@echo off
setlocal

rem SonoLabel Windows settings. Edit the values below before running this file.
set "API_HOST=127.0.0.1"
set "API_PROXY_HOST=127.0.0.1"
set "API_PORT=8000"
set "WEB_HOST=0.0.0.0"
set "WEB_PORT=5173"
set "INSTALL_MODE=Auto"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1" ^
  -ApiHost "%API_HOST%" ^
  -ApiProxyHost "%API_PROXY_HOST%" ^
  -ApiPort %API_PORT% ^
  -WebHost "%WEB_HOST%" ^
  -WebPort %WEB_PORT% ^
  -InstallMode "%INSTALL_MODE%"

if errorlevel 1 (
  echo.
  echo SonoLabel stopped with an error. Review the messages above.
  pause
)
endlocal
