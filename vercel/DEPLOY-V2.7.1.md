# Anime Title Core v2.7.1

Fixes:
- avoids replaying noisy aliases already harvested from the source page;
- prioritizes explicit original/Romaji names from AniHub, jut-su.net and jut.su;
- reduces per-catalog search fan-out so native searches stop timing out across every catalog;
- caps replay rounds and leaves time budget for final JSON serialization;
- serializes the final result before stream delivery and emits explicit serialization errors;
- final NDJSON result is emitted before HTTP-client cleanup;
- progress messages now include the concrete timeout/error text.

Deploy:

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

Verify:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```
