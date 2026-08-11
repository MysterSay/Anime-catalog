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
from typing import Any, Iterable
from urllib.parse import parse_qs, quote, quote_plus, unquote, urlencode, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_VERSION = "2.4.0"
DEFAULT_RESULT_WEBHOOK_URL = "https://myster-anime.pages.dev/api/ingest"

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
        "https://ru.yummyani.me/search?word={q}",
        "https://ru.yummyani.me/search?q={q}",
        "https://ru.yummyani.me/catalog?search={q}",
    ],
    "crunchyroll.com": ["https://www.crunchyroll.com/search?q={q}"],
    "animevost.org": ["https://animevost.org/index.php?do=search&subaction=search&story={q}"],
    "jutsu.tv": [
        "https://jutsu.tv/index.php?do=search&subaction=search&story={q}",
        "https://jutsu.tv/?s={q}",
    ],
    "jut.su": ["https://jut.su/anime/?search={q}", "https://jut.su/?s={q}"],
    "animego.studio": [
        "https://animego.studio/index.php?do=search&subaction=search&story={q}",
        "https://animego.studio/?s={q}",
        "https://animego.studio/search?q={q}",
    ],
    "anilibria.tv": [
        "https://aniliberty.top/anime/catalog?search={q}",
        "https://anilibria.top/anime/catalog?search={q}",
        "https://anilibria.tv/search?query={q}",
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
        "https://amanogawa.space/search?q={q}",
        "https://amanogawa.space/catalog?search={q}",
        "https://amanogawa.space/?s={q}",
    ],
    "animeon.club": [
        "https://animeon.club/anime?search={q}",
        "https://animeon.club/search?q={q}",
        "https://animeon.club/?s={q}",
    ],
    "anidesu.net": [
        "https://anidesu.net/?s={q}",
        "https://anidesu.net/index.php?do=search&subaction=search&story={q}",
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
    description: str = ""
    cover: str = ""
    cover_source: str = ""
    banner: str = ""
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
    key = normalize_title(value)
    if not key:
        return True
    if key in {normalize_title(x) for x in CATALOG_NOISE_TITLES}:
        return True
    if re.fullmatch(r"(?:19|20)\d{2}(?: год| рік)?", key):
        return True
    if re.fullmatch(r"\d+(?:[.,]\d+)?", key):
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


def soup_title_signals(soup: BeautifulSoup) -> list[str]:
    """Identity-bearing title signals only.

    Deliberately excludes H2/H3 and arbitrary body text. Those areas contain
    section headings, genres, recommendations and franchise lists, which caused
    false positives such as "Игры", "OVA" and unrelated titles.
    """
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
    values.extend(explicit_title_variants(soup))
    values.extend(_near_h1_title_variants(soup))
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
        self.http_sem = asyncio.Semaphore(24)
        self.google_sem = asyncio.Semaphore(6)
        self.verbose = clean_text(os.getenv("ANIME_CORE_VERBOSE")).lower() in {"1", "true", "yes", "on"}

    def log(self, message: str) -> None:
        if getattr(self, "verbose", False):
            print(f"[core] {message}", flush=True)

    async def close(self) -> None:
        await self.client.aclose()

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        async with self.http_sem:
            return await self.client.request(method, url, **kwargs)

    async def google_site_search_detailed(
        self, domain: str, title: str, limit: int = 12
    ) -> tuple[list[dict[str, str]], str]:
        query = f'site:{domain} "{title}"'
        async with self.google_sem:
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
            return [], "Google повернув HTTP 429. Спробуй пошук ще раз через кілька секунд."
        if response.status_code >= 400:
            return [], f"Google повернув HTTP {response.status_code}."
        if re.search(r"unusual traffic|/sorry/|detected unusual traffic", response.text, re.I):
            return [], "Google тимчасово заблокував автоматичний пошук для IP Vercel."

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

    async def search_authority_pages(self, title: str, limit: int = 8) -> dict[str, Any]:
        title = clean_title(title)
        groups: list[dict[str, Any]] = []

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
            return {
                "site": site,
                "label": AUTHORITY_LABELS.get(site, site),
                "query": query,
                "error": error,
                "items": items,
            }

        groups = await asyncio.gather(*(one_site(site) for site in AUTHORITY_SITES))
        return {
            "ok": True,
            "query": title,
            "groups": groups,
            "total": sum(len(group.get("items") or []) for group in groups),
            "search_engine": "google",
        }

    async def fetch_soup(self, url: str) -> tuple[BeautifulSoup | None, str]:
        try:
            response = await self.request("GET", url, headers={"Accept": "text/html,application/xhtml+xml"})
            if response.status_code >= 400:
                return None, str(response.url)
            return BeautifulSoup(response.text, "html.parser"), str(response.url)
        except Exception:
            return None, url

    async def anilist_by_id(self, media_id: int) -> dict[str, Any] | None:
        query = """
        query ($id: Int!) {
          Media(id: $id, type: ANIME) {
            id idMal
            title { romaji english native }
            synonyms
            description(asHtml: false)
            bannerImage
            coverImage { extraLarge large medium }
          }
        }
        """
        try:
            response = await self.request(
                "POST",
                "https://graphql.anilist.co",
                json={"query": query, "variables": {"id": media_id}},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            response.raise_for_status()
            return response.json().get("data", {}).get("Media")
        except Exception:
            return None

    async def anilist_search(self, title: str) -> list[dict[str, Any]]:
        query = """
        query ($search: String!) {
          Page(page: 1, perPage: 10) {
            media(search: $search, type: ANIME) {
              id idMal
              title { romaji english native }
              synonyms
              description(asHtml: false)
              bannerImage
              coverImage { extraLarge large medium }
            }
          }
        }
        """
        try:
            response = await self.request(
                "POST",
                "https://graphql.anilist.co",
                json={"query": query, "variables": {"search": title}},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            response.raise_for_status()
            return response.json().get("data", {}).get("Page", {}).get("media", []) or []
        except Exception:
            return []

    def parse_anilist_id(self, url: str) -> int | None:
        match = re.search(r"anilist\.co/anime/(\d+)", url)
        return int(match.group(1)) if match else None

    def parse_mal_id(self, url: str) -> int | None:
        match = re.search(r"myanimelist\.net/anime/(\d+)", url)
        return int(match.group(1)) if match else None

    def parse_shikimori_id(self, url: str) -> int | None:
        match = re.search(r"shikimori\.(?:io|one)/(?:animes?/)?(?:[a-z])?(\d+)", url, re.I)
        return int(match.group(1)) if match else None

    async def anilist_by_mal_id(self, mal_id: int) -> dict[str, Any] | None:
        query = """
        query ($idMal: Int!) {
          Media(idMal: $idMal, type: ANIME) {
            id idMal
            title { romaji english native }
            synonyms
            description(asHtml: false)
            bannerImage
            coverImage { extraLarge large medium }
          }
        }
        """
        try:
            response = await self.request(
                "POST",
                "https://graphql.anilist.co",
                json={"query": query, "variables": {"idMal": mal_id}},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            response.raise_for_status()
            return response.json().get("data", {}).get("Media")
        except Exception:
            return None

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
            response = await self.request(
                "GET",
                "https://shikimori.io/api/animes",
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
            response = await self.request(
                "GET",
                f"https://shikimori.io/api/animes/{anime_id}",
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

    async def resolve_authorities(self, payload: InputPayload) -> AuthorityData:
        """Resolve one anime identity before catalog search.

        Important invariant: ``original`` means the canonical Romaji/original title,
        not the localized title that arrived from the browser. A localized exact
        Shikimori hit is enough to establish identity because Shikimori returns the
        corresponding Romaji ``name`` even when AniList is temporarily unavailable.
        """
        cache_key = normalize_title(payload.title)
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
        english_input = clean_title(await self.translate_en(payload.title))
        base_queries = unique_strings([payload.title, english_input], limit=2)

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

        async def add_shiki(item: dict[str, Any], source_name: str, rank: int = 99, forced: bool = False) -> None:
            anime_id = item.get("id")
            if not anime_id:
                return
            details = await self.shikimori_details(int(anime_id)) or item
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

        # Phase 1: direct APIs first. No "first result wins" rule.
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
                    await add_shiki(item, f"shikimori:{normalize_title(query)}", rank)

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

        if chosen and chosen["kind"] == "shikimori":
            item = chosen["item"]
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
                    titles = media.get("title") or {}
                    data.anilist_id = media.get("id")
                    data.mal_id = media.get("idMal") or mal_id
                    data.original = clean_title(titles.get("romaji") or data.original)
                    data.english = clean_title(titles.get("english") or data.english)
                    data.native = clean_title(titles.get("native") or data.native)
                    data.description = clean_text(media.get("description")) or data.description
                    data.banner = clean_text(media.get("bannerImage"))
                    cover = media.get("coverImage") or {}
                    ani_cover = clean_text(cover.get("extraLarge") or cover.get("large") or cover.get("medium"))
                    if ani_cover:
                        data.cover = ani_cover
                        data.cover_source = "anilist.co"
                    chosen_names = self.media_names(media)
                    data.aliases.extend(chosen_names)

        elif chosen and chosen["kind"] == "anilist":
            media = chosen["media"]
            titles = media.get("title") or {}
            data.anilist_id = media.get("id")
            data.mal_id = media.get("idMal")
            data.original = clean_title(titles.get("romaji") or titles.get("english") or payload.title)
            data.english = clean_title(titles.get("english") or titles.get("romaji") or "")
            data.native = clean_title(titles.get("native") or "")
            data.description = clean_text(media.get("description"))
            data.banner = clean_text(media.get("bannerImage"))
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
                shiki_names = self.shikimori_names(shiki)
                if not chosen_names or any(titles_related(a, b, 0.72) for a in shiki_names for b in chosen_names):
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

        # Keep only related family variants discovered by authority searches. Never cache a lone unrelated hit.
        if chosen:
            for entry in candidates[1:]:
                family_names = entry.get("names") or []
                if any(titles_related(a, b, 0.72) for a in family_names for b in chosen_names):
                    data.aliases.extend(family_names)
                    if entry["kind"] == "shikimori":
                        item = entry["item"]
                        sid = item.get("id")
                        if sid:
                            url = urljoin("https://shikimori.io", item.get("url") or f"/animes/{sid}")
                            data.links["shikimori.io"].append({"url": compact_url(url), "title": clean_title(item.get("name"))})

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
            data.original, data.english, data.native, *data.aliases, payload.title, english_input,
        ], limit=50)

        TITLE_CACHE.set(cache_key, data.__dict__)
        return data

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
        sem = asyncio.Semaphore(12)

        async def verify(item: dict[str, str]) -> dict[str, str] | None:
            raw_url = compact_url(item.get("url", ""))
            if not raw_url or not is_catalog_title_url(domain, raw_url):
                return None

            display_title = clean_title(item.get("title"))
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

            page_signals = soup_title_signals(soup)
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
            }

        results = await asyncio.gather(*(verify(item) for item in candidates[:42]))
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

    async def search_anihub(self, queries: list[str], identity_aliases: list[str], anilist_id: int | None) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        urls: list[str] = []
        if anilist_id:
            urls.append(f"https://api.anihub.in.ua/anime?anilist_id={anilist_id}&page_size=20")
        urls.extend(f"https://api.anihub.in.ua/anime?search={quote_plus(query)}&page_size=20" for query in queries)
        for url in urls:
            try:
                response = await self.request("GET", url, headers={"Accept": "application/json"})
                if response.status_code >= 400:
                    continue
                payload = response.json()
                items = payload.get("items", []) if isinstance(payload, dict) else []
                for item in items:
                    titles = item.get("titles") or {}
                    names = unique_strings([
                        item.get("title_ukrainian"), item.get("title_english"), item.get("title_original"),
                        titles.get("ukrainian"), titles.get("uk"), titles.get("english"), titles.get("en"),
                        titles.get("original"), titles.get("romaji"), *(item.get("aliases") or []),
                    ])
                    match = next((title_match_kind(name, identity_aliases) for name in names if title_match_kind(name, identity_aliases)), None)
                    id_exact = anilist_id and str(item.get("anilist_id")) == str(anilist_id)
                    if not match and not id_exact:
                        continue
                    slug = clean_text(item.get("slug")).strip("/")
                    item_id = item.get("id")
                    if slug and item_id:
                        page = f"https://anihub.in.ua/anime/{slug}-{item_id}"
                    elif item_id:
                        page = f"https://anihub.in.ua/anime/{item_id}"
                    else:
                        continue
                    display = clean_title(item.get("title_ukrainian") or titles.get("ukrainian") or titles.get("uk") or (names[0] if names else ""))
                    found[page] = {"url": page, "title": display or (names[0] if names else queries[0]), "match": match or "exact"}
                if found:
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
        if mal_id:
            endpoints.extend((key, str(mal_id)) for key in ("malId", "mal_id", "mal"))
        for query in queries:
            endpoints.extend((key, query) for key in ("search", "q", "title", "query"))
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

    async def load_mikai_catalog(self) -> list[dict[str, Any]]:
        cache_key = "mikai:catalog"
        cached = FORM_CACHE.get(cache_key)
        if cached is not None:
            return cached
        try:
            first = await self.request(
                "GET", "https://api.mikai.me/v1/anime/search",
                params={"limit": 100, "order": "desc", "page": 1, "sort": "year"},
                headers={"Accept": "application/json"},
            )
            payload = first.json()
            first_items = payload.get("result", []) if isinstance(payload, dict) else []
            total = int(payload.get("total") or len(first_items)) if isinstance(payload, dict) else len(first_items)
            if not first_items:
                return []
            page_size = max(1, len(first_items))
            pages = min(80, max(1, (total + page_size - 1) // page_size))

            async def load(page: int) -> list[dict[str, Any]]:
                try:
                    r = await self.request(
                        "GET", "https://api.mikai.me/v1/anime/search",
                        params={"limit": 100, "order": "desc", "page": page, "sort": "year"},
                        headers={"Accept": "application/json"},
                    )
                    d = r.json()
                    return d.get("result", []) if isinstance(d, dict) else []
                except Exception:
                    return []

            rest = await asyncio.gather(*(load(page) for page in range(2, pages + 1))) if pages > 1 else []
            merged: dict[str, dict[str, Any]] = {}
            for item in [*first_items, *(x for page in rest for x in page)]:
                if isinstance(item, dict):
                    merged[str(item.get("id") or item.get("slug") or len(merged))] = item
            values = list(merged.values())
            FORM_CACHE.set(cache_key, values)
            return values
        except Exception:
            return []

    async def search_mikai(self, queries: list[str], identity_aliases: list[str]) -> list[dict[str, str]]:
        items = await self.load_mikai_catalog()
        found: dict[str, dict[str, str]] = {}
        for item in items:
            details = item.get("details") or {}
            names_obj = details.get("names") or {}
            names = unique_strings([names_obj.get("nameNative"), names_obj.get("name"), names_obj.get("nameEnglish")])
            match = next((title_match_kind(name, identity_aliases) for name in names if title_match_kind(name, identity_aliases)), None)
            if not match:
                continue
            item_id = item.get("id")
            slug = clean_text(item.get("slug")).strip("/")
            if item_id and slug:
                page = f"https://mikai.me/anime/{item_id}-{slug}"
            elif item_id:
                page = f"https://mikai.me/anime/{item_id}"
            else:
                continue
            display = clean_title(names_obj.get("name") or names_obj.get("nameNative") or names_obj.get("nameEnglish") or queries[0])
            found[page] = {"url": page, "title": display, "match": match}
        return list(found.values())[:30]

    async def search_aniliberty_direct(self, queries: list[str], identity_aliases: list[str]) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        for query in queries:
            slug = re.sub(r"[^a-z0-9]+", "-", query.casefold()).strip("-")
            if not slug:
                continue
            for host in ("aniliberty.top", "anilibria.top"):
                url = f"https://{host}/anime/releases/release/{slug}"
                soup, final_url = await self.fetch_soup(url)
                if not soup:
                    continue
                signals = soup_title_signals(soup)
                match = next((title_match_kind(signal, identity_aliases) for signal in signals if title_match_kind(signal, identity_aliases)), None)
                if match:
                    display = next((x for x in signals if is_probable_title(x)), query)
                    found[compact_url(final_url)] = {"url": compact_url(final_url), "title": display, "match": match}
            if found:
                break
        return list(found.values())[:30]

    async def search_dle_post(self, domain: str, queries: list[str], identity_aliases: list[str]) -> list[dict[str, str]]:
        hosts = logical_hosts(domain)
        for query in queries:
            data = {
                "do": "search", "subaction": "search", "search_start": "1",
                "full_search": "0", "result_from": "1", "story": query,
            }
            for host in hosts[:2]:
                for endpoint in (f"https://{host}/index.php?do=search", f"https://{host}/index.php"):
                    try:
                        response = await self.request("POST", endpoint, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
                        if response.status_code >= 400:
                            continue
                        parsed = self.parse_catalog_results(response.text, str(response.url), domain, identity_aliases)
                        if parsed:
                            verified = await self.verify_candidates(domain, parsed, identity_aliases)
                            if verified:
                                return verified
                        loose = self.parse_loose_catalog_candidates(response.text, str(response.url), domain, 50)
                        verified = await self.verify_candidates(domain, loose, identity_aliases)
                        if verified:
                            return verified
                    except Exception:
                        continue
        return []

    async def generic_site_search(self, domain: str, queries: list[str], identity_aliases: list[str]) -> list[dict[str, str]]:
        for query in queries:
            q = quote_plus(query)
            q_path = quote(query, safe="")
            urls = [route.format(q=q, q_path=q_path) for route in SEARCH_ROUTES.get(domain, [])]
            generic: list[str] = []
            for host in logical_hosts(domain)[:2]:
                generic.extend([
                    f"https://{host}/search?q={q}",
                    f"https://{host}/?s={q}",
                    f"https://{host}/catalog?search={q}",
                    f"https://{host}/anime?search={q}",
                ])
            urls = list(dict.fromkeys(urls + generic))[:12]

            async def fetch_route(url: str) -> list[dict[str, str]]:
                try:
                    response = await self.request("GET", url, headers={"Accept": "text/html,application/xhtml+xml"})
                    if response.status_code >= 400:
                        return []
                    strict = self.parse_catalog_results(response.text, str(response.url), domain, identity_aliases)
                    if strict:
                        verified = await self.verify_candidates(domain, strict, identity_aliases)
                        if verified:
                            return verified
                    loose = self.parse_loose_catalog_candidates(response.text, str(response.url), domain, 45)
                    return await self.verify_candidates(domain, loose, identity_aliases) if loose else []
                except Exception:
                    return []

            route_results = await asyncio.gather(*(fetch_route(url) for url in urls))
            merged: dict[str, dict[str, str]] = {}
            for items in route_results:
                for item in items:
                    merged[item["url"]] = item
            if merged:
                return list(merged.values())[:30]

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
                        loose = self.parse_loose_catalog_candidates(response.text, str(response.url), domain, 45)
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
    ) -> list[dict[str, str]]:
        queries = unique_strings(queries, limit=4)
        identity_aliases = unique_strings(identity_aliases, limit=20)
        if not queries:
            return []

        if domain == "shikimori.io":
            result = await self.search_shikimori(queries, identity_aliases, authority.mal_id)
        elif domain == "anihub.in.ua":
            result = await self.search_anihub(queries, identity_aliases, authority.anilist_id)
        elif domain == "ru.yummyani.me":
            result = await self.search_yummy(queries, identity_aliases)
            if not result:
                result = await self.generic_site_search(domain, queries, identity_aliases)
        elif domain == "animeon.club":
            result = await self.search_animeon(queries, identity_aliases, authority.mal_id)
            if not result:
                result = await self.generic_site_search(domain, queries, identity_aliases)
        elif domain == "mikai.me":
            result = await self.search_mikai(queries, identity_aliases)
            if not result:
                result = await self.generic_site_search(domain, queries, identity_aliases)
        elif domain == "anilibria.tv":
            result = await self.search_aniliberty_direct(queries, identity_aliases)
            if not result:
                result = await self.generic_site_search(domain, queries, identity_aliases)
        elif domain in {"anitube.in.ua", "uachan.com"}:
            result = await self.search_dle_post(domain, queries, identity_aliases)
            if not result:
                result = await self.generic_site_search(domain, queries, identity_aliases)
        else:
            result = await self.generic_site_search(domain, queries, identity_aliases)

        return self.merge_catalog_items([], result)

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
            value = {"url": url, "title": title}
            key = self.catalog_item_key(url)
            existing = unique.get(key)
            if not existing:
                unique[key] = value
                continue
            better_url = self.catalog_url_preference(url) > self.catalog_url_preference(existing["url"])
            better_title = len(value["title"]) > len(existing["title"]) and is_probable_title(value["title"])
            if better_url or better_title:
                unique[key] = value
        return list(unique.values())[:30]

    def catalog_group(self, domain: str) -> str:
        return "UA" if domain in UA_SITES else "RU"

    def source_catalog(self, url: str | None) -> str | None:
        host = source_domain(url)
        if not host:
            return None
        return next((domain for domain in CATALOG_SITES if host_allowed(host, domain)), None)

    async def seed_source_catalog(self, payload: InputPayload) -> tuple[str | None, dict[str, str] | None]:
        domain = self.source_catalog(payload.url)
        if not domain or not payload.url:
            return None, None
        soup, final_url = await self.fetch_soup(payload.url)
        final_url = compact_url(final_url or payload.url)
        if not is_catalog_title_url(domain, final_url):
            return domain, None

        # The browser already supplied the visible title. Only replace it with H1/OG title
        # when that page-level title is clearly related. Never choose H2/body headings such
        # as "Новые способности" or navigation labels such as "Игры".
        title = clean_title(payload.title)
        if soup:
            primary = page_primary_title(soup)
            if primary and not is_catalog_noise_title(primary):
                same_script = title_script(primary) == title_script(title)
                if not title or normalize_title(primary) == normalize_title(title) or (same_script and titles_related(primary, title, 0.62)):
                    title = primary
        return domain, {"url": final_url, "title": title or clean_title(payload.title)}

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

    async def process(self, payload: InputPayload, *, callback: bool = True) -> dict[str, Any]:
        # Authority resolution and source-page extraction are independent.
        authority_task = asyncio.create_task(self.resolve_authorities(payload))
        source_task = asyncio.create_task(self.seed_source_catalog(payload))
        authority, (source_catalog, source_item) = await asyncio.gather(authority_task, source_task)

        romanized = clean_title(authority.original or payload.title)
        native_original = clean_title(authority.native or romanized or payload.title)
        self.log(f"Назва: input={clean_title(payload.title)!r}; native={native_original!r}; romaji={romanized!r}; english={clean_title(authority.english)!r}")
        english = clean_title(authority.english)
        # Catalogs are much more likely to index Romaji/English than CJK native script.
        base_queries = unique_strings([romanized, english, native_original], limit=3)
        if not base_queries:
            base_queries = [clean_title(payload.title)]

        # Identity aliases are for verification, not display. Native is preserved as the
        # stored original title, while Romaji remains available for search.
        identity_aliases = unique_strings([
            native_original, romanized, english, *authority.aliases, payload.title,
        ], limit=30)

        catalogs: dict[str, list[dict[str, str]]] = {site: [] for site in CATALOG_SITES}
        if source_catalog and source_item:
            catalogs[source_catalog] = [source_item]

        # PHASE 1. Native search on every catalog using only original + English.
        # If both names are identical, unique_strings leaves a single query and no duplicate request is made.
        phase1_tasks: dict[str, asyncio.Task] = {}
        for domain in CATALOG_SITES:
            if domain == source_catalog:
                continue
            phase1_tasks[domain] = asyncio.create_task(
                self.search_catalog_native(domain, base_queries, identity_aliases, authority)
            )

        for domain, task in phase1_tasks.items():
            try:
                catalogs[domain] = self.merge_catalog_items(catalogs[domain], await task)
            except Exception:
                pass
        self.log("Фаза 1 завершена: " + ", ".join(f"{d}={len(v)}" for d, v in catalogs.items() if v))

        # Learn real localized names from catalogs that proved the identity using original/English/IDs.
        ru_candidates: list[str] = []
        ua_candidates: list[str] = []
        for domain, items in catalogs.items():
            target = ua_candidates if domain in UA_SITES else ru_candidates
            target.extend(item.get("title", "") for item in items)

        ru_title = choose_localized_title("RU", ru_candidates, identity_aliases)
        ua_title = choose_localized_title("UA", ua_candidates, identity_aliases)
        self.log(f"Локальні назви після фази 1: RU={ru_title!r}; UA={ua_title!r}")

        # PHASE 2. As soon as a real RU/UA catalog title is known, return to that language's catalogs.
        # Original/English were already tried in phase 1, so only the new localized query is sent here;
        # logically the order remains original -> English -> local without repeating network requests.
        phase2_tasks: dict[str, asyncio.Task] = {}
        for domain in CATALOG_SITES:
            local = ua_title if domain in UA_SITES else ru_title
            if not local or normalize_title(local) in {normalize_title(x) for x in base_queries}:
                continue
            local_identity = unique_strings([*identity_aliases, ru_title, ua_title], limit=34)
            phase2_tasks[domain] = asyncio.create_task(
                self.search_catalog_native(domain, [local], local_identity, authority)
            )

        for domain, task in phase2_tasks.items():
            try:
                catalogs[domain] = self.merge_catalog_items(catalogs[domain], await task)
            except Exception:
                pass

        # Re-evaluate localized titles after the second pass; another catalog may expose a cleaner base title.
        ru_candidates = [item.get("title", "") for d, items in catalogs.items() if d in RU_SITES for item in items]
        ua_candidates = [item.get("title", "") for d, items in catalogs.items() if d in UA_SITES for item in items]
        ru_title = choose_localized_title("RU", ru_candidates, identity_aliases) or ru_title
        ua_title = choose_localized_title("UA", ua_candidates, identity_aliases) or ua_title

        all_identity = unique_strings([*identity_aliases, ru_title, ua_title], limit=36)

        # PHASE 3. Google site: is a last resort only for catalogs still empty.
        # Query order is strict: original -> English (if different) -> corresponding RU/UA title.
        google_tasks: dict[str, asyncio.Task] = {}
        for domain in CATALOG_SITES:
            if catalogs[domain]:
                continue
            local = ua_title if domain in UA_SITES else ru_title
            google_queries = unique_strings([romanized, english, native_original, local], limit=4)
            google_tasks[domain] = asyncio.create_task(
                self.google_catalog_fallback(domain, google_queries, all_identity)
            )

        for domain, task in google_tasks.items():
            try:
                catalogs[domain] = self.merge_catalog_items(catalogs[domain], await task)
            except Exception:
                pass
        self.log("Пошук завершено: " + ", ".join(f"{d}={len(v)}" for d, v in catalogs.items() if v))

        # Final text fields are produced after catalog discovery so the real UA catalog title wins over MT.
        description_task = asyncio.create_task(self.translate_uk(authority.description))
        if ua_title:
            title_uk_task = asyncio.create_task(asyncio.sleep(0, result=ua_title))
        else:
            title_uk_task = asyncio.create_task(self.translate_uk(romanized or native_original or payload.title))
        if ru_title:
            title_ru_task = asyncio.create_task(asyncio.sleep(0, result=ru_title))
        else:
            title_ru_task = asyncio.create_task(self.translate_ru(romanized or native_original or payload.title))

        description_uk, final_uk, final_ru = await asyncio.gather(
            description_task, title_uk_task, title_ru_task
        )
        final_uk = clean_title(final_uk)
        final_ru = clean_title(final_ru)

        output_aliases = unique_strings([
            native_original, romanized, english, final_uk, final_ru, *authority.aliases,
        ], limit=40)

        result: dict[str, Any] = {
            "schema_version": 2,
            "input": {
                "title": clean_title(payload.title),
                "url": clean_text(payload.url),
                "status": clean_text(payload.status),
                "group": clean_text(payload.group),
            },
            "title": {
                "original": native_original,
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
            "authority": authority.links,
            "catalogs": {site: catalogs.get(site, []) for site in CATALOG_SITES},
            "status": clean_text(payload.status),
            "group": clean_text(payload.group),
            "meta": {
                "core_version": APP_VERSION,
                "anilist_id": authority.anilist_id,
                "mal_id": authority.mal_id,
                "source_catalog": source_catalog or "",
                "search_strategy": {
                    "authority": "direct APIs(input, english) -> strict title-entry Google site fallback",
                    "catalogs": "native title-page(romaji, english, native) -> native title-page(localized) -> Google title-page fallback",
                },
                "generated_at_unix": int(time.time()),
            },
        }

        if callback:
            callback_info = await self.send_callback(result)
            if callback_info is not None:
                result["delivery"] = callback_info
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
    return {"service": "anime-title-core", "version": APP_VERSION, "endpoints": ["/api/search", "/api/process"]}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "version": APP_VERSION, "search": "/api/search", "process": "/api/process"}


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
