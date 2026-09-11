# Anime Title Core v2.11.3

## Taxonomy source-absence hotfix

- Every taxonomy authority now exposes `notFound` separately from temporary failures.
- AniList GraphQL `Media: null` is now `NOT_FOUND`, not `ok=true` with an empty genre list.
- An AniList identity with no MAL linkage marks MAL/Shikimori as absent instead of endlessly retriable.
- HTTP 404 remains a definite source absence.
- HTTP 403/429/5xx, timeout and parser failures remain retriable.
- Taxonomy `complete` now means every authority is either `ok` or definitively `notFound`.
- Existing AniList client fallback behaviour is preserved.

## Deploy

Run from the repository root when Vercel Root Directory is `vercel`:

```powershell
npx vercel deploy --prod
```

Verify:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Expected version: `2.11.3`.

## Core v2.11.4 — Ukrainian taxonomy

Genre/theme values from MAL, Shikimori and AniList are normalized to Ukrainian before Core returns taxonomy payloads. Source identity/status remains unchanged.

Expected `/api/health` version: `2.11.4`.
