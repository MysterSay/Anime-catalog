# YORU Installer 1.1.9

Windows GUI orchestrator для повного встановлення YORU Anime Catalog.

## Головний принцип

Користувач задає **одну власну назву проєкту**. Installer використовує її як назву:

- Cloudflare Pages project;
- Vercel Core project;
- Turso database.

Installer не підставляє `myster-anime`, `anime-catalog` чи `yoru-anime` як готові назви.

## Структура, яку очікує Installer

```text
core/
site/
extension/
install/
```

Для сумісності зі старими checkout-ами папка `vercel/` також розпізнається як ядро, але новий архів використовує `core/`.

Якщо Installer запущений окремо і не знаходить проєкт, він клонує:

```text
gh repo clone MysterSay/Anime-catalog
```

і продовжує без перезапуску.

## Акаунти

Перед використанням кожного сервісу Installer показує активний акаунт та просить підтвердження:

- GitHub (коли потрібен clone/login);
- Cloudflare;
- Vercel;
- Turso.

Якщо вибрано інший акаунт, стару локальну прив'язку цього сервісу очищено перед повторним входом.

## Ключі та URL

Для чистого встановлення Installer заново отримує/генерує:

- Site URL;
- Core URL;
- `TURSO_DATABASE_URL`;
- `TURSO_AUTH_TOKEN`;
- `CORE_API_KEY`.

Після цього він заново записує потрібні Cloudflare secrets та Vercel environment variables, тому старі значення не повинні залишатися між різними clean installs.

Turso account Access Token і DB auth token — різні речі. Account token потрібний Installer-у для роботи CLI; DB token передається сайту як `TURSO_AUTH_TOKEN`.

## Безпека

Секретні значення в installer state шифруються Windows DPAPI для поточного користувача Windows. Повні секрети не повинні друкуватися в лог.

## Завершення

Після успішного встановлення Installer:

- перевіряє Core health;
- перевіряє Site health/version;
- перевіряє Site -> Core wiring;
- прописує актуальний Site URL у `anime-to-yoru-collector-*.user.js`;
- відкриває сторінку Tampermonkey;
- відкриває папку `extension`.

## Збірка

```powershell
cd install\src
go build -trimpath -ldflags="-s -w -H windowsgui" -o ..\YoruInstaller.exe .
```


## Прив’язка розширення

Перед відкриттям папки `extension` Installer підміняє `DEFAULT_BASE` у userscript на фактичний production URL створеного Cloudflare Pages сайту.

Після встановлення userscript адресу можна змінити без редагування коду: у панелі **Anime → YORU** затисніть `Shift` і натисніть домен у верхньому рядку. Розширення приймає і простий домен, і повний `https://` URL.
