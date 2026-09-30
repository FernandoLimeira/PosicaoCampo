@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   POSICAO DE CAMPO - LIMPEZA DE LEGADOS
echo ============================================
echo.

del /q "app.py" 2>nul
del /q "database.py" 2>nul
del /q "config.py" 2>nul
del /q "app.js" 2>nul
del /q "style.css" 2>nul
del /q "report-template.jpg" 2>nul
del /q "test_database.py" 2>nul
del /q "download" 2>nul
del /q "css\relatorio.css" 2>nul
del /q "js\register.js" 2>nul
del /q "js\relatorio.js" 2>nul
del /q "js\template-export-data.js" 2>nul
del /q "assets\template-export.png" 2>nul
if exist "__pycache__" rmdir /s /q "__pycache__"
if exist "backend\__pycache__" rmdir /s /q "backend\__pycache__"
if exist "tests\__pycache__" rmdir /s /q "tests\__pycache__"

echo Limpeza concluida. Banco, backups, .venv e arquivos atuais foram preservados.
echo.
pause
