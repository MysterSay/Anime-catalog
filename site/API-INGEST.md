# External JSON ingest

The site accepts the Python core schema-v2 JSON at:

- POST `https://myster-anime.pages.dev/api/ingest`
- POST `https://myster-anime.pages.dev/` with `Content-Type: application/json` (alias)

Body: the complete JSON returned by `anime-title-core`.

Optional protection: create Cloudflare Pages secret `INGEST_KEY`. If it exists, external clients must send `X-Ingest-Key: <value>`. The site-internal `/api/process-title` flow is unchanged.

PowerShell example:

```powershell
$body = Get-Content .\result.json -Raw
Invoke-RestMethod -Method Post -Uri "https://myster-anime.pages.dev/api/ingest" -ContentType "application/json" -Body $body
```

If `INGEST_KEY` is enabled:

```powershell
Invoke-RestMethod -Method Post -Uri "https://myster-anime.pages.dev/api/ingest" -Headers @{ "X-Ingest-Key" = "YOUR_KEY" } -ContentType "application/json" -Body $body
```
