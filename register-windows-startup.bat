@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\cursor-tg-bot-start.bat"
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo rem Auto-start cursor-tg-bot on Windows logon
>> "%LAUNCHER%" echo call "%ROOT%\start-bot.bat" ^>^> "%ROOT%\data\startup.log" 2^>^&1

echo Registered:
echo   %LAUNCHER%
echo.
echo Log: %ROOT%\data\startup.log
echo Remove %LAUNCHER% to unregister.
echo.
explorer "%STARTUP%"
endlocal
pause
