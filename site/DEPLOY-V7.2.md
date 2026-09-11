# YORU site v7.2 — Genre / Theme

## Deploy

```powershell
cd site
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

## Verify

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```

Expected: `yoru-v7.2-genres-themes-2026-09-11`.

Після деплою Core 2.11.0 + site 7.2 виконай taxonomy backfill:

```powershell
cd ..\migration
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python .\backfill_taxonomy.py
```
