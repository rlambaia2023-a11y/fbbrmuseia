@echo off
REM Watchdog: verifica o servidor e o Funnel a cada execucao; reinicia se caidos.
REM Agendado via: schtasks /create /tn "CorrecaoProvas Watchdog" /tr "C:\odontologiamuse\correcao-provas\watchdog.bat" /sc minute /mo 5 /f
REM Nota: 401 significa "servidor vivo, protegido por senha" -> tambem conta como OK.

powershell -NoProfile -c "$code=0; try { $code=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://localhost:3000/api/exams).StatusCode } catch { try { $code=[int]$_.Exception.Response.StatusCode } catch { $code=0 } }; if ($code -eq 200 -or $code -eq 401) { exit 0 } else { exit 1 }"
if %errorlevel% neq 0 (
  echo [%date% %time%] Servidor fora do ar. Reiniciando... >> C:\odontologiamuse\correcao-provas\watchdog.log
  schtasks /run /tn "Correcao de Provas Odonto" >nul 2>&1
)

tailscale funnel status 2>nul | findstr /i "https://" >nul
if %errorlevel% neq 0 (
  echo [%date% %time%] Funnel fora do ar. Reativando... >> C:\odontologiamuse\correcao-provas\watchdog.log
  tailscale funnel --bg http://localhost:3000 >nul 2>&1
)
