@echo off
setlocal

cd /d "%~dp0"
title StepView Desktop Launcher

echo.
echo ==============================
echo   StepView Desktop Launcher
echo ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Please install Node.js 18 or newer.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please reinstall Node.js.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/2] Installing dependencies for first run...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed. Check your network or npm config.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependencies found. Updating if needed...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency update failed. Check your network or npm config.
    pause
    exit /b 1
  )
)

echo [2/2] Starting StepView desktop app...
echo.
call npm.cmd run desktop

pause