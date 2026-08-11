@echo off
cd /d "%~dp0"
echo Deploying Yoru v4.5 from: %CD%
findstr /C:"openAddTitle" index.html >nul || (echo ERROR: wrong index.html & exit /b 1)
findstr /C:"yoru-v4.5-google-cse-browser-2026-08-11" _worker.js >nul || (echo ERROR: wrong _worker.js & exit /b 1)
npx wrangler pages deploy . --project-name myster-anime
