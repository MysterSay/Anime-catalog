# YORU Anime Catalog

Поточний пакет: **1.4.0** · Site: **7.7.0** · Core: **2.21.2** · Installer: **1.1.10** · Extension: **3.1.2**.

YORU — власний аніме-каталог із Cloudflare Pages frontend/Worker, Python/FastAPI Core на Vercel, Turso DB, Tampermonkey-розширенням та Windows GUI installer.



## Оновлення 1.4.0 — AniHub discovery та пошук аніме за кадром

### Випадковий тайтл

У верхньому меню каталогу поруч із **«Додати тайтл»** додано кнопку **«Випадковий тайтл»**. Вона відкриває тимчасову сторінку-превʼю AniHub: тайтл, постер/банер, опис, жанри, рік, тип, рейтинг та пряме посилання на джерело показуються без запису в Turso.

У верхній панелі такого превʼю є дві дії:

- **Випадковий тайтл** — отримує наступний результат `/anime/random`; уже показані ID передаються через `exclude` через кому, а Worker додатково відсіює тайтли, які вже є в YORU за AniHub/MAL/AniList ID або назвою.
- **Вибрати** — лише після цього відправляє назву та AniHub URL у Core `/process-full`, після чого результат зберігається в Turso як звичайний тайтл.

### Схожі тайтли

На сторінці збереженого тайтлу у верхній панелі біля логотипа YORU зʼявилася кнопка **«Схожі тайтли»**. Вона повертає на головну сторінку та тимчасово показує рекомендації AniHub у стандартному режимі галереї/списку. Якщо рекомендований тайтл уже є в Turso, картка відкриває його звичайну сторінку; інакше — AniHub preview без автоматичного збереження.

Worker спочатку використовує related/recommendation-дані картки AniHub, за їх відсутності читає блок **«Схоже аніме»** з публічної сторінки; `/anime/recommended` лишається запасним fallback.

### Пошук за кадром

У вікні **«Додати тайтл»** рядок пошуку тепер приймає скриншот: його можна вставити з буфера обміну або вибрати через кнопку **«Кадр»**. Після **«Знайти»** сайт показує збіги з назвою, банером/постером, описом, епізодом, таймкодом і схожістю.

Технічно Kitsu Anime API не має reverse-image endpoint, тому розпізнавання кадру виконується через trace.moe, а знайдена назва додатково збагачується даними Kitsu (банер, постер, опис та інші метадані). Натискання на результат переносить його назву в стандартний YORU-пошук, після чого працює звичайний ланцюжок `Core → ingest → Turso`.


## Оновлення 1.3.7 — чистий трейлер-фон і оновлення картки

Якщо в `Налаштування → Банер` увімкнено **Трейлер** і тайтл має trailer, фонова картинка банера більше не рендериться взагалі: на фоні залишається тільки autoplay-трейлер та затемнення.

На сторінці тайтлу додано кнопку **Оновити картку тайтла**. Вона бере перше джерело саме з поточного списку `Джерела`, передає його назву та URL у Core, а після відповіді доповнює в Turso тільки відсутні метадані: назви, опис, постер/банер, трейлер, аліаси, жанри, теми та нові посилання. Статус, група, теги, нотатки, вибране/улюблене, перегляди, сезон і серія не перезаписуються.


## Оновлення 1.3.6 — трейлер замість банера

Core 2.21.2 уже повертає `trailer` (`url`, `embed_url`, `site`, `id`, `thumbnail`, `source`). Site 7.6.0 тепер зберігає ці дані разом із тайтлом у Turso та повертає їх через `/api/anime`.

У `Налаштування → Банер` додано глобальний перемикач **«Трейлер»**. Він також зберігається в Turso, тому однаково працює на всіх пристроях. Якщо перемикач увімкнено і у тайтлу є трейлер, на фоні верхнього banner-блоку одразу запускається трейлер замість статичної картинки. Autoplay запускається без звуку; YouTube/Dailymotion отримують autoplay/mute/loop параметри. Якщо трейлера немає, сайт автоматично лишає звичайний банер.

Трейлер також додано до:

- вікна **Редагувати** — можна вставити/замінити URL трейлера або очистити поле, щоб прибрати його;
- вікна **Об’єднати** — трейлер вибирається з лівого або правого тайтлу так само, як постер і банер.

Для цього оновлення достатньо передеплоїти production Site. Core змінювати не потрібно.

## Hotfix 1.3.5

Виправлено сезонний повторний пошук Core для сценарію, коли тайтл стартує з базового MAL/AniList/Shikimori запису. У 2.21.1 `query_names` уже містили українську/російську назву, але `family_roots` могли лишатися лише латинськими. Через це verifier відкидав локалізовані результати каталогів ще до нормальної звірки. Тепер canonical UA/RU/native/Latin назви завжди входять до trusted family roots.

Також відновлено повний повторний прохід: для порожнього каталогу replay отримує не лише нові discovered aliases, а й локалізовану season-grid; запуск replay більше не залежить від наявності `replay_aliases`. Це усуває ситуацію, коли вже відомі перекладені назви не вважалися «новими» і другий скан фактично пропускався.

## Hotfix 1.3.4

Виправлено пошук усієї сезонної сім'ї, коли тайтл додається з базового MAL/AniList/Shikimori запису без суфікса `Season 2/3/4`. Core 2.21.0 міг залишатися в режимі точного пошуку першого сезону, тому сайт отримував лише кілька посилань. Core 2.21.1 використовує базову назву як franchise root для authority-source flow і шукає сезони/частини через усі каталоги. `meta.catalog_search.result_counts` тепер описує саме каталоги, які реально потрапили у фінальний JSON; окремо додані `internal_result_counts` і `public_result_counts` для діагностики.

## Hotfix 1.3.3

Виправлено помилку `safeHttpUrl is not defined` у `site/app.js`, яка зупиняла обробку фінального Core result під час додавання тайтлу через сам сайт. `safeHttpUrl()` тепер визначений у браузерному коді до використання в перевірці/підрахунку посилань.


## Структура

```text
Anime-catalog/
├─ core/       # Python/FastAPI Core для Vercel
├─ site/       # Cloudflare Pages сайт + Worker
├─ extension/  # Tampermonkey userscript
├─ install/    # YoruInstaller.exe + source installer-а
└─ README.md
```


## Оновлення 1.3.1

- Виправлено прямий сценарій **Сайт → Додати тайтл → Core → Turso**.
- Site ingest більше не відкидає знайдені Core посилання лише через форму bucket/domain: Worker дістає всі валідні URL з `authority` і `catalogs`, канонізує домен по самому URL та зберігає повний набір.
- Після ingest сайт звіряє кількість унікальних URL у фінальному Core JSON із кількістю, яку прийняв Worker і зберіг Turso. Неповний ingest більше не проходить непомітно.
- У статусі додавання показується фактична кількість збережених посилань.
- Extension у цьому сценарії не бере участі; його версія лишається 3.1.2.

## Оновлення 1.3.0

### Нове Core

`core/` повністю замінено на надану нову версію ядра. Core повідомляє `APP_VERSION = 2.21.0` і підтримує опціональне поле:

```json
{
  "mikai_api_key": "mk_..."
}
```

### Mikai API key у Turso і Core

У `Налаштування → Плеєр` Mikai Public API key зберігається у Turso, тому він доступний на всіх пристроях. Відкритий ключ назад у браузер не повертається.

Поруч є окремий перемикач **«Передавати Mikai API key у Core»**. За замовчуванням він вимкнений. Коли його ввімкнено, Cloudflare Worker сам читає ключ із Turso та додає його лише у внутрішні server-to-server запити до Core у форматі `mikai_api_key`. Клієнтський `mikai_api_key` ігнорується, щоб браузер не міг підмінити збережений ключ.

Якщо Mikai key очищено, передача у Core автоматично вимикається.

### Player Hub

Порядок кнопок:

```text
anihub.in.ua → animeon.club → mikai.me → jut-su.net → animego.studio
```

Кольори контурів:

- `anihub.in.ua`, `animeon.club`, `mikai.me` — жовтий;
- `jut-su.net`, `animego.studio` — червоний;
- у `mikai.me` контур завжди жовтий, а **лише фон** показує стан ключа: червонуватий без API key, зеленуватий із збереженим API key.

Mikai Player використовує офіційний Public API. DOM-плеєри AniHub, AnimeOn, Jut-su та AnimeGo працюють через окремі Cloudflare preview aliases і crop точного DOM-фрагмента.

## Дані та сервіси

- **Cloudflare Pages** — сайт, Worker API, proxy DOM-плеєрів.
- **Vercel** — Python Core.
- **Turso** — каталог, групи/статуси, Mikai API key і налаштування.
- **Tampermonkey** — Anime → YORU extension.

Основні секрети між Site/Core: `CORE_API_KEY`, `CORE_SEARCH_URL`, `CORE_TAXONOMY_URL`, `CORE_PROCESS_STREAM_URL`, `CORE_PROCESS_FULL_URL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.

## Installer

На Windows рекомендований запуск:

```text
install\YoruInstaller.exe
```

Installer **1.1.10**:

1. знаходить/клонує проєкт;
2. перевіряє Node.js, WSL та CLI;
3. показує активні Cloudflare/Vercel/Turso акаунти для підтвердження;
4. використовує одну власну назву для Cloudflare Project, Vercel Project і Turso DB;
5. створює/оновлює URL, secrets та `CORE_API_KEY`;
6. деплоїть Core і Site;
7. створює preview aliases `p-anihub`, `p-animeon`, `p-jutsu`, `p-animego`;
8. перевіряє health/wiring;
9. прописує production Site URL у userscript.

## Ручне оновлення після 1.3.0

Оскільки оновлено і Core, і Site, потрібно задеплоїти обидва компоненти. Для Site також оновлюються чотири player branches.

При ручному deploy спочатку перевір активний акаунт:

```powershell
npx --yes wrangler@4.131.1 whoami
```

Потім з папки `site`:

```powershell
npx --yes wrangler@4.131.1 pages deploy . --project-name PROJECT --commit-dirty=true
npx --yes wrangler@4.131.1 pages deploy . --project-name PROJECT --branch p-anihub --commit-dirty=true
npx --yes wrangler@4.131.1 pages deploy . --project-name PROJECT --branch p-animeon --commit-dirty=true
npx --yes wrangler@4.131.1 pages deploy . --project-name PROJECT --branch p-jutsu --commit-dirty=true
npx --yes wrangler@4.131.1 pages deploy . --project-name PROJECT --branch p-animego --commit-dirty=true
```

## Що не входить у пакет

Немає `migration/`, taxonomy/backfill scripts, окремих Git deploy scripts, `.env.local`, `.venv`, `.vercel`, `.wrangler`, installer state/logs/cache та backup/checkpoint-файлів.

### Site 7.5.3 — Turso link round-trip

Посилання тепер зберігаються у Turso у двох сумісних представленнях: структурованому `siteLinks` за доменами та плоскому `links` для старого UI. Після кожного ingest Worker одразу читає запис назад з Turso й перевіряє, що кількість посилань не зменшилась. `GET /api/anime?id=...&debug=1` показує raw/normalized counts для діагностики. Якщо Core у `meta.catalog_search.result_counts` заявив більше посилань, ніж реально поклав у фінальний JSON, сайт показує точну розбіжність по доменах замість мовчазного часткового запису.
