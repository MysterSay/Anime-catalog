from __future__ import annotations

import asyncio
import html as html_lib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable
from urllib.parse import parse_qs, quote, quote_plus, unquote, urlencode, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

APP_VERSION = "2.21.2"
DEFAULT_RESULT_WEBHOOK_URL = "https://mrsay.pages.dev/api/ingest"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)

AUTHORITY_SITES = ["myanimelist.net", "anilist.co", "shikimori.io"]
AUTHORITY_LABELS = {
    "myanimelist.net": "MyAnimeList",
    "anilist.co": "AniList",
    "shikimori.io": "Shikimori",
}
RU_SITES = [
    "jut-su.net",
    "ru.yummyani.me",
    "crunchyroll.com",
    "shikimori.io",
    "animevost.org",
    "jutsu.tv",
    "jut.su",
    "animego.studio",
    "anilibria.tv",
]
UA_SITES = [
    "uaserials.com",
    "uachan.com",
    "anihub.in.ua",
    "amanogawa.space",
    "animeon.club",
    "anidesu.net",
    "mikai.me",
    "anitube.in.ua",
]
CATALOG_SITES = RU_SITES + UA_SITES

# DataLife Engine-style catalogs use POST search forms.  Hitting generic GET
# routes first is both slower and, on sites such as jut-su.net, can prevent the
# real search request from ever running before the outer timeout.
DLE_SEARCH_SITES = {
    "jut-su.net", "animevost.org", "jutsu.tv", "animego.studio",
    "anidesu.net", "anitube.in.ua", "uachan.com",
}

HOST_ALIASES: dict[str, list[str]] = {
    "anilibria.tv": ["aniliberty.top", "www.aniliberty.top", "anilibria.top", "www.anilibria.top", "anilibria.tv"],
    "uachan.com": ["uachan.top", "www.uachan.top", "uachan.com", "www.uachan.com"],
    "crunchyroll.com": ["www.crunchyroll.com", "crunchyroll.com"],
    "shikimori.io": ["shikimori.io", "shikimori.one"],
}

SEARCH_ROUTES: dict[str, list[str]] = {
    "jut-su.net": [
        "https://jut-su.net/?s={q}",
        "https://jut-su.net/index.php?do=search&subaction=search&story={q}",
    ],
    "ru.yummyani.me": [
        # /catalog?search returns the actual filtered catalog. The WordPress-style
        # /?s= route returns a ~0.9 MB generic page and has not produced useful
        # matches in profiling, so avoid downloading it for every alias.
        "https://ru.yummyani.me/catalog?search={q}",
    ],
    "crunchyroll.com": ["https://www.crunchyroll.com/search?q={q}"],
    "animevost.org": ["https://animevost.org/index.php?do=search&subaction=search&story={q}"],
    "jutsu.tv": [
        "https://jutsu.tv/index.php?do=search&subaction=search&story={q}",
        "https://jutsu.tv/?s={q}",
    ],
    "jut.su": ["https://jut.su/anime/?search={q}"],
    "animego.studio": [
        "https://animego.studio/index.php?do=search&subaction=search&story={q}",
        "https://animego.studio/?s={q}",
        "https://animego.studio/search?q={q}",
    ],
    "anilibria.tv": [
        # aniliberty.top and anilibria.top are mirrors and returned byte-identical
        # catalog pages in profiling. Use the preferred host; direct search falls
        # back to the mirror only on transport/server failure.
        "https://aniliberty.top/anime/catalog?search={q}",
    ],
    "uaserials.com": ["https://uaserials.com/search/{q_path}/"],
    "uachan.com": [
        "https://uachan.top/index.php?do=search&subaction=search&story={q}",
        "https://uachan.com/index.php?do=search&subaction=search&story={q}",
    ],
    "anihub.in.ua": [
        "https://anihub.in.ua/search?q={q}",
        "https://anihub.in.ua/anime?search={q}",
    ],
    "amanogawa.space": [
        # Keep one canonical probe. If the search endpoint itself is 404, the
        # per-run dead-route guard stops trying new aliases against the same
        # unavailable route.
        "https://amanogawa.space/search?q={q}",
    ],
    "animeon.club": [
        "https://animeon.club/anime?search={q}",
        "https://animeon.club/search?q={q}",
        "https://animeon.club/?s={q}",
    ],
    "anidesu.net": [
        # Native POST search is blocked with 403; the public GET search is usable.
        "https://anidesu.net/?s={q}",
    ],
    "mikai.me": ["https://mikai.me/catalog?search={q}"],
    "anitube.in.ua": [
        "https://anitube.in.ua/index.php?do=search&subaction=search&story={q}",
        "https://anitube.in.ua/?s={q}",
    ],
}

SEARCH_FIELD_NAMES = {"q", "s", "search", "query", "keyword", "word", "story", "title", "term"}
SEARCH_HINT_RE = re.compile(r"search|find|пошук|знайти|поиск|найти|anime|аніме|аниме", re.I)
NAV_RE = re.compile(r"/(?:search|find|login|register|forum|news|schedule|catalog|browse|users?|genres?|studios?|characters?)(?:/|$)", re.I)
SEASON_RE = re.compile(
    r"(?:\b(?:season|сезон|сезони|часть|частина|part|cour|arc|арка|глава|hen)\b|"
    r"\b(?:первый|перший|второй|другий|третий|третій|четвертый|четвёртый|четвертий)\s+(?:сезон|часть|частина)\b|"
    r"\b\d+(?:st|nd|rd|th)\b|\b\d+\s*(?:season|сезон|часть|частина|part)\b)",
    re.I,
)
EPISODE_RE = re.compile(r"\b(?:episode|ep\.?|серия|серії|серія|епізод)\b", re.I)

CATALOG_NOISE_TITLES = {
    "каталог", "все аниме", "усі аніме", "аниме", "аніме", "ova", "ona", "tv сериалы",
    "тв сериалы", "фильмы", "фільми", "игры", "ігри", "комедия", "комедія", "драмы",
    "драми", "гарем", "приключения", "пригоди", "романтика", "фэнтези", "фентезі",
    "магия", "магія", "мистика", "спорт", "спортивные", "боевые искусства", "військові",
    "военные", "исторические", "історичні", "психология", "психологія", "сверхъестественное",
    "надприродне", "супер сила", "суперсила", "подборки", "добірки", "популярные франшизы",
    "популярні франшизи", "франшизы", "франшизи", "с субтитрами", "із субтитрами", "рандом",
    "telegram", "tiktok", "підтримка", "поддержка", "донат", "головна", "главная", "новинки",
    "інше", "другое", "профіль", "профиль", "anihub", "аніхаб", "анихаб", "буденність",
}

TITLE_PATH_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "jut-su.net": (re.compile(r"^/\d+-[^/]+\.html$", re.I),),
    "ru.yummyani.me": (re.compile(r"^/catalog/item/[^/]+/?$", re.I),),
    "crunchyroll.com": (re.compile(r"^/series/[A-Z0-9]+(?:/[^/]+)?/?$", re.I),),
    "shikimori.io": (re.compile(r"^/animes/\d+(?:-[^/]+)?/?$", re.I),),
    "animevost.org": (re.compile(r"^/tip/[^/]+/\d+-[^/]+\.html$", re.I),),
    "animego.studio": (re.compile(r"^/\d+-[^/]+\.html$", re.I),),
    "anilibria.tv": (re.compile(r"^/anime/releases/release/[^/]+/?$", re.I),),
    "uaserials.com": (re.compile(r"^/\d+-[^/]+\.html$", re.I),),
    "anihub.in.ua": (re.compile(r"^/anime/[^/]+-\d+/?$", re.I),),
    "amanogawa.space": (re.compile(r"^/anime/\d+/[^/]+/?$", re.I),),
    "animeon.club": (re.compile(r"^/anime/\d+(?:-[^/]+)?/?$", re.I),),
    "mikai.me": (re.compile(r"^/anime/\d+(?:-[^/]+)?/?$", re.I),),
    "anitube.in.ua": (re.compile(r"^/\d+-[^/]+\.html$", re.I),),
}

AUTHORITY_PATH_PATTERNS: dict[str, re.Pattern[str]] = {
    "myanimelist.net": re.compile(r"^/anime/\d+(?:/[^/?#]+)?/?$", re.I),
    "anilist.co": re.compile(r"^/anime/\d+(?:/[^/?#]+)?/?$", re.I),
    "shikimori.io": re.compile(r"^/animes/\d+(?:-[^/?#]+)?/?$", re.I),
}


class InputPayload(BaseModel):
    title: str = Field(min_length=1)
    url: str | None = ""
    status: str | None = ""
    group: str | None = ""
    # Optional Mikai Public API key forwarded server-to-server by the site.
    # Missing/blank/invalid-looking values are ignored, so old clients and
    # public no-key mode keep working unchanged.
    mikai_api_key: str | None = ""
    # Backfill/site clients may ask the serverless core to skip AniList GraphQL
    # and perform that one hop from the user's own network instead.  AniList can
    # return HTTP 403 to shared cloud/serverless egress while the same public
    # query works from a normal client connection.
    prefer_client_anilist: bool = False


class SearchPayload(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    limit: int = Field(default=8, ge=1, le=10)


@dataclass
class AuthorityData:
    links: dict[str, list[dict[str, str]]] = field(default_factory=lambda: {site: [] for site in AUTHORITY_SITES})
    aliases: list[str] = field(default_factory=list)
    original: str = ""
    english: str = ""
    native: str = ""
    russian: str = ""
    description: str = ""
    cover: str = ""
    cover_source: str = ""
    banner: str = ""
    trailer_id: str = ""
    trailer_site: str = ""
    trailer_thumbnail: str = ""
    trailer_url: str = ""
    trailer_embed_url: str = ""
    trailer_source: str = ""
    genres: dict[str, list[str]] = field(default_factory=lambda: {site: [] for site in AUTHORITY_SITES})
    themes: dict[str, list[str]] = field(default_factory=lambda: {site: [] for site in ["myanimelist.net", "shikimori.io"]})
    anilist_id: int | None = None
    mal_id: int | None = None


class MemoryCache:
    def __init__(self, ttl_seconds: int = 6 * 60 * 60):
        self.ttl = ttl_seconds
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        item = self._data.get(key)
        if not item:
            return None
        created, value = item
        if time.time() - created > self.ttl:
            self._data.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._data[key] = (time.time(), value)


TITLE_CACHE = MemoryCache()
FORM_CACHE = MemoryCache(ttl_seconds=60 * 60)


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def clean_title(value: Any) -> str:
    title = clean_text(value).strip(" \t\n\r\"'«»“”„")
    title = re.sub(r"\s*[|–—-]\s*(?:смотреть|дивитися|watch|anime|аниме|аніме).*?$", "", title, flags=re.I)
    title = re.sub(r"\s*[|–—-]\s*(?:jut\.?su|animego|shikimori|crunchyroll|anilibria|uaserials|myanimelist|anilist).*?$", "", title, flags=re.I)
    return title.strip()


def normalize_title(value: Any) -> str:
    value = clean_title(value).casefold()
    value = value.replace("ё", "е").replace("’", "'")
    value = re.sub(r"[^a-z0-9а-яіїєґ一-龯ぁ-んァ-ヶ]+", " ", value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip()


def unique_strings(values: Iterable[Any], limit: int | None = None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = clean_title(raw)
        if not value:
            continue
        key = normalize_title(value)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value)
        if limit and len(result) >= limit:
            break
    return result


def same_host(host: str, domain: str) -> bool:
    host = host.lower().removeprefix("www.")
    domain = domain.lower().removeprefix("www.")
    return host == domain or host.endswith("." + domain)


def logical_hosts(domain: str) -> list[str]:
    return HOST_ALIASES.get(domain, [domain])


def host_allowed(host: str, domain: str) -> bool:
    return any(same_host(host, candidate) for candidate in logical_hosts(domain))


def source_domain(url: str | None) -> str:
    try:
        return urlparse(url or "").hostname or ""
    except Exception:
        return ""


def media_trailer_url(site: str, trailer_id: str) -> str:
    site = clean_text(site).lower()
    trailer_id = clean_text(trailer_id)
    if not trailer_id:
        return ""
    if trailer_id.startswith(("http://", "https://")):
        return trailer_id
    if site in {"youtube", "youtu.be"}:
        return f"https://www.youtube.com/watch?v={quote(trailer_id, safe='-_')}"
    if site in {"dailymotion", "dai.ly"}:
        return f"https://www.dailymotion.com/video/{quote(trailer_id, safe='-_')}"
    return ""


def media_trailer_embed_url(site: str, trailer_id: str) -> str:
    site = clean_text(site).lower()
    trailer_id = clean_text(trailer_id)
    if not trailer_id:
        return ""
    if site in {"youtube", "youtu.be"}:
        return f"https://www.youtube.com/embed/{quote(trailer_id, safe='-_')}"
    if site in {"dailymotion", "dai.ly"}:
        return f"https://www.dailymotion.com/embed/video/{quote(trailer_id, safe='-_')}"
    return ""


def trailer_id_from_url(url: str) -> str:
    url = clean_text(url)
    if not url:
        return ""
    match = re.search(r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/))([A-Za-z0-9_-]{6,})", url, re.I)
    if match:
        return match.group(1)
    match = re.search(r"(?:dailymotion\.com/(?:video|embed/video)/|dai\.ly/)([A-Za-z0-9]+)", url, re.I)
    return match.group(1) if match else ""


def compact_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        query = {k: v for k, v in query.items() if not re.match(r"^(?:utm_|yclid|ysclid|ref|from)", k, re.I)}
        qs = urlencode([(k, x) for k, values in query.items() for x in values])
        return parsed._replace(query=qs, fragment="").geturl()
    except Exception:
        return url


def is_navigation_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        path = parsed.path or "/"
        if path in {"", "/"}:
            return True
        return bool(NAV_RE.search(path))
    except Exception:
        return True


def is_catalog_noise_title(value: str) -> bool:
    text = clean_title(value)
    key = normalize_title(text)
    if not key:
        return True
    if key in {normalize_title(x) for x in CATALOG_NOISE_TITLES}:
        return True
    if re.fullmatch(r"(?:19|20)\d{2}(?: год| рік)?", key):
        return True
    if re.fullmatch(r"\d+(?:[.,]\d+)?", key):
        return True
    # Ratings, rip/quality labels and bare site/brand names are metadata, not aliases.
    if re.fullmatch(r"\d+(?:[.,]\d+)?\s*/\s*10(?:\s*\([^)]*\))?", text, re.I):
        return True
    if re.search(r"\b(?:WEB[- .]?DL|WEB[- .]?DLRip|BDRip|BluRay|HDRip|DVDRip|1080p|720p|2160p|4K)\b", text, re.I):
        return True
    if re.fullmatch(r"(?:animevost|anitube|animego|anihub|mikai|shikimori|myanimelist|anilist)", key, re.I):
        return True
    # Long SEO sentences such as "watch ... online free" must never drive searches.
    seo_hits = re.findall(r"(?:дивитися|смотреть|watch|online|онлайн|безкоштовно|бесплатно|серій|серии|episodes?)", text, re.I)
    if (len(text) > 150 and seo_hits) or (len(text) > 85 and len(seo_hits) >= 2):
        return True
    # Catalog-generated SEO labels such as "... смотреть на джутсу" are useful
    # for display/debugging but must never become cross-catalog search aliases.
    if len(text) > 42 and re.search(r"\b(?:дивитися|смотреть|watch|онлайн|online)\b", text, re.I):
        return True
    return False


def is_authority_title_url(site: str, url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if not same_host(host, site):
            return False
        pattern = AUTHORITY_PATH_PATTERNS.get(site)
        return bool(pattern and pattern.match(parsed.path or "/"))
    except Exception:
        return False


def is_catalog_title_url(domain: str, url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        path = parsed.path or "/"
    except Exception:
        return False
    if not host_allowed(host, domain) or is_navigation_url(url):
        return False

    patterns = TITLE_PATH_PATTERNS.get(domain)
    if patterns:
        return any(pattern.match(path) for pattern in patterns)

    # Sites without a stable documented path still must look like a leaf page, never a category/search root.
    parts = [part for part in path.split("/") if part]
    if not parts:
        return False
    if len(parts) == 1 and normalize_title(parts[0]) in {
        "anime", "catalog", "ova", "ona", "movies", "films", "top", "ongoing", "schedule",
    }:
        return False
    return True


def slug_title(url: str) -> str:
    try:
        part = unquote(urlparse(url).path.rstrip("/").split("/")[-1])
        part = re.sub(r"\.(?:html?|php)$", "", part, flags=re.I)
        part = re.sub(r"^\d+[-_]", "", part)
        return clean_title(re.sub(r"[-_]+", " ", part))
    except Exception:
        return ""


def title_script(value: str) -> str:
    text = clean_title(value)
    if re.search(r"[а-яіїєґ]", text, re.I):
        return "cyrillic"
    if re.search(r"[a-z]", text, re.I):
        return "latin"
    if re.search(r"[一-龯ぁ-んァ-ヶ]", text):
        return "cjk"
    return "other"


def strip_series_suffix(value: str) -> str:
    text = normalize_title(value)
    if not text:
        return ""
    # Keep the franchise root while allowing sequel/movie/season variants to be treated as related.
    tokens = text.split()
    cut_words = {
        "season", "movie", "film", "ova", "ona", "special", "part", "cour", "arc", "hen",
        "сезон", "фильм", "фільм", "часть", "частина", "арка", "глава",
    }
    for i, token in enumerate(tokens):
        if token in cut_words or re.fullmatch(r"\d+(?:st|nd|rd|th)", token):
            if i >= 2:
                tokens = tokens[:i]
                break
    return " ".join(tokens).strip()


def title_relation_score(a: str, b: str) -> float:
    na, nb = normalize_title(a), normalize_title(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if title_script(na) != title_script(nb) and {title_script(na), title_script(nb)} <= {"latin", "cyrillic"}:
        return 0.0

    ra, rb = strip_series_suffix(a), strip_series_suffix(b)
    if ra and rb and (ra == rb or (len(ra) >= 7 and (rb.startswith(ra + " ") or ra.startswith(rb + " ")))):
        return 0.92

    ta, tb = set(na.split()), set(nb.split())
    if not ta or not tb:
        return 0.0
    overlap = len(ta & tb) / max(1, min(len(ta), len(tb)))
    ratio = SequenceMatcher(None, na, nb).ratio()
    prefix = 0.0
    shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
    if len(shorter) >= 7 and longer.startswith(shorter + " "):
        prefix = 0.86
    return max(overlap * 0.82, ratio, prefix)


def titles_related(a: str, b: str, threshold: float = 0.62) -> bool:
    return title_relation_score(a, b) >= threshold


def is_probable_title(value: str) -> bool:
    text = clean_title(value)
    if len(text) < 2 or len(text) > 220:
        return False
    if normalize_title(text) in {"watch", "anime", "аниме", "аніме", "смотреть", "дивитися", "подробнее", "детальніше"}:
        return False
    return True


def choose_localized_title(group: str, values: Iterable[str], canonical: list[str]) -> str:
    candidates = [
        value for value in unique_strings(values, limit=80)
        if is_probable_title(value) and not is_catalog_noise_title(value)
    ]
    if not candidates:
        return ""
    canonical_keys = {normalize_title(x) for x in canonical if clean_title(x)}

    def score(value: str) -> tuple[int, int, int, int]:
        norm = normalize_title(value)
        ua_marks = len(re.findall(r"[іїєґ]", value, re.I))
        ru_marks = len(re.findall(r"[ыэёъ]", value, re.I))
        cyr = 1 if re.search(r"[а-яіїєґ]", value, re.I) else 0
        distinct = 0 if norm in canonical_keys else 1
        if group == "UA":
            lang = 4 if ua_marks else (2 if cyr and not ru_marks else 0)
        else:
            lang = 4 if ru_marks else (2 if cyr and not ua_marks else 0)
        # Prefer a base title over a season/movie suffix when both exist.
        base_bonus = 1 if not SEASON_RE.search(value) else 0
        return (lang, distinct, base_bonus, -len(value))

    best = max(candidates, key=score)
    return best if score(best)[0] > 0 else ""


def title_match_kind(candidate: str, aliases: list[str]) -> str | None:
    cand = normalize_title(candidate)
    if not cand:
        return None
    for alias in aliases:
        base = normalize_title(alias)
        if not base:
            continue
        if cand == base:
            return "exact"
        if cand.startswith(base + " "):
            suffix = cand[len(base):].strip()
            if suffix and not EPISODE_RE.search(suffix) and SEASON_RE.search(suffix):
                return "season"
    return None



def season_number(value: str) -> int | None:
    """Return an explicit *season* number, never a cour/part number.

    2.18 treated ``Part 2`` / ``Частина 2`` as season 2.  That polluted family
    roots and could turn split cours, movies or specials into fake seasons.
    """
    text = clean_title(value).casefold()
    if not text:
        return None
    text = re.sub(r"\bcезон", "сезон", text, flags=re.I)
    patterns = [
        r"\b(?:season|сезон(?:и)?)\s*[:#.-]?\s*(\d{1,2})\b",
        r"\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:season|сезон(?:и)?)\b",
        r"\bs\s*(\d{1,2})\b",
        r"第\s*(\d{1,2})\s*期",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            try:
                number = int(match.group(1))
            except (TypeError, ValueError):
                continue
            if 1 <= number <= 30:
                return number
    word_ordinals = {
        "первый": 1, "первого": 1, "перший": 1, "перша": 1,
        "второй": 2, "второго": 2, "другий": 2, "друга": 2,
        "третий": 3, "третьего": 3, "третій": 3, "третя": 3,
        "четвертый": 4, "четвёртый": 4, "четвертий": 4,
        "пятый": 5, "п'ятий": 5, "п’ятий": 5,
        "шестой": 6, "шостий": 6,
        "седьмой": 7, "сьомий": 7,
        "восьмой": 8, "восьмий": 8,
    }
    for word, number in word_ordinals.items():
        if re.search(rf"\b{re.escape(word)}\s+(?:season|сезон)\b", text, re.I):
            return number
    return None


def part_number(value: str) -> int | None:
    """Return an explicit split-cour/part number without confusing it with season."""
    text = clean_title(value).casefold()
    if not text:
        return None
    for pattern in (
        r"\b(?:part|cour|часть|частина)\s*[:#.-]?\s*(\d{1,2})\b",
        r"\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:part|cour|часть|частина)\b",
    ):
        match = re.search(pattern, text, re.I)
        if match:
            number = int(match.group(1))
            if 1 <= number <= 30:
                return number
    return None


def season_family_title(value: str) -> str:
    """Return a stable franchise root for a seasonal title.

    Split-cour suffixes are stripped first and the season marker second, so
    ``Season 2 Part 2`` and ``(сезон 2, частина 2)`` both reduce to the same root.
    """
    text = clean_title(value)
    if not text:
        return ""
    text = re.sub(r"\b[Cc]езон", "сезон", text)
    previous = None
    while previous != text:
        previous = text
        # Parenthesized combined markers: ``(сезон 2, частина 2)``.
        text = re.sub(
            r"\s*[\[(]\s*(?:season|сезон(?:и)?)\s*[:#.-]?\s*\d{1,2}\s*(?:[,;/]\s*(?:part|cour|часть|частина)\s*[:#.-]?\s*\d{1,2})?\s*[\])]\s*$",
            "", text, flags=re.I,
        )
        # Strip a trailing split-cour marker, then loop so the preceding season
        # marker can be removed on the next pass.
        text = re.sub(
            r"\s*[:,.\-–—]?\s*[\[(]?\s*(?:part|cour|часть|частина)\s*[:#.-]?\s*\d{1,2}\s*[\])]?[\s.!:;,_\-–—]*$",
            "", text, flags=re.I,
        )
        text = re.sub(
            r"\s*[:,.\-–—]?\s*[\[(]?\s*\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:part|cour|часть|частина)\s*[\])]?[\s.!:;,_\-–—]*$",
            "", text, flags=re.I,
        )
        text = re.sub(
            r"\s*[:\-–—]?\s*[\[(]?\s*(?:season|сезон(?:и)?)\s*[:#.-]?\s*\d{1,2}\s*[\])]?[\s.!:;,_\-–—]*$",
            "", text, flags=re.I,
        )
        text = re.sub(
            r"\s*[:\-–—]?\s*[\[(]?\s*\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:season|сезон(?:и)?)\s*[\])]?[\s.!:;,_\-–—]*$",
            "", text, flags=re.I,
        )
        text = re.sub(r"\s*[:\-–—]?\s+s\s*\d{1,2}\s*$", "", text, flags=re.I)
        text = re.sub(
            r"\s*[:\-–—]?\s*[\[(]?\s*(?:первый|перший|второй|другий|третий|третій|четвертый|четвёртый|четвертий|пятый|п'ятий|п’ятий|шестой|шостий|седьмой|сьомий|восьмой|восьмий)\s+(?:season|сезон)\s*[\])]?[\s.!:;,_\-–—]*$",
            "", text, flags=re.I,
        )
        text = re.sub(r"\s*第\s*\d{1,2}\s*期\s*$", "", text, flags=re.I)
        text = clean_title(text).rstrip(" :-–—,.;")
    return clean_title(text).rstrip(" :-–—,.;")


def season_family_roots(values: Iterable[str], *, limit: int = 12) -> list[str]:
    """Extract stable season-free roots only from titles that explicitly name a season.

    Split-cour/part markers may be present, but they never define a season by
    themselves.  This keeps Season 2 Part 2 attached to season 2 while avoiding
    fake roots such as a bare "Part 2" title.
    """
    roots: list[str] = []
    for value in values:
        value = clean_title(value)
        if not value:
            continue
        explicit = season_number(value) is not None or bool(re.search(r"第\s*\d{1,2}\s*期", value))
        if not explicit:
            continue
        root = season_family_title(value)
        if root and normalize_title(root) != normalize_title(value) and len(root) >= 3:
            roots.append(root)
    return unique_strings(roots, limit=limit)


_SEASON_FAMILY_EXTRA_RE = re.compile(
    r"(?:\b(?:movie|film|ova|ona|special|specials|recap|summary|digest|compilation|spin[ -]?off|gaiden)\b"
    r"|\b(?:фильм|фільм|спецвыпуск|спецвипуск|спецвыпуски|спецвипуски|переказ|пересказ|відступ)\b"
    r"|劇場版)", re.I,
)


def _strip_episode_metadata(value: str) -> str:
    text = clean_title(value)
    # Remove only trailing bracket counters/OVA counters; do not erase meaningful
    # parenthesized season markers.
    text = re.sub(r"(?:\s*\[[^\]]*(?:\d+\s*[-–]\s*\d+|\d+\s*(?:из|з|of)\s*\d+|OVA\s*\d+)[^\]]*\])+$", "", text, flags=re.I)
    return clean_title(text)


def is_season_family_member(value: str, roots: Iterable[str]) -> bool:
    """True only for the main TV season line, not movies/OVAs/recaps/spin-offs."""
    text = _strip_episode_metadata(value)
    roots = [clean_title(root) for root in roots if clean_title(root)]
    if not text or not roots:
        return False

    def single(candidate: str) -> bool:
        candidate = clean_title(candidate)
        if not candidate or _SEASON_FAMILY_EXTRA_RE.search(candidate):
            return False
        number = season_number(candidate)
        family = season_family_title(candidate) if number is not None else candidate
        if number is None:
            # Some catalogs write only a trailing number (``... слиз 3``). Accept
            # it only when stripping that number yields a very strong root match.
            bare = re.search(r"^(.*?)\s+([2-9]|[12]\d|30)\s*$", candidate)
            if bare:
                bare_family = clean_title(bare.group(1))
                bare_best = max((title_relation_score(bare_family, root) for root in roots), default=0.0)
                bare_exact = any(normalize_title(bare_family) == normalize_title(root) for root in roots)
                if bare_exact or bare_best >= 0.90:
                    return True
        best = max((title_relation_score(family, root) for root in roots), default=0.0)
        exact_root = any(normalize_title(family) == normalize_title(root) for root in roots)
        if number is not None:
            return exact_root or best >= 0.76
        return exact_root or best >= 0.94

    # AnimeVost and similar catalogs expose ``RU / Romaji [episodes]``. Either
    # half may be the clean seasonal title; evaluate them independently so the
    # bracketed OVA counter does not make season 1 look like an OVA entry.
    if " / " in text:
        parts = [clean_title(part) for part in text.split(" / ") if clean_title(part)]
        if any(single(part) for part in parts):
            return True
    return single(text)


def catalog_titles_cover_alias(existing_titles: Iterable[str], alias: str) -> bool:
    """Whether existing catalog results already cover a discovered season alias.

    This treats a plain base title as season 1 and understands both "2 сезон" and
    "сезон 2", preventing needless replay of catalogs that already returned the
    same season with a different suffix style.
    """
    alias = clean_title(alias)
    if not alias:
        return True
    target_num = season_number(alias)
    target_family = season_family_title(alias)
    for existing in existing_titles:
        existing = clean_title(existing)
        if not existing:
            continue
        if normalize_title(existing) == normalize_title(alias):
            return True
        if title_match_kind(existing, [alias]) == "exact" or title_match_kind(alias, [existing]) == "exact":
            return True
        existing_num = season_number(existing)
        existing_family = season_family_title(existing)
        family_score = title_relation_score(existing_family or existing, target_family or alias)
        if target_num is not None:
            # A base title without an explicit suffix is the first season.
            effective_existing_num = existing_num if existing_num is not None else 1
            if effective_existing_num == target_num and family_score >= 0.72:
                return True
        elif family_score >= 0.9:
            return True
    return False


def page_primary_title(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if h1:
        value = clean_title(h1.get_text(" ", strip=True))
        if is_probable_title(value) and not is_catalog_noise_title(value):
            return value
    for attrs in [{"property": "og:title"}, {"name": "twitter:title"}]:
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            value = clean_title(tag["content"])
            if is_probable_title(value) and not is_catalog_noise_title(value):
                return value
    if soup.title:
        value = clean_title(soup.title.get_text(" ", strip=True))
        if is_probable_title(value) and not is_catalog_noise_title(value):
            return value
    return ""


def _near_h1_title_variants(soup: BeautifulSoup) -> list[str]:
    """Short title-like strings immediately after H1, before ordinary metadata/body text.

    Several anime catalogs (notably jut-su.net) render the localized H1 and the
    Romaji title as adjacent blocks without a useful label. We inspect only a
    tiny neighborhood of H1; we never scan the entire page body.
    """
    h1 = soup.find("h1")
    if not h1:
        return []
    result: list[str] = []
    stop_re = re.compile(
        r"^(?:режиссер|режисер|director|добавлен|додано|просмотров|переглядів|комментариев|"
        r"тип|type|жанр|genre|статус|status|эпизод|епізод|episodes?)\b",
        re.I,
    )
    for node in h1.find_all_next(string=True, limit=45):
        value = clean_title(node)
        if not value:
            continue
        if stop_re.search(value):
            break
        if value == clean_title(h1.get_text(" ", strip=True)):
            continue
        if len(value) > 180 or is_catalog_noise_title(value):
            continue
        # Keep only title-shaped strings: Latin/CJK names or explicit bilingual title rows.
        latin = len(re.findall(r"[A-Za-z]", value))
        cyr = len(re.findall(r"[А-Яа-яІіЇїЄєҐґ]", value))
        cjk = len(re.findall(r"[一-龯ぁ-んァ-ヶ]", value))
        digits = len(re.findall(r"\d", value))
        letters = latin + cyr + cjk
        if letters < 4 or digits > letters:
            continue
        if latin >= max(4, int(letters * 0.55)) or cjk >= 2:
            result.append(value)
        if len(result) >= 5:
            break
    return unique_strings(result, limit=5)


def explicit_title_variants(soup: BeautifulSoup) -> list[str]:
    values: list[str] = []
    # Semantic/class based fields.
    selectors = [
        "[class*=original]", "[class*=romaji]", "[class*=english-title]", "[class*=alt-title]",
        "[class*=alternative-title]", "[data-original-title]", "[data-romaji]",
    ]
    for selector in selectors:
        for tag in soup.select(selector)[:30]:
            for value in [tag.get_text(" ", strip=True), tag.get("data-original-title"), tag.get("data-romaji")]:
                value = clean_title(value)
                if is_probable_title(value) and not is_catalog_noise_title(value):
                    values.append(value)

    # Labeled rows. Restrict each capture to one short line/value so descriptions cannot leak in.
    label_re = re.compile(
        r"(?:original(?:\s+title)?|romaji|english(?:\s+title)?|оригинальн(?:ое|а)\s+назван(?:ие|ня)|"
        r"японск(?:ое|а)\s+назван(?:ие|ня)|альтернативн(?:ое|а)\s+назван(?:ие|ня))\s*[:：]\s*([^\n\r|]{2,180})",
        re.I,
    )
    text = soup.get_text("\n", strip=True)
    for match in label_re.finditer(text):
        value = clean_title(match.group(1))
        if is_probable_title(value) and not is_catalog_noise_title(value):
            values.append(value)
    return unique_strings(values, limit=20)


def site_specific_title_variants(domain: str, soup: BeautifulSoup) -> list[str]:
    """Extract title aliases from known catalog layouts.

    These are deliberately narrow selectors for fields that the catalog itself
    presents as an original/alternate title.  They supplement the generic
    metadata parser and are trusted only on the currently opened title page or
    on a candidate page that has already passed URL/title verification.
    """
    values: list[str] = []

    def add(value: Any) -> None:
        value = clean_title(value)
        if value and is_probable_title(value) and not is_catalog_noise_title(value):
            values.append(value)

    if domain == "anihub.in.ua":
        # AniHub: the canonical Romaji/original line is the <p> immediately
        # following H1.  Keep this deliberately exact: broad text-gray-400
        # selectors also match menus/navigation and used to pollute aliases.
        for selector in [
            "h1 + p.text-sm.text-gray-400.mb-1",
            "h1 + p.text-sm.text-gray-400",
            "p.text-sm.text-gray-400.mb-1",
        ]:
            tags = soup.select(selector)
            if tags:
                add(tags[0].get_text(" ", strip=True))
                break

    elif domain == "jut-su.net":
        # The .net clone has an explicit adjacent original-title block.
        for selector in [
            ".jutsu-page__original",
            ".jutsu-page__title-text .jutsu-page__original",
            "[class*=jutsu-page__original]",
        ]:
            for tag in soup.select(selector)[:8]:
                add(tag.get_text(" ", strip=True))

    elif domain == "jut.su":
        # jut.su usually writes: Оригинальное название: <b>Romaji title</b>
        label_re = re.compile(r"(?:Оригинальное|Оригінальне)\s+назван(?:ие|ня)\s*:?", re.I)
        for node in soup.find_all(string=label_re)[:8]:
            parent = node.parent
            # First prefer a bold/strong sibling after the label.
            for sibling in list(node.next_siblings)[:8]:
                if getattr(sibling, "name", None) in {"b", "strong", "span"}:
                    add(sibling.get_text(" ", strip=True))
                elif isinstance(sibling, str):
                    candidate = label_re.sub("", sibling).strip(" :：-–—")
                    add(candidate)
            if parent:
                for tag in parent.find_all(["b", "strong"], limit=8):
                    add(tag.get_text(" ", strip=True))

    return unique_strings(values, limit=20)


def source_page_title_variants(domain: str, soup: BeautifulSoup) -> list[str]:
    """All safe identity names exposed by one catalog title page."""
    return unique_strings([
        *site_specific_title_variants(domain, soup),
        *explicit_title_variants(soup),
        *_near_h1_title_variants(soup),
        *soup_title_signals_base(soup),
    ], limit=50)


def trusted_source_title_variants(domain: str, soup: BeautifulSoup) -> list[str]:
    """Small, high-confidence query set harvested from the opened title page.

    Known sites get strict selectors first.  We intentionally avoid broad JSON-LD
    and generic metadata as search-driving aliases because AniHub and several
    catalogs expose navigation/recommendation text there.
    """
    primary = page_primary_title(soup)
    specific = site_specific_title_variants(domain, soup)

    if domain in {"anihub.in.ua", "jut-su.net", "jut.su"}:
        values = [*specific[:2], primary]
    else:
        values = [*specific[:2], *explicit_title_variants(soup)[:3], *_near_h1_title_variants(soup)[:2], primary]

    return [
        x for x in unique_strings(values, limit=8)
        if is_probable_title(x) and not is_catalog_noise_title(x)
    ]


def soup_title_signals_base(soup: BeautifulSoup) -> list[str]:
    """Generic title metadata without recursively adding site-specific fields."""
    values: list[str] = []
    primary = page_primary_title(soup)
    if primary:
        values.append(primary)
    for attrs in [
        {"property": "og:title"},
        {"name": "twitter:title"},
        {"itemprop": "name"},
    ]:
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            values.append(tag["content"])
    for tag in soup.select("h1, [itemprop=name]")[:30]:
        values.append(tag.get_text(" ", strip=True))
    for script in soup.select('script[type="application/ld+json"]')[:15]:
        try:
            data = json.loads(script.get_text() or "null")
        except Exception:
            continue
        queue = data if isinstance(data, list) else [data]
        while queue:
            item = queue.pop(0)
            if not isinstance(item, dict):
                continue
            for key in ("name", "alternateName", "headline"):
                value = item.get(key)
                if isinstance(value, list):
                    values.extend(value)
                elif value:
                    values.append(value)
            graph = item.get("@graph")
            if isinstance(graph, list):
                queue.extend(graph)
    return [x for x in unique_strings(values, limit=50) if not is_catalog_noise_title(x)]


def soup_title_signals(soup: BeautifulSoup, domain: str = "") -> list[str]:
    """Identity-bearing title signals only.

    The optional domain enables narrow site-specific original-title selectors.
    Arbitrary body text is still excluded to avoid false positives.
    """
    values = [
        *soup_title_signals_base(soup),
        *explicit_title_variants(soup),
        *_near_h1_title_variants(soup),
    ]
    if domain:
        values.extend(site_specific_title_variants(domain, soup))
    return [x for x in unique_strings(values, limit=60) if not is_catalog_noise_title(x)]


def extract_description_from_soup(soup: BeautifulSoup) -> str:
    for attrs in [
        {"property": "og:description"},
        {"name": "description"},
        {"name": "twitter:description"},
    ]:
        tag = soup.find("meta", attrs=attrs)
        if tag and clean_text(tag.get("content")):
            return clean_text(tag.get("content"))
    for selector in ["[itemprop=description]", ".description", "[class*=description]", ".entry-content", ".text"]:
        tag = soup.select_one(selector)
        if tag:
            text = clean_text(tag.get_text(" ", strip=True))
            if len(text) >= 80:
                return text[:12000]
    return ""


def extract_cover_from_soup(soup: BeautifulSoup) -> str:
    for attrs in [
        {"property": "og:image"},
        {"name": "twitter:image"},
    ]:
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            return clean_text(tag["content"])
    img = soup.select_one("img[itemprop=image], .poster img, [class*=cover] img")
    return clean_text(img.get("src")) if img else ""


class Core:
    def __init__(self) -> None:
        self.client = httpx.AsyncClient(
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7",
            },
            follow_redirects=True,
            timeout=httpx.Timeout(45.0, connect=20.0),
        )
        # HTML parsing is CPU-heavy on a 1-vCPU serverless function. Keep enough
        # network parallelism to hide latency without creating dozens of queued
        # page verifications at once.
        self.http_sem = asyncio.Semaphore(12)
        self.google_sem = asyncio.Semaphore(1)
        self._google_disabled_reason = ""
        self._request_cache: dict[str, httpx.Response] = {}
        self._request_inflight: dict[str, asyncio.Task[httpx.Response]] = {}
        self._request_cache_lock = asyncio.Lock()
        self._domain_statuses: dict[str, list[int]] = {}
        self._dead_search_domains: set[str] = set()
        self._season_family_mode = False
        self._season_family_roots: list[str] = []
        self.mikai_api_key = ""
        self.verbose = clean_text(os.getenv("ANIME_CORE_VERBOSE")).lower() in {"1", "true", "yes", "on"}

    def log(self, message: str) -> None:
        if getattr(self, "verbose", False):
            print(f"[core] {message}", flush=True)

    async def close(self) -> None:
        await self.client.aclose()

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """HTTP request with per-run GET memoization and single-flight deduplication.

        The catalog pipeline often reaches the same API/search URL through several
        aliases or fallbacks. Reusing a completed response is safe for the duration
        of one run and prevents duplicate network traffic without removing the
        intentional second pass with a genuinely new localized title.
        """
        method_u = method.upper()
        no_cache = bool(kwargs.pop("_no_cache", False))

        async def perform() -> httpx.Response:
            async with self.http_sem:
                response = await self.client.request(method_u, url, **kwargs)
            try:
                host = (urlparse(str(response.url)).hostname or urlparse(url).hostname or "").lower()
                if host:
                    self._domain_statuses.setdefault(host.removeprefix("www."), []).append(int(response.status_code))
            except Exception:
                pass
            return response

        if method_u != "GET" or no_cache:
            return await perform()

        params = kwargs.get("params")
        try:
            query_key = str(httpx.QueryParams(params or {}))
        except Exception:
            query_key = repr(params)
        headers = kwargs.get("headers") or {}
        accept = clean_text(headers.get("Accept")) if isinstance(headers, dict) else ""
        cache_key = f"GET|{url}|{query_key}|{accept}"

        cached = self._request_cache.get(cache_key)
        if cached is not None:
            return cached

        owner = False
        async with self._request_cache_lock:
            cached = self._request_cache.get(cache_key)
            if cached is not None:
                return cached
            task = self._request_inflight.get(cache_key)
            if task is None:
                task = asyncio.create_task(perform())
                self._request_inflight[cache_key] = task
                owner = True

        try:
            response = await task
            if response.status_code in {200, 203, 204, 404}:
                self._request_cache[cache_key] = response
            return response
        finally:
            if owner:
                async with self._request_cache_lock:
                    if self._request_inflight.get(cache_key) is task:
                        self._request_inflight.pop(cache_key, None)

    def domain_hard_blocked(self, domain: str) -> bool:
        statuses: list[int] = []
        for host, values in self._domain_statuses.items():
            if host_allowed(host, domain):
                statuses.extend(values)
        if not statuses:
            return False
        recent = statuses[-8:]
        # Crunchyroll consistently blocks this server-side flow with 403, so one
        # explicit search response is sufficient evidence for the current run.
        # Other catalogs keep the two-response threshold to tolerate a transient
        # access error before they are considered hard-blocked.
        minimum = 1 if domain == "crunchyroll.com" else 2
        return len(recent) >= minimum and all(code in {401, 403, 429} for code in recent)

    async def authority_request(
        self, method: str, url: str, *, retries: int = 4, base_delay: float = 0.7, **kwargs: Any
    ) -> httpx.Response:
        """Request an authority API/page with bounded retry for transient failures.

        AniList, MAL and Shikimori occasionally answer 429/502/503/504 from shared
        serverless IPs.  A taxonomy miss caused by one such response should not be
        cached as an empty source, so retry those statuses before giving up.
        """
        last: httpx.Response | None = None
        retryable = {429, 500, 502, 503, 504}
        for attempt in range(max(1, retries)):
            try:
                response = await self.request(method, url, **kwargs)
                last = response
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt + 1 >= retries:
                    raise
                await asyncio.sleep(min(6.0, base_delay * (2 ** attempt)))
                continue
            if response.status_code not in retryable or attempt + 1 >= retries:
                return response
            retry_after = clean_text(response.headers.get("Retry-After"))
            try:
                wait = float(retry_after) if retry_after else base_delay * (2 ** attempt)
            except ValueError:
                wait = base_delay * (2 ** attempt)
            await asyncio.sleep(max(0.15, min(8.0, wait)))
        assert last is not None
        return last

    async def google_site_search_detailed(
        self, domain: str, title: str, limit: int = 12
    ) -> tuple[list[dict[str, str]], str]:
        # Once Google rate-limits / blocks the shared IP, the remaining queued
        # fallbacks in this run cannot recover by repeating the same request.
        # Stop the fan-out immediately instead of spending 20+ requests on 429s.
        if self._google_disabled_reason:
            return [], self._google_disabled_reason
        query = f'site:{domain} "{title}"'
        async with self.google_sem:
            if self._google_disabled_reason:
                return [], self._google_disabled_reason
            try:
                response = await self.request(
                    "GET",
                    "https://www.google.com/search",
                    params={
                        "q": query,
                        "num": str(min(20, limit + 5)),
                        "hl": "uk",
                        "filter": "0",
                        "gbv": "1",
                        "pws": "0",
                    },
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "Cache-Control": "no-cache",
                    },
                )
            except Exception as error:
                return [], f"Google request failed: {error}"

        if response.status_code == 429:
            self._google_disabled_reason = "Google повернув HTTP 429; fallback Google вимкнено до кінця цього запуску."
            return [], self._google_disabled_reason
        if response.status_code >= 400:
            return [], f"Google повернув HTTP {response.status_code}."
        if re.search(r"unusual traffic|/sorry/|detected unusual traffic", response.text, re.I):
            self._google_disabled_reason = "Google тимчасово заблокував автоматичний пошук для IP Vercel; fallback вимкнено до кінця запуску."
            return [], self._google_disabled_reason

        soup = BeautifulSoup(response.text, "html.parser")
        found: list[dict[str, str]] = []
        seen: set[str] = set()
        for anchor in soup.select("a[href]"):
            href = anchor.get("href") or ""
            candidate = ""
            if href.startswith("/url?"):
                qs = parse_qs(urlparse(href).query)
                candidate = (qs.get("q") or qs.get("url") or [""])[0]
            elif href.startswith("http"):
                candidate = href
            if not candidate:
                continue
            try:
                host = urlparse(candidate).hostname or ""
            except Exception:
                continue
            if not same_host(host, domain):
                continue
            candidate = compact_url(candidate)
            if candidate in seen or is_navigation_url(candidate):
                continue
            seen.add(candidate)
            title_text = clean_title(anchor.get_text(" ", strip=True)) or slug_title(candidate)
            found.append({"url": candidate, "title": title_text})
            if len(found) >= limit:
                break
        return found, ""

    async def google_site_search(self, domain: str, title: str, limit: int = 12) -> list[dict[str, str]]:
        found, _ = await self.google_site_search_detailed(domain, title, limit)
        return found

    async def authority_result_preview(
        self, site: str, item: dict[str, str], query: str
    ) -> dict[str, str] | None:
        url = compact_url(item.get("url", ""))
        if not url or not is_authority_title_url(site, url):
            return None

        fallback_title = clean_title(item.get("title")) or slug_title(url)
        soup, final_url = await self.fetch_soup(url)
        final_url = compact_url(final_url or url)
        if not is_authority_title_url(site, final_url):
            final_url = url

        page_title = fallback_title
        image = ""
        if soup:
            signals = soup_title_signals(soup)
            if signals:
                page_title = clean_title(signals[0]) or fallback_title
            cover = extract_cover_from_soup(soup)
            if cover:
                image = urljoin(final_url, cover)

        # Keep only plausible title pages. Google may occasionally surface unrelated
        # pages from the same host even with site: + quotes.
        score = max(
            title_relation_score(page_title, query),
            title_relation_score(fallback_title, query),
            title_relation_score(slug_title(final_url), query),
        )
        return {
            "url": final_url,
            "title": page_title or fallback_title or query,
            "image": image,
            "image_source": site if image else "",
            "score": round(score, 4),
        }

    async def _direct_authority_fallback(self, title: str, limit: int = 8) -> dict[str, list[dict[str, str]]]:
        """Build authority-site results without scraping Google.

        Google site: search remains the first strategy. This fallback is only used
        when Google's HTML contains no usable title-page results (common on cloud
        hosting IPs). The returned URLs still point to the requested authority
        sites so the frontend contract does not change.
        """
        ani_task = asyncio.create_task(self.anilist_search(title))
        shiki_task = asyncio.create_task(self.shikimori_authority_search(title))
        ani_raw, shiki_raw = await asyncio.gather(ani_task, shiki_task)

        out: dict[str, list[dict[str, str]]] = {site: [] for site in AUTHORITY_SITES}
        seen: dict[str, set[str]] = {site: set() for site in AUTHORITY_SITES}

        def add(site: str, url: str, label: str, image: str = "", score: float = 0.0) -> None:
            url = compact_url(url)
            if not url or url in seen[site] or not is_authority_title_url(site, url):
                return
            seen[site].add(url)
            out[site].append({
                "url": url,
                "title": clean_title(label) or title,
                "image": clean_text(image),
                "image_source": site if image else "",
                "score": round(float(score or 0.0), 4),
            })

        for media in ani_raw or []:
            titles = media.get("title") or {}
            names = self.media_names(media)
            label = clean_title(titles.get("romaji") or titles.get("english") or titles.get("native")) or title
            image = clean_text(((media.get("coverImage") or {}).get("extraLarge") or (media.get("coverImage") or {}).get("large") or (media.get("coverImage") or {}).get("medium")))
            score = max((title_relation_score(name, title) for name in names), default=0.0)
            media_id = media.get("id")
            mal_id = media.get("idMal")
            if media_id:
                add("anilist.co", f"https://anilist.co/anime/{media_id}", label, image, score)
            if mal_id:
                add("myanimelist.net", f"https://myanimelist.net/anime/{mal_id}", clean_title(titles.get("english") or titles.get("romaji") or label), image, score)

        for item in shiki_raw or []:
            anime_id = item.get("id")
            if not anime_id:
                continue
            label = clean_title(item.get("name") or item.get("russian") or title)
            candidate_names = unique_strings([item.get("name"), item.get("russian")], limit=4)
            score = max((title_relation_score(name, title) for name in candidate_names), default=0.0)
            image = ""
            image_obj = item.get("image") or {}
            if isinstance(image_obj, dict):
                image_path = image_obj.get("original") or image_obj.get("preview") or image_obj.get("x96") or image_obj.get("x48")
                if image_path:
                    image = urljoin("https://shikimori.io", str(image_path))
            shiki_url = urljoin("https://shikimori.io", item.get("url") or f"/animes/{anime_id}")
            add("shikimori.io", shiki_url, label, image, score)
            # Shikimori anime IDs are MAL IDs, so this also gives us a valid MAL URL.
            add("myanimelist.net", f"https://myanimelist.net/anime/{anime_id}", label, image, score)

        for site in out:
            out[site].sort(key=lambda item: float(item.get("score") or 0.0), reverse=True)
            out[site] = out[site][:limit]

        # A MyAnimeList fallback entry must use metadata from the MAL page itself.
        # Do not label an AniList/Shikimori image as a MAL image.
        async def hydrate_mal(item: dict[str, str]) -> dict[str, str]:
            candidate = {**item, "image": "", "image_source": ""}
            try:
                preview = await self.authority_result_preview("myanimelist.net", candidate, title)
            except Exception:
                preview = None
            if preview:
                # Keep the ranking score computed by the direct fallback.
                preview["score"] = item.get("score", preview.get("score", 0.0))
                return preview
            return candidate

        if out["myanimelist.net"]:
            out["myanimelist.net"] = list(await asyncio.gather(*(hydrate_mal(item) for item in out["myanimelist.net"])))

        return out

    async def search_authority_pages(self, title: str, limit: int = 8) -> dict[str, Any]:
        title = clean_title(title)
        direct_cache: dict[str, list[dict[str, str]]] | None = None
        direct_lock = asyncio.Lock()

        async def get_direct() -> dict[str, list[dict[str, str]]]:
            nonlocal direct_cache
            if direct_cache is not None:
                return direct_cache
            async with direct_lock:
                if direct_cache is None:
                    direct_cache = await self._direct_authority_fallback(title, limit)
            return direct_cache

        async def one_site(site: str) -> dict[str, Any]:
            query = f'site:{site} "{title}"'
            raw, error = await self.google_site_search_detailed(site, title, limit=max(limit + 4, 10))
            raw = [item for item in raw if is_authority_title_url(site, item.get("url", ""))]
            previews = await asyncio.gather(*(
                self.authority_result_preview(site, item, title) for item in raw[: max(limit + 2, limit)]
            ))
            items: list[dict[str, str]] = []
            seen: set[str] = set()
            for preview in previews:
                if not preview:
                    continue
                url = preview.get("url", "")
                key = compact_url(url)
                if not key or key in seen:
                    continue
                seen.add(key)
                items.append(preview)
                if len(items) >= limit:
                    break

            source = "google"
            if not items:
                direct = await get_direct()
                items = list(direct.get(site) or [])[:limit]
                if items:
                    source = "direct-fallback"
                    # Zero Google results is not an actionable user error once fallback succeeded.
                    error = ""

            return {
                "site": site,
                "label": AUTHORITY_LABELS.get(site, site),
                "query": query,
                "error": error,
                "source": source,
                "items": items,
            }

        groups = await asyncio.gather(*(one_site(site) for site in AUTHORITY_SITES))
        sources = sorted({group.get("source", "google") for group in groups})
        return {
            "ok": True,
            "query": title,
            "groups": groups,
            "total": sum(len(group.get("items") or []) for group in groups),
            "search_engine": "+".join(sources),
        }

    async def fetch_soup(self, url: str) -> tuple[BeautifulSoup | None, str]:
        try:
            response = await self.request("GET", url, headers={"Accept": "text/html,application/xhtml+xml"})
            if response.status_code >= 400:
                return None, str(response.url)
            return BeautifulSoup(response.text, "html.parser"), str(response.url)
        except Exception:
            return None, url

    async def anilist_graphql(
        self, query: str, variables: dict[str, Any], *, retries: int = 4
    ) -> tuple[dict[str, Any], bool, str]:
        """Execute AniList GraphQL and distinguish an empty result from a failed request."""
        try:
            response = await self.authority_request(
                "POST",
                "https://graphql.anilist.co",
                retries=retries,
                json={"query": query, "variables": variables},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            if response.status_code >= 400:
                # AniList uses 403 both for temporary API shutdowns and manual
                # blocking. Surface the GraphQL message instead of discarding it;
                # callers can then decide whether to use the client-side fallback.
                detail = ""
                try:
                    error_payload = response.json()
                    errors = error_payload.get("errors") if isinstance(error_payload, dict) else None
                    if isinstance(errors, list) and errors:
                        first = errors[0]
                        detail = clean_text(first.get("message")) if isinstance(first, dict) else clean_text(first)
                except Exception:
                    detail = ""
                suffix = f": {detail}" if detail else ""
                return {}, False, f"HTTP {response.status_code}{suffix}"
            payload = response.json()
            if not isinstance(payload, dict):
                return {}, False, "invalid JSON payload"
            errors = payload.get("errors") or []
            if errors and not payload.get("data"):
                message = clean_text((errors[0] or {}).get("message")) if isinstance(errors[0], dict) else clean_text(errors[0])
                return payload, False, message or "GraphQL error"
            return payload, True, ""
        except Exception as error:
            return {}, False, clean_text(error) or error.__class__.__name__

    async def anilist_by_id_result(self, media_id: int) -> tuple[dict[str, Any] | None, bool, str]:
        query = """
        query ($id: Int!) {
          Media(id: $id, type: ANIME) {
            id idMal
            title { romaji english native }
            synonyms
            genres
            description(asHtml: false)
            bannerImage
            trailer { id site thumbnail }
            coverImage { extraLarge large medium }
          }
        }
        """
        payload, ok, error = await self.anilist_graphql(query, {"id": media_id}, retries=4)
        if not ok:
            return None, False, error
        media = payload.get("data", {}).get("Media")
        if not isinstance(media, dict):
            return None, False, f"no media for AniList id {media_id}"
        return media, True, ""

    async def anilist_by_id(self, media_id: int) -> dict[str, Any] | None:
        media, _, _ = await self.anilist_by_id_result(media_id)
        return media

    async def anilist_search(self, title: str) -> list[dict[str, Any]]:
        query = """
        query ($search: String!) {
          Page(page: 1, perPage: 10) {
            media(search: $search, type: ANIME) {
              id idMal
              format
              title { romaji english native }
              synonyms
              genres
              description(asHtml: false)
              bannerImage
              trailer { id site thumbnail }
              coverImage { extraLarge large medium }
            }
          }
        }
        """
        payload, ok, _ = await self.anilist_graphql(query, {"search": title}, retries=3)
        if not ok:
            return []
        media = payload.get("data", {}).get("Page", {}).get("media", [])
        return media if isinstance(media, list) else []

    def parse_anilist_id(self, url: str) -> int | None:
        match = re.search(r"anilist\.co/anime/(\d+)", url)
        return int(match.group(1)) if match else None

    def parse_mal_id(self, url: str) -> int | None:
        match = re.search(r"myanimelist\.net/anime/(\d+)", url)
        return int(match.group(1)) if match else None

    def parse_shikimori_id(self, url: str) -> int | None:
        match = re.search(r"shikimori\.(?:io|one)/(?:animes?/)?(?:[a-z])?(\d+)", url, re.I)
        return int(match.group(1)) if match else None

    async def anilist_by_mal_id_result(self, mal_id: int) -> tuple[dict[str, Any] | None, bool, str]:
        query = """
        query ($idMal: Int!) {
          Media(idMal: $idMal, type: ANIME) {
            id idMal
            title { romaji english native }
            synonyms
            genres
            description(asHtml: false)
            bannerImage
            trailer { id site thumbnail }
            coverImage { extraLarge large medium }
          }
        }
        """
        payload, ok, error = await self.anilist_graphql(query, {"idMal": mal_id}, retries=5)
        if not ok:
            return None, False, error
        media = payload.get("data", {}).get("Media")
        if not isinstance(media, dict):
            return None, False, f"no media for MAL id {mal_id}"
        return media, True, ""

    async def anilist_by_mal_id(self, mal_id: int) -> dict[str, Any] | None:
        media, _, _ = await self.anilist_by_mal_id_result(mal_id)
        return media

    def media_names(self, media: dict[str, Any]) -> list[str]:
        titles = media.get("title") or {}
        return unique_strings([
            titles.get("romaji"), titles.get("english"), titles.get("native"),
            *(media.get("synonyms") or []),
        ], limit=30)

    def media_score(self, media: dict[str, Any], queries: list[str]) -> tuple[float, bool]:
        names = self.media_names(media)
        exact = any(normalize_title(name) == normalize_title(query) for name in names for query in queries if query)
        score = max((title_relation_score(name, query) for name in names for query in queries if query), default=0.0)
        return score, exact

    async def shikimori_authority_search(self, query: str) -> list[dict[str, Any]]:
        try:
            response = await self.authority_request(
                "GET",
                "https://shikimori.io/api/animes",
                retries=3,
                params={"search": query, "limit": 10},
                headers={"Accept": "application/json"},
            )
            if response.status_code >= 400:
                return []
            payload = response.json()
            return payload if isinstance(payload, list) else []
        except Exception:
            return []

    async def translate_text(self, text: str, target: str) -> str:
        text = clean_text(text)
        if not text:
            return ""
        chunks: list[str] = []
        rest = text
        while len(rest) > 1300:
            cut = max(rest.rfind(". ", 0, 1300), rest.rfind(" ", 0, 1300))
            if cut < 500:
                cut = 1300
            chunks.append(rest[:cut + 1].strip())
            rest = rest[cut + 1:].strip()
        if rest:
            chunks.append(rest)

        async def one(chunk: str) -> str:
            try:
                response = await self.request(
                    "GET",
                    "https://translate.googleapis.com/translate_a/single",
                    params={"client": "gtx", "sl": "auto", "tl": target, "dt": "t", "q": chunk},
                    headers={"Accept": "application/json"},
                )
                data = response.json()
                value = "".join(part[0] for part in (data[0] or []) if part and part[0])
                return clean_text(value) or chunk
            except Exception:
                return chunk

        translated = await asyncio.gather(*(one(chunk) for chunk in chunks))
        return clean_text(" ".join(translated))

    async def translate_uk(self, text: str) -> str:
        return await self.translate_text(text, "uk")

    async def translate_ru(self, text: str) -> str:
        return await self.translate_text(text, "ru")

    async def translate_en(self, text: str) -> str:
        return await self.translate_text(text, "en")

    async def validate_authority_google_item(
        self,
        site: str,
        item: dict[str, str],
        query: str,
        base_queries: list[str],
    ) -> tuple[bool, list[str], BeautifulSoup | None, str]:
        title = clean_title(item.get("title"))
        slug = slug_title(item.get("url", ""))
        direct_score = max(
            title_relation_score(title, query),
            title_relation_score(slug, query),
            *(title_relation_score(title, q) for q in base_queries if q),
            *(title_relation_score(slug, q) for q in base_queries if q),
        )
        soup, final_url = await self.fetch_soup(item.get("url", ""))
        if not soup:
            return direct_score >= 0.72, [title, slug], None, final_url

        signals = soup_title_signals(soup)
        signal_score = max(
            (title_relation_score(signal, q) for signal in signals for q in [query, *base_queries] if q),
            default=0.0,
        )
        body_key = normalize_title(soup.get_text(" ", strip=True))
        body_exact = any(normalize_title(q) and normalize_title(q) in body_key for q in [query, *base_queries])
        # A Google result is accepted only when the page itself proves relation to the requested title.
        ok = direct_score >= 0.72 or signal_score >= 0.72 or body_exact
        return ok, unique_strings([title, slug, *signals], limit=40), soup, final_url

    async def shikimori_details(self, anime_id: int) -> dict[str, Any] | None:
        try:
            response = await self.authority_request(
                "GET",
                f"https://shikimori.io/api/animes/{anime_id}",
                retries=4,
                headers={"Accept": "application/json"},
            )
            if response.status_code >= 400:
                return None
            payload = response.json()
            return payload if isinstance(payload, dict) else None
        except Exception:
            return None

    def shikimori_names(self, item: dict[str, Any]) -> list[str]:
        english = item.get("english") or []
        japanese = item.get("japanese") or []
        synonyms = item.get("synonyms") or []
        if isinstance(english, str):
            english = [english]
        if isinstance(japanese, str):
            japanese = [japanese]
        if isinstance(synonyms, str):
            synonyms = [synonyms]
        return unique_strings([
            item.get("name"), item.get("russian"), *english, *japanese, *synonyms,
        ], limit=30)

    def taxonomy_names(self, values: Any, *, limit: int = 40) -> list[str]:
        if not isinstance(values, list):
            values = [] if values is None else [values]
        out: list[str] = []
        seen: set[str] = set()
        for raw in values:
            if isinstance(raw, dict):
                raw = raw.get("name") or raw.get("english") or raw.get("russian") or raw.get("title") or ""
            value = clean_text(raw)
            if not value:
                continue
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(value)
            if len(out) >= limit:
                break
        return out

    def shikimori_taxonomy(self, item: dict[str, Any] | None) -> tuple[list[str], list[str]]:
        """REST fallback for older Shikimori payloads.

        Current Shikimori pages split genres and themes via genres_v2.  Some REST
        payloads flatten that distinction, so the HTML page parser below is the
        preferred source; this method remains a compatibility fallback.
        """
        genres: list[str] = []
        themes: list[str] = []
        if not isinstance(item, dict):
            return genres, themes
        for raw in item.get("genres") or []:
            if not isinstance(raw, dict):
                continue
            name = clean_text(raw.get("name") or raw.get("english") or raw.get("russian"))
            if not name:
                continue
            kind = clean_text(raw.get("kind") or raw.get("genre_kind") or "").casefold()
            if kind == "theme":
                themes.append(name)
            elif kind in {"genre", "", "genres"}:
                genres.append(name)
        return self.taxonomy_names(genres), self.taxonomy_names(themes)

    def shikimori_taxonomy_from_soup(self, soup: BeautifulSoup | None) -> tuple[list[str], list[str], bool]:
        """Read Shikimori's visible Genre/Theme rows exactly as the title page shows them."""
        if not soup:
            return [], [], False
        root = soup.select_one(".b-entry-info")
        if not root:
            return [], [], False
        genres: list[str] = []
        themes: list[str] = []
        saw_taxonomy = False
        for row in root.select(".line-container"):
            key_node = row.select_one(".key")
            if not key_node:
                continue
            label = clean_text(key_node.get_text(" ", strip=True)).rstrip(":").casefold()
            is_genre = label.startswith(("жанр", "genre"))
            is_theme = label.startswith(("тем", "theme"))
            if not (is_genre or is_theme):
                continue
            saw_taxonomy = True
            names: list[str] = []
            for anchor in row.select('a.b-tag[href], a[href*="/animes/genre/"]'):
                href = clean_text(anchor.get("href"))
                match = re.search(r"/animes/genre/\d+-([^/?#]+)", href, re.I)
                if match:
                    # The route slug is the stable English taxonomy name, e.g.
                    # /animes/genre/114-Award-Winning -> Award Winning.
                    name = unquote(match.group(1)).replace("-", " ")
                else:
                    name = clean_text(anchor.get_text(" ", strip=True))
                if name:
                    names.append(name)
            if is_genre:
                genres.extend(names)
            else:
                themes.extend(names)
        return self.taxonomy_names(genres), self.taxonomy_names(themes), saw_taxonomy

    async def shikimori_page_taxonomy(self, anime_id: int | None) -> tuple[list[str], list[str], bool, str]:
        if not anime_id:
            return [], [], False, "missing MAL/Shikimori id"
        url = f"https://shikimori.io/animes/{int(anime_id)}"
        try:
            response = await self.authority_request(
                "GET", url, retries=4, headers={"Accept": "text/html,application/xhtml+xml"}
            )
            if response.status_code >= 400:
                return [], [], False, f"HTTP {response.status_code}"
            soup = BeautifulSoup(response.text, "html.parser")
            genres, themes, parsed = self.shikimori_taxonomy_from_soup(soup)
            if not parsed:
                return genres, themes, False, "taxonomy rows not found"
            return genres, themes, True, ""
        except Exception as error:
            return [], [], False, clean_text(error) or error.__class__.__name__

    def _parse_mal_taxonomy_soup(self, soup: BeautifulSoup | None) -> tuple[list[str], list[str], bool]:
        if not soup:
            return [], [], False
        genres: list[str] = []
        themes: list[str] = []
        saw_taxonomy = False
        for row in soup.select("div.spaceit_pad, tr"):
            label_node = row.select_one("span.dark_text, th")
            if not label_node:
                continue
            label = clean_text(label_node.get_text(" ", strip=True)).rstrip(":").casefold()
            if label not in {"genre", "genres", "theme", "themes"}:
                continue
            saw_taxonomy = True
            names = [clean_text(a.get_text(" ", strip=True)) for a in row.select('a[href*="/anime/genre/"]')]
            if label.startswith("genre"):
                genres.extend(names)
            else:
                themes.extend(names)
        return self.taxonomy_names(genres), self.taxonomy_names(themes), saw_taxonomy

    async def myanimelist_taxonomy_result(self, mal_id: int | None) -> tuple[list[str], list[str], bool, str]:
        if not mal_id:
            return [], [], False, "missing MAL id"
        try:
            response = await self.authority_request(
                "GET",
                f"https://myanimelist.net/anime/{int(mal_id)}",
                retries=4,
                headers={"Accept": "text/html,application/xhtml+xml"},
            )
            if response.status_code >= 400:
                return [], [], False, f"HTTP {response.status_code}"
            soup = BeautifulSoup(response.text, "html.parser")
            genres, themes, parsed = self._parse_mal_taxonomy_soup(soup)
            if not parsed:
                return genres, themes, False, "taxonomy rows not found"
            return genres, themes, True, ""
        except Exception as error:
            return [], [], False, clean_text(error) or error.__class__.__name__

    async def myanimelist_taxonomy(self, mal_id: int | None) -> tuple[list[str], list[str]]:
        genres, themes, _, _ = await self.myanimelist_taxonomy_result(mal_id)
        return genres, themes

    def taxonomy_payload(self, sources: dict[str, list[str]], allowed_sources: list[str]) -> dict[str, Any]:
        clean_sources: dict[str, list[str]] = {}
        merged: list[str] = []
        for site in allowed_sources:
            names = self.taxonomy_names((sources or {}).get(site) or [])
            clean_sources[site] = names
            merged.extend(names)
        return {"all": self.taxonomy_names(merged, limit=80), "sources": clean_sources}

    async def resolve_authorities(
        self,
        payload: InputPayload,
        extra_queries: list[str] | None = None,
        *,
        mal_id_hint: int | None = None,
        anilist_id_hint: int | None = None,
    ) -> AuthorityData:
        """Resolve one anime identity before catalog search.

        Important invariant: ``original`` means the canonical Romaji/original title,
        not the localized title that arrived from the browser. A localized exact
        Shikimori hit is enough to establish identity because Shikimori returns the
        corresponding Romaji ``name`` even when AniList is temporarily unavailable.
        """
        extra_queries = unique_strings(extra_queries or [], limit=12)
        authority_url_key = ""
        source_for_cache = source_domain(payload.url)
        if payload.url and any(same_host(source_for_cache, d) for d in AUTHORITY_SITES):
            authority_url_key = compact_url(payload.url).casefold()
        cache_key = (
            normalize_title(payload.title) + "|" + authority_url_key + "|"
            + "|".join(normalize_title(x) for x in extra_queries[:6])
            + f"|mal:{int(mal_id_hint) if mal_id_hint else 0}|al:{int(anilist_id_hint) if anilist_id_hint else 0}"
        )
        cached = TITLE_CACHE.get(cache_key)
        if cached:
            result = AuthorityData(**json.loads(json.dumps(cached)))
            source = source_domain(payload.url)
            if payload.url and any(same_host(source, d) for d in AUTHORITY_SITES):
                logical = next((d for d in AUTHORITY_SITES if same_host(source, d)), None)
                if logical and is_authority_title_url(logical, payload.url):
                    existing = {x["url"] for x in result.links[logical]}
                    if payload.url not in existing:
                        result.links[logical].insert(0, {"url": compact_url(payload.url), "title": payload.title})
            return result

        data = AuthorityData()
        source = source_domain(payload.url)
        # Translating a localized title only helps when we have no Latin seed at all.
        # AniHub/Mikai APIs normally provide Romaji/English up front, so avoid a
        # guaranteed-extra Google Translate request (and its frequent HTTP 429).
        latin_seed = next(
            (clean_title(x) for x in [payload.title, *extra_queries] if title_script(x) == "latin"),
            "",
        )
        english_input = "" if latin_seed else clean_title(await self.translate_en(payload.title))
        base_queries = unique_strings([payload.title, *extra_queries, english_input], limit=8)

        candidates: list[dict[str, Any]] = []

        def relation(names: list[str]) -> tuple[float, bool]:
            exact = any(
                normalize_title(name) == normalize_title(query)
                for name in names for query in base_queries if query
            )
            score = max(
                (title_relation_score(name, query) for name in names for query in base_queries if query),
                default=0.0,
            )
            return score, exact

        def add_ani(media: dict[str, Any] | None, source_name: str, rank: int = 99, forced: bool = False) -> None:
            if not media or not media.get("id"):
                return
            names = self.media_names(media)
            score, exact = relation(names)
            if not forced and not exact and score < 0.72:
                return
            candidates.append({
                "kind": "anilist",
                "key": f"anilist:{media.get('id')}",
                "media": media,
                "names": names,
                "score": score,
                "exact": exact,
                "rank": rank,
                "source": source_name,
                "forced": forced,
            })

        async def add_shiki(
            item: dict[str, Any], source_name: str, rank: int = 99, forced: bool = False,
            *, fetch_details: bool = True,
        ) -> None:
            anime_id = item.get("id")
            if not anime_id:
                return
            details = (await self.shikimori_details(int(anime_id)) or item) if fetch_details else item
            names = self.shikimori_names(details)
            score, exact = relation(names)
            if not forced and not exact and score < 0.72:
                return
            candidates.append({
                "kind": "shikimori",
                "key": f"shikimori:{anime_id}",
                "item": details,
                "names": names,
                "score": score,
                "exact": exact,
                "rank": rank,
                "source": source_name,
                "forced": forced,
                "details_loaded": fetch_details,
            })

        # Explicit authority URL has highest identity priority, but only if it is an actual anime title page.
        if payload.url and same_host(source, "anilist.co") and is_authority_title_url("anilist.co", payload.url):
            media_id = self.parse_anilist_id(payload.url)
            if media_id:
                add_ani(await self.anilist_by_id(media_id), "source:anilist", 0, True)
        elif payload.url and same_host(source, "myanimelist.net") and is_authority_title_url("myanimelist.net", payload.url):
            mal_id = self.parse_mal_id(payload.url)
            if mal_id:
                add_ani(await self.anilist_by_mal_id(mal_id), "source:mal", 0, True)
        elif payload.url and same_host(source, "shikimori.io") and is_authority_title_url("shikimori.io", payload.url):
            shiki_id = self.parse_shikimori_id(payload.url)
            if shiki_id:
                details = await self.shikimori_details(shiki_id)
                if details:
                    await add_shiki(details, "source:shikimori", 0, True)

        # Trusted external IDs from the opened AniHub/Mikai API response are a
        # stronger identity signal than launching text searches against AniList and
        # Shikimori for every alias. Resolve that exact ID first; only fall back to
        # multi-query authority search when the source did not expose usable IDs.
        if not candidates and (anilist_id_hint or mal_id_hint):
            hinted_media: dict[str, Any] | None = None
            if anilist_id_hint:
                hinted_media = await self.anilist_by_id(int(anilist_id_hint))
            elif mal_id_hint:
                hinted_media = await self.anilist_by_mal_id(int(mal_id_hint))
            if hinted_media:
                add_ani(hinted_media, "source-api-id", 0, True)
            elif mal_id_hint:
                hinted_shiki = await self.shikimori_details(int(mal_id_hint))
                if hinted_shiki:
                    await add_shiki(hinted_shiki, "source-api-mal", 0, True)

        # Phase 1: direct text APIs only when exact source IDs were unavailable or
        # could not be resolved. No "first result wins" rule.
        if not candidates:
            ani_jobs = [(query, asyncio.create_task(self.anilist_search(query))) for query in base_queries]
            shiki_jobs = [(query, asyncio.create_task(self.shikimori_authority_search(query))) for query in base_queries]

            for query, task in ani_jobs:
                try:
                    items = await task
                except Exception:
                    items = []
                for rank, media in enumerate(items[:10]):
                    names = self.media_names(media)
                    q_exact = any(normalize_title(name) == normalize_title(query) for name in names)
                    q_score = max((title_relation_score(name, query) for name in names), default=0.0)
                    if q_exact or q_score >= 0.72:
                        add_ani(media, f"anilist:{normalize_title(query)}", rank)

            for query, task in shiki_jobs:
                try:
                    items = await task
                except Exception:
                    items = []
                for rank, item in enumerate(items[:10]):
                    quick_names = unique_strings([item.get("name"), item.get("russian")])
                    q_exact = any(normalize_title(name) == normalize_title(query) for name in quick_names)
                    q_score = max((title_relation_score(name, query) for name in quick_names), default=0.0)
                    if q_exact or q_score >= 0.72:
                        # The list response already has enough title information to
                        # rank identity candidates. Fetch details only for the final
                        # selected MAL id instead of downloading every related season.
                        await add_shiki(
                            item, f"shikimori:{normalize_title(query)}", rank,
                            fetch_details=False,
                        )

        def dedup_candidates(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            best: dict[str, dict[str, Any]] = {}
            for item in items:
                existing = best.get(item["key"])
                if not existing:
                    best[item["key"]] = item
                    continue
                old_key = (existing["forced"], existing["exact"], existing["score"], -existing["rank"])
                new_key = (item["forced"], item["exact"], item["score"], -item["rank"])
                if new_key > old_key:
                    best[item["key"]] = item
            return list(best.values())

        def candidate_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
            names = item.get("names") or []
            # Prefer a base title over a sequel/movie when both match the franchise.
            base_bonus = 1 if any(not SEASON_RE.search(name) for name in names[:3]) else 0
            source_bonus = 2 if item["kind"] == "anilist" else 1
            return (
                1 if item["forced"] else 0,
                1 if item["exact"] else 0,
                item["score"],
                base_bonus,
                source_bonus,
                -item["rank"],
            )

        candidates = dedup_candidates(candidates)
        candidates.sort(key=candidate_sort_key, reverse=True)

        # Phase 2: strict Google site fallback only if direct APIs did not identify the title.
        # Only actual anime-entry URL shapes are accepted; forum/list/category pages are ignored.
        if not candidates:
            google_jobs: list[tuple[str, str, asyncio.Task]] = []
            for site in AUTHORITY_SITES:
                for query in base_queries:
                    google_jobs.append((site, query, asyncio.create_task(self.google_site_search(site, query, 10))))

            for site, query, task in google_jobs:
                try:
                    items = await task
                except Exception:
                    items = []
                for rank, item in enumerate(items[:10]):
                    url = compact_url(item.get("url", ""))
                    if not is_authority_title_url(site, url):
                        continue
                    if site == "anilist.co":
                        media_id = self.parse_anilist_id(url)
                        if media_id:
                            add_ani(await self.anilist_by_id(media_id), f"google:{site}:{normalize_title(query)}", 20 + rank)
                    elif site == "myanimelist.net":
                        mal_id = self.parse_mal_id(url)
                        if mal_id:
                            add_ani(await self.anilist_by_mal_id(mal_id), f"google:{site}:{normalize_title(query)}", 20 + rank)
                    elif site == "shikimori.io":
                        shiki_id = self.parse_shikimori_id(url)
                        if shiki_id:
                            details = await self.shikimori_details(shiki_id)
                            if details:
                                await add_shiki(details, f"google:{site}:{normalize_title(query)}", 20 + rank)

            candidates = dedup_candidates(candidates)
            candidates.sort(key=candidate_sort_key, reverse=True)

        chosen = candidates[0] if candidates else None
        chosen_names: list[str] = []
        resolved_anilist_media: dict[str, Any] | None = None
        resolved_shikimori: dict[str, Any] | None = None

        if chosen and chosen["kind"] == "shikimori":
            item = chosen["item"]
            if not chosen.get("details_loaded") and item.get("id"):
                item = await self.shikimori_details(int(item["id"])) or item
            resolved_shikimori = item
            mal_id = int(item.get("id")) if item.get("id") else None
            # Shikimori's `name` is the canonical Romaji title. This is trusted even if AniList is down.
            data.original = clean_title(item.get("name") or payload.title)
            english_values = item.get("english") or []
            japanese_values = item.get("japanese") or []
            if isinstance(english_values, str):
                english_values = [english_values]
            if isinstance(japanese_values, str):
                japanese_values = [japanese_values]
            data.english = clean_title(next((x for x in english_values if clean_title(x)), "") or english_input)
            data.native = clean_title(next((x for x in japanese_values if clean_title(x)), ""))
            data.russian = clean_title(item.get("russian") or data.russian)
            data.mal_id = mal_id
            data.description = clean_text(item.get("description"))
            image = item.get("image") or {}
            image_url = clean_text(image.get("original") or image.get("preview") or image.get("x96")) if isinstance(image, dict) else ""
            if image_url:
                data.cover = urljoin("https://shikimori.io", image_url)
                data.cover_source = "shikimori.io"
            chosen_names = self.shikimori_names(item)
            data.aliases.extend(chosen_names)
            shiki_url = urljoin("https://shikimori.io", item.get("url") or f"/animes/{mal_id}")
            data.links["shikimori.io"].append({"url": compact_url(shiki_url), "title": data.original})

            # Enrich from AniList by MAL id when available, but do not lose the already-correct Romaji identity if it fails.
            if mal_id:
                media = await self.anilist_by_mal_id(mal_id)
                if media:
                    resolved_anilist_media = media
                    titles = media.get("title") or {}
                    data.anilist_id = media.get("id")
                    data.mal_id = media.get("idMal") or mal_id
                    data.original = clean_title(titles.get("romaji") or data.original)
                    data.english = clean_title(titles.get("english") or data.english)
                    data.native = clean_title(titles.get("native") or data.native)
                    data.description = clean_text(media.get("description")) or data.description
                    data.banner = clean_text(media.get("bannerImage"))
                    trailer = media.get("trailer") or {}
                    data.trailer_id = clean_text(trailer.get("id"))
                    data.trailer_site = clean_text(trailer.get("site")).lower()
                    data.trailer_thumbnail = clean_text(trailer.get("thumbnail"))
                    data.trailer_url = media_trailer_url(data.trailer_site, data.trailer_id)
                    data.trailer_embed_url = media_trailer_embed_url(data.trailer_site, data.trailer_id)
                    data.trailer_source = "anilist.co" if data.trailer_id else ""
                    cover = media.get("coverImage") or {}
                    ani_cover = clean_text(cover.get("extraLarge") or cover.get("large") or cover.get("medium"))
                    if ani_cover:
                        data.cover = ani_cover
                        data.cover_source = "anilist.co"
                    chosen_names = self.media_names(media)
                    data.aliases.extend(chosen_names)

        elif chosen and chosen["kind"] == "anilist":
            media = chosen["media"]
            resolved_anilist_media = media
            titles = media.get("title") or {}
            data.anilist_id = media.get("id")
            data.mal_id = media.get("idMal")
            data.original = clean_title(titles.get("romaji") or titles.get("english") or payload.title)
            data.english = clean_title(titles.get("english") or titles.get("romaji") or "")
            data.native = clean_title(titles.get("native") or "")
            data.description = clean_text(media.get("description"))
            data.banner = clean_text(media.get("bannerImage"))
            trailer = media.get("trailer") or {}
            data.trailer_id = clean_text(trailer.get("id"))
            data.trailer_site = clean_text(trailer.get("site")).lower()
            data.trailer_thumbnail = clean_text(trailer.get("thumbnail"))
            data.trailer_url = media_trailer_url(data.trailer_site, data.trailer_id)
            data.trailer_embed_url = media_trailer_embed_url(data.trailer_site, data.trailer_id)
            data.trailer_source = "anilist.co" if data.trailer_id else ""
            cover = media.get("coverImage") or {}
            data.cover = clean_text(cover.get("extraLarge") or cover.get("large") or cover.get("medium"))
            if data.cover:
                data.cover_source = "anilist.co"
            chosen_names = self.media_names(media)
            data.aliases.extend(chosen_names)

        else:
            # No authority confirmed: keep the browser title as a fallback, but do not pretend it is a discovered Romaji title.
            data.original = clean_title(payload.title)
            data.english = english_input if title_script(english_input) == "latin" else ""
            chosen_names = unique_strings([data.original, data.english])

        # Add canonical authority links only for the resolved title IDs.
        if data.anilist_id:
            data.links["anilist.co"].append({
                "url": f"https://anilist.co/anime/{data.anilist_id}",
                "title": data.original,
            })
        if data.mal_id:
            data.links["myanimelist.net"].append({
                "url": f"https://myanimelist.net/anime/{data.mal_id}",
                "title": data.english or data.original,
            })
            # Shikimori uses the MAL anime id. Fetch its localized names as trusted aliases and canonical link.
            shiki = await self.shikimori_details(int(data.mal_id))
            if shiki:
                resolved_shikimori = shiki
                shiki_names = self.shikimori_names(shiki)
                if not chosen_names or any(titles_related(a, b, 0.72) for a in shiki_names for b in chosen_names):
                    # Keep the primary localized Russian title separate from synonyms.
                    # This must be available BEFORE catalog fan-out; otherwise RU sites
                    # start from a weaker synonym and may spend tens of seconds probing
                    # aliases before the correct title is discovered.
                    data.russian = clean_title(shiki.get("russian") or data.russian)
                    data.aliases.extend(shiki_names)
                    shiki_url = urljoin("https://shikimori.io", shiki.get("url") or f"/animes/{data.mal_id}")
                    data.links["shikimori.io"].append({
                        "url": compact_url(shiki_url),
                        "title": clean_title(shiki.get("name") or data.original),
                    })
                    if not data.description:
                        data.description = clean_text(shiki.get("description"))
                    if not data.cover:
                        image = shiki.get("image") or {}
                        image_url = clean_text(image.get("original") or image.get("preview") or image.get("x96")) if isinstance(image, dict) else ""
                        if image_url:
                            data.cover = urljoin("https://shikimori.io", image_url)
                            data.cover_source = "shikimori.io"

        # Collect classification from every requested authority source. AniList
        # exposes genres directly. Shikimori exposes MAL taxonomy entries with
        # kind=genre/theme. MyAnimeList is parsed from the selected anime page so
        # Genres and Themes stay source-specific instead of being guessed.
        if data.anilist_id and not resolved_anilist_media:
            resolved_anilist_media = await self.anilist_by_id(int(data.anilist_id))
        if resolved_anilist_media:
            # AniList exposes banner + trailer in the same Media object, so this
            # adds no network request compared with the existing authority lookup.
            if not data.banner:
                data.banner = clean_text(resolved_anilist_media.get("bannerImage"))
            trailer = resolved_anilist_media.get("trailer") or {}
            if isinstance(trailer, dict) and clean_text(trailer.get("id")):
                data.trailer_id = clean_text(trailer.get("id"))
                data.trailer_site = clean_text(trailer.get("site")).lower()
                data.trailer_thumbnail = clean_text(trailer.get("thumbnail"))
                data.trailer_url = media_trailer_url(data.trailer_site, data.trailer_id)
                data.trailer_embed_url = media_trailer_embed_url(data.trailer_site, data.trailer_id)
                data.trailer_source = "anilist.co"
            data.genres["anilist.co"] = self.taxonomy_names(resolved_anilist_media.get("genres") or [])

        if data.mal_id and not resolved_shikimori:
            resolved_shikimori = await self.shikimori_details(int(data.mal_id))
        if not data.trailer_url and isinstance(resolved_shikimori, dict):
            videos = resolved_shikimori.get("videos") or []
            if isinstance(videos, list):
                video_items = [item for item in videos if isinstance(item, dict)]
                preferred = [
                    item for item in video_items
                    if clean_text(item.get("kind")).lower() in {"pv", "trailer", "teaser", "cm"}
                ]
                video = (preferred or video_items or [{}])[0]
                direct_url = clean_text(video.get("url"))
                player_url = clean_text(video.get("player_url") or video.get("playerUrl"))
                site = clean_text(video.get("hosting") or video.get("site")).lower()
                trailer_id = trailer_id_from_url(direct_url or player_url)
                if direct_url or player_url:
                    data.trailer_id = trailer_id
                    data.trailer_site = site or ("youtube" if "youtu" in (direct_url + player_url).lower() else "")
                    data.trailer_thumbnail = clean_text(video.get("image_url") or video.get("imageUrl"))
                    data.trailer_url = direct_url or media_trailer_url(data.trailer_site, trailer_id)
                    data.trailer_embed_url = player_url or media_trailer_embed_url(data.trailer_site, trailer_id)
                    data.trailer_source = "shikimori.io"

        shiki_genres, shiki_themes, shiki_page_ok, _ = await self.shikimori_page_taxonomy(data.mal_id)
        if not shiki_page_ok:
            shiki_genres, shiki_themes = self.shikimori_taxonomy(resolved_shikimori)
        data.genres["shikimori.io"] = shiki_genres
        data.themes["shikimori.io"] = shiki_themes

        mal_genres, mal_themes = await self.myanimelist_taxonomy(data.mal_id)
        data.genres["myanimelist.net"] = mal_genres
        data.themes["myanimelist.net"] = mal_themes

        # Do not merge neighbouring franchise/season search hits into aliases.
        # They are useful for discovery UIs, but they are NOT names of the selected
        # title and previously caused searches for sequels/arcs/spin-offs.

        # Preserve an explicitly supplied authority title URL only when its path is an anime entry.
        if payload.url:
            for site in AUTHORITY_SITES:
                if same_host(source, site) and is_authority_title_url(site, payload.url):
                    data.links[site].insert(0, {"url": compact_url(payload.url), "title": clean_title(payload.title)})
                    if site in {"myanimelist.net", "shikimori.io"}:
                        soup, final_url = await self.fetch_soup(payload.url)
                        if soup:
                            cover = extract_cover_from_soup(soup)
                            if cover:
                                data.cover = urljoin(final_url, cover)
                                data.cover_source = site
                    break

        for site in AUTHORITY_SITES:
            dedup: dict[str, dict[str, str]] = {}
            for item in data.links[site]:
                url = compact_url(item.get("url", ""))
                if url and is_authority_title_url(site, url):
                    dedup[url] = {"url": url, "title": clean_title(item.get("title")) or data.original}
            data.links[site] = list(dedup.values())[:8]

        data.aliases = unique_strings([
            data.original, data.english, data.native, *data.aliases, *extra_queries, payload.title, english_input,
        ], limit=60)

        TITLE_CACHE.set(cache_key, data.__dict__)
        return data

    async def resolve_taxonomy_authorities(self, payload: InputPayload) -> tuple[AuthorityData, dict[str, dict[str, Any]]]:
        """Resolve taxonomy with a direct authority-id path whenever possible.

        Backfill records already contain a MAL/Shikimori/AniList URL.  Using that
        canonical id avoids the broad title search and makes 167-item backfills both
        faster and much less likely to hit serverless/API throttling.
        """
        source = source_domain(payload.url)
        mal_id: int | None = None
        anilist_id: int | None = None
        media: dict[str, Any] | None = None
        fallback: AuthorityData | None = None
        anilist_ok = False
        anilist_error = ""

        if payload.url and same_host(source, "myanimelist.net") and is_authority_title_url("myanimelist.net", payload.url):
            mal_id = self.parse_mal_id(payload.url)
        elif payload.url and same_host(source, "shikimori.io") and is_authority_title_url("shikimori.io", payload.url):
            mal_id = self.parse_shikimori_id(payload.url)
        elif payload.url and same_host(source, "anilist.co") and is_authority_title_url("anilist.co", payload.url):
            anilist_id = self.parse_anilist_id(payload.url)
            if anilist_id:
                media, anilist_ok, anilist_error = await self.anilist_by_id_result(anilist_id)
                if media and media.get("idMal"):
                    mal_id = int(media["idMal"])

        if mal_id and media is None:
            if payload.prefer_client_anilist:
                # Used by the local backfill/client. Avoid a guaranteed 403 from
                # shared serverless egress and let the caller query AniList directly.
                anilist_ok = False
                anilist_error = "client fallback requested"
            else:
                media, anilist_ok, anilist_error = await self.anilist_by_mal_id_result(mal_id)
                if media and media.get("id"):
                    anilist_id = int(media["id"])

        # Only title-search when the caller did not provide a usable authority id.
        if mal_id is None and media is None:
            fallback = await self.resolve_authorities(payload)
            mal_id = fallback.mal_id
            anilist_id = fallback.anilist_id
            if anilist_id:
                media, anilist_ok, anilist_error = await self.anilist_by_id_result(int(anilist_id))
            elif mal_id:
                media, anilist_ok, anilist_error = await self.anilist_by_mal_id_result(int(mal_id))
                if media and media.get("id"):
                    anilist_id = int(media["id"])

        data = fallback or AuthorityData()
        data.mal_id = int(mal_id) if mal_id else data.mal_id
        data.anilist_id = int(anilist_id) if anilist_id else data.anilist_id

        shiki_details: dict[str, Any] | None = None
        shiki_ok = False
        shiki_error = ""
        if data.mal_id:
            try:
                shiki_details = await self.shikimori_details(int(data.mal_id))
                shiki_ok = shiki_details is not None
                if not shiki_ok:
                    shiki_error = "REST details unavailable"
            except Exception as error:
                shiki_error = clean_text(error) or error.__class__.__name__

        # Run the three source-specific taxonomy reads concurrently after identity is known.
        mal_task = asyncio.create_task(self.myanimelist_taxonomy_result(data.mal_id))
        shiki_page_task = asyncio.create_task(self.shikimori_page_taxonomy(data.mal_id))
        mal_genres, mal_themes, mal_ok, mal_error = await mal_task
        shiki_genres, shiki_themes, shiki_page_ok, shiki_page_error = await shiki_page_task

        if shiki_page_ok:
            shiki_ok = True
            shiki_error = ""
        elif shiki_details:
            # Page parse failed, keep REST as data fallback but report the page
            # failure so backfill can retry instead of silently persisting a flattened split.
            fallback_genres, fallback_themes = self.shikimori_taxonomy(shiki_details)
            shiki_genres = fallback_genres
            shiki_themes = fallback_themes
            shiki_error = shiki_page_error or shiki_error

        if media:
            titles = media.get("title") or {}
            data.original = clean_title(titles.get("romaji") or data.original or payload.title)
            data.english = clean_title(titles.get("english") or data.english or "")
            data.native = clean_title(titles.get("native") or data.native or "")
            data.aliases = unique_strings([*self.media_names(media), *data.aliases, payload.title], limit=60)
            data.genres["anilist.co"] = self.taxonomy_names(media.get("genres") or [])
            if media.get("id"):
                data.anilist_id = int(media["id"])
            if media.get("idMal"):
                data.mal_id = int(media["idMal"])
        else:
            data.genres["anilist.co"] = []

        if shiki_details:
            names = self.shikimori_names(shiki_details)
            if not data.original:
                data.original = clean_title(shiki_details.get("name") or payload.title)
            # Keep Shikimori's primary localized title distinct from its synonyms.
            # Choosing by Cyrillic letter heuristics can prefer a secondary synonym
            # (e.g. "Неторопливый фермер...") over the actual catalog title
            # ("Фермерская жизнь...") and makes every RU catalog miss its first query.
            data.russian = clean_title(shiki_details.get("russian") or data.russian)
            data.aliases = unique_strings([*data.aliases, *names, payload.title], limit=60)
            if not data.english:
                english_values = shiki_details.get("english") or []
                if isinstance(english_values, str):
                    english_values = [english_values]
                data.english = clean_title(next((x for x in english_values if clean_title(x)), ""))
            if not data.native:
                japanese_values = shiki_details.get("japanese") or []
                if isinstance(japanese_values, str):
                    japanese_values = [japanese_values]
                data.native = clean_title(next((x for x in japanese_values if clean_title(x)), ""))

        data.genres["myanimelist.net"] = mal_genres
        data.themes["myanimelist.net"] = mal_themes
        data.genres["shikimori.io"] = shiki_genres
        data.themes["shikimori.io"] = shiki_themes

        if data.mal_id:
            data.links["myanimelist.net"] = [{"url": f"https://myanimelist.net/anime/{data.mal_id}", "title": data.english or data.original or payload.title}]
            data.links["shikimori.io"] = [{"url": f"https://shikimori.io/animes/{data.mal_id}", "title": data.original or payload.title}]
        if data.anilist_id:
            data.links["anilist.co"] = [{"url": f"https://anilist.co/anime/{data.anilist_id}", "title": data.original or payload.title}]

        # Distinguish a definite catalogue absence from a temporary source failure.
        # This matters for backfill: NOT_FOUND must be considered a completed check,
        # while 403/429/5xx/timeouts/parsing failures remain retriable.
        identity_has_anilist_without_mal = bool(data.anilist_id and not data.mal_id)
        mal_not_found = bool(
            "http 404" in clean_text(mal_error).casefold()
            or identity_has_anilist_without_mal
        )
        shiki_final_error = shiki_page_error or ("" if shiki_page_ok else shiki_error)
        shiki_not_found = bool(
            "http 404" in clean_text(shiki_final_error).casefold()
            or identity_has_anilist_without_mal
        )
        anilist_error_key = clean_text(anilist_error).casefold()
        anilist_not_found = bool(
            "no media for mal id" in anilist_error_key
            or "no media for anilist id" in anilist_error_key
        )

        status = {
            "myanimelist.net": {
                "ok": bool(mal_ok),
                "notFound": mal_not_found,
                "error": "title has no MAL id" if identity_has_anilist_without_mal and not mal_ok else mal_error,
                "id": data.mal_id,
                "genres": len(mal_genres),
                "themes": len(mal_themes),
            },
            "shikimori.io": {
                "ok": bool(shiki_page_ok),
                "notFound": shiki_not_found,
                "error": "title has no MAL/Shikimori id" if identity_has_anilist_without_mal and not shiki_page_ok else shiki_final_error,
                "id": data.mal_id,
                "genres": len(shiki_genres),
                "themes": len(shiki_themes),
                "pageSplit": bool(shiki_page_ok),
            },
            "anilist.co": {
                "ok": bool(anilist_ok),
                "notFound": anilist_not_found,
                "error": anilist_error,
                "id": data.anilist_id,
                "genres": len(data.genres.get("anilist.co") or []),
                "clientFallback": bool(payload.prefer_client_anilist or (not anilist_ok and "HTTP 403" in (anilist_error or ""))),
            },
        }
        return data, status

    async def discover_search_requests(self, domain: str, query: str) -> list[tuple[str, str, dict[str, Any]]]:
        cache_key = f"forms:{domain}"
        templates = FORM_CACHE.get(cache_key)
        if templates is None:
            templates = []
            for host in logical_hosts(domain)[:3]:
                soup, final_url = await self.fetch_soup(f"https://{host}/")
                if not soup:
                    continue
                for form in soup.find_all("form")[:80]:
                    inputs = form.find_all(["input", "textarea"])
                    search_input = None
                    for input_tag in inputs:
                        name = clean_text(input_tag.get("name")).lower()
                        hint = " ".join([
                            clean_text(input_tag.get("placeholder")),
                            clean_text(input_tag.get("aria-label")),
                        ])
                        if input_tag.get("type") == "search" or name in SEARCH_FIELD_NAMES or SEARCH_HINT_RE.search(hint):
                            search_input = input_tag
                            break
                    if not search_input or not search_input.get("name"):
                        continue
                    action = urljoin(final_url, form.get("action") or final_url)
                    method = (form.get("method") or "GET").upper()
                    static: dict[str, str] = {}
                    for inp in inputs:
                        name = inp.get("name")
                        if not name or name == search_input.get("name"):
                            continue
                        typ = (inp.get("type") or "").lower()
                        if typ in {"submit", "button", "file", "password"}:
                            continue
                        if typ in {"checkbox", "radio"} and not inp.has_attr("checked"):
                            continue
                        value = inp.get("value")
                        if value not in {None, ""}:
                            static[name] = value
                    templates.append({
                        "action": action,
                        "method": method if method == "POST" else "GET",
                        "field": search_input.get("name"),
                        "static": static,
                    })
                if templates:
                    break
            FORM_CACHE.set(cache_key, templates[:5])

        result: list[tuple[str, str, dict[str, Any]]] = []
        for template in templates[:5]:
            data = dict(template["static"])
            data[template["field"]] = query
            if template["method"] == "POST":
                result.append(("POST", template["action"], {"data": data}))
            else:
                result.append(("GET", template["action"], {"params": data}))
        return result

    def parse_catalog_results(self, html: str, base_url: str, domain: str, identity_aliases: list[str]) -> list[dict[str, str]]:
        """Extract only title-entry links whose card text already matches the identity.

        This is only a pre-filter. Every generic HTML result is still verified on the
        destination title page before it can enter the final JSON.
        """
        soup = BeautifulSoup(html, "html.parser")
        found: dict[str, dict[str, str]] = {}
        for anchor in soup.select("a[href]")[:3200]:
            href = anchor.get("href") or ""
            if href.startswith(("#", "javascript:")):
                continue
            url = compact_url(urljoin(base_url, href))
            if not is_catalog_title_url(domain, url):
                continue
            img = anchor.find("img")
            texts = unique_strings([
                anchor.get_text(" ", strip=True),
                anchor.get("title"),
                anchor.get("aria-label"),
                img.get("alt") if img else "",
                slug_title(url),
            ], limit=8)
            best_kind = None
            best_title = ""
            for text in texts:
                if is_catalog_noise_title(text):
                    continue
                kind = title_match_kind(text, identity_aliases)
                if kind == "exact":
                    best_kind, best_title = kind, text
                    break
                if kind == "season" and not best_kind:
                    best_kind, best_title = kind, text
            if not best_kind:
                continue
            found[url] = {"url": url, "title": best_title or (texts[0] if texts else slug_title(url)), "match": best_kind}
        values = list(found.values())
        values.sort(key=lambda x: (0 if x.get("match") == "exact" else 1, x.get("title", "")))
        return values[:30]

    def parse_loose_catalog_candidates(self, html: str, base_url: str, domain: str, limit: int = 40) -> list[dict[str, str]]:
        """Collect plausible anime-title entry URLs only, never category/list/navigation pages."""
        soup = BeautifulSoup(html, "html.parser")
        found: dict[str, dict[str, str]] = {}
        for anchor in soup.select("a[href]")[:3600]:
            href = anchor.get("href") or ""
            if href.startswith(("#", "javascript:")):
                continue
            url = compact_url(urljoin(base_url, href))
            if not is_catalog_title_url(domain, url):
                continue
            img = anchor.find("img")
            texts = unique_strings([
                anchor.get_text(" ", strip=True),
                anchor.get("title"),
                anchor.get("aria-label"),
                img.get("alt") if img else "",
                slug_title(url),
            ], limit=6)
            title = next((x for x in texts if is_probable_title(x) and not is_catalog_noise_title(x)), "")
            if not title:
                continue
            found.setdefault(url, {"url": url, "title": title, "match": ""})
            if len(found) >= limit:
                break
        return list(found.values())

    async def verify_candidates(self, domain: str, candidates: list[dict[str, str]], identity_aliases: list[str]) -> list[dict[str, str]]:
        """Verify candidates from page-level title metadata only.

        The old implementation scanned the entire body. On catalog/category pages the
        requested anime often appears in menus, franchise widgets or recommendations,
        causing those pages to be falsely accepted. Body containment is intentionally
        forbidden here.
        """
        sem = asyncio.Semaphore(8)

        async def verify(item: dict[str, str]) -> dict[str, str] | None:
            raw_url = compact_url(item.get("url", ""))
            if not raw_url or not is_catalog_title_url(domain, raw_url):
                return None

            display_title = clean_title(item.get("title"))
            if (
                self._season_family_mode
                and display_title
                and not is_season_family_member(display_title, self._season_family_roots)
            ):
                return None
            direct_kind = None
            if display_title and not is_catalog_noise_title(display_title):
                direct_kind = title_match_kind(display_title, identity_aliases)
            if not direct_kind:
                direct_kind = title_match_kind(slug_title(raw_url), identity_aliases)

            async with sem:
                soup, final_url = await self.fetch_soup(raw_url)
            final_url = compact_url(final_url or raw_url)
            if not is_catalog_title_url(domain, final_url):
                return None

            if not soup:
                # If a title page is temporarily blocked, only an already exact card match
                # is trusted. Loose/body-derived candidates are never accepted blind.
                if direct_kind == "exact":
                    return {"url": final_url, "title": display_title or slug_title(final_url), "match": "exact"}
                return None

            page_signals = soup_title_signals(soup, domain)
            if self._season_family_mode:
                page_signals = [
                    signal for signal in page_signals
                    if is_season_family_member(signal, self._season_family_roots)
                ]
            matching_signal = ""
            match_kind = None
            for signal in page_signals:
                kind = title_match_kind(signal, identity_aliases)
                if kind == "exact":
                    matching_signal, match_kind = signal, kind
                    break
                if kind == "season" and not match_kind:
                    matching_signal, match_kind = signal, kind

            if not match_kind:
                return None

            primary = page_primary_title(soup)
            preferred = primary if is_probable_title(primary) and not is_catalog_noise_title(primary) else ""
            if not preferred and is_probable_title(display_title) and not is_catalog_noise_title(display_title):
                preferred = display_title
            return {
                "url": final_url,
                "title": preferred or matching_signal,
                "match": match_kind,
                "verified_by": matching_signal,
                "_aliases": unique_strings(page_signals, limit=40),
            }

        # Loose result pages can contain dozens of unrelated anime cards. Fetching
        # the first 18 title pages blindly caused hundreds of useless requests
        # (Bleach, seasonal cards, recommendations, etc.). Rank locally first and
        # verify only candidates that already resemble a trusted identity alias.
        def pre_score(item: dict[str, str]) -> float:
            display = clean_title(item.get("title", ""))
            if (
                self._season_family_mode
                and display
                and not is_season_family_member(display, self._season_family_roots)
            ):
                return -1.0
            signals = unique_strings([display, slug_title(item.get("url", ""))], limit=4)
            best = 0.0
            for signal in signals:
                kind = title_match_kind(signal, identity_aliases)
                if kind == "exact":
                    return 2.0
                if kind == "season":
                    best = max(best, 1.5)
                for alias in identity_aliases:
                    best = max(best, title_relation_score(signal, alias))
            return best

        ranked = sorted(candidates, key=pre_score, reverse=True)
        # 0.48 admitted generic cards sharing only words like "isekai" and caused
        # unrelated title-page fetches. Exact/season matches score 2.0/1.5, so a
        # stricter lexical floor keeps completeness while cutting false candidates.
        plausible_limit = 10 if self._season_family_mode else 4
        plausible = [item for item in ranked if pre_score(item) >= 0.66][:plausible_limit]
        if not plausible:
            return []

        results = await asyncio.gather(*(verify(item) for item in plausible))
        unique: dict[str, dict[str, str]] = {}
        for item in results:
            if item:
                existing = unique.get(item["url"])
                if not existing or (existing.get("match") != "exact" and item.get("match") == "exact"):
                    unique[item["url"]] = item
        values = list(unique.values())
        values.sort(key=lambda x: (0 if x.get("match") == "exact" else 1, x.get("title", "")))
        return values[:30]

    async def search_shikimori(self, queries: list[str], identity_aliases: list[str], mal_id: int | None) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        operations: list[tuple[str, str]] = []
        if mal_id:
            operations.append(("ids", str(mal_id)))
        operations.extend(("search", query) for query in queries)
        for kind, value in operations:
            try:
                response = await self.request(
                    "GET", "https://shikimori.io/api/animes",
                    params={"limit": "50", kind: value}, headers={"Accept": "application/json"},
                )
                if response.status_code >= 400:
                    continue
                payload = response.json()
                for item in payload if isinstance(payload, list) else []:
                    names = unique_strings([item.get("name"), item.get("russian")])
                    match = next((title_match_kind(name, identity_aliases) for name in names if title_match_kind(name, identity_aliases)), None)
                    mal_exact = mal_id and str(item.get("id")) == str(mal_id)
                    if not match and not mal_exact:
                        continue
                    url = urljoin("https://shikimori.io", item.get("url") or f"/animes/{item.get('id')}")
                    # Prefer Russian displayed title for localization, while identity remains verified by original/MAL id.
                    display = clean_title(item.get("russian") or item.get("name") or value)
                    found[compact_url(url)] = {"url": compact_url(url), "title": display, "match": match or "exact"}
                if found:
                    break
            except Exception:
                continue
        return list(found.values())[:30]

    async def anihub_api_lookup(
        self,
        *,
        anime_id: int | None = None,
        mal_id: int | None = None,
        anilist_id: int | None = None,
    ) -> dict[str, Any] | None:
        """Resolve one AniHub title through the documented JSON API only."""
        try:
            if anime_id:
                response = await self.request(
                    "GET", f"https://api.anihub.in.ua/anime/{int(anime_id)}",
                    headers={"Accept": "application/json"},
                )
                if response.status_code < 400:
                    data = response.json()
                    return data if isinstance(data, dict) else None
                return None

            lookups: list[tuple[str, int]] = []
            if mal_id:
                lookups.append(("mal_id", int(mal_id)))
            if anilist_id:
                lookups.append(("anilist_id", int(anilist_id)))
            for field, value in lookups:
                response = await self.request(
                    "GET", "https://api.anihub.in.ua/anime",
                    params={"page_size": 5, field: value},
                    headers={"Accept": "application/json"},
                )
                if response.status_code >= 400:
                    continue
                payload = response.json()
                items = payload.get("items", []) if isinstance(payload, dict) else []
                if not items:
                    continue
                exact = next((x for x in items if str(x.get(field) or "") == str(value)), None)
                if exact:
                    return exact
                if isinstance(items[0], dict):
                    return items[0]
            return None
        except Exception:
            return None

    def anihub_item_to_catalog(self, item: dict[str, Any], fallback: str = "") -> dict[str, str] | None:
        item_id = item.get("id")
        slug = clean_text(item.get("slug")).strip("/")
        if not item_id:
            return None
        page = f"https://anihub.in.ua/anime/{slug}-{item_id}" if slug else f"https://anihub.in.ua/anime/{item_id}"
        names = unique_strings([
            item.get("title_ukrainian"), item.get("title_original"), item.get("title_english"), fallback,
        ], limit=8)
        display = clean_title(item.get("title_ukrainian") or item.get("title_original") or item.get("title_english") or fallback)
        return {
            "url": compact_url(page),
            "title": display,
            "match": "exact",
            "_aliases": names,
        }

    async def search_anihub(
        self,
        queries: list[str],
        identity_aliases: list[str],
        anilist_id: int | None,
        mal_id: int | None = None,
    ) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}

        # Exact external identifiers are vastly cheaper and more reliable than text search.
        exact = await self.anihub_api_lookup(mal_id=mal_id, anilist_id=anilist_id)
        if exact:
            item = self.anihub_item_to_catalog(exact, queries[0] if queries else "")
            if item:
                found[item["url"]] = item
                return list(found.values())

        # Name search is only a fallback and uses at most two high-confidence names.
        for query in unique_strings(queries, limit=2):
            try:
                response = await self.request(
                    "GET", "https://api.anihub.in.ua/anime",
                    params={"search": query, "page_size": 10},
                    headers={"Accept": "application/json"},
                )
                if response.status_code >= 400:
                    continue
                payload = response.json()
                items = payload.get("items", []) if isinstance(payload, dict) else []
                for raw in items:
                    if not isinstance(raw, dict):
                        continue
                    names = unique_strings([raw.get("title_ukrainian"), raw.get("title_original"), raw.get("title_english")])
                    match = next((title_match_kind(name, identity_aliases) for name in names if title_match_kind(name, identity_aliases)), None)
                    if not match:
                        continue
                    item = self.anihub_item_to_catalog(raw, query)
                    if item:
                        item["match"] = match
                        found[item["url"]] = item
                if found:
                    break
            except Exception:
                continue
        return list(found.values())[:30]

    async def search_anihub_family(
        self, queries: list[str], identity_aliases: list[str]
    ) -> list[dict[str, str]]:
        """Search AniHub by a season-free franchise root and keep only season-family hits."""
        found: dict[str, dict[str, str]] = {}
        for query in unique_strings(queries, limit=1):
            try:
                response = await self.request(
                    "GET", "https://api.anihub.in.ua/anime",
                    params={"search": query, "page_size": 20},
                    headers={"Accept": "application/json"},
                )
                if response.status_code >= 400:
                    continue
                payload = response.json()
                items = payload.get("items", []) if isinstance(payload, dict) else []
                for raw in items:
                    if not isinstance(raw, dict):
                        continue
                    names = unique_strings([
                        raw.get("title_ukrainian"), raw.get("title_original"), raw.get("title_english")
                    ])
                    if not any(is_season_family_member(name, queries) for name in names):
                        continue
                    match = next((
                        title_match_kind(name, identity_aliases)
                        for name in names if title_match_kind(name, identity_aliases)
                    ), None)
                    if not match:
                        continue
                    item = self.anihub_item_to_catalog(raw, query)
                    if item:
                        item["match"] = match
                        found[item["url"]] = item
                break
            except Exception:
                continue
        return list(found.values())[:30]

    async def search_yummy(self, queries: list[str], identity_aliases: list[str]) -> list[dict[str, str]]:
        token = clean_text(os.getenv("YUMMY_APPLICATION_TOKEN"))
        if not token:
            return []
        found: dict[str, dict[str, str]] = {}
        for query in queries:
            try:
                response = await self.request(
                    "GET", "https://api.yani.tv/search",
                    params={"q": query, "limit": 50, "offset": 0},
                    headers={"Accept": "application/json", "X-Application": token, "Lang": "ru"},
                )
                if response.status_code >= 400:
                    continue
                payload = response.json()
                root = payload.get("response", payload) if isinstance(payload, dict) else payload
                if isinstance(root, dict):
                    items = next((root.get(k) for k in ("items", "results", "data", "animes") if isinstance(root.get(k), list)), [])
                else:
                    items = root if isinstance(root, list) else []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    titles = item.get("titles") or {}
                    names = unique_strings([
                        item.get("title"), item.get("name"), item.get("title_ru"), item.get("title_en"),
                        titles.get("ru"), titles.get("en"), titles.get("romaji"), *(item.get("synonyms") or []),
                    ])
                    match = next((title_match_kind(name, identity_aliases) for name in names if title_match_kind(name, identity_aliases)), None)
                    if not match:
                        continue
                    slug = clean_text(item.get("alias") or item.get("slug")).strip("/")
                    page = clean_text(item.get("url"))
                    if page:
                        page = urljoin("https://ru.yummyani.me", page)
                    elif slug:
                        page = f"https://ru.yummyani.me/catalog/item/{quote(slug)}"
                    else:
                        continue
                    display = clean_title(item.get("title_ru") or titles.get("ru") or item.get("title") or item.get("name") or names[0])
                    found[compact_url(page)] = {"url": compact_url(page), "title": display, "match": match}
                if found:
                    break
            except Exception:
                continue
        return list(found.values())[:30]

    async def search_animeon(self, queries: list[str], identity_aliases: list[str], mal_id: int | None) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        endpoints: list[tuple[str, str]] = []
        # We already know the localized UA title before catalog search. One text
        # query usually returns the whole matching franchise (season 1 + season 2),
        # while probing three MAL parameter spellings first cost 3 extra requests.
        for query in unique_strings(queries, limit=2):
            endpoints.extend((key, query) for key in ("search", "q", "title", "query"))
        if mal_id:
            endpoints.extend((key, str(mal_id)) for key in ("malId", "mal_id", "mal"))
        for key, value in endpoints:
            try:
                response = await self.request("GET", "https://animeon.club/api/anime/", params={key: value}, headers={"Accept": "application/json"})
                if response.status_code >= 400:
                    continue
                payload = response.json()
                if isinstance(payload, list):
                    items = payload
                elif isinstance(payload, dict):
                    items = next((payload.get(k) for k in ("results", "items", "data", "anime") if isinstance(payload.get(k), list)), [])
                    if not items and payload.get("id"):
                        items = [payload]
                else:
                    items = []
                for item in items:
                    names = unique_strings([item.get("titleUa"), item.get("title"), item.get("name")])
                    match = next((title_match_kind(name, identity_aliases) for name in names if title_match_kind(name, identity_aliases)), None)
                    mal_exact = mal_id and str(item.get("malId") or item.get("mal_id") or "") == str(mal_id)
                    if not match and not mal_exact:
                        continue
                    slug = clean_text(item.get("slug")).strip("/")
                    page = f"https://animeon.club/anime/{slug}" if slug else f"https://animeon.club/anime/{item.get('id')}"
                    display = clean_title(item.get("titleUa") or item.get("title") or item.get("name") or queries[0])
                    found[page] = {"url": page, "title": display, "match": match or "exact"}
                if found:
                    break
            except Exception:
                continue
        return list(found.values())[:30]

    def effective_mikai_api_key(self) -> str:
        key = clean_text(self.mikai_api_key or os.getenv("MIKAI_API_KEY"))
        return key if key.lower().startswith("mk_") else ""

    def mikai_api_headers(self, *, anonymous: bool = False) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        key = "" if anonymous else self.effective_mikai_api_key()
        if key:
            headers["X-API-Key"] = key
        return headers

    async def mikai_api_get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        # Use the saved/user-provided key when available. If it was revoked or
        # malformed and Mikai rejects it, transparently retry public anonymous
        # mode so a bad optional key cannot break title processing.
        keyed = bool(self.effective_mikai_api_key())
        response = await self.request(
            "GET", url, params=params, headers=self.mikai_api_headers(),
        )
        if keyed and response.status_code in {401, 403}:
            response = await self.request(
                "GET", url, params=params, headers=self.mikai_api_headers(anonymous=True), _no_cache=True,
            )
        return response

    async def mikai_api_detail(
        self,
        *,
        mikai_id: int | None = None,
        mal_id: int | None = None,
        anilist_id: int | None = None,
    ) -> dict[str, Any] | None:
        refs: list[str] = []
        if mikai_id:
            refs.append(str(int(mikai_id)))
        if mal_id:
            refs.append(f"mal:{int(mal_id)}")
        if anilist_id:
            refs.append(f"al:{int(anilist_id)}")
        for ref in unique_strings(refs, limit=3):
            try:
                response = await self.mikai_api_get(
                    f"https://api.mikai.me/public/v1/anime/{quote(ref, safe=':')}"
                )
                if response.status_code == 404:
                    continue
                if response.status_code >= 400:
                    return None
                payload = response.json()
                result = payload.get("result") if isinstance(payload, dict) and payload.get("ok") is True else None
                if isinstance(result, dict):
                    return result
            except Exception:
                continue
        return None

    def mikai_item_to_catalog(self, item: dict[str, Any], fallback: str = "") -> dict[str, str] | None:
        ids = item.get("ids") or {}
        titles = item.get("titles") or {}
        item_id = ids.get("mikai") or item.get("id")
        slug = clean_text(ids.get("slug") or item.get("slug")).strip("/")
        if not item_id:
            return None
        page = f"https://mikai.me/anime/{item_id}-{slug}" if slug else f"https://mikai.me/anime/{item_id}"
        names = unique_strings([titles.get("ua"), titles.get("english"), titles.get("original"), fallback], limit=8)
        display = clean_title(titles.get("ua") or titles.get("english") or titles.get("original") or fallback)
        return {
            "url": compact_url(page),
            "title": display,
            "match": "exact",
            "_aliases": names,
        }

    async def search_mikai(
        self,
        queries: list[str],
        identity_aliases: list[str],
        mal_id: int | None = None,
        anilist_id: int | None = None,
    ) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}

        # Official public API: one exact request by MAL/AniList ID gives the
        # canonical title/description. Keep it, then do at most ONE text search to
        # recover related seasons. This preserves the old complete catalog result
        # without ever walking dozens of API pages.
        detail = await self.mikai_api_detail(mal_id=mal_id, anilist_id=anilist_id)
        if detail:
            item = self.mikai_item_to_catalog(detail, queries[0] if queries else "")
            if item:
                found[item["url"]] = item

        for query in unique_strings(queries, limit=1):
            try:
                response = await self.mikai_api_get(
                    "https://api.mikai.me/public/v1/anime",
                    params={"search": query, "limit": 20, "page": 1},
                )
                if response.status_code >= 400:
                    continue
                payload = response.json()
                items = payload.get("result", []) if isinstance(payload, dict) and payload.get("ok") is True else []
                for raw in items:
                    if not isinstance(raw, dict):
                        continue
                    titles = raw.get("titles") or {}
                    names = unique_strings([titles.get("ua"), titles.get("english"), titles.get("original")])
                    if self._season_family_mode and self._season_family_roots:
                        if not any(is_season_family_member(name, self._season_family_roots) for name in names):
                            continue
                    match = next((title_match_kind(name, identity_aliases) for name in names if title_match_kind(name, identity_aliases)), None)
                    if not match:
                        continue
                    item = self.mikai_item_to_catalog(raw, query)
                    if item:
                        item["match"] = match
                        found[item["url"]] = item
                # One family-search request is enough. Exact-ID result, if any,
                # remains merged with season/franchise matches from this response.
                break
            except Exception:
                continue
        return list(found.values())[:30]

    async def search_aniliberty_direct(self, queries: list[str], identity_aliases: list[str]) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        for query in queries:
            slug = re.sub(r"[^a-z0-9]+", "-", query.casefold()).strip("-")
            if not slug:
                continue
            # The two domains are mirrors. Query the preferred host once; only
            # retry the mirror when the preferred host is unreachable/5xx. A 404
            # is a valid "release slug not found" result and should not be doubled.
            hosts = ("aniliberty.top", "anilibria.top")
            for idx, host in enumerate(hosts):
                url = f"https://{host}/anime/releases/release/{slug}"
                try:
                    response = await self.request("GET", url, headers={"Accept": "text/html,application/xhtml+xml"})
                except Exception:
                    if idx == 0:
                        continue
                    break
                if response.status_code >= 500:
                    if idx == 0:
                        continue
                    break
                if response.status_code >= 400:
                    break
                soup = BeautifulSoup(response.text, "html.parser")
                signals = soup_title_signals(soup)
                match = next((title_match_kind(signal, identity_aliases) for signal in signals if title_match_kind(signal, identity_aliases)), None)
                if match:
                    display = next((x for x in signals if is_probable_title(x)), query)
                    found[compact_url(str(response.url))] = {"url": compact_url(str(response.url)), "title": display, "match": match}
                break
            if found:
                break
        return list(found.values())[:30]

    async def search_dle_post(
        self,
        domain: str,
        queries: list[str],
        identity_aliases: list[str],
        *,
        request_timeout: float | None = None,
    ) -> list[dict[str, str]]:
        """Use the native DataLife Engine search form for one ordered query at a time.

        jut-su.net visibly returns the correct title through this form even when
        generic /search?q= routes do not exist. Priority queries use the normal
        HTTP transport timeout; only secondary aliases receive a short timeout.
        """
        hosts = ["uachan.top"] if domain == "uachan.com" else logical_hosts(domain)
        for query in queries:
            data = {
                "do": "search",
                "subaction": "search",
                "search_start": "1",
                "full_search": "0",
                "result_from": "1",
                "story": query,
            }
            for host in hosts[:2]:
                # All supported DLE catalogs expose the canonical search action at
                # /index.php?do=search. Posting the same form again to bare /index.php
                # duplicates work on failures and was a major source of AnimeGO/Jutsu
                # latency. Use one native request per title variant.
                endpoints = [f"https://{host}/index.php?do=search"]
                for endpoint in endpoints:
                    try:
                        request_coro = self.request(
                            "POST",
                            endpoint,
                            data=data,
                            headers={
                                "Content-Type": "application/x-www-form-urlencoded",
                                "Accept": "text/html,application/xhtml+xml",
                                "Referer": f"https://{host}/",
                            },
                        )
                        # Priority title searches intentionally have no short artificial
                        # timeout. They use the HTTP client's transport timeout. A short
                        # timeout is only supplied once we start probing secondary aliases.
                        response = (
                            await asyncio.wait_for(request_coro, timeout=request_timeout)
                            if request_timeout is not None
                            else await request_coro
                        )
                        if response.status_code >= 400:
                            continue
                        parsed = self.parse_catalog_results(response.text, str(response.url), domain, identity_aliases)
                        if parsed:
                            verified = await self.verify_candidates(domain, parsed, identity_aliases)
                            if verified:
                                return verified
                        # Search cards often wrap poster/title in separate anchors.
                        # Loose URL collection is safe because every candidate is
                        # then verified on its own title page against H1/original.
                        loose = self.parse_loose_catalog_candidates(response.text, str(response.url), domain, 30)
                        if loose:
                            verified = await self.verify_candidates(domain, loose, identity_aliases)
                            if verified:
                                return verified
                    except asyncio.TimeoutError:
                        self.log(f"DLE search timeout: {domain} {endpoint} query={query!r}")
                        continue
                    except Exception as error:
                        self.log(f"DLE search error: {domain} {endpoint}: {error}")
                        continue
        return []

    async def generic_site_search(
        self, domain: str, queries: list[str], identity_aliases: list[str], *,
        compact: bool = False, discover_forms: bool = True,
    ) -> list[dict[str, str]]:
        if domain in self._dead_search_domains:
            return []
        for query in queries:
            if domain in self._dead_search_domains:
                break
            q = quote_plus(query)
            q_path = quote(query, safe="")
            urls = [route.format(q=q, q_path=q_path) for route in SEARCH_ROUTES.get(domain, [])]
            generic: list[str] = []
            # Prefer known site routes.  Generic probes are only a small safety net;
            # six parallel guesses per query were the main source of unnecessary
            # traffic and timeouts in 2.8.x.
            if not urls or not compact:
                for host in logical_hosts(domain)[:1 if compact else 2]:
                    generic.extend([
                        f"https://{host}/search?q={q}",
                        f"https://{host}/?s={q}",
                        f"https://{host}/catalog?search={q}",
                        f"https://{host}/anime?search={q}",
                    ])
            max_routes = 2 if compact else 6
            urls = list(dict.fromkeys(urls + generic))[:max_routes]

            route_statuses: list[int] = []

            async def fetch_route(url: str) -> list[dict[str, str]]:
                try:
                    response = await self.request("GET", url, headers={"Accept": "text/html,application/xhtml+xml"})
                    route_statuses.append(int(response.status_code))
                    if response.status_code >= 400:
                        return []
                    strict = self.parse_catalog_results(response.text, str(response.url), domain, identity_aliases)
                    if strict:
                        verified = await self.verify_candidates(domain, strict, identity_aliases)
                        if verified:
                            return verified
                    loose = self.parse_loose_catalog_candidates(response.text, str(response.url), domain, 18)
                    return await self.verify_candidates(domain, loose, identity_aliases) if loose else []
                except Exception:
                    return []

            route_results = await asyncio.gather(*(fetch_route(url) for url in urls))
            # A 404 from every configured search route means the route itself does
            # not exist, not that this particular anime is missing. Stop probing
            # more aliases/replay for that domain during this run.
            if urls and route_statuses and len(route_statuses) == len(urls) and all(code == 404 for code in route_statuses):
                self._dead_search_domains.add(domain)
            merged: dict[str, dict[str, str]] = {}
            for items in route_results:
                for item in items:
                    merged[item["url"]] = item
            if merged:
                return list(merged.values())[:30]

            if not discover_forms or domain in self._dead_search_domains:
                continue
            discovered = await self.discover_search_requests(domain, query)
            form_jobs: list[asyncio.Task] = []
            for method, url, kwargs in discovered:
                async def submit(method=method, url=url, kwargs=kwargs):
                    try:
                        response = await self.request(method, url, **kwargs)
                        if response.status_code >= 400:
                            return []
                        strict = self.parse_catalog_results(response.text, str(response.url), domain, identity_aliases)
                        if strict:
                            verified = await self.verify_candidates(domain, strict, identity_aliases)
                            if verified:
                                return verified
                        loose = self.parse_loose_catalog_candidates(response.text, str(response.url), domain, 18)
                        return await self.verify_candidates(domain, loose, identity_aliases) if loose else []
                    except Exception:
                        return []
                form_jobs.append(asyncio.create_task(submit()))
            if form_jobs:
                for items in await asyncio.gather(*form_jobs):
                    for item in items:
                        merged[item["url"]] = item
                if merged:
                    return list(merged.values())[:30]
        return []

    async def google_catalog_fallback(self, domain: str, queries: list[str], identity_aliases: list[str]) -> list[dict[str, str]]:
        # Strict order is preserved: original -> English (if different) -> localized RU/UA title.
        for query in queries:
            indexed = await self.google_site_search(logical_hosts(domain)[0].removeprefix("www."), query, 24)
            candidates: list[dict[str, str]] = []
            for item in indexed:
                try:
                    host = urlparse(item["url"]).hostname or ""
                except Exception:
                    continue
                if not host_allowed(host, domain):
                    continue
                candidates.append({"url": item["url"], "title": item.get("title") or slug_title(item["url"]), "match": ""})
            if not candidates:
                continue
            verified = await self.verify_candidates(domain, candidates, identity_aliases)
            if verified:
                return verified
        return []

    async def search_catalog_native(
        self,
        domain: str,
        queries: list[str],
        identity_aliases: list[str],
        authority: AuthorityData,
        *,
        request_timeout: float | None = None,
    ) -> list[dict[str, str]]:
        queries = unique_strings(queries, limit=4)
        identity_aliases = unique_strings(identity_aliases, limit=20)
        if not queries:
            return []

        if domain == "shikimori.io":
            result = await self.search_shikimori(queries, identity_aliases, authority.mal_id)
        elif domain == "anihub.in.ua":
            result = await self.search_anihub(queries, identity_aliases, authority.anilist_id, authority.mal_id)
        elif domain == "ru.yummyani.me":
            result = await self.search_yummy(queries, identity_aliases)
            if not result:
                result = await self.generic_site_search(
                    domain, queries, identity_aliases, compact=True, discover_forms=False
                )
        elif domain == "animeon.club":
            result = await self.search_animeon(queries, identity_aliases, authority.mal_id)
        elif domain == "mikai.me":
            result = await self.search_mikai(queries, identity_aliases, authority.mal_id, authority.anilist_id)
        elif domain == "anilibria.tv":
            # The catalog search endpoint is explicit and stable. Guessed release
            # slugs plus homepage/form discovery added many requests on misses while
            # returning no extra verified titles in profiling.
            result = await self.generic_site_search(
                domain, queries, identity_aliases, compact=True, discover_forms=False
            )
        elif domain == "anidesu.net":
            # Current AniDesu DLE POST endpoints consistently return 403 while
            # the public GET search remains reachable. Do not waste two blocked
            # POSTs per alias or rediscover the same blocked form.
            result = await self.generic_site_search(
                domain, queries, identity_aliases, compact=True, discover_forms=False
            )
        elif domain in {"crunchyroll.com", "uaserials.com", "amanogawa.space", "jut.su"}:
            # These catalogs already have explicit known GET search routes. Form
            # discovery adds a homepage request (and for UASerials an extra form
            # submission) for every alias without improving the observed result.
            result = await self.generic_site_search(
                domain, queries, identity_aliases, compact=True, discover_forms=False
            )
        elif domain in DLE_SEARCH_SITES:
            # DLE catalogs (including jut-su.net) must use their real POST search
            # first.  The old generic GET fan-out often consumed the whole outer
            # timeout before the site's actual search form was submitted.
            try:
                result = await self.search_dle_post(
                    domain, queries, identity_aliases, request_timeout=request_timeout
                )
            except TypeError as error:
                if "request_timeout" not in str(error):
                    raise
                result = await self.search_dle_post(domain, queries, identity_aliases)
            # Do not immediately fan out into generic GET routes for every alias.
            # The process already has an indexed fallback phase for still-empty
            # catalogs. Running both here multiplied each DLE miss by 2-4 requests.
        else:
            result = await self.generic_site_search(domain, queries, identity_aliases, compact=True)

        return self.merge_catalog_items([], result)

    async def search_catalog_aliases_async(
        self,
        domain: str,
        queries: list[str],
        identity_aliases: list[str],
        authority: AuthorityData,
        *,
        query_limit: int = 8,
    ) -> list[dict[str, str]]:
        """Search one catalog by several title variants concurrently.

        The outer process launches this method for every catalog at the same time.
        Inside a catalog, each useful alias is also searched concurrently; Core.request()
        keeps total network concurrency bounded by self.http_sem.
        """
        names = unique_strings(queries, limit=min(query_limit, 4))
        if not names:
            return []

        jobs = [
            asyncio.create_task(self.search_catalog_native(domain, [name], identity_aliases, authority))
            for name in names
        ]
        results = await asyncio.gather(*jobs, return_exceptions=True)
        merged: list[dict[str, str]] = []
        for result in results:
            if isinstance(result, Exception):
                continue
            merged = self.merge_catalog_items(merged, result)
        return merged

    async def google_catalog_fallback_async(
        self,
        domain: str,
        queries: list[str],
        identity_aliases: list[str],
        *,
        query_limit: int = 8,
    ) -> list[dict[str, str]]:
        """Run Google site: fallback for all useful aliases concurrently."""
        names = unique_strings(queries, limit=query_limit)
        if not names:
            return []
        # Reuse the proven single-query fallback, but launch each title variant in
        # parallel.  Subclasses/tests can still override google_catalog_fallback.
        groups = await asyncio.gather(*(
            self.google_catalog_fallback(domain, [name], identity_aliases) for name in names
        ), return_exceptions=True)
        merged: list[dict[str, str]] = []
        for group in groups:
            if isinstance(group, Exception):
                continue
            merged = self.merge_catalog_items(merged, group)
        return merged

    def catalog_item_key(self, url: str) -> str:
        url = compact_url(url)
        domain = self.source_catalog(url)
        if domain == "jut-su.net":
            try:
                parsed = urlparse(url)
                # jut-su can expose the same title through -z1/-t1/-l1 style tab URLs.
                # They are one anime entry, not separate titles.
                match = re.match(r"^/(\d+-[^/]+?)(?:-[zlt]\d+)\.html$", parsed.path, re.I)
                if match:
                    return f"jut-su.net:{match.group(1).casefold()}"
            except Exception:
                pass
        return url

    def catalog_url_preference(self, url: str) -> int:
        if self.source_catalog(url) == "jut-su.net":
            path = urlparse(url).path
            if re.search(r"-z\d+\.html$", path, re.I):
                return 3
            if not re.search(r"-[zlt]\d+\.html$", path, re.I):
                return 2
            return 1
        return 1

    def merge_catalog_items(self, left: list[dict[str, str]], right: list[dict[str, str]]) -> list[dict[str, str]]:
        unique: dict[str, dict[str, str]] = {}
        for item in [*left, *right]:
            url = compact_url(item.get("url", ""))
            if not url:
                continue
            title = clean_title(item.get("title")) or slug_title(url)
            if is_catalog_noise_title(title):
                continue
            if (
                self._season_family_mode
                and self._season_family_roots
                and not is_season_family_member(title, self._season_family_roots)
            ):
                continue
            value = {"url": url, "title": title}
            aliases = item.get("_aliases") if isinstance(item, dict) else None
            if isinstance(aliases, list):
                value["_aliases"] = unique_strings(aliases, limit=40)
            key = self.catalog_item_key(url)
            existing = unique.get(key)
            if not existing:
                unique[key] = value
                continue
            better_url = self.catalog_url_preference(url) > self.catalog_url_preference(existing["url"])
            better_title = len(value["title"]) > len(existing["title"]) and is_probable_title(value["title"])
            if better_url or better_title:
                merged_aliases = unique_strings([
                    *(existing.get("_aliases") or []), *(value.get("_aliases") or [])
                ], limit=40)
                if merged_aliases:
                    value["_aliases"] = merged_aliases
                unique[key] = value
            elif existing is not None:
                merged_aliases = unique_strings([
                    *(existing.get("_aliases") or []), *(value.get("_aliases") or [])
                ], limit=40)
                if merged_aliases:
                    existing["_aliases"] = merged_aliases
        return list(unique.values())[:30]

    def catalog_group(self, domain: str) -> str:
        return "UA" if domain in UA_SITES else "RU"

    def source_catalog(self, url: str | None) -> str | None:
        host = source_domain(url)
        if not host:
            return None
        return next((domain for domain in CATALOG_SITES if host_allowed(host, domain)), None)

    async def seed_source_catalog(self, payload: InputPayload) -> tuple[str | None, dict[str, str] | None, list[str], dict[str, Any]]:
        domain = self.source_catalog(payload.url)
        if not domain or not payload.url:
            return None, None, [], {}

        # AniHub and Mikai expose documented JSON APIs, so never parse their HTML
        # title pages just to recover names we can receive directly as structured data.
        try:
            path = urlparse(payload.url).path or ""
            if domain == "anihub.in.ua":
                match = re.search(r"-(\d+)/?$", path)
                anime_id = int(match.group(1)) if match else None
                api_item = await self.anihub_api_lookup(anime_id=anime_id) if anime_id else None
                if api_item:
                    item = self.anihub_item_to_catalog(api_item, payload.title)
                    aliases = unique_strings([
                        api_item.get("title_original"), api_item.get("title_english"),
                        api_item.get("title_ukrainian"), payload.title,
                    ], limit=8)
                    meta = {
                        "mal_id": api_item.get("mal_id"),
                        "anilist_id": api_item.get("anilist_id"),
                        "anihub_item": api_item,
                    }
                    return domain, item, aliases, meta
            elif domain == "mikai.me":
                match = re.search(r"^/anime/(\d+)", path)
                mikai_id = int(match.group(1)) if match else None
                api_item = await self.mikai_api_detail(mikai_id=mikai_id) if mikai_id else None
                if api_item:
                    item = self.mikai_item_to_catalog(api_item, payload.title)
                    titles = api_item.get("titles") or {}
                    aliases = unique_strings([titles.get("original"), titles.get("english"), titles.get("ua"), payload.title], limit=8)
                    ids = api_item.get("ids") or {}
                    meta = {
                        "mal_id": ids.get("mal") or ids.get("mal_id"),
                        "anilist_id": ids.get("anilist") or ids.get("anilist_id") or ids.get("al"),
                        "mikai_item": api_item,
                    }
                    return domain, item, aliases, meta
        except Exception:
            pass

        soup, final_url = await self.fetch_soup(payload.url)
        final_url = compact_url(final_url or payload.url)
        trusted_aliases = trusted_source_title_variants(domain, soup) if soup else []
        explicit_aliases = site_specific_title_variants(domain, soup) if soup else []
        if not is_catalog_title_url(domain, final_url):
            return domain, None, unique_strings([payload.title, *trusted_aliases], limit=16), {}

        # Keep search-driving aliases intentionally small and high-confidence.
        title = clean_title(payload.title)
        if soup:
            primary = page_primary_title(soup)
            if primary and not is_catalog_noise_title(primary):
                same_script = title_script(primary) == title_script(title)
                if not title or normalize_title(primary) == normalize_title(title) or (same_script and titles_related(primary, title, 0.62)):
                    title = primary
        source_aliases = unique_strings([*explicit_aliases, title, payload.title, *trusted_aliases], limit=8)
        item_aliases = unique_strings([*explicit_aliases, title, payload.title, *trusted_aliases], limit=12)
        return domain, {"url": final_url, "title": title or clean_title(payload.title), "_aliases": item_aliases}, source_aliases, {}

    async def send_callback(self, result: dict[str, Any]) -> dict[str, Any] | None:
        url = clean_text(os.getenv("RESULT_WEBHOOK_URL")) or DEFAULT_RESULT_WEBHOOK_URL
        headers = {"Content-Type": "application/json"}
        token = clean_text(os.getenv("RESULT_WEBHOOK_TOKEN"))
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = await self.request("POST", url, json=result, headers=headers)
            return {"status": response.status_code, "ok": response.status_code < 400}
        except Exception as error:
            return {"status": 0, "ok": False, "error": str(error)}

    async def process(
        self,
        payload: InputPayload,
        *,
        callback: bool = True,
        progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        """Build the complete schema-v2 payload.

        `progress` receives small JSON-serializable packets.  Catalog work stays
        concurrent, but each completed domain is reported immediately so browser
        clients can render real progress instead of waiting for one huge response.
        """
        started_at = time.perf_counter()
        last_percent = 0
        soft_deadline_seconds = 235.0
        # The website can forward its Turso-stored Mikai key in the internal
        # server-to-server payload. Old/local callers may omit it entirely.
        incoming_mikai_key = clean_text(getattr(payload, "mikai_api_key", "") or "")
        self.mikai_api_key = incoming_mikai_key if incoming_mikai_key.lower().startswith("mk_") else ""

        def elapsed_seconds() -> float:
            return time.perf_counter() - started_at

        def within_budget(reserve: float = 18.0) -> bool:
            return elapsed_seconds() < max(1.0, soft_deadline_seconds - reserve)

        async def emit(stage: str, percent: int, message: str, **extra: Any) -> None:
            nonlocal last_percent
            percent = max(last_percent, min(99, int(percent)))
            last_percent = percent
            if not progress:
                return
            packet: dict[str, Any] = {
                "type": "progress",
                "stage": stage,
                "percent": percent,
                "message": message,
                "elapsed_ms": int((time.perf_counter() - started_at) * 1000),
            }
            packet.update(extra)
            await progress(packet)

        async def catalog_job(
            domain: str,
            queries: list[str],
            aliases: list[str],
            authority: AuthorityData,
            *,
            priority_queries: Iterable[str] = (),
            query_limit: int = 8,
            secondary_timeout: float = 7.0,
        ) -> tuple[str, list[dict[str, str]], str, list[str]]:
            """Search one catalog in the exact user-defined order.

            Priority names are: Latin Original/Romaji -> English -> language of the
            catalog (UA or RU).  These names are *not* wrapped in a short asyncio
            timeout; they are allowed to finish using the HTTP transport timeout.
            Only after those priority names fail do we probe remaining aliases with
            ``secondary_timeout``.  This prevents a 6-second timer from killing the
            exact title search on slower DLE sites such as jut-su.net.
            """
            ordered = unique_strings(queries, limit=query_limit)
            priority_keys = {normalize_title(x) for x in priority_queries if normalize_title(x)}
            tried: list[str] = []

            async def call_native(query: str, timeout_value: float | None) -> list[dict[str, str]]:
                try:
                    return await self.search_catalog_native(
                        domain, [query], aliases, authority, request_timeout=timeout_value
                    )
                except TypeError as error:
                    # Backward-compatible with test subclasses / older adapters that
                    # override search_catalog_native without the new keyword.
                    if "request_timeout" not in str(error):
                        raise
                    return await self.search_catalog_native(domain, [query], aliases, authority)

            for query in ordered:
                tried.append(query)
                is_priority = normalize_title(query) in priority_keys
                try:
                    if is_priority:
                        result = await call_native(query, None)
                    else:
                        result = await asyncio.wait_for(
                            call_native(query, secondary_timeout),
                            timeout=secondary_timeout,
                        )
                except asyncio.TimeoutError:
                    # Timeout is intentionally only possible in the secondary alias
                    # phase.  Stop native probing and let the indexed fallback take over.
                    return domain, [], f"timeout {int(secondary_timeout)}s (інші назви)", tried
                except Exception as error:
                    return domain, [], clean_text(error), tried
                if result:
                    return domain, result, "", tried
                # If repeated access/rate-limit responses established that the
                # domain is blocked for this run, do not burn the remaining aliases.
                if self.domain_hard_blocked(domain):
                    return domain, [], "blocked after repeated HTTP 401/403/429", tried
            return domain, [], "", tried

        async def google_job(
            domain: str,
            queries: list[str],
            aliases: list[str],
            *,
            query_limit: int = 7,
            timeout: float = 12.0,
        ) -> tuple[str, list[dict[str, str]], str, list[str]]:
            ordered = unique_strings(queries, limit=query_limit)
            try:
                # google_catalog_fallback itself is sequential and stops on the
                # first verified query, preserving the same priority order.
                result = await asyncio.wait_for(
                    self.google_catalog_fallback(domain, ordered, aliases),
                    timeout=timeout,
                )
                return domain, result, "", ordered
            except asyncio.TimeoutError:
                return domain, [], f"timeout {int(timeout)}s", ordered
            except Exception as error:
                return domain, [], clean_text(error), ordered

        await emit("accepted", 1, "Запит прийнято. Починаю визначення тайтлу.")

        # Read the currently opened catalog page first.  Many localized catalogs
        # expose the real Romaji/original title in a small field near H1.  That
        # string is substantially more reliable than translating a UA/RU H1 to
        # English, so it participates in authority resolution immediately.
        await emit("source_identity", 3, "Отримую оригінальну/альтернативну назву з поточного джерела або його API.")
        source_seed = await self.seed_source_catalog(payload)
        source_meta: dict[str, Any] = {}
        if isinstance(source_seed, tuple) and len(source_seed) >= 3:
            source_catalog, source_item, source_aliases = source_seed[0], source_seed[1], source_seed[2]
            if len(source_seed) >= 4 and isinstance(source_seed[3], dict):
                source_meta = source_seed[3]
        else:
            source_catalog, source_item = source_seed  # backward-compatible subclass/test hook
            source_aliases = []
        if source_aliases:
            await emit(
                "source_identity",
                6,
                f"Зі сторінки отримано {len(source_aliases)} варіантів назви.",
                aliases=source_aliases[:12],
                domain=source_catalog or "",
            )

        await emit("identity", 7, "Визначаю canonical ID, назви та медіа.")
        try:
            authority = await self.resolve_authorities(
                payload,
                extra_queries=source_aliases,
                mal_id_hint=source_meta.get("mal_id"),
                anilist_id_hint=source_meta.get("anilist_id"),
            )
        except TypeError as error:
            message = str(error)
            if not any(key in message for key in ("extra_queries", "mal_id_hint", "anilist_id_hint")):
                raise
            try:
                authority = await self.resolve_authorities(payload, extra_queries=source_aliases)
            except TypeError as legacy_error:
                if "extra_queries" not in str(legacy_error):
                    raise
                authority = await self.resolve_authorities(payload)

        # In this project "original" means the useful Latin/Romaji title, not
        # native CJK script.  The exact Latin line exposed by the opened source
        # page has first priority (AniHub: h1 + p.text-sm.text-gray-400.mb-1).
        source_latin = next((clean_title(x) for x in source_aliases if title_script(x) == "latin"), "")
        authority_romaji = clean_title(authority.original) if title_script(authority.original) == "latin" else ""
        english = clean_title(authority.english)
        romanized = clean_title(
            source_latin
            or authority_romaji
            or (english if title_script(english) == "latin" else "")
            or (payload.title if title_script(payload.title) == "latin" else "")
        )
        # Native CJK remains useful as a late alias, but is never written to
        # title.original and never outranks the Latin original during search.
        native_original = clean_title(authority.native)
        self.log(
            f"Назва: input={clean_title(payload.title)!r}; native={native_original!r}; "
            f"romaji={romanized!r}; english={english!r}; source_aliases={source_aliases[:8]!r}"
        )
        await emit(
            "identity",
            12,
            "Тайтл визначено. Готую паралельний пошук каталогів.",
            anilist_id=authority.anilist_id,
            mal_id=authority.mal_id,
            native=native_original,
            romaji=romanized,
            source_aliases=source_aliases[:12],
        )

        # API-first localization. AniHub and Mikai both expose structured title
        # data, so resolve them once by canonical IDs before touching localized
        # catalog HTML. Besides the UA name this can provide a native UA description
        # and lets us pre-seed both catalog links without any page parsing.
        anihub_exact: dict[str, Any] | None = source_meta.get("anihub_item") if isinstance(source_meta.get("anihub_item"), dict) else None
        mikai_exact: dict[str, Any] | None = source_meta.get("mikai_item") if isinstance(source_meta.get("mikai_item"), dict) else None
        if authority.mal_id or authority.anilist_id:
            pending_api: list[tuple[str, asyncio.Task]] = []
            if not anihub_exact:
                pending_api.append(("anihub", asyncio.create_task(
                    self.anihub_api_lookup(mal_id=authority.mal_id, anilist_id=authority.anilist_id)
                )))
            if not mikai_exact:
                pending_api.append(("mikai", asyncio.create_task(
                    self.mikai_api_detail(mal_id=authority.mal_id, anilist_id=authority.anilist_id)
                )))
            for api_name, task in pending_api:
                value = await task
                if api_name == "anihub":
                    anihub_exact = value
                else:
                    mikai_exact = value

        mikai_titles = (mikai_exact or {}).get("titles") or {}
        api_ua_title = clean_title(
            (anihub_exact or {}).get("title_ukrainian")
            or mikai_titles.get("ua")
        )
        api_description_uk = clean_text(
            (mikai_exact or {}).get("description")
            or (anihub_exact or {}).get("description")
        )
        api_identity_aliases = unique_strings([
            (anihub_exact or {}).get("title_original"),
            (anihub_exact or {}).get("title_english"),
            (anihub_exact or {}).get("title_ukrainian"),
            mikai_titles.get("original"), mikai_titles.get("english"), mikai_titles.get("ua"),
        ], limit=10)

        # Franchise search must also work when the website starts from the base
        # season on MAL/AniList/Shikimori.  Older 2.21.0 logic only enabled the
        # season-family mode when an explicit Season N>1 marker was already
        # present, so the normal site flow (which usually selects season 1 from
        # an authority source) could save only a handful of exact season-1 links.
        pre_family_inputs = unique_strings([
            payload.title, native_original, romanized, english, authority.russian,
            *source_aliases, *api_identity_aliases,
        ], limit=30)
        detected_seasons = [season_number(value) for value in pre_family_inputs]
        detected_seasons = [number for number in detected_seasons if number is not None]
        source_season_number = max(detected_seasons) if detected_seasons else None
        authority_host = source_domain(payload.url)
        authority_family_seed = any(host_allowed(authority_host, domain) for domain in AUTHORITY_SITES)
        season_family_expansion = bool(source_season_number and source_season_number > 1) or authority_family_seed
        preliminary_family_roots = season_family_roots(pre_family_inputs, limit=12)
        if season_family_expansion and not preliminary_family_roots:
            # An unnumbered/base title is itself the franchise root.  Keep several
            # language variants so each catalog still receives a native query.
            preliminary_family_roots = unique_strings([
                season_family_title(value)
                for value in pre_family_inputs
                if clean_title(value)
                and not _SEASON_FAMILY_EXTRA_RE.search(clean_title(value))
                and not is_catalog_noise_title(value)
            ], limit=12)
        if authority_family_seed and source_season_number is None:
            source_season_number = 1
        self._season_family_mode = season_family_expansion
        self._season_family_roots = list(preliminary_family_roots)

        # Mikai family search is the same single request we previously issued later
        # inside phase 1. Move it before catalog fan-out so season/part aliases are
        # trusted by every other adapter from the first query. The exact Mikai detail
        # request above is served from the per-run HTTP cache inside search_mikai().
        mikai_family_items: list[dict[str, str]] = []
        mikai_ua_root = season_family_title(clean_title(mikai_titles.get("ua"))) if season_family_expansion else ""
        mikai_original_root = season_family_title(clean_title(mikai_titles.get("original"))) if season_family_expansion else ""
        mikai_family_query = (
            mikai_ua_root
            or mikai_original_root
            or next((root for root in preliminary_family_roots if re.search(r"[іїєґ]", root, re.I)), "")
            or next((root for root in preliminary_family_roots if re.search(r"[а-яё]", root, re.I)), "")
            or next((root for root in preliminary_family_roots if title_script(root) == "latin"), "")
            or api_ua_title or clean_title(authority.russian) or romanized or english
        )
        if mikai_family_query and (authority.mal_id or authority.anilist_id):
            preliminary_identity = unique_strings([
                *preliminary_family_roots, *api_identity_aliases, authority.russian, romanized, english, native_original, payload.title,
            ], limit=32)
            try:
                mikai_family_items = await self.search_mikai(
                    [mikai_family_query], preliminary_identity, authority.mal_id, authority.anilist_id
                )
            except Exception:
                mikai_family_items = []
            family_aliases: list[str] = []
            for item in mikai_family_items:
                family_aliases.append(item.get("title", ""))
                aliases = item.get("_aliases") if isinstance(item, dict) else None
                if isinstance(aliases, list):
                    family_aliases.extend(aliases[:8])
            api_identity_aliases = unique_strings([*api_identity_aliases, *family_aliases], limit=24)

        if api_ua_title:
            await emit(
                "localized_api", 13,
                "Українську назву отримано через API AniHub/Mikai без HTML-парсингу.",
                ukrainian=api_ua_title,
            )

        # The title directly exposed by the source page (AniHub: H1 + the
        # adjacent p.text-sm.text-gray-400.mb-1) is the highest-confidence search
        # key.  This is the "original" requested by the workflow, even when it is
        # Romaji rather than native CJK script.
        source_originals = [
            name for name in source_aliases
            if normalize_title(name) != normalize_title(payload.title)
            and title_script(name) == "latin"
        ]
        source_original = clean_title(source_originals[0] if source_originals else "")
        search_original = source_original or romanized or (english if title_script(english) == "latin" else "")
        if not search_original:
            # Last-resort Latin value. This can be an English transliteration when
            # a catalog exposes no Romaji field, but never deliberately chooses CJK.
            try:
                translated_latin = clean_title(await self.translate_en(payload.title))
            except Exception:
                translated_latin = ""
            search_original = translated_latin if title_script(translated_latin) == "latin" else clean_title(payload.title)
        romanized = search_original

        # Determine localized names BEFORE catalog search.  They are third in the
        # per-domain priority chain, never used ahead of original/English.
        canonical_names = unique_strings([search_original, romanized, english, native_original], limit=8)
        ua_title = ""
        ru_title = ""
        if source_catalog in UA_SITES and re.search(r"[А-Яа-яІіЇїЄєҐґ]", payload.title or ""):
            ua_title = clean_title(payload.title)
        if source_catalog in RU_SITES and re.search(r"[А-Яа-яЁё]", payload.title or ""):
            ru_title = clean_title(payload.title)

        # Authority aliases belong to the selected media only (family/sequel hits
        # are deliberately excluded above).  Shikimori usually supplies the RU
        # title here, so prefer it over machine translation.
        if not ru_title:
            ru_title = clean_title(authority.russian) or choose_localized_title("RU", authority.aliases, canonical_names)
        if not ua_title:
            ua_title = api_ua_title or choose_localized_title("UA", api_identity_aliases, canonical_names)

        async def quick_translate(coro: Awaitable[str]) -> str:
            try:
                return clean_title(await asyncio.wait_for(coro, timeout=6.0))
            except Exception:
                return ""

        translation_base = english or romanized or search_original or native_original or clean_title(payload.title)
        missing_jobs: list[tuple[str, asyncio.Task[str]]] = []
        if not ua_title and translation_base:
            missing_jobs.append(("ua", asyncio.create_task(quick_translate(self.translate_uk(translation_base)))))
        if not ru_title and translation_base:
            missing_jobs.append(("ru", asyncio.create_task(quick_translate(self.translate_ru(translation_base)))))
        for lang, task in missing_jobs:
            value = await task
            if lang == "ua" and value:
                ua_title = value
            elif lang == "ru" and value:
                ru_title = value

        # Rebuild family roots after localized titles are known.  For a request
        # that starts on season N>1 these roots become the primary catalog queries,
        # so a single search can return season 1..N and any later indexed seasons.
        family_inputs = unique_strings([
            search_original, romanized, english, native_original, ua_title, ru_title,
            payload.title, *source_aliases, *api_identity_aliases, *preliminary_family_roots,
        ], limit=40)
        if not season_family_expansion:
            numbers = [season_number(value) for value in family_inputs]
            numbers = [number for number in numbers if number is not None]
            source_season_number = max(numbers) if numbers else source_season_number
            season_family_expansion = bool(source_season_number and source_season_number > 1)
        family_roots = season_family_roots(family_inputs, limit=16) if season_family_expansion else []
        if season_family_expansion:
            # Authority-started base seasons (MAL/AniList/Shikimori) often have no
            # explicit season marker in the selected title.  ``season_family_roots``
            # therefore used to keep only Latin roots discovered from sequel aliases,
            # while the already-known UA/RU translations were missing.  The verifier
            # then rejected perfectly valid localized catalog cards before title
            # matching because they were not members of the Latin-only family.
            #
            # Canonical localized/base names are trusted identity data, so always add
            # their season-free forms to the family root set.  Do not do this for
            # arbitrary discovered catalog strings.
            canonical_base_roots = [
                season_family_title(value)
                for value in [search_original, romanized, english, native_original, ua_title, ru_title, *preliminary_family_roots]
                if clean_title(value)
                and not _SEASON_FAMILY_EXTRA_RE.search(clean_title(value))
                and not is_catalog_noise_title(value)
            ]
            family_roots = unique_strings([*family_roots, *canonical_base_roots], limit=16)
        if season_family_expansion and not family_roots:
            family_roots = unique_strings([
                season_family_title(value)
                for value in [*preliminary_family_roots, search_original, romanized, english, native_original, ua_title, ru_title]
                if clean_title(value)
                and not _SEASON_FAMILY_EXTRA_RE.search(clean_title(value))
                and not is_catalog_noise_title(value)
            ], limit=16)
        self._season_family_mode = season_family_expansion
        self._season_family_roots = list(family_roots)

        # One bounded AniList family search gives us canonical season names even
        # when the starting item is season 4.  Keep only TV entries that are an
        # exact/base-or-season match of the derived franchise root, so movies/OVAs
        # and unrelated spin-offs do not enter the catalog search aliases.
        anilist_family_aliases: list[str] = []
        if season_family_expansion:
            latin_family_seed = next((root for root in family_roots if title_script(root) == "latin"), "")
            if latin_family_seed:
                try:
                    family_media = await self.anilist_search(latin_family_seed)
                except Exception:
                    family_media = []
                for media in family_media[:10]:
                    media_format = clean_text(media.get("format")).upper()
                    if media_format and media_format not in {"TV", "TV_SHORT"}:
                        continue
                    names = self.media_names(media)
                    if not any(title_match_kind(name, family_roots) for name in names):
                        continue
                    anilist_family_aliases.extend(names[:8])
                anilist_family_aliases = unique_strings(anilist_family_aliases, limit=30)

        def family_root_for(value: str, *, script: str = "") -> str:
            value = clean_title(value)
            if value and (season_number(value) is not None or re.search(r"第\s*\d{1,2}\s*期", value)):
                root = season_family_title(value)
                if root:
                    return root
            if script:
                return next((root for root in family_roots if title_script(root) == script), "")
            return ""

        ua_family_root = family_root_for(ua_title) or next((
            root for root in family_roots if re.search(r"[іїєґ]", root, re.I)
        ), "")
        ru_family_root = family_root_for(ru_title) or next((
            root for root in family_roots if re.search(r"[а-яё]", root, re.I) and not re.search(r"[іїєґ]", root, re.I)
        ), "")
        original_family_root = family_root_for(search_original, script="latin")
        english_family_root = family_root_for(english, script="latin")

        await emit(
            "localized_titles", 14,
            "Порядок пошуку підготовлено: мова каталогу → franchise root → Original/English → інші назви." if season_family_expansion else "Порядок пошуку підготовлено: Original → English → мова каталогу → інші назви.",
            original=search_original, english=english, ukrainian=ua_title, russian=ru_title,
            source_season=source_season_number, family_roots=family_roots[:8],
        )

        # Only exact-media aliases are allowed to drive searches.  The old family
        # enrichment added sequel/arc names such as Faceless Arc and 2nd Season,
        # which both polluted Notion aliases and multiplied catalog requests.
        canonical_search_aliases = unique_strings([
            *(family_roots if season_family_expansion else []),
            *anilist_family_aliases,
            search_original, romanized, english, native_original, ua_title, ru_title,
            *api_identity_aliases, payload.title,
        ], limit=50)

        def searchworthy_alias(value: str) -> bool:
            if not is_probable_title(value) or is_catalog_noise_title(value):
                return False
            if any(normalize_title(value) == normalize_title(base) for base in canonical_search_aliases):
                return True
            # Keep season/part variants and close lexical aliases; reject unrelated
            # card metadata and SEO strings discovered deep in catalog pages.
            if title_match_kind(value, canonical_search_aliases):
                return True
            return max(
                (title_relation_score(value, base) for base in canonical_search_aliases if base),
                default=0.0,
            ) >= 0.72

        trusted_identity_aliases = unique_strings([
            *canonical_search_aliases, *source_aliases, *authority.aliases,
        ], limit=60)
        identity_aliases = [value for value in trusted_identity_aliases if searchworthy_alias(value)]

        # AniHub exact lookup identifies the current season only.  When the user
        # starts from season N>1, add one root search so AniHub can contribute all
        # indexed seasons, not just N.  The same family-root logic is already used
        # by Mikai above.
        anihub_family_items: list[dict[str, str]] = []
        if season_family_expansion and (ua_family_root or original_family_root or english_family_root):
            try:
                anihub_family_items = await self.search_anihub_family(
                    [ua_family_root or original_family_root or english_family_root], identity_aliases
                )
            except Exception:
                anihub_family_items = []

        def catalog_priority_plan(domain: str) -> list[str]:
            local = ua_title if domain in UA_SITES else ru_title
            local_root = ua_family_root if domain in UA_SITES else ru_family_root
            if season_family_expansion:
                # A season-free query is intentional here: catalog search pages
                # usually return the whole franchise, so starting from season 4
                # can still discover seasons 1/2/3 and later seasons in one request.
                if domain in UA_SITES or (domain in RU_SITES and domain != "crunchyroll.com"):
                    return unique_strings([local_root, local, original_family_root or search_original, english_family_root or english], limit=4)
                return unique_strings([original_family_root or search_original, english_family_root or english, local_root, local], limit=4)
            # Localized catalogs are most likely to index the localized title. Once
            # AniHub/Mikai/Shikimori have supplied it, try that first and avoid two
            # predictable misses on Romaji/English. Crunchyroll remains Latin-first.
            if domain in UA_SITES or (domain in RU_SITES and domain != "crunchyroll.com"):
                return unique_strings([local, search_original, english], limit=3)
            return unique_strings([search_original, english, local], limit=3)

        def catalog_query_plan(domain: str, extra: Iterable[str] = ()) -> list[str]:
            priority = catalog_priority_plan(domain)
            # Only after the priority trio has failed may native CJK / alternate
            # aliases be tried, and these secondary names use a short timeout.
            remaining = [
                value for value in [
                    romanized, payload.title, native_original,
                    *source_aliases, *authority.aliases, *extra,
                ]
                if searchworthy_alias(value)
            ]
            return unique_strings([*priority, *remaining], limit=4)

        catalogs: dict[str, list[dict[str, Any]]] = {site: [] for site in CATALOG_SITES}
        timed_out_domains: set[str] = set()
        tried_by_domain: dict[str, list[str]] = {site: [] for site in CATALOG_SITES}
        if source_catalog and source_item:
            catalogs[source_catalog] = [source_item]
            await emit(
                "source",
                15,
                f"Поточну сторінку додано як джерело: {source_catalog}.",
                domain=source_catalog,
                found=1,
            )

        # Authority resolution already confirmed Shikimori by MAL ID. Reuse the
        # canonical link instead of doing another Shikimori catalog search.
        if authority.mal_id and authority.links.get("shikimori.io"):
            shiki_link = authority.links["shikimori.io"][0]
            catalogs["shikimori.io"] = [{
                "url": compact_url(shiki_link.get("url", "")),
                "title": ru_title or clean_title(shiki_link.get("title", "")) or romanized,
                "match": "exact",
            }]

        # Exact API lookups can pre-seed AniHub/Mikai even when the input came from
        # another catalog. This removes their search work from phase 1 entirely.
        if anihub_exact:
            api_item = self.anihub_item_to_catalog(anihub_exact, ua_title or search_original)
            if api_item:
                catalogs["anihub.in.ua"] = self.merge_catalog_items(catalogs["anihub.in.ua"], [api_item])
        if anihub_family_items:
            catalogs["anihub.in.ua"] = self.merge_catalog_items(catalogs["anihub.in.ua"], anihub_family_items)
        if mikai_family_items:
            catalogs["mikai.me"] = self.merge_catalog_items(catalogs["mikai.me"], mikai_family_items)
        elif mikai_exact:
            api_item = self.mikai_item_to_catalog(mikai_exact, ua_title or search_original)
            if api_item:
                catalogs["mikai.me"] = self.merge_catalog_items(catalogs["mikai.me"], [api_item])

        # PHASE 1 — all still-empty catalogs run concurrently, but each catalog
        # checks its title variants sequentially. Mikai family data was resolved
        # before fan-out, so it does not need a second adapter task here.
        phase1_domains = [
            domain for domain in CATALOG_SITES
            if (
                not catalogs[domain]
                or (
                    season_family_expansion
                    and domain == source_catalog
                    and domain not in {"anihub.in.ua", "mikai.me", "shikimori.io"}
                )
            )
        ]
        phase1_tasks = [
            asyncio.create_task(
                catalog_job(
                    domain,
                    catalog_query_plan(domain),
                    identity_aliases,
                    authority,
                    priority_queries=catalog_priority_plan(domain),
                    query_limit=(3 if domain in {"ru.yummyani.me", "jut.su", "anilibria.tv", "uaserials.com", "amanogawa.space", "anidesu.net"} else 4),
                    secondary_timeout=6.0,
                )
            )
            for domain in phase1_domains
        ]
        completed = 0
        total = max(1, len(phase1_tasks))
        await emit("catalogs_primary", 16, f"Послідовний пошук по каталогах: 0/{len(phase1_tasks)}.")
        for task in asyncio.as_completed(phase1_tasks):
            domain, result, error, tried = await task
            tried_by_domain[domain] = tried
            completed += 1
            if error.startswith("timeout"):
                timed_out_domains.add(domain)
            if result:
                catalogs[domain] = self.merge_catalog_items(catalogs[domain], result)
            pct = 16 + round((completed / total) * 46)
            tried_label = " → ".join(tried[:4])
            state = f"знайдено {len(catalogs[domain])}" if catalogs[domain] else (f"{error} → fallback" if error else "без збігів")
            await emit(
                "catalogs_primary",
                pct,
                f"{domain}: {state} · {completed}/{len(phase1_tasks)}.",
                domain=domain,
                completed=completed,
                total=len(phase1_tasks),
                found=len(catalogs[domain]),
                error=error,
                tried=tried,
                order=tried_label,
            )

        def collect_verified_aliases() -> list[str]:
            values: list[str] = [*identity_aliases]
            for items in catalogs.values():
                for item in items:
                    values.append(item.get("title", ""))
                    aliases = item.get("_aliases") if isinstance(item, dict) else None
                    if isinstance(aliases, list):
                        values.extend(aliases[:6])
            return [
                value for value in unique_strings(values, limit=60)
                if searchworthy_alias(value)
            ]

        # PHASE 2 — targeted replay. New localized base names are sent only to
        # empty catalogs of the same language group. New season/part titles are
        # also sent to catalogs that found season 1 but do not yet cover that
        # season. This keeps completeness (e.g. AnimeGO season 2) without replaying
        # every alias across every domain.
        initial_keys = {normalize_title(v) for v in identity_aliases if normalize_title(v)}
        discovered_by_group: dict[str, list[str]] = {"UA": [], "RU": []}
        season_by_group: dict[str, list[str]] = {"UA": [], "RU": []}

        # In family mode build an explicit contiguous season grid.  Season 1 is
        # often stored as the bare franchise title, so relying only on discovered
        # ``2 сезон`` / ``3 сезон`` aliases can leave a partially-filled catalog
        # without season 1.  Starting from season 4 therefore means 1..4; if APIs
        # already exposed season 5, the grid naturally becomes 1..5.
        if season_family_expansion:
            known_numbers = [source_season_number or 1]
            for value in [*identity_aliases, *anilist_family_aliases, *api_identity_aliases]:
                number = season_number(value)
                if number is not None:
                    known_numbers.append(number)
            max_known_season = max(known_numbers) if known_numbers else (source_season_number or 1)
            max_known_season = min(max(1, max_known_season), 12)
            if ua_family_root:
                season_by_group["UA"].extend(
                    clean_title(f"{ua_family_root} ({number} сезон)")
                    for number in range(1, max_known_season + 1)
                )
            if ru_family_root:
                season_by_group["RU"].extend(
                    clean_title(f"{ru_family_root} {number} сезон")
                    for number in range(1, max_known_season + 1)
                )

        def compact_replay_alias(group: str, value: str) -> str:
            """Turn noisy catalog display titles into one stable replay query.

            Example: AnimeVost may expose
            "... (второй сезон) / Romaji 2 [1-12 из 12]". Sending that whole
            display string to every other catalog is slow and brittle. If we can
            identify the season, replay the trusted localized base + season number.
            """
            value = clean_title(value)
            # Display titles such as "RU / Romaji [1-12 из 12]" are useful in
            # results but waste requests when replayed verbatim across catalogs.
            # Keep only the localized half before season normalization.
            if " / " in value and re.search(r"\[\s*\d+\s*-\s*\d+\s+(?:из|з|of)\s+\d+\s*\]", value, re.I):
                value = clean_title(value.split(" / ", 1)[0])
            number = season_number(value)
            if number is not None:
                if group == "UA":
                    base = ua_family_root or season_family_title(ua_title) or ua_title
                else:
                    base = ru_family_root or season_family_title(ru_title) or ru_title
                if base:
                    if number == 1:
                        return clean_title(base)
                    return clean_title(f"{base} ({number} сезон)" if group == "UA" else f"{base} {number} сезон")
            return value

        for source_domain_name, items in catalogs.items():
            group = self.catalog_group(source_domain_name)
            for item in items:
                values = [item.get("title", "")]
                aliases = item.get("_aliases") if isinstance(item, dict) else None
                if isinstance(aliases, list):
                    values.extend(aliases[:8])
                for value in values:
                    if (
                        searchworthy_alias(value)
                        and normalize_title(value)
                        and normalize_title(value) not in initial_keys
                    ):
                        compact_value = compact_replay_alias(group, value)
                        if compact_value:
                            discovered_by_group[group].append(compact_value)
                        if season_number(value) is not None or SEASON_RE.search(value):
                            season_value = compact_replay_alias(group, value)
                            if season_value:
                                season_by_group[group].append(season_value)
        if season_family_expansion:
            for group in ("UA", "RU"):
                observed = [season_number(value) for value in season_by_group[group]]
                observed = [number for number in observed if number is not None]
                if not observed:
                    continue
                upper = min(max(observed), 12)
                base = ua_family_root if group == "UA" else ru_family_root
                if base:
                    grid = [
                        clean_title(f"{base} ({number} сезон)" if group == "UA" else f"{base} {number} сезон")
                        for number in range(1, upper + 1)
                    ]
                    season_by_group[group] = unique_strings([*grid, *season_by_group[group]], limit=16)

        discovered_limit = 8 if season_family_expansion else 3
        season_limit = 12 if season_family_expansion else 3
        discovered_by_group = {group: unique_strings(values, limit=discovered_limit) for group, values in discovered_by_group.items()}
        season_by_group = {group: unique_strings(values, limit=season_limit) for group, values in season_by_group.items()}
        replay_aliases = unique_strings([*discovered_by_group["UA"], *discovered_by_group["RU"]], limit=6)
        alias_replay_rounds = 0
        replay_plan: dict[str, list[str]] = {}
        for domain in CATALOG_SITES:
            if domain in timed_out_domains or domain in self._dead_search_domains or self.domain_hard_blocked(domain) or domain in {"anihub.in.ua", "mikai.me", "shikimori.io"}:
                continue
            group = self.catalog_group(domain)
            already_tried = {normalize_title(x) for x in tried_by_domain.get(domain, [])}
            pending: list[str] = []
            if not catalogs[domain]:
                # A completely empty catalog needs the explicit localized season grid
                # too.  Previously only newly *discovered* aliases were replayed here.
                # When UA/RU names were already known before phase 1, they were not
                # considered new aliases, so the second scan was silently skipped for
                # the very catalogs that needed it most.
                pending.extend(discovered_by_group[group])
                pending.extend(season_by_group[group])
            else:
                existing_titles = [clean_title(item.get("title", "")) for item in catalogs[domain]]
                for season_alias in season_by_group[group]:
                    if not catalog_titles_cover_alias(existing_titles, season_alias):
                        pending.append(season_alias)
            replay_limit = 8 if season_family_expansion else 2
            pending = [x for x in unique_strings(pending, limit=replay_limit) if normalize_title(x) not in already_tried]
            if pending:
                replay_plan[domain] = pending

        replay_domains = list(replay_plan)
        if replay_domains and within_budget(35.0):
            alias_replay_rounds = 1
            replay_visible_aliases = unique_strings([
                *replay_aliases,
                *(alias for domain in replay_domains for alias in replay_plan.get(domain, [])),
            ], limit=16)
            await emit(
                "catalogs_alias_replay", 64,
                f"Повторний пошук локалізованих/сезонних назв: {len(replay_domains)} каталогів.",
                aliases=replay_visible_aliases,
            )
            replay_tasks = []
            for domain in replay_domains:
                pending = replay_plan[domain]
                replay_tasks.append(asyncio.create_task(
                    catalog_job(
                        domain, pending, unique_strings([*identity_aliases, *replay_aliases], limit=50), authority,
                        priority_queries=(), query_limit=(8 if season_family_expansion else 2), secondary_timeout=5.0,
                    )
                ))
            completed = 0
            total = max(1, len(replay_tasks))
            for task in asyncio.as_completed(replay_tasks):
                domain, result, error, tried = await task
                tried_by_domain[domain] = unique_strings([*tried_by_domain.get(domain, []), *tried], limit=10)
                completed += 1
                if error.startswith("timeout"):
                    timed_out_domains.add(domain)
                if result:
                    catalogs[domain] = self.merge_catalog_items(catalogs[domain], result)
                pct = 64 + round((completed / total) * 5)
                await emit(
                    "catalogs_alias_replay", pct,
                    f"{domain}: точковий повтор {completed}/{len(replay_tasks)}" + (f" · {error}" if error else "") + ".",
                    domain=domain, found=len(catalogs[domain]), error=error, tried=tried,
                )

        # PHASE 3 — web-index fallback only for catalogs still empty.  It uses the
        # SAME strict per-domain order and stops on the first verified result.
        final_identity_aliases = collect_verified_aliases()
        all_identity = unique_strings([*identity_aliases, *final_identity_aliases], limit=70)
        fallback_specs = [
            (domain, catalog_query_plan(domain, final_identity_aliases))
            for domain in CATALOG_SITES
            if not catalogs[domain] and domain not in self._dead_search_domains and domain not in {"anihub.in.ua", "mikai.me"}
        ]
        fallback_tasks = [
            asyncio.create_task(google_job(
                domain, queries, all_identity,
                query_limit=(1 if season_family_expansion else 3), timeout=10.0,
            ))
            for domain, queries in fallback_specs
        ]
        completed = 0
        total = max(1, len(fallback_tasks))
        if fallback_tasks:
            await emit("catalogs_fallback", 72, f"Fallback лише для порожніх каталогів: 0/{len(fallback_tasks)}.")
        for task in asyncio.as_completed(fallback_tasks):
            domain, result, error, tried = await task
            completed += 1
            if result:
                catalogs[domain] = self.merge_catalog_items(catalogs[domain], result)
            pct = 72 + round((completed / total) * 17)
            await emit(
                "catalogs_fallback", pct,
                f"{domain}: fallback {completed}/{len(fallback_tasks)}" + (f" · {error}" if error else "") + ".",
                domain=domain, completed=completed, total=len(fallback_tasks),
                found=len(catalogs[domain]), error=error, tried=tried,
            )

        # Localized fields for output are already known before search; verified
        # catalog titles may refine them, but never affect the query priority retroactively.
        ru_candidates = [item.get("title", "") for d, items in catalogs.items() if d in RU_SITES for item in items]
        ua_candidates = [item.get("title", "") for d, items in catalogs.items() if d in UA_SITES for item in items]
        refined_identity = collect_verified_aliases()
        # When processing season N>1, the selected media must remain season N even
        # though catalog expansion now finds the whole franchise.  Do not let a
        # season-1/base catalog title replace the localized title of the input item.
        if not season_family_expansion:
            ru_title = choose_localized_title("RU", ru_candidates, refined_identity) or ru_title
            ua_title = choose_localized_title("UA", ua_candidates, refined_identity) or ua_title
        final_identity_aliases = refined_identity

        self.log("Пошук завершено: " + ", ".join(f"{d}={len(v)}" for d, v in catalogs.items() if v))
        await emit(
            "catalogs_done",
            90,
            "Пошук каталогів завершено. Формую фінальні поля.",
            result_counts={site: len(catalogs.get(site, [])) for site in CATALOG_SITES},
        )

        async def safe_translation(coro: Awaitable[str], fallback: str) -> str:
            try:
                return await asyncio.wait_for(coro, timeout=8.0)
            except Exception:
                return fallback

        description_task = asyncio.create_task(
            asyncio.sleep(0, result=api_description_uk)
            if api_description_uk else safe_translation(self.translate_uk(authority.description), clean_text(authority.description))
        )
        title_uk_task = asyncio.create_task(
            asyncio.sleep(0, result=ua_title)
            if ua_title else safe_translation(self.translate_uk(romanized or native_original or payload.title), clean_title(payload.title))
        )
        title_ru_task = asyncio.create_task(
            asyncio.sleep(0, result=ru_title)
            if ru_title else safe_translation(self.translate_ru(romanized or native_original or payload.title), romanized or native_original)
        )
        description_uk, final_uk, final_ru = await asyncio.gather(
            description_task, title_uk_task, title_ru_task
        )
        final_uk = clean_title(final_uk)
        final_ru = clean_title(final_ru)
        await emit("finalize", 95, "Назви та опис готові. Збираю JSON schema v2.")

        output_aliases = [
            value for value in unique_strings([
                native_original, romanized, english, final_uk, final_ru,
                *source_aliases, *final_identity_aliases, *authority.aliases,
            ], limit=80)
            if (
                is_probable_title(value)
                and not is_catalog_noise_title(value)
                and not re.search(r"\[\s*\d+\s*-\s*\d+\s+(?:из|з|of)\s+\d+\s*\]", value, re.I)
                and (not season_family_expansion or not _SEASON_FAMILY_EXTRA_RE.search(value))
            )
        ]

        public_catalogs = {
            site: [
                {"url": compact_url(item.get("url", "")), "title": clean_title(item.get("title", ""))}
                for item in catalogs.get(site, []) if compact_url(item.get("url", ""))
            ]
            for site in CATALOG_SITES
        }
        internal_result_counts = {site: len(catalogs.get(site, [])) for site in CATALOG_SITES}
        public_result_counts = {site: len(public_catalogs.get(site, [])) for site in CATALOG_SITES}

        result: dict[str, Any] = {
            "schema_version": 3,
            "input": {
                "title": clean_title(payload.title),
                "url": clean_text(payload.url),
                "status": clean_text(payload.status),
                "group": clean_text(payload.group),
            },
            "title": {
                "original": romanized,
                "romaji": romanized,
                "english": english,
                "ukrainian": final_uk or clean_title(payload.title),
                "russian": final_ru,
                "aliases": output_aliases,
            },
            "description_uk": description_uk,
            "cover": {
                "url": authority.cover,
                "source": authority.cover_source,
            },
            "banner": {
                "url": authority.banner,
                "source": "anilist.co" if authority.banner else "",
            },
            "trailer": {
                "url": authority.trailer_url or media_trailer_url(authority.trailer_site, authority.trailer_id),
                "embed_url": authority.trailer_embed_url or media_trailer_embed_url(authority.trailer_site, authority.trailer_id),
                "site": authority.trailer_site,
                "id": authority.trailer_id,
                "thumbnail": authority.trailer_thumbnail,
                "source": authority.trailer_source,
            },
            "authority": authority.links,
            "genres": self.taxonomy_payload(authority.genres, ["myanimelist.net", "shikimori.io", "anilist.co"]),
            "themes": self.taxonomy_payload(authority.themes, ["myanimelist.net", "shikimori.io"]),
            "catalogs": public_catalogs,
            "status": clean_text(payload.status),
            "group": clean_text(payload.group),
            "meta": {
                "core_version": APP_VERSION,
                "anilist_id": authority.anilist_id,
                "mal_id": authority.mal_id,
                "source_catalog": source_catalog or "",
                "search_strategy": {
                    "authority": "canonical MAL/AniList/Shikimori identity with API-first UA enrichment",
                    "catalogs": "AniHub/Mikai API first; season-family root expansion from any starting season; localized catalog title -> Romaji -> English; targeted same-language alias replay; bounded Google fallback",
                },
                "catalog_search": {
                    "async": True,
                    "domains": len(CATALOG_SITES),
                    "query_names": unique_strings([*family_roots, search_original, english, ua_title, ru_title, native_original], limit=16),
                    "query_order": "season_family_root -> catalog_language -> original -> english -> other_exact_aliases" if season_family_expansion else "catalog_language -> original -> english -> other_exact_aliases (Crunchyroll stays Latin-first)",
                    "source_season": source_season_number,
                    "season_family_expansion": season_family_expansion,
                    "family_roots": family_roots,
                    "source_aliases": source_aliases,
                    "discovered_aliases": final_identity_aliases,
                    "alias_replay_rounds": alias_replay_rounds,
                    # result_counts describes the JSON that clients actually
                    # receive. Keep pre-serialization counts separately for debugging.
                    "result_counts": public_result_counts,
                    "internal_result_counts": internal_result_counts,
                    "public_result_counts": public_result_counts,
                    "elapsed_ms": int((time.perf_counter() - started_at) * 1000),
                    "priority_short_timeout": False,
                    "priority_order": "catalog_language -> latin_original -> english",
                    "secondary_alias_timeout_seconds": 7,
                    "fallback_timeout_seconds": 10,
                    "timed_out_domains": sorted(timed_out_domains),
                },
                "generated_at_unix": int(time.time()),
            },
        }

        # Validate serialization before the streaming endpoint receives the value.
        # This turns a malformed field into an explicit progress/error packet instead
        # of silently ending a streamed HTTP 200 response after 95%.
        await emit("serialize", 97, "Перевіряю та серіалізую фінальний JSON.")
        json.dumps(result, ensure_ascii=False, separators=(",", ":"))

        if callback:
            await emit("delivery", 98, "Відправляю готовий JSON у callback.")
            callback_info = await self.send_callback(result)
            if callback_info is not None:
                result["delivery"] = callback_info
        await emit("result_ready", 99, "Повний JSON готовий.")
        return result


app = FastAPI(title="Anime Title Core", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, Any]:
    return {"service": "anime-title-core", "version": APP_VERSION, "endpoints": ["/api/search", "/api/taxonomy", "/api/process-stream", "/api/process-full", "/api/process"]}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "version": APP_VERSION, "search": "/api/search", "taxonomy": "/api/taxonomy", "process_stream": "/api/process-stream", "process_full": "/api/process-full", "process": "/api/process", "progress_protocol": "ndjson-v1", "result_schema": 3}


@app.post("/api/search")
async def search_endpoint(payload: SearchPayload, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    expected = clean_text(os.getenv("CORE_API_KEY"))
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid X-API-Key")

    core = Core()
    try:
        return await core.search_authority_pages(payload.title, payload.limit)
    finally:
        await core.close()


@app.post("/api/taxonomy")
async def taxonomy_endpoint(payload: InputPayload, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Resolve only authority metadata used for Genre/Theme backfill.

    This intentionally skips the slow catalog crawl. It is safe to call for old
    Turso records after upgrading from schema-v2.
    """
    expected = clean_text(os.getenv("CORE_API_KEY"))
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid X-API-Key")
    core = Core()
    try:
        authority, source_status = await core.resolve_taxonomy_authorities(payload)
        return {
            "ok": True,
            "core_version": APP_VERSION,
            "title": {
                "original": authority.original,
                "english": authority.english,
                "native": authority.native,
            },
            "ids": {"anilist": authority.anilist_id, "mal": authority.mal_id},
            "genres": core.taxonomy_payload(authority.genres, ["myanimelist.net", "shikimori.io", "anilist.co"]),
            "themes": core.taxonomy_payload(authority.themes, ["myanimelist.net", "shikimori.io"]),
            "authority": authority.links,
            "source_status": source_status,
            "client_fallback": {
                "anilist": bool((source_status.get("anilist.co") or {}).get("clientFallback")),
            },
            "complete": all(bool(v.get("ok")) or bool(v.get("notFound")) for v in source_status.values()),
        }
    finally:
        await core.close()


@app.post("/api/process-stream")
async def process_stream_endpoint(payload: InputPayload, x_api_key: str | None = Header(default=None)) -> StreamingResponse:
    """Stream progress packets and the final schema-v2 result as NDJSON.

    Packet examples:
      {"type":"progress","stage":"catalogs_primary","percent":42,...}
      {"type":"result","stage":"done","percent":100,"result":{...}}
      {"type":"error","stage":"error","percent":...,"message":"..."}
    """
    expected = clean_text(os.getenv("CORE_API_KEY"))
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid X-API-Key")

    async def stream():
        # Queue already-serialized NDJSON lines.  Serializing before enqueueing means
        # a bad field produces a visible `error` packet instead of a streamed HTTP 200
        # that simply stops around 95%.
        queue: asyncio.Queue[str] = asyncio.Queue()
        state = {"percent": 0, "stage": "accepted", "message": "Запуск…"}
        finished = asyncio.Event()
        core = Core()

        def encode(packet: dict[str, Any]) -> str:
            return json.dumps(packet, ensure_ascii=False, separators=(",", ":")) + "\n"

        async def push(packet: dict[str, Any]) -> None:
            state.update({
                "percent": int(packet.get("percent", state["percent"]) or 0),
                "stage": clean_text(packet.get("stage") or state["stage"]),
                "message": clean_text(packet.get("message") or state["message"]),
            })
            await queue.put(encode(packet))

        async def runner() -> None:
            try:
                result = await core.process(payload, callback=False, progress=push)
                # Build the final line here, before cleanup. This was the weak point in
                # 2.7.0: clients could receive 95% and then wait for stream cleanup.
                await queue.put(encode({
                    "type": "result",
                    "stage": "done",
                    "percent": 100,
                    "message": "Готово. Повний JSON сформовано.",
                    "result": result,
                }))
            except asyncio.CancelledError:
                raise
            except Exception as error:
                try:
                    await queue.put(encode({
                        "type": "error",
                        "stage": "error",
                        "percent": int(state.get("percent") or 0),
                        "message": clean_text(error) or error.__class__.__name__,
                        "error_type": error.__class__.__name__,
                    }))
                except Exception:
                    await queue.put('{"type":"error","stage":"error","percent":0,"message":"final serialization failed"}\n')
            finally:
                # Let the HTTP stream finish immediately after its final packet. Client
                # delivery must not wait for httpx cleanup of many cancelled requests.
                finished.set()
                try:
                    await asyncio.wait_for(core.close(), timeout=2.0)
                except Exception:
                    pass

        task = asyncio.create_task(runner())
        try:
            while not finished.is_set() or not queue.empty():
                try:
                    line = await asyncio.wait_for(queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    line = encode({
                        "type": "heartbeat",
                        "stage": state["stage"],
                        "percent": state["percent"],
                        "message": state["message"],
                    })
                yield line
                # A result/error line is terminal; don't keep the client waiting for
                # any remaining cleanup work.
                if '"type":"result"' in line or '"type":"error"' in line:
                    break
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/process-full")
async def process_full_endpoint(payload: InputPayload, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Return the complete schema-v2 payload without sending a callback.

    This endpoint is intended for the website flow: authority selection happens via
    /api/search, then /api/process-full performs the asynchronous all-catalog search,
    and Cloudflare ingests the returned JSON into Turso exactly once.
    """
    expected = clean_text(os.getenv("CORE_API_KEY"))
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid X-API-Key")

    core = Core()
    try:
        return await core.process(payload, callback=False)
    finally:
        await core.close()


@app.post("/api/process")
async def process_endpoint(payload: InputPayload, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    expected = clean_text(os.getenv("CORE_API_KEY"))
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid X-API-Key")

    core = Core()
    try:
        return await core.process(payload, callback=True)
    finally:
        await core.close()


async def run_test_mode() -> None:
    print("Anime Title Core - TEST mode")
    title = input("Назва тайтлу: ").strip()
    url = input("Посилання на тайтл (можна залишити порожнім): ").strip()
    if not title:
        raise SystemExit("Назва тайтлу обов'язкова.")

    payload = InputPayload(title=title, url=url, status="", group="")
    core = Core()
    core.verbose = True
    try:
        result = await core.process(payload, callback=False)
    finally:
        await core.close()

    output = Path.cwd() / "result.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово: {output}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].lower() == "test":
        asyncio.run(run_test_mode())
    else:
        print("Запуск сервера: uvicorn app:app --reload")
        print("Локальний тест: python app.py test")
