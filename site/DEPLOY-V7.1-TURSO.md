# YORU v7.1 Turso deployment

Cloudflare Pages secrets:

```text
TURSO_DATABASE_URL = libsql://<database>-<org>.turso.io
TURSO_AUTH_TOKEN    = <database token>
```

Deploy:

```powershell
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

Checks:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
Invoke-RestMethod "https://myster-anime.pages.dev/api/health" | ConvertTo-Json -Depth 10
$r = Invoke-RestMethod "https://myster-anime.pages.dev/api/anime"
$r.count
```

Expected version: `yoru-v7.1-turso-libsql-2026-09-11`.
