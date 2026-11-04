@echo off
rem Auxiliar: arranca un servidor de prueba. No se usa directamente.
rem   _arrancar.bat <puerto> <nombre de la persona>
rem
rem Existe porque poner varias variables en una sola linea de `start` con `&`
rem se come los espacios de forma dificil de ver: "Ana Perez " con un espacio
rem de mas al final, y despues el nombre aparece raro en las decisiones.

setlocal
cd /d "%~dp0"
set INVSAP_AUTH=off
set INVSAP_PUERTO=%1
set INVSAP_DEV_USUARIO=%~2
set INVSAP_ABRIR=si
title %~2 - puerto %1
"node\node.exe" servidor\servidor.js
echo.
echo   El servidor de %~2 se detuvo.
pause
