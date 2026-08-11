# Anime Title Core v2.4.0

New endpoint:

- `POST /api/search` — Google `site:` search in MyAnimeList, AniList and Shikimori.
- `POST /api/process` — existing full pipeline.

Example search body:

```json
{"title":"Arifureta Shokugyou de Sekai Saikyou","limit":8}
```

If `CORE_API_KEY` is configured in Vercel, both endpoints require `X-API-Key`.

Deploy this folder as the Vercel project root, or replace the existing core files and redeploy production.
