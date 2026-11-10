# Client acceptance smoke — ASCII only for Windows PowerShell
$ErrorActionPreference = 'Continue'
$fail = 0
function Ok([string]$m) { Write-Host "OK  $m" -ForegroundColor Green }
function Bad([string]$m) { Write-Host "FAIL $m" -ForegroundColor Red; $script:fail++ }

try {
  $h = Invoke-RestMethod http://localhost:3000/health
  if ($h.status -eq 'ok') { Ok 'health' } else { Bad 'health' }
} catch { Bad "health $($_.Exception.Message)" }

try {
  $r = Invoke-RestMethod http://localhost:3000/ready
  if ($r.status -eq 'ready' -and $r.checks.postgis) {
    Ok "ready postgis=$($r.checks.postgis) ops=$($r.checks.council_ops)"
  } else { Bad 'ready not ready' }
} catch { Bad "ready $($_.Exception.Message)" }

try {
  $c = Invoke-RestMethod http://localhost:3000/api/auth/captcha
  if ($c.data.image -and $c.data.challenge) { Ok 'captcha image' } else { Bad 'captcha shape' }
} catch { Bad "captcha $($_.Exception.Message)" }

try {
  $login = Invoke-RestMethod -Method POST http://localhost:3000/api/auth/login -ContentType 'application/json' -Body (@{ email='demo.planner@vungu.test'; password='demo1234' } | ConvertTo-Json)
  $token = $login.data.token
  $hdr = @{ Authorization = "Bearer $token" }
  Ok "planner login $($login.data.user.role)"
} catch {
  Bad "login $($_.Exception.Message)"
  Write-Host "SMOKE ABORTED"
  exit 1
}

try {
  $layers = Invoke-RestMethod http://localhost:3000/api/tiles/layers -Headers $hdr
  $n = @($layers.data).Count
  if ($n -gt 0) { Ok "tile layers $n" } else { Bad 'no tile layers' }
} catch { Bad "tiles $($_.Exception.Message)" }

try {
  $themes = Invoke-RestMethod http://localhost:3000/api/ops/master-themes -Headers $hdr
  Ok "master themes $(@($themes.data).Count)"
} catch { Bad "themes $($_.Exception.Message)" }

try {
  $pdf = Invoke-WebRequest -Method POST http://localhost:3000/api/ops/council-map-report -Headers $hdr -ContentType 'application/json' -Body '{}' -UseBasicParsing
  if ($pdf.StatusCode -eq 200) { Ok "council map PDF $($pdf.RawContentLength)b" } else { Bad 'council map PDF' }
} catch { Bad "council map $($_.Exception.Message)" }

try {
  $list = Invoke-RestMethod 'http://localhost:3000/api/permit-applications?limit=1' -Headers $hdr
  $id = $list.data[0].id
  try {
    Invoke-RestMethod -Method PATCH "http://localhost:3000/api/permit-applications/$id/status" -Headers $hdr -ContentType 'application/json' -Body (@{ status='approved'; expectedRevision=0 } | ConvertTo-Json) | Out-Null
    Bad 'planner was allowed to approve'
  } catch {
    $body = $_.ErrorDetails.Message
    if ($body -match 'eo_decision_required') { Ok 'EO gate blocks planner approve' }
    else { Bad "unexpected gate: $body" }
  }
} catch { Bad "permit list $($_.Exception.Message)" }

if ($fail -eq 0) {
  Write-Host ''
  Write-Host 'ALL CHECKS PASSED - ready for client pilot demo.' -ForegroundColor Green
  exit 0
}
Write-Host ''
Write-Host "$fail check(s) failed." -ForegroundColor Red
exit 1
