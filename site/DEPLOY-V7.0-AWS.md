# YORU v7.0 AWS deployment

Required Cloudflare Pages secrets:

- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- AWS_REGION = eu-central-1
- AWS_DDB_TABLE = yoru-anime

Deploy:

```powershell
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

Test:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/health" | ConvertTo-Json -Depth 10
```
