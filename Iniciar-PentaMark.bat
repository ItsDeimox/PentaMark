@echo off
title PentaMark
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O PentaMark precisa do Node.js instalado.
  echo  Baixe em: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "local-dist\index.html" (
  echo.
  echo  Preparando o PentaMark pela primeira vez...
  call npm install
  if errorlevel 1 goto :erro
  call npm run local:build
  if errorlevel 1 goto :erro
)

node "local\server.mjs"
if errorlevel 1 goto :erro
exit /b 0

:erro
echo.
echo  O PentaMark encontrou um problema ao iniciar.
echo  Manda uma captura desta tela que a gente caceta o bug :V
echo.
pause
exit /b 1
