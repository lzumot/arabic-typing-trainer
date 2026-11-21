@echo off
setlocal
set PORT=8765
set FOUND=

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
  set FOUND=1
)

if defined FOUND (
  echo Trainer stopped.
) else (
  echo Trainer was not running.
)
timeout /t 2 >nul
