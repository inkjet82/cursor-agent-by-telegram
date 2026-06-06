@echo off
setlocal EnableExtensions
cd /d "%~dp0"

for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "MACHINE_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%b"
if defined MACHINE_PATH set "PATH=%MACHINE_PATH%"
if defined USER_PATH set "PATH=%PATH%;%USER_PATH%"

call npx pm2 describe cursor-tg-bot >nul 2>&1
if errorlevel 1 (
  call npx pm2 start ecosystem.config.cjs
) else (
  call npx pm2 restart cursor-tg-bot --update-env
)
endlocal
