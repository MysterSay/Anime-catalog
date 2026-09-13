# YORU Anime Catalog

Актуальний мінімальний склад проєкту без міграційних і окремих deploy-скриптів.
 

## [Підтримка]([https://github.com](https://send.monobank.ua/jar/3rqmBsdneV))

## Структура

```text
Anime-catalog/
├─ core/       # Python/FastAPI ядро для Vercel
├─ site/       # Cloudflare Pages сайт + Worker
├─ extension/  # Tampermonkey userscript
├─ install/    # Windows GUI Installer
└─ README.md
```

## Рекомендований запуск

На Windows запускайте:

```text
install\YoruInstaller.exe
```

Installer сам проводить повне розгортання:

1. знаходить поточний проєкт або клонує `MysterSay/Anime-catalog`, якщо проєкту поруч немає;
2. перевіряє Node.js, WSL та потрібні CLI;
3. показує активний акаунт Cloudflare, Vercel, Turso і просить підтвердження кожного;
4. просить одну власну назву проєкту — вона використовується для Cloudflare Pages, Vercel Core та Turso DB;
5. генерує новий `CORE_API_KEY` для чистого встановлення;
6. створює/отримує нові URL і токени;
7. записує актуальні secrets/env між Cloudflare, Vercel і Turso;
8. робить фінальний deploy;
9. перевіряє Site -> Core wiring, health та version endpoints;
10. відкриває Tampermonkey і папку `extension`.

Старі URL/ключі не повинні використовуватись при чистому встановленні. Для resume Installer використовує свій state і прямо запитує, чи продовжувати попереднє встановлення.

## Компоненти

### `core/`

Python/FastAPI backend, який розгортається на Vercel. Містить тільки файли, потрібні для роботи/збірки ядра: `app.py`, `vercel.json`, `pyproject.toml`, `requirements.txt` та приклади schema/env.

### `site/`

Cloudflare Pages frontend + `_worker.js`. Каталог використовує virtual scrolling та lazy loading, щоб не тримати всі картки і постери в DOM одночасно.

### `extension/`

Tampermonkey userscript для додавання/обробки тайтлів із зовнішніх джерел.

### `install/`

`YoruInstaller.exe` — основний спосіб встановлення. Вихідний код installer-а є в `install/src/`.

## Збірка Installer

Потрібен Go 1.23+.

```powershell
cd install\src
go build -trimpath -ldflags="-s -w -H windowsgui" -o ..\YoruInstaller.exe .
```


