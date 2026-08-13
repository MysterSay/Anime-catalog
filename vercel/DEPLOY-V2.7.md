# Anime Title Core v2.7.0

## Main changes

- Extracts original/Romaji title directly from the currently opened catalog page before authority resolution.
- Explicit selectors for AniHub, jut-su.net, and jut.su original-title fields.
- Uses source-page aliases when resolving AniList / MyAnimeList / Shikimori identity.
- Verified catalog pages can contribute new aliases.
- Empty catalogs are retried asynchronously whenever a newly verified alias is discovered.
- Alias replay is iterative and bounded, so a late original/localized name can unlock sites already checked earlier.
- Internal alias metadata is stripped from the final schema-v2 catalogs output.

## Deploy

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

## Verify

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Expected version: `2.7.0`.
