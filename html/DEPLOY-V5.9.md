# Yoru v5.9

- Status `Переглянув` automatically ensures `Переглянуто >= 1`.
- Existing counters are never reset by core ingest when `viewed` is absent.
- Extension v2.5 adds a +1 viewed control.

Deploy:

```powershell
npx --yes wrangler@4.120.0 pages deploy . --project-name myster-anime
```
