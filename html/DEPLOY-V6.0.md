# Yoru v6.0

Adds Notion number properties `Сезон` and `Серія`.

- They are shown on a title page only when status is `Дивлюсь`.
- Values remain in Notion when the status changes.
- Use the left/right chevrons or type a number manually.

Deploy:

```powershell
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

Check:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```

Expected version: `yoru-v6.0-season-episode-2026-08-15`.
