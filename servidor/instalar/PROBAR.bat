@echo off
rem Arranca el sistema para probarlo. No instala nada: usa el Node que viene
rem en la carpeta node\ de este mismo paquete.
rem
rem El navegador lo abre EL SERVIDOR cuando ya esta escuchando, no este
rem archivo a los pocos segundos: asi nadie termina mirando lo que hubiera en
rem ese puerto antes.
rem
rem Sin acentos a proposito: los .bat se leen con la codificacion de la consola
rem y en algunas maquinas los acentos salen rotos.

setlocal
cd /d "%~dp0"
title Inventario fisico vs SAP - PRUEBA

echo.
echo   ============================================================
echo    INVENTARIO FISICO VS SAP - version de prueba
echo   ============================================================
echo.
echo    Esto es una prueba en tu propia maquina:
echo.
echo      - NO pide usuario y contrasena. Para eso hace falta
echo        publicarla, porque Microsoft no admite una maquina
echo        suelta como direccion de retorno del login.
echo      - Las decisiones se guardan en datos\inventario.db, aca
echo        al lado. Son de prueba: no van a ningun lado.
echo      - Para borrarlas y empezar de cero, borra esa carpeta.
echo.

if not exist "node\node.exe" (
  echo   ERROR: falta node\node.exe. El paquete esta incompleto.
  echo.
  pause
  exit /b 1
)

set /p NOMBRE=  Con que nombre queres que queden tus decisiones?
if "%NOMBRE%"=="" set NOMBRE=Prueba

echo.
echo   Arrancando. El navegador se abre solo cuando este listo.
echo.
echo   PARA CERRAR: cerra esta ventana.
echo   ------------------------------------------------------------
echo.

set INVSAP_AUTH=off
set INVSAP_DEV_USUARIO=%NOMBRE%
set INVSAP_ABRIR=si

"node\node.exe" servidor\servidor.js

echo.
echo   El servidor se detuvo.
pause
