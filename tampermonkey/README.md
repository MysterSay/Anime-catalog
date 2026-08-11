# Anime -> Notion Collector v2.0.0

The userscript is now a thin client of the same Yoru/Python pipeline as the website.
It no longer stores a Notion integration token and no longer runs 17 catalog scrapers inside the browser.

Flow:

1. Detect title + current page URL.
2. POST to `https://myster-anime.pages.dev/api/process-title-stream`.
3. Display the same NDJSON progress packets as the website (stage, percentage, catalog).
4. Receive the final schema-v2 JSON.
5. POST that JSON to `https://myster-anime.pages.dev/api/ingest`.
6. Show 100% only after Notion confirms the write.

Install by opening `anime-to-notion-collector-v2.0.0.user.js` with Tampermonkey.
