# Copy the latest NSIS installer to Desktop and INSTALLERS/ for easy find.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$nsis = Join-Path $root 'src-tauri\target\release\bundle\nsis'
$src = Get-ChildItem $nsis -Filter '*setup.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $src) {
  Write-Error "No installer in $nsis. Run: npm run desktop:build (with TAURI_SIGNING_PRIVATE_KEY set)."
}

$outDir = Join-Path $root 'INSTALLERS'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$safeName = ($src.Name -replace '\s+', '_')
$destRepo = Join-Path $outDir $safeName
$destDesk = Join-Path $env:USERPROFILE "Desktop\$safeName"

Copy-Item -Force $src.FullName $destRepo
Copy-Item -Force $src.FullName $destDesk

$sig = Get-Item ($src.FullName + '.sig') -ErrorAction SilentlyContinue
if ($sig) {
  Copy-Item -Force $sig.FullName (Join-Path $outDir ($safeName + '.sig'))
}

Write-Host "Installer ready:"
Write-Host "  $destRepo"
Write-Host "  $destDesk"
Write-Host ("  Size: {0:N1} MB" -f ($src.Length / 1MB))
