param(
  [string]$NodeExe = "",
  [switch]$SkipFrontendBuild,
  [switch]$SkipBackendInstall
)

$ErrorActionPreference = 'Stop'
$FrontendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendRoot = (Resolve-Path (Join-Path $FrontendRoot '..\backend')).Path
$ResourcesRoot = Join-Path $FrontendRoot 'src-tauri\resources'
$StackRoot = Join-Path $ResourcesRoot 'local-stack'
$BundledNode = Join-Path $ResourcesRoot 'node\node.exe'

if (-not $NodeExe) {
  $NodeCommand = Get-Command node.exe -ErrorAction Stop
  $NodeExe = $NodeCommand.Source
}
if (-not (Test-Path $NodeExe)) { throw "Node executable not found: $NodeExe" }

if (-not $SkipFrontendBuild) {
  Push-Location $FrontendRoot
  try { & npm.cmd run build:fast; if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' } }
  finally { Pop-Location }
}

$FrontendDist = Join-Path $FrontendRoot 'dist'
if (-not (Test-Path (Join-Path $FrontendDist 'index.html'))) {
  throw "Built frontend was not found at $FrontendDist. Run npm run build first."
}

$PostgresBin = ''
$Candidates = @(
  'C:\Program Files\PostgreSQL\18\bin',
  'C:\Program Files\PostgreSQL\17\bin',
  'C:\Program Files\PostgreSQL\16\bin',
  "$env:USERPROFILE\scoop\apps\postgresql\current\bin"
)
foreach ($Candidate in $Candidates) {
  if ((Test-Path (Join-Path $Candidate 'pg_ctl.exe')) -and (Test-Path (Join-Path (Split-Path $Candidate) 'share\extension\postgis.control'))) {
    $PostgresBin = $Candidate
    break
  }
}
if (-not $PostgresBin) {
  throw 'PostgreSQL with the matching PostGIS extension was not found in a standard install path. Install it before preparing the desktop package.'
}

if (Test-Path $StackRoot) { Remove-Item $StackRoot -Recurse -Force }
New-Item -ItemType Directory -Path $StackRoot -Force | Out-Null
$BackendDest = Join-Path $StackRoot 'backend'
New-Item -ItemType Directory -Path $BackendDest -Force | Out-Null

$BackendItems = @('server.js', 'package.json', 'package-lock.json', 'migrations', 'scripts', 'src', 'routes', 'qgis-projects')
$BackendIgnore = @('node_modules', 'uploads', 'backups', '.git', '.env', '.env.example')
foreach ($Item in $BackendItems) {
  $Source = Join-Path $BackendRoot $Item
  if (Test-Path $Source) {
    $Target = Join-Path $BackendDest $Item
    if ((Get-Item $Source).PSIsContainer) {
      New-Item -ItemType Directory -Path $Target -Force | Out-Null
      $RobocopyArgs = @($Source, $Target, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
      foreach ($Ignored in $BackendIgnore) { $RobocopyArgs += @('/XD', $Ignored) }
      & robocopy.exe @RobocopyArgs | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "Failed staging $Item (robocopy exit $LASTEXITCODE)." }
    } else {
      Copy-Item $Source -Destination $Target -Force
    }
  }
}
$PgRuntimeDest = Join-Path $ResourcesRoot 'postgres'
if (Test-Path $PgRuntimeDest) { Remove-Item $PgRuntimeDest -Recurse -Force }
New-Item -ItemType Directory -Path $PgRuntimeDest -Force | Out-Null
$PgRoot = Split-Path $PostgresBin
foreach ($Item in @('bin', 'lib', 'share')) {
  $Source = Join-Path $PgRoot $Item
  if (Test-Path $Source) {
    $Target = Join-Path $PgRuntimeDest $Item
    $RobocopyArgs = @($Source, $Target, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
    if ($Item -eq 'share') { $RobocopyArgs += @('/XD', 'doc', 'docs', 'tutorial') }
    & robocopy.exe @RobocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Failed staging PostgreSQL $Item (robocopy exit $LASTEXITCODE)." }
  }
}
# Do NOT npm-install into the staged tree for Tauri embed: walking
# node_modules via resources/** overflows the Windows build-script stack.
# First launch / start_local_stack should npm install into a writable app-data copy.
if (-not $SkipBackendInstall) {
  Write-Host 'Skipping npm install into staged backend (Tauri resource embed limit).' -ForegroundColor Yellow
  Write-Host 'Runtime will install production deps into app-data on first launch.'
}
# Postgres binaries are found at runtime (Scoop / Program Files); do not embed ~400MB.
if (Test-Path $PgRuntimeDest) {
  Write-Host "Removing staged Postgres from resources (use system/Scoop PG): $PgRuntimeDest" -ForegroundColor Yellow
  Remove-Item $PgRuntimeDest -Recurse -Force
}
New-Item -ItemType Directory -Path (Split-Path $BundledNode) -Force | Out-Null
Copy-Item $NodeExe -Destination $BundledNode -Force

Write-Host ''
Write-Host 'Prepared the Tauri desktop runtime resources:' -ForegroundColor Green
Write-Host "  $StackRoot"
Write-Host "  $BundledNode"
Write-Host "  System PostgreSQL expected at: $PostgresBin"
Write-Host ''
Write-Host 'PostgreSQL/PostGIS is NOT embedded (build-script stack overflow on Windows).'
Write-Host 'The national GeoPackage source data must be provisioned separately before full GIS layers appear.'
Write-Host 'A private PostgreSQL password is generated at first launch and stored in app config.'
