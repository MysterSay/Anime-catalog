# Yoru v4.9

The website now consumes the Python core NDJSON stream through `/api/process-title-stream`.

Flow:

1. Fast `/api/core-search` returns the three authority result groups.
2. Clicking a tile starts `/api/process-title-stream`.
3. The modal receives progress packets and renders the real percentage/stage/catalog.
4. The final `result` packet is POSTed to `/api/ingest`.
5. Only after Notion confirms the write does the UI reach 100% and open the title page.

Deploy:

```powershell
npx wrangler pages deploy . --project-name myster-anime
```

Version check:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```
