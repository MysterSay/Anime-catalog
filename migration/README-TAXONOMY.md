# Genre / Theme backfill

Після деплою Python Core 2.11.0 і сайту v7.2 запусти:

```powershell
cd migration
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python .\backfill_taxonomy.py
```

Скрипт не запускає повний пошук по 17 каталогах. Він використовує швидкий `/api/core-taxonomy`, а потім PATCH-ить тільки `genres` і `themes` у Turso.

Checkpoint: `taxonomy-backfill-checkpoint.json`. Повторний запуск продовжує з місця зупинки.
