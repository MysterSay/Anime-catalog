# YORU Turso v7.2.2.2 hotfix + Anime Title Core v2.11.1

Поточний стек:

- Cloudflare Pages/Worker — сайт та API.
- Turso/libSQL — база каталогу.
- Vercel — Python Core пошуку та метаданих.
- Tampermonkey — Anime → YORU Collector v3.1.0.

## v7.2.2

- Жанри: MyAnimeList + Shikimori + AniList.
- Теми: MyAnimeList + Shikimori.
- На сторінці тайтлу жанри/теми показуються під назвою із підказкою джерел.
- На головній картки не захаращуються жанрами/темами.
- Додані окремі фільтри «Жанр» і «Тема».
- Додане сортування за жанром/темою A–Я та Я–A.
- Пошук також враховує жанри й теми.
- Core schema v3 зберігає taxonomy як `{all, sources}`.
- `/api/taxonomy` у Core та `/api/core-taxonomy` у Cloudflare дозволяють швидко дозаповнити старі 167 записів без повторного обходу каталогів.

## Порядок оновлення

1. Задеплой `python-core/` у Vercel.
2. Перевір `/api/health`: версія `2.11.1`, `result_schema: 3`.
3. Задеплой `site/` у Cloudflare Pages.
4. Перевір `/api/version`: `yoru-v7.2.2-genres-themes-2026-09-11`.
5. Запусти `migration/backfill_taxonomy.py`, щоб жанри/теми з’явилися у вже перенесених тайтлів.

Розширення v3.1.0 міняти не потрібно: воно передає результат Core через існуючий ingest, а Worker v7.2.2 сам зберігає нові поля.


## AniList serverless 403 fallback
Core 2.11.2 can skip AniList during taxonomy backfill (`prefer_client_anilist`). Backfill 1.2 queries AniList directly from the local Windows connection. The site and Tampermonkey v3.1.1 also enrich missing AniList genres client-side before Turso ingest.
