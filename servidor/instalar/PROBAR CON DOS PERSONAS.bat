@echo off
rem Arranca DOS servidores sobre la MISMA base, con dos identidades distintas.
rem Sirve para ver lo que una sola ventana no muestra: como se ve el trabajo
rem entre varias personas.

setlocal
cd /d "%~dp0"
title Inventario fisico vs SAP - PRUEBA entre dos personas

echo.
echo   ============================================================
echo    PROBAR EL TRABAJO ENTRE DOS PERSONAS
echo   ============================================================
echo.
echo    Se abren DOS ventanas del navegador, cada una con una
echo    identidad distinta, sobre la MISMA base de datos.
echo.
echo    Que mirar:
echo.
echo      1. Deci algo en una ventana. En menos de 20 segundos
echo         aparece solo en la otra, sin apretar nada.
echo.
echo      2. Abri el MISMO caso en las dos y deci en las dos.
echo         La segunda recibe un aviso con el nombre de quien
echo         habia decidido antes. Nada se pierde: el historial
echo         de la ficha guarda las dos.
echo.

if not exist "node\node.exe" (
  echo   ERROR: falta node\node.exe. El paquete esta incompleto.
  pause
  exit /b 1
)

echo   Arrancando los dos. Cada uno abre su ventana del navegador
echo   cuando esta listo.
echo.

start "" "%~dp0_arrancar.bat" 8673 "Ana Perez"
timeout /t 3 /nobreak >nul
start "" "%~dp0_arrancar.bat" 8674 "Beto Gomez"

echo.
echo   Ana Perez en el 8673, Beto Gomez en el 8674.
echo.
echo   PARA CERRAR: cerra las dos ventanas negras que se abrieron.
echo.
pause
