@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

rem Keep this file ASCII-only: cmd.exe parses .bat as GBK on Chinese Windows,
rem and UTF-8 Chinese bytes would break the command parser.
set NODE_OPTIONS=
set ELECTRON_RUN_AS_NODE=

where node >nul 2>nul
if errorlevel 1 goto no_node

echo Building Freedom installer, please wait...
echo.

node "%~dp0scripts\build-installer.mjs" %*
set "BUILD_EXIT=%errorlevel%"

echo.
if not "%BUILD_EXIT%"=="0" goto build_failed

echo [DONE] Installer is ready in the release folder.
echo.
pause
exit /b 0

:build_failed
echo [FAILED] Build exited with code %BUILD_EXIT%.
echo.
pause
exit /b %BUILD_EXIT%

:no_node
echo [ERROR] Node.js not found in PATH. Please install Node.js 18 or newer.
echo.
pause
exit /b 1
