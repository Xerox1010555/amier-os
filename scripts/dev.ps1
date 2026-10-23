# Amier OS launcher (Windows): personal-assistant boot in ONE click.
# 1) loads services/ai-orchestrator/.env (provider key, secret, model, bind…)
# 2) picks the provider automatically: .env override > key detection > mock
# 3) starts the AI orchestrator (hidden) unless already healthy
# 4) starts the desktop app (vite + electron)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
$ErrorActionPreference = "Continue"

$servicePort = 8000

# ── .env (KEY=VALUE, # comments) ────────────────────────────────────────────
$envFile = Join-Path $PSScriptRoot "..\services\ai-orchestrator\.env"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
      $name = $Matches[1]; $value = $Matches[2].Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($name)) {
        [Environment]::SetEnvironmentVariable($name, $value)
      }
    }
  }
}

# ── provider: honor explicit override, else first key found, else mock ─────
function Test-Key([string]$name) {
  $v = [Environment]::GetEnvironmentVariable($name)
  return ($v -and $v.Trim() -ne "")
}
$providerSet = $env:JARVIS_LLM_PROVIDER
if ($providerSet -eq "mock") { $providerSet = $null }  # a plain .env default must not hide a real key
if (-not $providerSet) {
  if     (Test-Key "GEMINI_API_KEY")    { $env:JARVIS_LLM_PROVIDER = "gemini" }
  elseif (Test-Key "OPENAI_API_KEY")    { $env:JARVIS_LLM_PROVIDER = "openai" }
  elseif (Test-Key "ANTHROPIC_API_KEY") { $env:JARVIS_LLM_PROVIDER = "anthropic" }
  else { $env:JARVIS_LLM_PROVIDER = "mock" }
}
if (-not $env:JARVIS_SHARED_SECRET) { $env:JARVIS_SHARED_SECRET = "dev-local-secret" }

$serviceHealthy = $false
try {
  $res = Invoke-WebRequest -Uri "http://127.0.0.1:$servicePort/api/v1/health" -UseBasicParsing -TimeoutSec 2
  $serviceHealthy = ($res.StatusCode -eq 200)
} catch { $serviceHealthy = $false }

if (-not $serviceHealthy) {
  Write-Host "[amier] provider=$($env:JARVIS_LLM_PROVIDER) — starting AI orchestrator on :$servicePort" -ForegroundColor Yellow
  $venvPy = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
  $service = Start-Process -PassThru $venvPy -ArgumentList @(
    "-X","utf8","-m","uvicorn","main:app","--host","127.0.0.1","--port","$servicePort"
  ) -WorkingDirectory (Join-Path $PSScriptRoot "..\services\ai-orchestrator") -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Write-Host "  service pid: $($service.Id)" -ForegroundColor DarkGray
} else {
  Write-Host "[amier] orchestrator already healthy on :$servicePort" -ForegroundColor Green
}

# ── wait briefly for readiness, then boot the desktop shell ────────────────
$probe = 0
while ($probe -lt 10) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$servicePort/api/v1/health" -UseBasicParsing -TimeoutSec 1
    if ($r.StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Milliseconds 500; $probe += 1
}

Write-Host "[amier] starting desktop…" -ForegroundColor Yellow
npm run dev --workspace apps/desktop
