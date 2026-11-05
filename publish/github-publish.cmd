@echo off
chcp 65001 >nul
echo ============================================
echo  dsh-claim-gate  --  publish to GitHub
echo ============================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0github-publish.ps1"
echo.
pause
