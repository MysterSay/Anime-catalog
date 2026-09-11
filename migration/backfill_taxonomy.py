from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

AUTHORITY_HOSTS = ("myanimelist.net", "anilist.co", "shikimori.io", "shikimori.one")


def request_json(session: requests.Session, method: str, url: str, *, retries: int = 8, **kwargs):
    for attempt in range(retries):
        try:
            response = session.request(method, url, timeout=90, **kwargs)
            if response.status_code == 429 or response.status_code >= 500:
                retry_after = response.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else min(20.0, 1.5 * (attempt + 1))
                print(f"      HTTP {response.status_code}; retry in {wait:.1f}s")
                time.sleep(wait)
                continue
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            if attempt + 1 >= retries:
                raise
            wait = min(20.0, 1.5 * (attempt + 1))
            print(f"      {exc}; retry in {wait:.1f}s")
            time.sleep(wait)
    raise RuntimeError("request failed")


def taxonomy_all(value) -> list[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, dict):
        if isinstance(value.get("all"), list):
            return [str(x).strip() for x in value["all"] if str(x).strip()]
        source = value.get("sources") if isinstance(value.get("sources"), dict) else value
        out: list[str] = []
        seen: set[str] = set()
        for items in source.values():
            if not isinstance(items, list):
                continue
            for raw in items:
                name = str(raw).strip()
                key = name.casefold()
                if name and key not in seen:
                    seen.add(key)
                    out.append(name)
        return out
    return []


def authority_url(item: dict) -> str:
    priority = {"myanimelist.net": 0, "anilist.co": 1, "shikimori.io": 2, "shikimori.one": 2}
    candidates = []
    for link in item.get("links") or []:
        url = str(link.get("url") or "").strip()
        try:
            host = (urlparse(url).hostname or "").lower().removeprefix("www.")
        except Exception:
            continue
        if host in AUTHORITY_HOSTS:
            candidates.append((priority.get(host, 9), url))
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1] if candidates else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill Genre/Theme metadata for existing YORU Turso titles.")
    parser.add_argument("--site", default="https://myster-anime.pages.dev")
    parser.add_argument("--delay", type=float, default=0.45)
    parser.add_argument("--force", action="store_true", help="Refresh even records that already have taxonomy")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    base = args.site.rstrip("/")
    checkpoint = Path(__file__).with_name("taxonomy-backfill-checkpoint.json")
    done: set[str] = set()
    if checkpoint.exists():
        try:
            payload = json.loads(checkpoint.read_text(encoding="utf-8"))
            done = set(payload.get("done") or [])
        except Exception:
            pass

    session = requests.Session()
    session.headers.update({"Accept": "application/json", "User-Agent": "YORU-taxonomy-backfill/1.0"})

    catalog = request_json(session, "GET", f"{base}/api/anime")
    items = list(catalog.get("items") or [])
    if args.limit > 0:
        items = items[: args.limit]
    print(f"Found {len(items)} anime summaries")

    updated = skipped = failed = 0
    for index, summary in enumerate(items, 1):
        item_id = str(summary.get("id") or "")
        title = str(summary.get("title") or item_id)
        if not item_id:
            continue
        if item_id in done and not args.force:
            print(f"[{index}/{len(items)}] {title} (checkpoint)")
            skipped += 1
            continue
        if not args.force and (taxonomy_all(summary.get("genres")) or taxonomy_all(summary.get("themes"))):
            print(f"[{index}/{len(items)}] {title} (already has taxonomy)")
            done.add(item_id); skipped += 1
            checkpoint.write_text(json.dumps({"done": sorted(done)}, ensure_ascii=False, indent=2), encoding="utf-8")
            continue
        try:
            detail_payload = request_json(session, "GET", f"{base}/api/anime", params={"id": item_id})
            item = detail_payload.get("item") or {}
            query_title = item.get("originalTitle") or item.get("englishTitle") or item.get("title") or title
            seed_url = authority_url(item)
            print(f"[{index}/{len(items)}] {title}")
            taxonomy = request_json(session, "POST", f"{base}/api/core-taxonomy", json={"title": query_title, "url": seed_url, "status": "", "group": ""})
            genres = taxonomy.get("genres") or {"all": [], "sources": {}}
            themes = taxonomy.get("themes") or {"all": [], "sources": {}}
            request_json(session, "PATCH", f"{base}/api/anime", params={"id": item_id}, headers={"Content-Type": "application/json"}, json={"genres": genres, "themes": themes})
            print(f"      genres={len(taxonomy_all(genres))}, themes={len(taxonomy_all(themes))}")
            updated += 1
            done.add(item_id)
            checkpoint.write_text(json.dumps({"done": sorted(done)}, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            failed += 1
            print(f"      FAILED: {exc}")
        time.sleep(max(0.0, args.delay))

    print(f"Done. updated={updated}, skipped={skipped}, failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
