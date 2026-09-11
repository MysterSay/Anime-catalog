#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

TABLE_SQL = """
CREATE TABLE IF NOT EXISTS yoru_items (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
""".strip()
INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_yoru_items_entity ON yoru_items(entity)"
UPSERT_SQL = """
INSERT INTO yoru_items (id, entity, data, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  entity = excluded.entity,
  data = excluded.data,
  updated_at = excluded.updated_at
""".strip()


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def http_base(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if url.startswith("libsql://"):
        return "https://" + url[len("libsql://"):]
    if url.startswith("https://"):
        return url
    raise ValueError("TURSO_DATABASE_URL must start with libsql:// or https://")


def arg(value):
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": str(value)}
    return {"type": "text", "value": str(value)}


class TursoHTTP:
    def __init__(self, database_url: str, auth_token: str):
        self.base = http_base(database_url)
        self.token = auth_token.strip()
        if not self.token:
            raise ValueError("TURSO_AUTH_TOKEN is empty")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "YORU-Turso-Migrator/1.1",
        })

    def pipeline(self, statements, timeout=60):
        requests_payload = []
        for sql, values in statements:
            stmt = {"sql": sql}
            if values is not None:
                stmt["args"] = [arg(v) for v in values]
            requests_payload.append({"type": "execute", "stmt": stmt})
        requests_payload.append({"type": "close"})
        r = self.session.post(
            f"{self.base}/v2/pipeline",
            json={"requests": requests_payload},
            timeout=timeout,
        )
        if not r.ok:
            raise RuntimeError(f"Turso HTTP {r.status_code}: {r.text[:1200]}")
        payload = r.json()
        results = payload.get("results") or []
        out = []
        for idx in range(len(statements)):
            if idx >= len(results):
                raise RuntimeError(f"Turso response missing result #{idx + 1}")
            entry = results[idx]
            if entry.get("type") != "ok":
                raise RuntimeError(f"Turso SQL error: {json.dumps(entry, ensure_ascii=False)[:1200]}")
            out.append((entry.get("response") or {}).get("result") or {})
        return out

    def ensure_schema(self):
        self.pipeline([(TABLE_SQL, None), (INDEX_SQL, None)])

    def count(self):
        [result] = self.pipeline([("SELECT COUNT(*) AS count FROM yoru_items", None)])
        rows = result.get("rows") or []
        if not rows or not rows[0]:
            return 0
        return int(rows[0][0].get("value") or 0)

    def put_many(self, items, chunk_size=20):
        for offset in range(0, len(items), chunk_size):
            chunk = items[offset:offset + chunk_size]
            statements = []
            for item in chunk:
                statements.append((UPSERT_SQL, [
                    item["id"],
                    item.get("entity") or "anime",
                    json.dumps(item, ensure_ascii=False, separators=(",", ":")),
                    item.get("updatedAt") or utc_now(),
                ]))
            self.pipeline(statements, timeout=90)
            print(f"\r      {min(offset + len(chunk), len(items))}/{len(items)}", end="", flush=True)
        print()


def _retry_after_seconds(response):
    raw = (response.headers.get("Retry-After") or "").strip()
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(raw)
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
    except Exception:
        return None


def get_json(session, url, timeout=60, max_retries=12, label="request"):
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            r = session.get(
                url,
                timeout=timeout,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "YORU-Turso-Migrator/1.1",
                    "Cache-Control": "no-cache",
                },
            )
        except requests.RequestException as exc:
            last_error = exc
            if attempt >= max_retries:
                raise
            wait = min(30.0, 1.5 * (2 ** min(attempt, 4))) + random.uniform(0.1, 0.8)
            print(f"\n      {label}: network error ({exc}). Retry in {wait:.1f}s ...")
            time.sleep(wait)
            continue

        if r.ok:
            return r.json()

        if r.status_code == 429:
            if attempt >= max_retries:
                r.raise_for_status()
            server_wait = _retry_after_seconds(r)
            wait = server_wait if server_wait is not None else min(45.0, 2.0 * (2 ** min(attempt, 4)))
            wait = max(2.0, wait) + random.uniform(0.2, 1.0)
            print(f"\n      {label}: HTTP 429 (rate limit). Waiting {wait:.1f}s, then retry {attempt + 1}/{max_retries} ...")
            time.sleep(wait)
            continue

        if r.status_code in (408, 425, 500, 502, 503, 504):
            if attempt >= max_retries:
                r.raise_for_status()
            wait = min(30.0, 1.5 * (2 ** min(attempt, 4))) + random.uniform(0.1, 0.8)
            print(f"\n      {label}: HTTP {r.status_code}. Retry in {wait:.1f}s ({attempt + 1}/{max_retries}) ...")
            time.sleep(wait)
            continue

        r.raise_for_status()

    if last_error:
        raise last_error
    raise RuntimeError(f"Failed to load {url}")


def atomic_write_json(path: Path, payload):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def normalize_item(item):
    now = utc_now()
    return {
        "id": str(item.get("id") or ""),
        "entity": "anime",
        "title": str(item.get("title") or "Без назви"),
        "originalTitle": str(item.get("originalTitle") or ""),
        "englishTitle": str(item.get("englishTitle") or ""),
        "russianTitle": str(item.get("russianTitle") or ""),
        "aliases": str(item.get("aliases") or ""),
        "key": str(item.get("key") or ""),
        "poster": str(item.get("poster") or ""),
        "banner": str(item.get("banner") or ""),
        "description": str(item.get("description") or ""),
        "status": str(item.get("status") or "Без статусу"),
        "group": str(item.get("group") or "Без групи"),
        "addedAt": str(item.get("addedAt") or now),
        "updatedAt": now,
        "favorite": bool(item.get("favorite", False)),
        "liked": bool(item.get("liked", False)),
        "viewed": max(0, int(item.get("viewed") or 0)),
        "season": max(0, int(item.get("season") or 0)),
        "episode": max(0, int(item.get("episode") or 0)),
        "tags": [str(x).strip() for x in (item.get("tags") or []) if str(x).strip()],
        "notes": str(item.get("notes") or ""),
        "links": [
            {"name": str(x.get("name") or x.get("title") or "Посилання"), "url": str(x.get("url") or "")}
            for x in (item.get("links") or []) if isinstance(x, dict) and x.get("url")
        ],
        "sourceUrl": str(item.get("sourceUrl") or ""),
        "migratedFrom": str(item.get("migratedFrom") or "notion"),
    }


def load_checkpoint(path: Path, base: str):
    if not path.exists():
        return {"source": base, "items": {}, "createdAt": utc_now(), "updatedAt": utc_now()}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("source") != base:
            print(f"      Checkpoint belongs to another source; ignoring: {path}")
            return {"source": base, "items": {}, "createdAt": utc_now(), "updatedAt": utc_now()}
        if not isinstance(data.get("items"), dict):
            data["items"] = {}
        return data
    except Exception as exc:
        print(f"      WARNING: checkpoint could not be read ({exc}); starting fresh.")
        return {"source": base, "items": {}, "createdAt": utc_now(), "updatedAt": utc_now()}


def load_from_live(base, checkpoint_path: Path, request_delay=0.55, max_retries=12):
    s = requests.Session()
    print(f"[1/6] Reading catalog from {base} ...")
    root = get_json(s, f"{base}/api/anime", max_retries=max_retries, label="catalog")
    summaries = root.get("items") or []
    options = root.get("options") or {}
    print(f"      Found {len(summaries)} anime summaries")

    checkpoint = load_checkpoint(checkpoint_path, base)
    checkpoint["options"] = options
    checkpoint["summaryIds"] = [str(x.get("id") or "") for x in summaries if x.get("id")]
    checkpoint["updatedAt"] = utc_now()
    atomic_write_json(checkpoint_path, checkpoint)

    cached = checkpoint.get("items") or {}
    if cached:
        print(f"      Resume checkpoint: {len(cached)} full records already saved")

    full = []
    print("[2/6] Reading full title records ...")
    for idx, summary in enumerate(summaries, 1):
        item_id = str(summary.get("id") or "")
        if not item_id:
            continue

        normalized = cached.get(item_id)
        if not normalized:
            payload = get_json(
                s,
                f"{base}/api/anime?id={item_id}",
                max_retries=max_retries,
                label=f"title {idx}/{len(summaries)}",
            )
            item = payload.get("item")
            if item:
                normalized = normalize_item(item)
                if normalized["id"]:
                    cached[item_id] = normalized
                    checkpoint["items"] = cached
                    checkpoint["updatedAt"] = utc_now()
                    atomic_write_json(checkpoint_path, checkpoint)
            if request_delay > 0:
                time.sleep(request_delay)

        if normalized and normalized.get("id"):
            full.append(normalized)

        state = "cached" if item_id in cached else "missing"
        print(f"\r      {idx}/{len(summaries)}  ({state})", end="", flush=True)
    print()

    config = {
        "id": "CONFIG#CATALOG",
        "entity": "config",
        "version": 1,
        "groupOptions": [
            {"id": str(g.get("id") or f"legacy-{i}"), "name": str(g.get("name") or ""), "color": str(g.get("color") or "default")}
            for i, g in enumerate(options.get("groupOptions") or []) if g.get("name")
        ],
        "statusGroups": options.get("statusGroups") or {},
        "starredGroups": options.get("starredGroups") or [],
        "updatedAt": utc_now(),
    }

    checkpoint["complete"] = len(full) == len([x for x in summaries if x.get("id")])
    checkpoint["updatedAt"] = utc_now()
    atomic_write_json(checkpoint_path, checkpoint)
    return {"source": base, "options": options, "config": config, "items": full}


def main():
    ap = argparse.ArgumentParser(description="Migrate YORU data to Turso/libSQL")
    ap.add_argument("--source", default="https://myster-anime.pages.dev", help="Current OLD YORU site, before Turso deploy")
    ap.add_argument("--database-url", default=os.getenv("TURSO_DATABASE_URL", ""))
    ap.add_argument("--auth-token", default=os.getenv("TURSO_AUTH_TOKEN", ""))
    ap.add_argument("--backup", default="", help="Write/read backup path")
    ap.add_argument("--from-backup", action="store_true", help="Read --backup instead of live site")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--checkpoint", default="yoru-migration-checkpoint.json", help="Incremental resume checkpoint while reading old site")
    ap.add_argument("--request-delay", type=float, default=0.55, help="Delay between full-title requests in seconds (default: 0.55)")
    ap.add_argument("--max-retries", type=int, default=12, help="Retries for HTTP 429/5xx/network errors (default: 12)")
    args = ap.parse_args()

    if args.from_backup:
        if not args.backup:
            print("--from-backup requires --backup FILE", file=sys.stderr)
            return 2
        payload = json.loads(Path(args.backup).read_text(encoding="utf-8"))
        print(f"[1/6] Loaded backup: {args.backup}")
    else:
        try:
            payload = load_from_live(
                args.source.rstrip('/'),
                Path(args.checkpoint),
                request_delay=max(0.0, args.request_delay),
                max_retries=max(0, args.max_retries),
            )
        except Exception as exc:
            print("\nMigration source read interrupted.", file=sys.stderr)
            print(f"Reason: {exc}", file=sys.stderr)
            print(f"Progress is saved in: {Path(args.checkpoint).resolve()}", file=sys.stderr)
            print("Run the SAME command again; already downloaded title records will be skipped.", file=sys.stderr)
            return 4

    backup_path = Path(args.backup) if args.backup and not args.from_backup else Path(f"yoru-backup-before-turso-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json")
    if not args.from_backup:
        backup_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[3/6] Backup saved: {backup_path.resolve()}")
    else:
        print("[3/6] Using existing backup; no replacement backup written.")

    items = [payload.get("config") or {}] + [x for x in (payload.get("items") or []) if x.get("id")]
    if args.dry_run:
        print(f"[DRY RUN] Ready to migrate {len(items)-1} anime + config. Nothing written to Turso.")
        return 0

    if not args.database_url or not args.auth_token:
        print("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, or pass --database-url/--auth-token.", file=sys.stderr)
        return 2

    print("[4/6] Connecting to Turso and creating schema ...")
    db = TursoHTTP(args.database_url, args.auth_token)
    db.ensure_schema()
    print(f"      Connected: {db.base}")

    print("[5/6] Writing records ...")
    db.put_many(items)

    print("[6/6] Verification ...")
    count = db.count()
    expected = len(items)
    print(f"      Turso rows: {count}; expected at least: {expected}")
    if count < expected:
        print("WARNING: row count is lower than expected. Do not deploy Turso site yet.", file=sys.stderr)
        return 3
    print(f"      Anime migrated: {len(items)-1}")
    print("Migration complete. Keep the backup until the Turso version is fully verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
