Write-Host "YORU -> Cloudflare Pages Turso secrets" -ForegroundColor Cyan
Write-Host "You will be prompted for each secret value. Values are encrypted by Cloudflare." -ForegroundColor DarkGray

npx --yes wrangler@4.120.0 pages secret put TURSO_DATABASE_URL --project-name myster-anime
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx --yes wrangler@4.120.0 pages secret put TURSO_AUTH_TOKEN --project-name myster-anime
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Secrets saved." -ForegroundColor Green
