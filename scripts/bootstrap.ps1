# Bootstrap everything on Windows (PowerShell 5+).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
$ErrorActionPreference = "Stop"

Write-Host "== Jarvis OS bootstrap ==" -ForegroundColor Cyan

# 1) Node workspace deps
Write-Host "[1/4] npm workspaces install..." -ForegroundColor Yellow
npm install --workspaces --include-workspace-root
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

# 2) Build shared package (needed by desktop typecheck/build)
Write-Host "[2/4] build @jarvis/shared..." -ForegroundColor Yellow
npm run build --workspace packages/shared
if ($LASTEXITCODE -ne 0) { throw "shared build failed" }

# 3) Python venv + orchestrator deps
if (-not (Test-Path ".venv")) {
  Write-Host "[3/4] creating venv + installing service deps..." -ForegroundColor Yellow
  python -m venv .venv
  .\.venv\Scripts\python -m pip install --upgrade pip --quiet
  .\.venv\Scripts\python -m pip install -r services/ai-orchestrator/requirements.txt
  if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
} else {
  Write-Host "[3/4] venv exists — skipping pip install (run .\.venv\Scripts\pip install -r services/ai-orchestrator/requirements.txt to refresh)" -ForegroundColor DarkGray
}

# 4) Rust core (optional — skipped when rustup is absent; app runs with engine offline)
if (Get-Command cargo -ErrorAction SilentlyContinue) {
  Write-Host "[4/4] building Rust core (this compiles ~1-3 min)..." -ForegroundColor Yellow
  npm run core:build
  if (Test-Path ".\core\target\release\ai_os_core.dll") {
    Copy-Item ".\core\target\release\ai_os_core.dll" ".\core\ai_os_core.node" -Force
    Write-Host "      core ready: core/ai_os_core.node" -ForegroundColor Green
  }
} else {
  Write-Host "[4/4] cargo not found — skipping Rust core (desktop will boot with 'engine offline' banner)" -ForegroundColor DarkYellow
  Write-Host "      install rust: https://rustup.rs  then: npm run core:build" -ForegroundColor DarkYellow
}

Write-Host "`nDone. Next:  npm run dev   (or see scripts/dev.ps1)" -ForegroundColor Green
