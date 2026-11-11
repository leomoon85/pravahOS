@echo off
rem ==============================================================================
rem  PravahOS Standalone Desktop Application Launcher (Windows Batch)
rem  Launches local microkernel web server and opens standalone Chromium app window.
rem ==============================================================================

setlocal enabledelayedexpansion
title PravahOS Desktop Launcher

cd /d "%~dp0"

set "TARGET_PORT=8080"
set "APP_URL=http://localhost:%TARGET_PORT%/emulator/"

echo.
echo ======================================================
echo   PravahOS Mobile Platform Desktop Launcher
echo ======================================================
echo.

rem Check if server is already listening on port 8080
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort %TARGET_PORT% -State Listen -ErrorAction SilentlyContinue) -ne $null" > "%TEMP%\pravah_port_check.txt" 2>&1
set /p PORT_ACTIVE=<"%TEMP%\pravah_port_check.txt"
del /f /q "%TEMP%\pravah_port_check.txt" >nul 2>&1

if "%PORT_ACTIVE%"=="True" (
    echo [*] PravahOS server already active on port %TARGET_PORT%.
) else (
    echo [*] Starting PravahOS server (node serve.js)...
    start /B "" node serve.js
    rem Wait 1.5 seconds for socket binding
    powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500"
)

rem Locate Chromium-based browser for --app mode
set "BROWSER_BIN="

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_BIN=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_BIN=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_BIN=%LocalAppData%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_BIN=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_BIN=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_BIN=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    set "BROWSER_BIN=%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
) else if exist "%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    set "BROWSER_BIN=%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe"
)

if defined BROWSER_BIN (
    echo [*] Launching standalone app mode via:
    echo     !BROWSER_BIN!
    echo [*] Target URL: %APP_URL%
    start "" "!BROWSER_BIN!" --app=%APP_URL% --window-size=1280,920 --user-data-dir="%TEMP%\pravah_os_desktop_data"
) else (
    echo [!] No Chromium browser detected. Launching in default web browser...
    start %APP_URL%
)

echo.
echo [OK] PravahOS Desktop App launched successfully.
echo ======================================================
exit /b 0
