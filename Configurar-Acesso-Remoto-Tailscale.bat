@echo off
setlocal
title PentaMark - Acesso remoto seguro
cd /d "%~dp0"

set "PENTAMARK_TAILSCALE=tailscale"
where tailscale >nul 2>nul
if errorlevel 1 (
  set "PENTAMARK_TAILSCALE=C:\Program Files\Tailscale\tailscale.exe"
  if not exist "%PENTAMARK_TAILSCALE%" goto :sem_tailscale
)

echo.
echo  Criando um endereco HTTPS privado para o PentaMark...
echo  Se o navegador pedir autorizacao, confirme o Tailscale Serve.
echo.
"%PENTAMARK_TAILSCALE%" serve --bg 3417
if errorlevel 1 goto :erro

echo.
echo  Pronto. Envie ao celular o endereco HTTPS mostrado abaixo:
echo.
"%PENTAMARK_TAILSCALE%" serve status
echo.
echo  PC e celular precisam estar conectados ao mesmo tailnet.
echo  Para remover depois, rode: tailscale serve reset
echo.
pause
exit /b 0

:sem_tailscale
echo.
echo  O Tailscale nao foi encontrado neste PC.
echo  Instale em: https://tailscale.com/download/windows
echo.
pause
exit /b 1

:erro
echo.
echo  Nao foi possivel ativar o Tailscale Serve.
echo  Confirme que o Tailscale esta aberto e conectado.
echo.
pause
exit /b 1
