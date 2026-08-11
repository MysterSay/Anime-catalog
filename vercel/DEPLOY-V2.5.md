# Anime Title Core v2.5.0

## API flow

- `POST /api/search` — fast authority search for MyAnimeList / AniList / Shikimori.
- `POST /api/process-full` — full schema-v2 processing. Resolves titles/aliases, searches all configured catalogs asynchronously, returns JSON only. It does **not** call the Notion webhook.
- `POST /api/process` — backward-compatible endpoint for extension/direct use; it still sends the callback after processing.

## Deploy to the existing Vercel project

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

Check:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Expected version: `2.5.0`.
