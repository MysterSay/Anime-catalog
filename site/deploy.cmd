@echo off
cd /d "%~dp0"
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
pause
