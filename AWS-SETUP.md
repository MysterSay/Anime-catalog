# AWS Free plan + DynamoDB — покрокове налаштування YORU

## 1. Створення AWS Free plan

1. Відкрий `https://aws.amazon.com/free/`.
2. Створи новий AWS account.
3. На етапі вибору plan вибери **Free plan**.
4. Заверши підтвердження email/телефону/платіжного методу.
5. Не створюй AWS Organization і не вмикай Control Tower для цього акаунта.

Примітка: Free plan AWS діє до 6 місяців або до вичерпання credits. Після завершення Free plan акаунт закривається, якщо не перейти на Paid plan. DynamoDB має окремі Always Free limits, але для довгострокової роботи після завершення Free plan акаунт треба буде перевести в Paid plan.

## 2. Створення DynamoDB table

AWS Console -> пошук `DynamoDB` -> **Tables** -> **Create table**.

Виставити:

- Table name: `yoru-anime`
- Partition key: `id`
- Type: `String`
- Sort key: НЕ додавати
- Table settings: `Customize settings`
- Table class: `DynamoDB Standard`
- Capacity mode: `Provisioned`
- Read capacity: `10`
- Write capacity: `10`
- Auto scaling: **Off**
- Secondary indexes: none
- Encryption: AWS owned key
- Point-in-time recovery: Off
- Global tables: не вмикати

Регіон проекту: **Europe (Frankfurt) / eu-central-1**.

Альтернатива через AWS CLI: `aws/create-table.ps1`.

## 3. Створення IAM user для Cloudflare

Не використовуй root access keys.

AWS Console -> IAM -> Users -> Create user.

Name: `yoru-cloudflare`

Permissions -> Create inline policy -> JSON. Встав `aws/iam-policy-template.json`, але заміни `YOUR_ACCOUNT_ID` на свій 12-значний AWS Account ID.

Policy name: `YoruDynamoDbOnly`

Потім:

IAM -> Users -> `yoru-cloudflare` -> Security credentials -> Access keys -> Create access key.

Для use case можна вибрати `Application running outside AWS`.

Збережи:
- Access key ID
- Secret access key

Secret показується один раз.

## 4. Міграція даних зі старого YORU/Notion

ЦЕ ЗРОБИ ДО ДЕПЛОЮ AWS-версії САЙТУ.

PowerShell:

```powershell
cd C:\шлях\до\yoru-aws-v7.0\migration
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Задай AWS credentials тільки в поточній PowerShell-сесії:

```powershell
$env:AWS_ACCESS_KEY_ID="ТВІЙ_ACCESS_KEY_ID"
$env:AWS_SECRET_ACCESS_KEY="ТВІЙ_SECRET_ACCESS_KEY"
$env:AWS_DEFAULT_REGION="eu-central-1"
```

Спочатку dry run:

```powershell
python .\migrate_yoru_to_dynamodb.py --dry-run
```

Він збере повний backup старої бази у JSON, але нічого не запише в AWS.

Потім реальна міграція:

```powershell
python .\migrate_yoru_to_dynamodb.py --table yoru-anime --region eu-central-1
```

Скрипт:
- читає список тайтлів із поточного `myster-anime.pages.dev`;
- для кожного тайтлу читає повні дані;
- зберігає локальний backup JSON;
- переносить тайтли в DynamoDB;
- переносить group colors, starred groups та status->groups settings;
- зберігає старі IDs, тому внутрішні посилання сайту не ламаються.

Не видаляй backup JSON.

## 5. Cloudflare Pages secrets

Зайди в папку `site/`.

```powershell
cd C:\шлях\до\yoru-aws-v7.0\site
```

Додай 4 secrets. Wrangler сам попросить значення після кожної команди:

```powershell
npx --yes wrangler@4.120.0 pages secret put AWS_ACCESS_KEY_ID --project-name myster-anime
npx --yes wrangler@4.120.0 pages secret put AWS_SECRET_ACCESS_KEY --project-name myster-anime
npx --yes wrangler@4.120.0 pages secret put AWS_REGION --project-name myster-anime
npx --yes wrangler@4.120.0 pages secret put AWS_DDB_TABLE --project-name myster-anime
```

Значення:
- `AWS_ACCESS_KEY_ID` = access key IAM user
- `AWS_SECRET_ACCESS_KEY` = secret IAM user
- `AWS_REGION` = `eu-central-1`
- `AWS_DDB_TABLE` = `yoru-anime`

Старі `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `NOTION_DATA_SOURCE_ID` після успішної перевірки AWS більше не потрібні. Їх можна видалити з Cloudflare secrets пізніше.

## 6. Deploy AWS site

```powershell
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```

Після deploy:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```

Очікується:

```json
{
  "ok": true,
  "version": "yoru-v7.0-aws-dynamodb-2026-09-11",
  "storage": "aws-dynamodb"
}
```

Health:

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/health" | ConvertTo-Json -Depth 10
```

Повинно бути приблизно:

```json
{
  "ok": true,
  "storage": "aws-dynamodb",
  "region": "eu-central-1",
  "table": "yoru-anime",
  "tableStatus": "ACTIVE",
  "itemCount": 100
}
```

Перевір список:

```powershell
$r = Invoke-RestMethod "https://myster-anime.pages.dev/api/anime"
$r.count
```

Число має збігатися з кількістю твоїх тайтлів.

## 7. Розширення

У Tampermonkey видали/вимкни старий `Anime -> Notion Collector` і встанови:

`extension/anime-to-yoru-collector-v3.0.0.user.js`

API URL не змінився (`myster-anime.pages.dev`), тому розширення автоматично працює з DynamoDB через Cloudflare Worker.

Firefox stream bridge також збережений.

## 8. Перевірка функцій

Перевір у такому порядку:

1. Відкривається каталог.
2. Вибране/Улюблене змінюються та видно після Ctrl+F5.
3. Статус `Переглянув` автоматично робить `Переглянуто=1`, якщо було 0.
4. `+1 Переглянуто` працює.
5. Сезон/Серія зберігаються.
6. Теги й нотатки зберігаються.
7. Групи: rename/color/star.
8. Status -> Groups mapping.
9. Редагування посилань.
10. Merge/Delete.
11. Додавання нового тайтлу через сайт.
12. Додавання/оновлення через Tampermonkey.

## 9. Що НЕ вмикати, якщо хочеш мінімізувати ризик витрат

- On-demand capacity для цієї таблиці — не потрібна.
- Auto scaling — Off.
- DAX — Off.
- Global tables — Off.
- Point-in-time recovery/backups — поки Off.
- DynamoDB Streams — Off, поки вони не потрібні.
- Не створюй EC2/RDS/NAT Gateway/API Gateway для цього проекту.

YORU використовує тільки DynamoDB, а API лишається на Cloudflare Pages Worker.

## 10. Безпека

- Не вставляй AWS Secret Access Key у JS, userscript або GitHub.
- Ключ лежить тільки в Cloudflare Pages secrets і локально під час міграції.
- Не використовуй root access key.
- IAM user має права тільки на одну DynamoDB table.
- Після міграції прибери `$env:AWS_SECRET_ACCESS_KEY` закриттям PowerShell або виконай:

```powershell
Remove-Item Env:AWS_ACCESS_KEY_ID
Remove-Item Env:AWS_SECRET_ACCESS_KEY
Remove-Item Env:AWS_DEFAULT_REGION
```
