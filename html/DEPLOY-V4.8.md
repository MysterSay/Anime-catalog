# Yoru v4.8

After a tile is selected, Cloudflare calls Vercel `/api/process-full`. The Python core performs the full asynchronous catalog search and returns schema-v2 JSON. Cloudflare then writes that JSON to Notion exactly once.

Deploy:

```powershell
npx wrangler pages deploy . --project-name myster-anime
```

Check:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```

Expected version: `yoru-v4.8-async-full-catalog-search-2026-08-11`.
