@echo off
rem Sirve Lector en la red local para abrirlo desde el telefono (misma Wi-Fi).
cd /d "%~dp0"
echo.
echo  En el telefono abre en Chrome:  http://IP-DE-ESTE-PC:8765
echo  IP de este PC:
ipconfig | findstr /c:"IPv4"
echo.
echo  Deja esta ventana abierta mientras lo usas. Ctrl+C para terminar.
echo.
python servir.py 8765
