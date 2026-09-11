# YORU Turso migration hotfix 1.1

This migration helper is rate-limit safe for the old Notion-backed YORU API.

Changes:
- pauses 0.55s between full-title requests by default;
- honors HTTP `Retry-After` on 429;
- retries 429, temporary 5xx and network errors with backoff;
- writes `yoru-migration-checkpoint.json` after every downloaded title;
- rerunning the same command resumes and skips already cached full records.

Recommended first run:

```powershell
python .\migrate_yoru_to_turso.py --dry-run
```

If the old API still rate-limits heavily:

```powershell
python .\migrate_yoru_to_turso.py --dry-run --request-delay 0.9
```

After a successful dry run, run the real migration with the same checkpoint:

```powershell
python .\migrate_yoru_to_turso.py
```
