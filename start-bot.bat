@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Merge Machine + User PATH (works from Startup / Task Scheduler)
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "MACHINE_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%b"
if defined MACHINE_PATH set "PATH=%MACHINE_PATH%"
if defined USER_PATH set "PATH=%PATH%;%USER_PATH%"

if not exist "data" mkdir "data"

echo [%date% %time%] cursor-tg-bot build...
call npm run build
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)

call npx pm2 describe cursor-tg-bot >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] pm2 start...
  call npx pm2 start ecosystem.config.cjs
) else (
  echo [%date% %time%] pm2 restart...
  call npx pm2 restart cursor-tg-bot --update-env
)

call npx pm2 save >nul 2>&1
echo [%date% %time%] done. pm2 list:
call npx pm2 list
endlocal
