# Yoru v5.7 — Notion favorites

`Вибране` and `Улюблене` are now stored in Notion checkbox properties and treated as the source of truth across devices.

Deploy:

```powershell
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

Verify:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```
