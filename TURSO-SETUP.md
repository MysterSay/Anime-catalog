# YORU v7.2 — перехід на Turso Cloud

Turso Cloud використовує SQLite/libSQL. YORU v7.2 підключається до Turso безпосередньо з Cloudflare Worker через офіційний SQL-over-HTTP endpoint `/v2/pipeline`.

## Безкоштовний план

На момент підготовки v7.1 Turso Free коштує $0/місяць і включає 100 databases, 5 GB storage, 500 million rows read/month, 10 million rows written/month та 3 GB sync/month. Для персонального YORU цього запасу дуже багато.

## 1. Створити акаунт і базу

Найнадійніший офіційний спосіб для Turso Cloud CLI на Windows — через WSL.

У PowerShell:

```powershell
wsl
```

У WSL:

```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

Закрий/відкрий WSL shell або перечитай shell profile, а потім:

```bash
turso auth login --headless
```

Після авторизації:

```bash
turso db create yoru-anime
```

Отримати URL:

```bash
turso db show yoru-anime --url
```

Виглядатиме приблизно так:

```text
libsql://yoru-anime-USERNAME.turso.io
```

Створити database token:

```bash
turso db tokens create yoru-anime --expiration never
```

Збережи URL і token локально. Не вставляй token у JavaScript, userscript, GitHub або чат.

> Альтернатива: database можна створити в Turso Dashboard, а URL/token взяти з Connect/SDK setup. Для YORU потрібні лише два значення: `TURSO_DATABASE_URL` і `TURSO_AUTH_TOKEN`.

## 2. Перенести поточну Notion-базу

ВАЖЛИВО: зроби цей крок ДО деплою Turso-версії на `myster-anime.pages.dev`, бо мігратор читає поточну стару базу через API сайту.

В PowerShell:

```powershell
cd C:\шлях\до\yoru-turso-v7.2\migration
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Тимчасово задай credentials тільки для поточної PowerShell-сесії:

```powershell
$env:TURSO_DATABASE_URL="libsql://yoru-anime-USERNAME.turso.io"
$env:TURSO_AUTH_TOKEN="ТВІЙ_DATABASE_TOKEN"
```

Спочатку dry-run:

```powershell
python .\migrate_yoru_to_turso.py --dry-run
```

Він:

- прочитає список тайтлів зі старого YORU;
- прочитає повні дані кожного тайтлу;
- збере конфіг груп/кольорів/статусів;
- створить локальний backup JSON;
- нічого не запише в Turso.

Якщо кількість тайтлів правильна, запускай реальну міграцію:

```powershell
python .\migrate_yoru_to_turso.py
```

Очікуваний фінал:

```text
Turso rows: N; expected at least: N
Anime migrated: ...
Migration complete.
```

У Turso буде таблиця:

```sql
CREATE TABLE yoru_items (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Усі існуючі ID тайтлів зберігаються, тому старі `title.html?id=...` залишаються сумісними.

## 3. Додати Turso secrets у Cloudflare Pages

Перейди в папку сайту:

```powershell
cd C:\шлях\до\yoru-turso-v7.2\site
```

Додай URL:

```powershell
npx --yes wrangler@4.120.0 pages secret put TURSO_DATABASE_URL --project-name myster-anime
```

Встав `libsql://...` URL.

Додай token:

```powershell
npx --yes wrangler@4.120.0 pages secret put TURSO_AUTH_TOKEN --project-name myster-anime
```

Встав database token.

Перевір список secrets:

```powershell
npx --yes wrangler@4.120.0 pages secret list --project-name myster-anime
```

Мають бути `TURSO_DATABASE_URL` і `TURSO_AUTH_TOKEN`.

## 4. Деплой Cloudflare сайту

У папці `site`:

```powershell
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

Після deployment:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```

Очікується:

```json
{
  "ok": true,
  "version": "yoru-v7.2-genres-themes-2026-09-11",
  "storage": "turso-libsql"
}
```

Перевір health:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/health" | ConvertTo-Json -Depth 10
```

Очікується `ok: true`, `storage: turso-libsql` і правильний `itemCount`.

Перевір каталог:

```powershell
$r = Invoke-RestMethod "https://myster-anime.pages.dev/api/anime"
$r.count
```

Це число має відповідати кількості тайтлів до міграції.

## 5. Оновити розширення

У Tampermonkey повністю заміни старий userscript на:

```text
extension/anime-to-yoru-collector-v3.1.0.user.js
```

Turso token у розширенні не зберігається. Розширення працює тільки через API YORU на Cloudflare.

## 6. Python Core

Vercel Python Core оновлюється до 2.11.1. Він повертає schema-v3 JSON з жанрами/темами, а Cloudflare Worker v7.2 зберігає ці поля у Turso.

## 7. Після перевірки

Не видаляй backup JSON одразу. Коли перевіриш сайт, редагування, додавання нового тайтлу, Tampermonkey, Вибране/Улюблене, Сезон/Серію, теги, нотатки й об'єднання — старий Notion можна залишити як архів.


## Оновлення 7.2: жанри та теми

Після переходу на Core 2.11.1 і сайт 7.2 старі записи можна дозаповнити без повного повторного пошуку по каталогах:

```powershell
cd C:\шлях\до\yoru-turso-v7.2\migration
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python .\backfill_taxonomy.py
```

Скрипт використовує `/api/core-taxonomy`, а потім зберігає тільки `genres` та `themes` у наявний Turso-запис.
