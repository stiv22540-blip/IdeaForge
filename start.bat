@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Нужен Node.js 18+: https://nodejs.org & pause & exit /b 1)
node server.js
pause
