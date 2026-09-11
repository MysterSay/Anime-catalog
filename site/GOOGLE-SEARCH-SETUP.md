# Google search setup (Yoru v4.5)

Yoru v4.5 does **not** scrape `https://www.google.com/search` from Cloudflare anymore.
Google was returning HTTP 429 to Cloudflare datacenter IPs.

Instead the browser uses the official Google Programmable Search Element and its results-ready callback.

## One-time setup

1. Open Google Programmable Search Engine and create a search engine.
2. Add these sites:
   - `myanimelist.net`
   - `anilist.co`
   - `shikimori.io`
3. Copy the **Search engine ID (cx)**.
4. Either:
   - paste the CX in the Yoru modal when it asks for it (stored in localStorage), or
   - configure it in Cloudflare Pages:

```powershell
npx wrangler pages secret put GOOGLE_CX --project-name myster-anime
npx wrangler pages deploy . --project-name myster-anime
```

The CX is not a password; the site must send it to Google's browser-side Search Element.

## Search flow

For a title `Arifureta Shokugyou de Sekai Saikyou` the browser executes, sequentially:

- `site:myanimelist.net "Arifureta Shokugyou de Sekai Saikyou"`
- `site:anilist.co "Arifureta Shokugyou de Sekai Saikyou"`
- `site:shikimori.io "Arifureta Shokugyou de Sekai Saikyou"`

The returned URLs are filtered to actual anime title pages. Then `/api/source-preview` reads each chosen site's page directly to get `og:title` and `og:image`. Google thumbnails are not used as the source image.

The selected title+URL are sent to `/api/process-title`, which proxies to the Vercel Python core. The core JSON is then ingested into Notion.
