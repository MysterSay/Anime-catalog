# Anime Title Core v2.4.1

Fix for `/api/search` returning empty groups when Google HTML contains no usable results on Vercel.

Search order per authority site:
1. Google `site:` search.
2. If Google produced zero usable title pages, direct fallback via AniList/Shikimori APIs.
3. Fallback still returns canonical URLs for `myanimelist.net`, `anilist.co`, and `shikimori.io` in the same response schema.

Deploy:

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

Verify:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json
```

Expected version: `2.4.1`.
