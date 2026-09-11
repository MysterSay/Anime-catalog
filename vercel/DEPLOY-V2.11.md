# Anime Title Core v2.11.0

## Нове

- Жанри збираються окремо з MyAnimeList, Shikimori та AniList.
- Теми збираються окремо з MyAnimeList та Shikimori.
- schema-v3 додає `genres` і `themes` у форматі `{all, sources}`.
- Новий швидкий endpoint `POST /api/taxonomy` для дозаповнення старих записів без повного пошуку каталогів.
- Попередній порядок пошуку каталогів та Firefox stream protocol не змінені.

## Deploy

```powershell
npx vercel link --yes --project anime-catalog
npx vercel deploy --prod
```

Перевірка:

```powershell
Invoke-RestMethod "https://anime-catalog-flame.vercel.app/api/health" | ConvertTo-Json -Depth 10
```

Очікувана версія: `2.11.0`, `result_schema: 3`.
