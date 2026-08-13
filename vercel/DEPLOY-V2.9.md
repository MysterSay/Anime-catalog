# Anime Title Core v2.9.0

## What changed

Catalog search now uses a strict, deterministic title order for every site:

1. Original/Romaji taken directly from the opened source page (for AniHub this is the line next to/below H1).
2. English title.
3. Localized title matching the catalog language: Ukrainian for UA catalogs, Russian for RU catalogs.
4. Remaining exact aliases/native title.

Names are tried sequentially inside each catalog and search stops immediately after a verified result.
Catalogs still run in parallel with each other.

DLE-based sites now use their native POST search form first, including jut-su.net, animevost.org,
jutsu.tv, animego.studio, anidesu.net, anitube.in.ua and uachan.com. This avoids wasting the
catalog timeout on generic guessed GET routes.

Neighbouring franchise/season authority hits are no longer copied into aliases for the selected title.

## Deploy

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

## Verify

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Expected version: `2.9.0`.
