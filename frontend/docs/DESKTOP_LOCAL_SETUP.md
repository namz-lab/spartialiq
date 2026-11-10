# SpartialIQ Local Desktop setup

This workspace already has a Tauri shell, a Fastify API, PostgreSQL migrations, PostGIS spatial import tooling and QGIS project files. The desktop work wires those existing parts into a Windows-first local runtime. It does **not** turn remote/proprietary GIS sources into bundled data, and it does not silently connect to the production database.

## What is local

- **Desktop UI:** the Vue/Vite frontend, packaged in a Tauri WebView.
- **API:** the existing Fastify backend, launched as a child process on `127.0.0.1:3000`.
- **Database:** a separate PostgreSQL cluster in the current Windows user's app-data directory, database `spartialiq_local`, on `127.0.0.1:55432`. PostGIS and pgcrypto are enabled there; the checked-in migration runner provisions the app schema and records applied migrations in `schema_migrations`.
- **Uploaded files:** kept in the user's app-data `uploads` directory instead of inside the installer.
- **GIS editing/rendering:** use QGIS Desktop against that local PostGIS database via the generated service file. The QGIS project is included with the backend runtime. QGIS Server is not yet launched by this desktop package; the browser map can use the existing PostGIS vector-tile path without it.

The local database is its own database and data folder. It is not the council's production database. No automatic production-data copy is made. The desktop seed command can create demo accounts in this local database.

## Windows prerequisites for the current build

1. For a development build, install PostgreSQL with the PostGIS extension. The desktop build stages those PostgreSQL/PostGIS runtime binaries into the installer.
2. Install QGIS Desktop (which provides GDAL/`ogr2ogr` for loading GeoPackages). The current launcher prepares PostGIS and the API; the GIS data import is a separate explicit step.
3. For building the installer, install the Rust MSVC toolchain and the Tauri Windows build prerequisites.

## Build the Windows app

From `frontend/`, install frontend dependencies if needed, then run:

- `npm install`
- `npm run desktop:build`

`desktop:prepare` builds the Vue app, stages the backend production dependencies and source, and bundles the Node executable from the current machine. On first application launch, the shell creates `%APPDATA%\zw.gov.vungu.spatialiq.local\desktop.env` with a random PostgreSQL password; do not share that file. `tauri:build` then emits the Windows installer/bundle under `frontend/src-tauri/target/release/bundle/`.

The runtime installer is Windows-specific. It bundles PostgreSQL/PostGIS and Node from the build machine. QGIS Desktop/GDAL and the large GIS source datasets remain external prerequisites; this is not yet a fully self-contained offline GIS installer.

## First launch and database setup

Start SpartialIQ Local. It initializes its app-owned PostgreSQL data directory on first launch, starts the database, creates the `spartialiq_local` database, enables extensions, runs `backend/scripts/migrate-render.js` against **only** `127.0.0.1:55432`, and then starts Fastify. The database files persist when the app exits; closing the app stops its child processes but does not delete database records.

The connection URL is constructed by the desktop shell, not read from the backend `.env`; the production `DATABASE_URL` is never used by the packaged local shell. If demo accounts are needed, run `npm run desktop:seed` in the staged backend directory with the app-local connection URL from `%APPDATA%\zw.gov.vungu.spatialiq.local\desktop.env` configured as `DATABASE_URL`.

## Load GIS source data

The migrations create application tables but do not recreate the large national basemap. The complete spatial dataset needs the two GeoPackages (`zimbabwe.gpkg`, about 1.47 GB, and `Vungu_RDC_Master_Plan.gpkg`) and a GDAL `ogr2ogr` build with the PostgreSQL driver. These inputs are intentionally not shipped in Git. The desktop staging script excludes `.env` files, uploaded records, backups, and Git metadata from the installer.

For a local development checkout, after downloading/providing those source files and confirming the desktop PostGIS instance is running, import them with `backend/scripts/setup-spatial.mjs`, setting its `DATABASE_URL` to the local database only and `OGR2OGR` to QGIS's PostgreSQL-enabled `ogr2ogr`. Read that script first: its import steps use `-overwrite` for spatial tables. Do not aim it at production or a database containing records you need to preserve. Then verify layers with `backend/scripts/verify-spatial-tables.js`.

A distributable with all map content therefore needs an approved way to distribute the GeoPackages or a prepared local database backup. The installer builder deliberately does not silently embed the 1.47-GB source.

## Connect QGIS Desktop

On first launch the desktop app writes the credential-bearing QGIS service config privately to `%APPDATA%\zw.gov.vungu.spatialiq.local\pg_service.conf`. Set the `PGSERVICEFILE` environment variable for QGIS Desktop to that path, or copy it to `%APPDATA%\postgresql\pg_service.conf` (keep it private and never commit it). The service is configured for `127.0.0.1`, port `55432`, database `spartialiq_local`, and service name `vungu`; if you change the port in `desktop.env`, restart the desktop app so it regenerates this file.

QGIS Server's `docker-compose.qgis.yml` remains a separate optional setup for pixel-exact WMS rendering; the desktop app does not start it yet. PostgreSQL listens only on loopback. The PostGIS vector tile map path is the supported local mode.

## Demo users

Demo seeding is disabled by default. Run `npm run desktop:seed` in the backend with `DATABASE_URL` set to the app's local database URL to create demo-only local accounts. This command refuses any database not named `spartialiq_local` on `127.0.0.1:55432`. Its default password is `demo1234`; change it with `DEMO_DEFAULT_PASSWORD` before sharing a demo workstation.

## Backups

The PostgreSQL data directory and uploaded files live under the user's local app-data directory. Back up both before moving machines or applying destructive schema/data operations. The bundled PostgreSQL runtime includes dump tools; the backend backup script can create database dumps. Also copy the `uploads` directory. Reinstalling/upgrading the app should not overwrite either folder.

## Current scope and validation

This is a local-stack foundation, not yet a signed, self-contained municipal installer. It currently assumes Windows and a build machine that can provide PostgreSQL with PostGIS. It does not copy the production database, configure remote sync, start QGIS Server, or package the large national map data. Test on a disposable machine and a fresh local data directory before distributing it to council staff.
