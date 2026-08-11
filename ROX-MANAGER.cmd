@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ROX-PREFLIGHT.ps1" -Quiet
if errorlevel 1 (
  echo.
  echo ROX Manager stopped because a PowerShell script has a syntax error.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ROX-MANAGER.ps1"
