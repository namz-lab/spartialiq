# Start the full SpartialIQ stack including QGIS Server.
# Run from repo root:  powershell -File scripts/start-full-stack.ps1
#
# Prerequisites:
#   - Docker Desktop installed and running (for QGIS Server on :8080)
#   - PostgreSQL via Scoop (see .claude/skills/run-stack/SKILL.md)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$PgCtl = 'C:\Users\munya\scoop\apps\postgresql\current\bin\pg_ctl.exe'
$PgData = 'C:\Users\munya\scoop\apps\postgresql\current\data'

function Test-Port($port) {
  return Test-NetConnection localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
}

Write-Host "`n=== SpartialIQ full stack ===`n"

# 1. PostgreSQL
if (-not (Test-Port 5432)) {
  New-Item -ItemType Directory -Force (Join-Path $PgData 'log') | Out-Null
  & $PgCtl start -D $PgData -l (Join-Path $PgData 'log\startup.log') -w | Out-Null
}
Write-Host ($(if (Test-Port 5432) { '[OK]' } else { '[!!]' }) + ' PostgreSQL :5432')

# 2. QGIS Server (Docker)
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  Push-Location $Backend
  docker compose -f docker-compose.qgis.yml up -d 2>&1 | Out-Null
  Pop-Location
  Start-Sleep 5
  node (Join-Path $Backend 'scripts\verify-qgis-server.js')
} else {
  Write-Host '[!!] Docker not found — install Docker Desktop, then run:'
  Write-Host '     cd backend && docker compose -f docker-compose.qgis.yml up -d'
  Write-Host '     npm run qgis:verify'
}

# 3. Backend
if (-not (Test-Port 3000)) {
  Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$Backend'; npm run dev" -WindowStyle Minimized
  Start-Sleep 8
}
Write-Host ($(if (Test-Port 3000) { '[OK]' } else { '[!!]' }) + ' Backend :3000')

# 4. Frontend
if (-not (Test-Port 5174)) {
  Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$Frontend'; npm run dev -- --host" -WindowStyle Minimized
  Start-Sleep 8
}
Write-Host ($(if (Test-Port 5174) { '[OK]' } else { '[!!]' }) + ' Frontend :5174')

Write-Host "`nURLs:"
Write-Host "  App:     http://localhost:5174"
Write-Host "  API:     http://localhost:3000/health"
Write-Host "  OGC:     http://localhost:3000/api/ogc/health"
Write-Host "  QGIS:    http://localhost:8080/healthz`n"
