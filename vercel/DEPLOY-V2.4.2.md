# Deploy v2.4.2

This release keeps the v2.4.1 direct search fallback and fixes MyAnimeList preview images.
MAL search results now fetch title/og:image from the actual myanimelist.net anime page. If MAL blocks the metadata request, the result is returned without an image rather than borrowing an AniList/Shikimori image.

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```
