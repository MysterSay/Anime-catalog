# Yoru v5.3 — Merge titles

## Deploy

```powershell
cd <folder-with-these-files>
npx wrangler pages deploy . --project-name myster-anime
```

## Verify

```powershell
Invoke-RestMethod "https://myster-anime.pages.dev/api/version" | ConvertTo-Json -Depth 10
```

Expected version: `yoru-v5.3-merge-title-2026-08-11`.

## Merge flow

1. Open any title.
2. Press **Об’єднати** below the links list.
3. Choose the second title in the catalog. Search/filter/sort remain available.
4. On the full-screen merge page choose left/right values for title, poster, marks, banner and description.
5. Links are always combined and duplicate URLs are ignored.
6. The first title (right side) remains as the Notion record; the second title (left side) is moved to Notion Trash after merge.

The Notion public API does not permanently purge pages; deletion removes a title from the database by moving its page to Trash.
