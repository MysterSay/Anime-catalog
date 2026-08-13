# Anime Title Core v2.10.0

## Changes

- `title.original` is now the Latin/Romaji title. Native CJK remains an alias.
- AniHub source title priority: `h1 + p.text-sm.text-gray-400.mb-1`.
- Per-catalog search order is strict: Latin Original/Romaji -> English -> catalog language (UA/RU) -> remaining exact aliases.
- The first three priority slots are not killed by a short asyncio timeout. They use the HTTP transport timeout.
- The short 7s timeout begins only for secondary aliases.
- DLE POST search also follows this timeout policy; priority queries are not capped at 4.5s anymore.

## Deploy

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

Verify:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Expected version: `2.10.0`.
