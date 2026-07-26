@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "GPT_SOVITS_DIR=%SCRIPT_DIR%GPT-SoVITS"
set "PYTHON=%GPT_SOVITS_DIR%\runtime\python.exe"
set "BRIDGE=%SCRIPT_DIR%gpt-sovits-airi\server.py"

if not exist "%PYTHON%" (
  echo [AIRI TTS] GPT-SoVITS runtime Python was not found.
  exit /b 1
)

if not exist "%BRIDGE%" (
  echo [AIRI TTS] Local bridge was not found.
  exit /b 1
)

powershell -NoProfile -Command "$client = New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', 9880); exit 0 } catch { exit 1 } finally { $client.Dispose() }"
if errorlevel 1 (
  echo [AIRI TTS] Starting GPT-SoVITS native API on 127.0.0.1:9880...
  pushd "%GPT_SOVITS_DIR%"
  start "AIRI GPT-SoVITS Native" /B "%PYTHON%" api_v2.py -a 127.0.0.1 -p 9880
  popd
)

powershell -NoProfile -Command "$client = New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', 9888); exit 0 } catch { exit 1 } finally { $client.Dispose() }"
if not errorlevel 1 (
  echo [AIRI TTS] Local AIRI bridge is already running on 127.0.0.1:9888.
  exit /b 0
)
echo [AIRI TTS] Starting local AIRI bridge on 127.0.0.1:9888...
"%PYTHON%" "%BRIDGE%"
