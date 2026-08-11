@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ROX-PREFLIGHT.ps1" -Quiet
if errorlevel 1 (
  echo.
  echo ROX Safe Bridge stopped before changing any file.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ROX-BRIDGE.ps1"
if errorlevel 1 pause
