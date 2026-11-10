use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use std::fs;
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct LocalStack(Mutex<Option<StackProcesses>>);

#[derive(Default)]
struct StackProcesses {
    postgres: Option<Child>,
    backend: Option<Child>,
    postgres_bin: Option<PathBuf>,
    postgres_data: Option<PathBuf>,
    postgres_password: Option<String>,
}

#[derive(Clone, Serialize)]
struct StackStatus {
    phase: String,
    message: String,
    postgres: bool,
    backend: bool,
    qgis: bool,
}

fn emit_status(app: &AppHandle, status: StackStatus) {
    let _ = app.emit("local-stack-status", status);
}

fn resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|error| format!("Cannot locate installed app resources: {error}"))
}

fn load_desktop_env(app: &AppHandle) -> Result<(), String> {
    let config = app.path().app_config_dir().map_err(|error| error.to_string())?;
    let path = config.join("desktop.env");
    if !path.exists() {
        return Ok(());
    }
    let contents = fs::read_to_string(path).map_err(|error| format!("Cannot read desktop config: {error}"))?;
    for line in contents.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')) {
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            if matches!(key, "SPARTIALIQ_DB_PORT" | "SPARTIALIQ_DB_PASSWORD" | "SPARTIALIQ_PG_BIN" | "SPARTIALIQ_NODE_EXE") {
                std::env::set_var(key, value.trim().trim_matches('"'));
            }
        }
    }
    Ok(())
}

fn read_http_line(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let line = text.lines().map(str::trim).find(|line| line.starts_with("http"))?;
    Some(line.trim_end_matches('/').to_string())
}

/// Public council address. A line in hosted-server.txt or SPARTIALIQ_WEB_URL
/// wins over the copy packaged with the installer, so the same program can
/// follow the server when it moves.
fn hosted_web_url_value(app: &AppHandle) -> Option<String> {
    if let Ok(value) = std::env::var("SPARTIALIQ_WEB_URL") {
        let value = value.trim().trim_end_matches('/').to_string();
        if value.starts_with("http") {
            return Some(value);
        }
    }
    let mut files = Vec::new();
    if let Ok(config) = app.path().app_config_dir() {
        files.push(config.join("hosted-server.txt"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            files.push(dir.join("hosted-server.txt"));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        files.push(resources.join("hosted-server.txt"));
        files.push(resources.join("resources").join("hosted-server.txt"));
    }
    files.into_iter().find_map(|path| read_http_line(&path))
}

#[tauri::command]
fn hosted_web_url(app: AppHandle) -> Option<String> {
    let url = hosted_web_url_value(&app)?;
    if let Ok(parsed) = url.parse::<tauri::Url>() {
        if let Some(window) = app.get_webview_window("main") {
            let already = window
                .url()
                .ok()
                .map(|current| current.origin() == parsed.origin())
                .unwrap_or(false);
            if !already {
                let _ = window.navigate(parsed);
            }
        }
    }
    Some(url)
}

/// Folders that may hold the packaged backend and Node runtime.
/// On Windows the installer puts them in `{exe}\resources`, while
/// `resource_dir()` sometimes returns the folder that contains `resources`.
fn search_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = resource_dir(app) {
        roots.push(dir.join("resources"));
        roots.push(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("resources"));
            roots.push(dir.to_path_buf());
        }
    }
    roots
}

fn install_root(app: &AppHandle) -> Result<PathBuf, String> {
    let roots = search_roots(app);
    for root in &roots {
        let stack = root.join("local-stack");
        if stack.join("backend").join("server.js").exists() {
            return Ok(stack);
        }
    }
    let looked = roots
        .iter()
        .map(|root| root.join("local-stack").display().to_string())
        .collect::<Vec<_>>()
        .join("; ");
    Err(format!(
        "The local stack is not packaged. Looked in: {looked}. See the desktop setup guide."
    ))
}

/// Recursive copy used to materialise the packaged backend into writable app-data.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|error| format!("Cannot create {}: {error}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|error| format!("Cannot read {}: {error}", src.display()))? {
        let entry = entry.map_err(|error| format!("Cannot read directory entry: {error}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|error| format!("Cannot copy {} → {}: {error}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

fn runtime_exe(app: &AppHandle) -> Result<PathBuf, String> {
    for root in search_roots(app) {
        let bundled_node = root.join("node").join("node.exe");
        if bundled_node.exists() {
            return Ok(bundled_node);
        }
    }
    if let Ok(path) = std::env::var("SPARTIALIQ_NODE_EXE") {
        return Ok(PathBuf::from(path));
    }
    Ok(PathBuf::from("node.exe"))
}

fn find_postgres_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled_bin = resource_dir(app)?.join("postgres").join("bin");
    if bundled_bin.join("pg_ctl.exe").exists() {
        return Ok(bundled_bin);
    }
    if let Some(value) = std::env::var_os("SPARTIALIQ_PG_BIN") {
        let candidate = PathBuf::from(value);
        if candidate.join("pg_ctl.exe").exists() {
            return Ok(candidate);
        }
        return Err(format!("SPARTIALIQ_PG_BIN has no pg_ctl.exe: {}", candidate.display()));
    }
    let mut roots = vec![PathBuf::from(r"C:\Program Files\PostgreSQL")];
    if let Some(home) = std::env::var_os("USERPROFILE") {
        roots.push(PathBuf::from(home).join("scoop/apps/postgresql/current/bin"));
    }
    if let Some(local) = app.path().app_local_data_dir().ok() {
        roots.push(local.join("runtime/postgresql/bin"));
    }
    for root in roots {
        if root.join("pg_ctl.exe").exists() {
            return Ok(root);
        }
        if root.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&root) {
                let mut entries = entries.flatten().collect::<Vec<_>>();
                entries.sort_by_key(|entry| entry.file_name());
                for entry in entries.into_iter().rev() {
                    let candidate = entry.path().join("bin");
                    if candidate.join("pg_ctl.exe").exists() {
                        return Ok(candidate);
                    }
                }
            }
        }
    }
    Err("PostgreSQL binaries were not found. Install PostgreSQL 16 with PostGIS and set SPARTIALIQ_PG_BIN to its bin folder.".into())
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Cannot locate writable app data folder: {error}"))?;
    Ok(local.join("postgres-data"))
}

fn database_url(port: &str, password: &str) -> String {
    format!("postgresql://postgres:{password}@127.0.0.1:{port}/spartialiq_local")
}

fn write_qgis_service_file(app: &AppHandle, port: &str, password: &str) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| format!("Cannot create desktop config directory: {error}"))?;
    let path = config_dir.join("pg_service.conf");
    let passfile = config_dir.join("pgpass.conf").display().to_string().replace('\\', "/");
    let contents = format!("[vungu]\nhost=127.0.0.1\nport={port}\ndbname=spartialiq_local\nuser=postgres\npassfile={passfile}\nsslmode=disable\n");
    fs::write(&path, contents).map_err(|error| format!("Cannot write local QGIS Postgres service file: {error}"))?;
    Ok(path)
}

fn create_pgpass(app: &AppHandle, port: &str, password: &str) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    let path = config_dir.join("pgpass.conf");
    let escaped_password = password.replace('\\', "\\\\").replace(':', "\\:").replace('\n', "");
    fs::write(&path, format!("127.0.0.1:{port}:*:*:{escaped_password}\n"))
        .map_err(|error| format!("Cannot write private local Postgres password file: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Cannot restrict local Postgres password file permissions: {error}"))?;
    }
    Ok(path)
}

fn spawn_logged(app: &AppHandle, mut command: Command, label: &'static str) -> Result<Child, String> {
    command.creation_flags(CREATE_NO_WINDOW);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("Could not start {label}: {error}"))?;
    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                let _ = app.emit("local-stack-log", format!("[{label}] {line}"));
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                let _ = app.emit("local-stack-log", format!("[{label}] {line}"));
            }
        });
    }
    Ok(child)
}

fn api_already_running() -> bool {
    let address: std::net::SocketAddr = match "127.0.0.1:3000".parse() {
        Ok(address) => address,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_secs(2)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream
        .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut body = String::new();
    let _ = stream.read_to_string(&mut body);
    body.contains("spartialiq-backend")
}

fn existing_council_database() -> Option<String> {
    if TcpStream::connect(("127.0.0.1", 5432)).is_ok() {
        Some("postgresql://postgres@127.0.0.1:5432/vungu_master_db_v1".into())
    } else {
        None
    }
}

fn wait_for_port(port: u16, child: &mut Child, label: &str) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("{label} exited during startup with {status}"));
        }
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("Timed out waiting for {label} on 127.0.0.1:{port}"));
        }
        thread::sleep(Duration::from_millis(350));
    }
}

fn stop_child(child: &mut Option<Child>) {
    if let Some(mut process) = child.take() {
        let _ = process.kill();
        let _ = process.wait();
    }
}

fn stop_stack(stack: &mut StackProcesses) {
    stop_child(&mut stack.backend);
    if let (Some(bin), Some(data)) = (&stack.postgres_bin, &stack.postgres_data) {
        let mut stop = Command::new(bin.join("pg_ctl.exe"));
        stop.creation_flags(CREATE_NO_WINDOW);
        if let Some(password) = &stack.postgres_password { stop.env("PGPASSWORD", password); }
        let _ = stop.args(["-D", data.to_string_lossy().as_ref(), "-m", "fast", "-w", "stop"]).status();
    }
    if let Some(mut postgres) = stack.postgres.take() {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if postgres.try_wait().ok().flatten().is_some() { return; }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = postgres.kill();
        let _ = postgres.wait();
    }
}

#[cfg(target_os = "windows")]
fn postgres_start(bin: &Path, data: &Path, port: &str) -> Command {
    let mut command = Command::new(bin.join("postgres.exe"));
    command.args(["-D", data.to_string_lossy().as_ref(), "-p", port, "-h", "127.0.0.1"]);
    command
}

#[tauri::command]
async fn start_local_stack(app: AppHandle, state: tauri::State<'_, Arc<LocalStack>>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut guard = state.0.lock().map_err(|_| "Local stack lock failed".to_string())?;
            if guard.is_some() {
                return Ok(());
            }
            *guard = Some(StackProcesses::default());
        }

        let result = (|| {
            load_desktop_env(&app)?;
            if api_already_running() {
                emit_status(&app, StackStatus {
                    phase: "ready".into(),
                    message: "The council API is already running on this computer.".into(),
                    postgres: true,
                    backend: true,
                    qgis: false,
                });
                return Ok(());
            }
            let root = install_root(&app)?;
            let bin = find_postgres_bin(&app)?;
            let pg_lib = resource_dir(&app)?.join("postgres").join("lib");
            let pg_share = resource_dir(&app)?.join("postgres").join("share");
            let has_bundled_pg = pg_lib.exists() && pg_share.join("extension").join("postgis.control").exists();
            let data = data_dir(&app)?;
            let backend_dir = root.join("backend");
            let port = std::env::var("SPARTIALIQ_DB_PORT").unwrap_or_else(|_| "55432".into());
            let port_number = port.parse::<u16>().map_err(|_| "SPARTIALIQ_DB_PORT must be a valid port number".to_string())?;
            let config_dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
            fs::create_dir_all(&config_dir).map_err(|error| format!("Cannot create desktop config directory: {error}"))?;
            let stored_password = std::env::var("SPARTIALIQ_DB_PASSWORD").unwrap_or_default();
            let password = if stored_password.is_empty() {
                let mut bytes = [0_u8; 32];
                getrandom::fill(&mut bytes).map_err(|error| format!("Cannot generate local database password: {error}"))?;
                let generated = bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
                let mut config = fs::OpenOptions::new().create(true).append(true).open(config_dir.join("desktop.env"))
                    .map_err(|error| format!("Cannot save local database password: {error}"))?;
                std::io::Write::write_all(&mut config, format!("\nSPARTIALIQ_DB_PASSWORD={generated}\n").as_bytes())
                    .map_err(|error| format!("Cannot save local database password: {error}"))?;
                generated
            } else {
                stored_password
            };
            let fresh_database_url = database_url(&port, &password);
            let attached_database = existing_council_database();
            let qgis_service_file = write_qgis_service_file(&app, &port, &password)?;
            let pgpass_file = create_pgpass(&app, &port, &password)?;
            let uploads_dir = data_dir(&app)?.parent().ok_or("Local app data directory missing")?.join("uploads");
            fs::create_dir_all(&uploads_dir).map_err(|error| format!("Cannot create local uploads directory: {error}"))?;

            if attached_database.is_none() {
            emit_status(&app, StackStatus { phase: "starting".into(), message: "Starting local PostGIS…".into(), postgres: false, backend: false, qgis: false });
            if !data.join("PG_VERSION").exists() {
                std::fs::create_dir_all(&data).map_err(|error| format!("Cannot create local database folder: {error}"))?;
                let mut init = Command::new(bin.join("initdb.exe"));
                init.creation_flags(CREATE_NO_WINDOW);
                let pwfile = data.with_extension("pwfile");
                fs::write(&pwfile, &password).map_err(|error| format!("Cannot write temporary database password file: {error}"))?;
                init.args(["-D", data.to_string_lossy().as_ref(), "-U", "postgres", "-A", "scram-sha-256", "--pwfile", pwfile.to_string_lossy().as_ref(), "-E", "UTF8", "--locale=C"]);
                if has_bundled_pg {
                    init.env("PATH", format!("{};{}", bin.display(), std::env::var("PATH").unwrap_or_default()));
                    init.env("PGSHAREDIR", &pg_share);
                    init.env("PGLIB", &pg_lib);
                }
                let output = init.output().map_err(|error| format!("Could not initialise local PostgreSQL: {error}"))?;
                let _ = fs::remove_file(&pwfile);
                if !output.status.success() {
                    return Err(format!("initdb failed: {}", String::from_utf8_lossy(&output.stderr)));
                }
            }
            let postgres_conf = data.join("postgresql.conf");
            let config = fs::read_to_string(&postgres_conf).map_err(|error| format!("Cannot read PostgreSQL settings: {error}"))?;
            if !config.lines().any(|line| line.trim() == format!("port = {port}") || line.trim() == format!("port={port}")) {
                fs::OpenOptions::new()
                    .append(true)
                    .open(postgres_conf)
                    .and_then(|mut file| std::io::Write::write_all(&mut file, format!("\nport = {port}\n").as_bytes()))
                    .map_err(|error| format!("Cannot configure local database port: {error}"))?;
            }
            if TcpStream::connect(("127.0.0.1", port_number)).is_ok() {
                return Err(format!("Port {port_number} is already in use. Set SPARTIALIQ_DB_PORT in desktop.env to a free local port."));
            }
            let mut pg = postgres_start(&bin, &data, &port);
            if has_bundled_pg {
                pg.env("PATH", format!("{};{}", bin.display(), std::env::var("PATH").unwrap_or_default()));
                pg.env("PGSHAREDIR", &pg_share);
                pg.env("PGLIB", &pg_lib);
            }
            let mut pg_child = spawn_logged(&app, pg, "postgres")?;
            if let Err(error) = wait_for_port(port_number, &mut pg_child, "PostgreSQL") {
                let _ = pg_child.kill();
                let _ = pg_child.wait();
                return Err(error);
            }
            state.0.lock().map_err(|_| "Local stack lock failed".to_string())?.as_mut().ok_or("Local stack state missing")?.postgres = Some(pg_child);
            {
                let mut guard = state.0.lock().map_err(|_| "Local stack lock failed".to_string())?;
                let stack = guard.as_mut().ok_or("Local stack state missing")?;
                stack.postgres_bin = Some(bin.clone());
                stack.postgres_data = Some(data.clone());
                stack.postgres_password = Some(password.clone());
            }

            emit_status(&app, StackStatus { phase: "starting".into(), message: "Preparing local database…".into(), postgres: true, backend: false, qgis: false });
            let pgpass_file = pgpass_file.canonicalize().unwrap_or(pgpass_file);
            let mut ensure_db = Command::new(bin.join("createdb.exe"));
            ensure_db.creation_flags(CREATE_NO_WINDOW);
            if has_bundled_pg { ensure_db.env("PATH", format!("{};{}", bin.display(), std::env::var("PATH").unwrap_or_default())); }
            ensure_db.args(["-h", "127.0.0.1", "-p", &port, "-U", "postgres", "spartialiq_local"]);
            ensure_db.env("PGPASSFILE", &pgpass_file);
            let _ = ensure_db.status(); // Existing database is an expected restart condition.
            let mut enable_postgis = Command::new(bin.join("psql.exe"));
            enable_postgis.creation_flags(CREATE_NO_WINDOW);
            if has_bundled_pg {
                enable_postgis.env("PATH", format!("{};{}", bin.display(), std::env::var("PATH").unwrap_or_default()));
                enable_postgis.env("PGSHAREDIR", &pg_share);
                enable_postgis.env("PGLIB", &pg_lib);
            }
            enable_postgis.args(["-h", "127.0.0.1", "-p", &port, "-U", "postgres", "-d", "spartialiq_local", "-v", "ON_ERROR_STOP=1", "-c", "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"]);
            enable_postgis.env("PGPASSFILE", &pgpass_file);
            let extension = enable_postgis.output().map_err(|error| format!("Could not enable PostGIS: {error}"))?;
            if !extension.status.success() {
                return Err(format!("PostGIS setup failed. Install the PostGIS extension matching your PostgreSQL version: {}", String::from_utf8_lossy(&extension.stderr)));
            }
            }

            // Writable runtime copy: packaged tree has no node_modules (Tauri embed limit).
            let runtime_backend = data_dir(&app)?
                .parent()
                .ok_or("Local app data directory missing")?
                .join("runtime-backend");
            if !runtime_backend.join("server.js").exists() {
                emit_status(&app, StackStatus { phase: "starting".into(), message: "Copying backend into app data…".into(), postgres: true, backend: false, qgis: false });
                copy_dir_recursive(&backend_dir, &runtime_backend)?;
            }
            let node_exe = runtime_exe(&app)?;
            if !runtime_backend.join("node_modules").exists() {
                emit_status(&app, StackStatus { phase: "starting".into(), message: "Installing backend dependencies (first launch)…".into(), postgres: true, backend: false, qgis: false });
                // Prefer system npm.cmd; packaged node alone cannot always resolve npm.
                let npm_cmd = if PathBuf::from(r"C:\Program Files\nodejs\npm.cmd").exists() {
                    PathBuf::from(r"C:\Program Files\nodejs\npm.cmd")
                } else {
                    PathBuf::from("npm.cmd")
                };
                let mut install = Command::new(&npm_cmd);
                install.creation_flags(CREATE_NO_WINDOW);
                install.current_dir(&runtime_backend).args(["install", "--omit=dev"]);
                let installed = install.output().map_err(|error| format!("Could not install backend deps: {error}"))?;
                if !installed.status.success() {
                    return Err(format!(
                        "Backend npm install failed: {}",
                        String::from_utf8_lossy(&installed.stderr)
                    ));
                }
            }

            if attached_database.is_none() {
            emit_status(&app, StackStatus { phase: "starting".into(), message: "Applying local database migrations…".into(), postgres: true, backend: false, qgis: false });
            let mut migrate = Command::new(&node_exe);
            migrate.creation_flags(CREATE_NO_WINDOW);
            migrate.current_dir(&runtime_backend).arg("scripts/migrate.js");
            migrate.env("DATABASE_URL", &fresh_database_url).env("NODE_ENV", "development");
            let migrations = migrate.output().map_err(|error| format!("Could not run local migrations: {error}"))?;
            if !migrations.status.success() {
                return Err(format!("Database migrations failed: {}", String::from_utf8_lossy(&migrations.stderr)));
            }
            }
            let database_url = attached_database.unwrap_or(fresh_database_url);

            emit_status(&app, StackStatus { phase: "starting".into(), message: "Starting local API…".into(), postgres: true, backend: false, qgis: false });
            let mut backend = Command::new(&node_exe);
            backend.current_dir(&runtime_backend).arg("server.js");
            backend.env("DATABASE_URL", &database_url).env("NODE_ENV", "development").env("PORT", "3000").env("HOST", "127.0.0.1").env("SPARTIALIQ_DESKTOP", "1").env("JWT_SECRET", "spartialiq-desktop-local-secret-change-before-sharing-1234567890").env("COOKIE_SECRET", "spartialiq-desktop-local-cookie-secret-change-before-sharing").env("QGIS_SERVER_URL", "http://127.0.0.1:8080").env("QGIS_PROJECT", "/io/data/vungu-project.qgs").env("UPLOADS_DIR", &uploads_dir);
            let mut backend_child = spawn_logged(&app, backend, "backend")?;
            if let Err(error) = wait_for_port(3000, &mut backend_child, "Backend API") {
                let _ = backend_child.kill();
                let _ = backend_child.wait();
                return Err(error);
            }
            state.0.lock().map_err(|_| "Local stack lock failed".to_string())?.as_mut().ok_or("Local stack state missing")?.backend = Some(backend_child);
            emit_status(&app, StackStatus { phase: "starting".into(), message: "Preparing QGIS Desktop connection…".into(), postgres: true, backend: true, qgis: false });
            emit_status(&app, StackStatus { phase: "ready".into(), message: format!("Local app is ready. QGIS Desktop can connect using {}. QGIS Server is optional and requires separate Docker setup.", qgis_service_file.display()), postgres: true, backend: true, qgis: false });
            Ok(())
        })();

        if let Err(error) = &result {
            if let Ok(mut guard) = state.0.lock() {
                if let Some(stack) = guard.as_mut() { stop_stack(stack); }
                *guard = None;
            }
            emit_status(&app, StackStatus { phase: "error".into(), message: error.clone(), postgres: false, backend: false, qgis: false });
        }
        result
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn stop_local_stack(app: AppHandle, state: tauri::State<'_, Arc<LocalStack>>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Local stack lock failed".to_string())?;
    if let Some(stack) = guard.as_mut() { stop_stack(stack); }
    *guard = None;
    emit_status(&app, StackStatus { phase: "stopped".into(), message: "Local services stopped. Database files remain on this computer.".into(), postgres: false, backend: false, qgis: false });
    Ok(())
}

pub fn run() {
    let stack = Arc::new(LocalStack::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(stack.clone())
        .invoke_handler(tauri::generate_handler![hosted_web_url, start_local_stack, stop_local_stack])
        .build(tauri::generate_context!())
        .expect("error while building desktop application")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut guard) = stack.0.lock() {
                    if let Some(processes) = guard.as_mut() { stop_stack(processes); }
                    *guard = None;
                }
            }
        });
}
