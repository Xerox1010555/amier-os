@echo off
rem ══════════════════════════════════════════════════════════════════════════
rem  Amier OS — personal assistant, single-click launcher
rem  Double-click this file (or its Desktop shortcut) and the assistant boots:
rem  AI service (hidden) + the Amier OS window. First run bootstraps deps.
rem ══════════════════════════════════════════════════════════════════════════
setlocal
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo [amier] first run detected - bootstrapping (npm + venv + shared)...
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
)

if not exist "logs" mkdir "logs"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev.ps1

endlocal
