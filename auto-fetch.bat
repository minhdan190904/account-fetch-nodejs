@echo off
chcp 65001 > nul
echo.
echo ============================================
echo   SUNO COOKIE FETCHER - AUTO FETCH
echo   %date% %time%
echo ============================================
echo.

cd /d "%~dp0"
node src/fetch-all.js

echo.
echo Hoan tat! Ket qua luu tai output/cookies.json
echo.
