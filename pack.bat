@echo off
title Pack Claude Hub
cd /d "%~dp0"

echo.
echo  ==========================================
echo   Dong goi Claude Hub
echo  ==========================================
echo.

set OUT=claude-hub-release
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

:: Copy chi cac file can thiet
copy /y server.js "%OUT%\" >nul
copy /y package.json "%OUT%\" >nul
copy /y package-lock.json "%OUT%\" >nul
copy /y start.bat "%OUT%\" >nul
copy /y .gitignore "%OUT%\" >nul

echo  [OK] Da copy files vao %OUT%\
echo.

:: Tao file zip (dung PowerShell tar)
set ZIPNAME=claude-hub-v4.zip
if exist "%ZIPNAME%" del "%ZIPNAME%"
tar -a -cf "%ZIPNAME%" "%OUT%"

if exist "%ZIPNAME%" (
    echo  [OK] Da tao: %ZIPNAME%
) else (
    echo  [!] Khong tao duoc zip, hay nen thu cong folder: %OUT%\
)

echo.
echo  Huong dan gui ban be:
echo    1. Gui file %ZIPNAME%
echo    2. Ban be giai nen, mo CMD trong folder do
echo    3. Chay: npm install
echo    4. Chay: start.bat
echo    5. Trinh duyet tu dong mo http://localhost:8765
echo.
echo  Yeu cau: Node.js 18+, Claude CLI (claude.exe)
echo.
pause
