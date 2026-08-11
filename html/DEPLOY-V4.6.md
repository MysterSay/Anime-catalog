# Yoru v4.6

This site no longer needs Google Programmable Search / CX.

Flow:

1. Browser -> `POST /api/core-search` on Cloudflare.
2. Cloudflare proxies to Vercel `POST /api/search`.
3. Python core runs three Google `site:` searches and reads `og:image` from each result page.
4. User selects a tile.
5. Browser -> `/api/process-title` -> Vercel `/api/process` -> JSON -> Notion.

Deploy the Python core v2.4.0 first, then deploy this site.

If Vercel uses `CORE_API_KEY`, set the same value as a Cloudflare secret named `CORE_API_KEY`.
