# Anime → YORU Collector — Browser Extension v3.2.0

Повноцінне WebExtension-розширення на основі userscript `Anime -> YORU Collector v3.1.2`.
Tampermonkey більше не потрібен.

## Підтримувані браузери

- Google Chrome / Chromium
- Microsoft Edge
- Brave
- Opera
- Vivaldi
- Firefox
- Safari Web Extension resources (пакування в Xcode на macOS)

## Що перенесено з userscript

- визначення назви аніме на підтримуваних сайтах;
- окрема логіка `jut.su`;
- перевірка існуючого тайтлу в YORU;
- статуси, групи, теги, вибране, улюблене;
- `+1 переглянуто`, сезон і серія;
- rename існуючого запису;
- запуск `/api/process-title-stream` і обробка NDJSON progress;
- AniList GraphQL fallback;
- `/api/ingest`, `/api/anime`, `/api/anime/viewed`, `/api/extension/context`;
- резервний `/api/process-title`;
- зміна активного YORU-домену.

## Що змінилось відносно Tampermonkey

### Мережа
`GM_xmlhttpRequest` прибраний. Усі кросдоменні JSON-запити виконує `background.js`.
Довгий NDJSON stream передається через `runtime.Port`.
Content script надсилає keep-alive повідомлення раз на 20 секунд під час активного stream.

### Storage
`GM_getValue` / `GM_setValue` замінено на `storage.local`.
Налаштований YORU-домен спільний для всіх підтримуваних сайтів.

### Menu commands
`GM_registerMenuCommand` замінено toolbar popup-ом розширення.
У popup можна:
- відкрити панель Anime → YORU у поточній вкладці;
- змінити YORU-домен;
- відкрити YORU.

### Notifications
`GM_notification` замінено на WebExtensions Notifications API.

### Clipboard / styles
Clipboard використовує стандартний Clipboard API з fallback.
CSS додається звичайним `<style>` із content script.

## Структура

```text
anime-to-yoru-extension/
├─ src/
│  ├─ background.js
│  ├─ content.js
│  ├─ popup.html
│  ├─ popup.css
│  ├─ popup.js
│  └─ icons/
├─ manifests/
│  ├─ manifest.chromium.json
│  ├─ manifest.firefox.json
│  └─ manifest.safari.json
├─ dist/
├─ legacy-userscript.js
├─ build.ps1
└─ build.sh
```

## Збірка у Windows

У PowerShell із кореня проєкту:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Після цього в `dist` будуть готові архіви та unpacked-папки.

## Встановлення — Chrome / Edge / Brave / Opera / Vivaldi

1. Розпакуй `Anime-to-YORU-Chromium-v3.2.0.zip`.
2. Відкрий сторінку розширень браузера.
3. Увімкни режим розробника.
4. Натисни **Load unpacked / Завантажити розпаковане**.
5. Вибери папку `Anime-to-YORU-Chromium-v3.2.0`.
6. Tampermonkey userscript можна вимкнути або видалити, щоб не було двох однакових панелей.

## Встановлення — Firefox

Для розробки/перевірки:

1. Відкрий `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on**.
3. Вибери `manifest.json` у папці `Anime-to-YORU-Firefox-v3.2.0` або готовий `.xpi`.

На звичайному Firefox постійна інсталяція стороннього XPI зазвичай потребує підпису Mozilla Add-ons.

## Safari

Safari Web Extensions пакуються як app extension через Xcode на macOS.
Готові WebExtension resources лежать у `Anime-to-YORU-Safari-WebExtension-v3.2.0.zip`.

На Mac після розпакування можна виконати:

```bash
xcrun safari-web-extension-packager /path/to/Anime-to-YORU-Safari-WebExtension-v3.2.0
```

Далі Xcode створить Safari Extension App проєкт.

## Permissions

Розширення використовує:

- `storage` — зберігати YORU-домен;
- `notifications` — системні повідомлення;
- `<all_urls>` host permission — background має звертатись до змінного YORU-домену та API, який задає користувач.

Content script при цьому інжектиться лише в перелік аніме-сайтів із manifest.

## Оновлення логіки

`src/content.js` є прямим продовженням твоєї v3.1.2: основна логіка UI, визначення тайтлів і робота з YORU залишена максимально без змін. Tampermonkey transport/storage/menu API замінені на WebExtension API.
