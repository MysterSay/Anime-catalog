# Anime -> Notion Collector v2.5.0

- Adds `+1 Переглянуто` with the current Notion counter.
- Existing titles increment `/api/anime/viewed` immediately.
- New titles keep a pending counter and write it after creation.
- Selecting status `Переглянув` guarantees at least one view.
- Favorite/Liked, status, group and viewed count remain synced through Yoru/Notion.
