# Dev orchestrator (Windows): start the AI service, then the desktop app.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
$ErrorActionPreference = "Continue"

$servicePort = 8000
$serviceHealthy = $false
try {
  $res = Invoke-WebRequest -Uri "http://127.0.0.1:$servicePort/api/v1/health" -UseBasicParsing -TimeoutSec 2
  $serviceHealthy = ($res.StatusCode -eq 200)
} catch { $serviceHealthy = $false }

if (-not $serviceHealthy) {
  Write-Host "Starting AI orchestrator on :$servicePort (mock provider until .env has keys)..." -ForegroundColor Yellow
  $env:JARVIS_LLM_PROVIDER = if ($env:JARVIS_LLM_PROVIDER) { $env:JARVIS_LLM_PROVIDER } else { "mock" }
  $env:JARVIS_SHARED_SECRET = if ($env:JARVIS_SHARED_SECRET) { $env:JARVIS_SHARED_SECRET } else { "dev-local-secret" }
  $service = Start-Process -PassThru ".\.venv\Scripts\python.exe" -ArgumentList @(
    "-X","utf8","-m","uvicorn","main:app","--host","127.0.0.1","--port","$servicePort"
  ) -WorkingDirectory "services/ai-orchestrator" -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Write-Host "  service pid: $($service.Id) (uvicorn.log tail: services/ai-orchestrator/)" -ForegroundColor DarkGray
}

Write-Host "Starting desktop (vite + electron)..." -ForegroundColor Yellow
npm run dev --workspace apps/desktop
