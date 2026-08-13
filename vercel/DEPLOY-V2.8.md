# Anime Title Core v2.8.0

Changes:
- AniHub Romaji is read from `h1 + p.text-sm.text-gray-400.mb-1` first.
- Search-driving aliases are restricted to high-confidence title fields.
- Navigation/social labels are rejected as aliases.
- Native catalog search uses a compact exact-title pass (max 2 names, 9s/domain).
- A timed-out domain is never retried by native/alias/localized passes; it goes directly to fallback.
- At most one targeted exact-alias replay is performed, only for non-timeout empty domains.
- At most one localized pass is performed, only for non-timeout empty domains.
- Fallback uses at most 2 names with an 8s/domain cap.

Deploy:

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

Verify:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Expected version: `2.8.0`.
