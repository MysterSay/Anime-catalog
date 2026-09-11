# YORU site v7.2.2 — Genre / Theme + AniList client fallback

AniList may return HTTP 403 to shared cloud/serverless egress. The add-title flow now keeps MAL and Shikimori in Core and, when AniList genres are missing, performs the public `Media(idMal: ...)` GraphQL query directly from the user's browser before `/api/ingest`.

Deploy:

```powershell
cd "D:\РСтіл\anime\Anime-catalog\site"
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

Expected `/api/version`: `yoru-v7.2.2-anilist-client-fallback-2026-09-11`.


## v7.2.3 migration compact mode

`GET /api/anime?id=<id>&compact=1` and `PATCH /api/anime?id=<id>&compact=1` skip the expensive full catalogue/options rebuild. This mode is used by taxonomy backfill 1.7 and leaves ordinary frontend API responses unchanged.

Expected `/api/version`: `yoru-v7.2.3-compact-anime-api-2026-09-11`.

## v7.2.4 Ukrainian Genre / Theme labels

All taxonomy values are normalized to Ukrainian on both read and write. Existing rows therefore display Ukrainian labels immediately after deployment, even before a database rewrite.

Examples:
- `Action` -> `Екшен`
- `Supernatural` -> `Надприродне`
- `Shounen` -> `Сьонен`
- `Historical` -> `Історичне`

Expected `/api/version`: `yoru-v7.2.4-uk-taxonomy-2026-09-11`.
