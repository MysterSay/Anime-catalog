# Anime Title Pipeline

Архів містить дві незалежні частини:

- `tampermonkey/anime-core-client.user.js` — мінімальний Tampermonkey-клієнт.
- `core/app.py` — Python/FastAPI ядро для локального запуску та Vercel.

## 1. Tampermonkey

Клієнт більше не виконує пошук і не працює з Notion. Він лише:

1. Показує кнопку `Anime → Core`.
2. Відкриває вікно зі статусом та групою.
3. Дозволяє додавати групи; список груп зберігається локально у Tampermonkey.
4. Бере назву сторінки та її URL.
5. Відправляє в Python-ядро JSON:

```json
{
  "title": "Клинок, рассекающий демонов",
  "url": "https://example.com/anime/...",
  "status": "Дивлюсь",
  "group": "Основне"
}
```

За замовчуванням ядро: `http://127.0.0.1:8000/api/process`.
Через меню Tampermonkey `Anime Core: налаштувати URL/API key` можна задати майбутній Vercel URL і `X-API-Key`.

## 2. Python ядро

### Локальний запуск API

```bash
cd core
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --reload
```

Endpoint:

```text
POST http://127.0.0.1:8000/api/process
```

### Локальний TEST режим

```bash
cd core
python app.py test
```

Скрипт попросить у консолі:

- назву тайтлу;
- посилання (можна залишити порожнім).

Результат буде записано у `result.json` в поточній папці запуску.
У test-режимі callback на `[[Сайт]]` не виконується.

## 3. Алгоритм ядра

1. Отримує `title`, `url`, `status`, `group`.
2. Паралельно виконує Google-запити:
   - `site:myanimelist.net "Назва"`
   - `site:anilist.co "Назва"`
   - `site:shikimori.io "Назва"`
3. Збирає всі знайдені точні/альтернативні назви в список aliases (кешується в пам'яті warm instance).
4. AniList API використовується для надійного отримання `romaji`, aliases, `bannerImage`, `coverImage`, description, AniList ID та MAL ID.
5. Для кожного RU/UA каталогу спочатку запускається пошук самого сайту/API.
6. Якщо сайт нічого не повернув — виконується Google fallback `site:<каталог> "Назва"`.
7. Для каталогів з окремими сезонами зберігаються всі відповідні посилання.
8. Опис перекладається українською.
9. Обкладинка:
   - якщо вхідний URL з AniList/MAL/Shikimori — намагається взяти обкладинку саме з нього;
   - інакше використовується одна з authority-баз, пріоритетно AniList.
10. Банер — `bannerImage` AniList; якщо його немає, поле пусте.
11. Формує один JSON і, якщо задано `RESULT_WEBHOOK_URL`, POST-ить його на `[[Сайт]]`.
12. Той самий JSON повертається у відповіді `/api/process`.

## 4. Формат вихідного JSON

Скорочений приклад:

```json
{
  "input": {
    "title": "...",
    "url": "...",
    "status": "Дивлюсь",
    "group": "Основне"
  },
  "title": {
    "original": "Kimetsu no Yaiba",
    "ukrainian": "Клинок, що знищує демонів",
    "aliases": ["Kimetsu no Yaiba", "Demon Slayer", "鬼滅の刃"]
  },
  "description_uk": "...",
  "cover": {"url": "https://...", "source": "anilist.co"},
  "banner": {"url": "https://...", "source": "anilist.co"},
  "authority": {
    "myanimelist.net": [{"url": "...", "title": "..."}],
    "anilist.co": [{"url": "...", "title": "..."}],
    "shikimori.io": [{"url": "...", "title": "..."}]
  },
  "catalogs": {
    "jut-su.net": [{"url": "...", "title": "..."}],
    "ru.yummyani.me": [],
    "anitube.in.ua": [{"url": "...", "title": "..."}]
  },
  "status": "Дивлюсь",
  "group": "Основне"
}
```

Ключ кожного каталогу присутній завжди. Якщо нічого не знайдено — значення `[]`.

## 5. Vercel

Папку `core` можна імпортувати як окремий Vercel project. В `pyproject.toml` вказаний FastAPI entrypoint `app:app`, а `vercel.json` задає `maxDuration: 300`.

У Vercel Environment Variables пізніше додайте:

- `CORE_API_KEY` — за бажанням;
- `RESULT_WEBHOOK_URL` — адреса `[[Сайт]]`;
- `RESULT_WEBHOOK_TOKEN` — за потреби;
- `YUMMY_APPLICATION_TOKEN` — за наявності.

Після deploy у Tampermonkey змініть Core URL на:

```text
https://<ваш-проект>.vercel.app/api/process
```

## Важливо про Google

Google HTML-пошук може періодично показувати CAPTCHA/429 серверним запитам. Ядро не покладається на Google для каталогів як на перший спосіб: спочатку використовує пошук/API самого каталогу, а Google є fallback. Для authority-баз AniList додатково використовується офіційний GraphQL API, щоб не втрачати метадані, якщо Google тимчасово обмежить запит.
