# Anime Title Core v2.6.0

New endpoint: `POST /api/process-stream`.

It returns newline-delimited JSON (`application/x-ndjson`) while the full catalog search is still running.

Packet types:

- `progress` — stage, percent, message and optionally domain/completed/total/found/error.
- `heartbeat` — keeps the stream alive while a slow request is pending.
- `result` — `percent: 100` and the final schema-v2 JSON in `result`.
- `error` — terminal error packet if the process fails after streaming has started.

Deploy:

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

Health:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Live stream test (curl shows packets as they arrive):

```powershell
curl.exe -N -X POST "https://anime-catalog-flame.vercel.app/api/process-stream" `
  -H "Content-Type: application/json" `
  -d '{"title":"Arifureta Shokugyou de Sekai Saikyou","url":"https://anilist.co/anime/100668","status":"","group":""}'
```
