@echo off
title Claude Hub
cd /d "%~dp0"

:: Giữ cửa sổ mở nếu có lỗi
if "%1"=="" (
    cmd /k "%~f0" KEEP
    exit /b
)

echo.
echo  ==========================================
echo   ^🤖  CLAUDE HUB - Windows Dashboard
echo  ==========================================
echo.

:: Cài npm packages nếu chưa có
if not exist "node_modules" (
    echo  [1/2] Dang cai dependencies...
    npm install
    if errorlevel 1 (
        echo.
        echo  LOI: npm install that bai.
        echo  Hay dam bao da cai Node.js: https://nodejs.org
        pause
        exit /b 1
    )
    echo  [1/2] Done!
)

echo  [2/2] Dang khoi dong server...
echo.

:: Mở browser sau 2 giây
start /b cmd /c "timeout /t 2 /nobreak > nul && start http://127.0.0.1:8765"

:: Chạy server (giữ cửa sổ này mở)
node server.js

echo.
echo  Server da dung. Nhan phim bat ky de thoat...
pause > nul
