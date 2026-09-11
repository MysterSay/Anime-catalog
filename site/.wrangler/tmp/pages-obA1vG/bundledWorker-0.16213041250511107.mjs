var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _worker.js
var ANILIST_ENDPOINT = "https://graphql.anilist.co";
var CORE_PROCESS_FULL_URL = "https://anime-catalog-flame.vercel.app/api/process-full";
var CORE_PROCESS_STREAM_URL = "https://anime-catalog-flame.vercel.app/api/process-stream";
var CORE_SEARCH_URL = "https://anime-catalog-flame.vercel.app/api/search";
var CORE_TAXONOMY_URL = "https://anime-catalog-flame.vercel.app/api/taxonomy";
var TITLE_STATUS_OPTIONS = ["\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u043E", "\u0411\u0443\u0434\u0443 \u0434\u0438\u0432\u0438\u0442\u0438\u0441\u044C", "\u0414\u0438\u0432\u043B\u044E\u0441\u044C", "\u041F\u0435\u0440\u0435\u0433\u043B\u044F\u043D\u0443\u0432", "\u0412\u0456\u0434\u043A\u043B\u0430\u0434\u0435\u043D\u043E", "\u041A\u0438\u043D\u0443\u0442\u043E"];
var CATALOG_CONFIG_VERSION = 1;
var CATALOG_GROUPS = {
  RU: ["jut-su.net", "ru.yummyani.me", "crunchyroll.com", "shikimori.io", "animevost.org", "jutsu.tv", "jut.su", "animego.studio", "anilibria.tv"],
  UA: ["uaserials.com", "uachan.com", "anihub.in.ua", "amanogawa.space", "animeon.club", "anidesu.net", "mikai.me", "anitube.in.ua"]
};
var CATALOGS = [...CATALOG_GROUPS.RU, ...CATALOG_GROUPS.UA];
var AUTHORITY_SITES = ["myanimelist.net", "anilist.co", "shikimori.io"];
var SITE_PROPERTIES = [.../* @__PURE__ */ new Set([...AUTHORITY_SITES, ...CATALOGS])];
var SEARCH_HOST_ALIASES = {
  "anilibria.tv": ["aniliberty.top", "www.aniliberty.top", "anilibria.top", "www.anilibria.top", "anilibria.tv"],
  "crunchyroll.com": ["www.crunchyroll.com", "crunchyroll.com"],
  "uachan.com": ["uachan.top", "www.uachan.top", "uachan.com", "www.uachan.com"]
};
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, message, details = "", code = "", step = "") {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
    this.step = step;
  }
};
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type, X-Ingest-Key",
      ...extraHeaders
    }
  });
}
__name(json, "json");
function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, "").trim();
}
__name(cleanTitle, "cleanTitle");
function plainTitle(value) {
  return cleanTitle(String(value || "").replace(/<[^>]+>/g, " "));
}
__name(plainTitle, "plainTitle");
function normalizeName(value) {
  return plainTitle(value).normalize("NFKC").toLocaleLowerCase();
}
__name(normalizeName, "normalizeName");
function exactCoreTitleKey(value) {
  return plainTitle(value).normalize("NFKC").toLocaleLowerCase().replace(/[’'`´]/g, "").replace(/[‐‑‒–—―]/g, "-").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}
__name(exactCoreTitleKey, "exactCoreTitleKey");
function safeHttpUrl(value) {
  try {
    const u = new URL(String(value || "").trim());
    return /^https?:$/.test(u.protocol) ? u.toString() : "";
  } catch {
    return "";
  }
}
__name(safeHttpUrl, "safeHttpUrl");
function normalizeTags(value = []) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/(?:\.\s*|[\n,;]+)/);
  return [...new Set(raw.map((x) => String(x || "").trim().replace(/^#+/, "").replace(/\.+$/, "")).filter(Boolean))].slice(0, 100);
}
__name(normalizeTags, "normalizeTags");
var GENRE_SOURCES = ["myanimelist.net", "shikimori.io", "anilist.co"];
var THEME_SOURCES = ["myanimelist.net", "shikimori.io"];
var TAXONOMY_UK = Object.freeze({
  "action": "\u0415\u043A\u0448\u0435\u043D",
  "adventure": "\u041F\u0440\u0438\u0433\u043E\u0434\u0438",
  "avant garde": "\u0410\u0432\u0430\u043D\u0433\u0430\u0440\u0434",
  "award winning": "\u0412\u0456\u0434\u0437\u043D\u0430\u0447\u0435\u043D\u0435 \u043D\u0430\u0433\u043E\u0440\u043E\u0434\u0430\u043C\u0438",
  "boys love": "\u0425\u043B\u043E\u043F\u0447\u0430\u0447\u0435 \u043A\u043E\u0445\u0430\u043D\u043D\u044F",
  "comedy": "\u041A\u043E\u043C\u0435\u0434\u0456\u044F",
  "drama": "\u0414\u0440\u0430\u043C\u0430",
  "fantasy": "\u0424\u0435\u043D\u0442\u0435\u0437\u0456",
  "girls love": "\u0414\u0456\u0432\u043E\u0447\u0435 \u043A\u043E\u0445\u0430\u043D\u043D\u044F",
  "gourmet": "\u0413\u0443\u0440\u043C\u0430\u043D\u0441\u044C\u043A\u0435",
  "horror": "\u0416\u0430\u0445\u0438",
  "mystery": "\u0422\u0430\u0454\u043C\u043D\u0438\u0446\u0456",
  "romance": "\u0420\u043E\u043C\u0430\u043D\u0442\u0438\u043A\u0430",
  "sci fi": "\u041D\u0430\u0443\u043A\u043E\u0432\u0430 \u0444\u0430\u043D\u0442\u0430\u0441\u0442\u0438\u043A\u0430",
  "science fiction": "\u041D\u0430\u0443\u043A\u043E\u0432\u0430 \u0444\u0430\u043D\u0442\u0430\u0441\u0442\u0438\u043A\u0430",
  "slice of life": "\u041F\u043E\u0432\u0441\u044F\u043A\u0434\u0435\u043D\u043D\u0456\u0441\u0442\u044C",
  "sports": "\u0421\u043F\u043E\u0440\u0442",
  "supernatural": "\u041D\u0430\u0434\u043F\u0440\u0438\u0440\u043E\u0434\u043D\u0435",
  "suspense": "\u0422\u0440\u0438\u043B\u0435\u0440",
  "thriller": "\u0422\u0440\u0438\u043B\u0435\u0440",
  "ecchi": "\u0415\u0442\u0442\u0456",
  "erotica": "\u0415\u0440\u043E\u0442\u0438\u043A\u0430",
  "hentai": "\u0425\u0435\u043D\u0442\u0430\u0439",
  "josei": "\u0414\u0437\u044C\u043E\u0441\u0435\u0439",
  "kids": "\u0414\u043B\u044F \u0434\u0456\u0442\u0435\u0439",
  "seinen": "\u0421\u0435\u0439\u043D\u0435\u043D",
  "shoujo": "\u0421\u044C\u043E\u0434\u0437\u044C\u043E",
  "shojo": "\u0421\u044C\u043E\u0434\u0437\u044C\u043E",
  "shounen": "\u0421\u044C\u043E\u043D\u0435\u043D",
  "shonen": "\u0421\u044C\u043E\u043D\u0435\u043D",
  "adult cast": "\u0414\u043E\u0440\u043E\u0441\u043B\u0456 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0456",
  "anthropomorphic": "\u0410\u043D\u0442\u0440\u043E\u043F\u043E\u043C\u043E\u0440\u0444\u0456\u0437\u043C",
  "cgdct": "\u041C\u0438\u043B\u0456 \u0434\u0456\u0432\u0447\u0430\u0442\u0430 \u0440\u043E\u0431\u043B\u044F\u0442\u044C \u043C\u0438\u043B\u0456 \u0440\u0435\u0447\u0456",
  "childcare": "\u0414\u043E\u0433\u043B\u044F\u0434 \u0437\u0430 \u0434\u0456\u0442\u044C\u043C\u0438",
  "combat sports": "\u0411\u043E\u0439\u043E\u0432\u0456 \u0432\u0438\u0434\u0438 \u0441\u043F\u043E\u0440\u0442\u0443",
  "crossdressing": "\u041A\u0440\u043E\u0441\u0434\u0440\u0435\u0441\u0438\u043D\u0433",
  "delinquents": "\u0425\u0443\u043B\u0456\u0433\u0430\u043D\u0438",
  "detective": "\u0414\u0435\u0442\u0435\u043A\u0442\u0438\u0432",
  "educational": "\u041E\u0441\u0432\u0456\u0442\u043D\u0454",
  "gag humor": "\u0413\u0435\u0433-\u0433\u0443\u043C\u043E\u0440",
  "gore": "\u041A\u0440\u0438\u0432\u0430\u0432\u0456 \u0441\u0446\u0435\u043D\u0438",
  "harem": "\u0413\u0430\u0440\u0435\u043C",
  "high stakes game": "\u0413\u0440\u0430 \u0437 \u0432\u0438\u0441\u043E\u043A\u0438\u043C\u0438 \u0441\u0442\u0430\u0432\u043A\u0430\u043C\u0438",
  "historical": "\u0406\u0441\u0442\u043E\u0440\u0438\u0447\u043D\u0435",
  "idols female": "\u0416\u0456\u043D\u043E\u0447\u0456 \u0430\u0439\u0434\u043E\u043B\u0438",
  "idols male": "\u0427\u043E\u043B\u043E\u0432\u0456\u0447\u0456 \u0430\u0439\u0434\u043E\u043B\u0438",
  "isekai": "\u0406\u0441\u0435\u043A\u0430\u0439",
  "iyashikei": "\u0406\u044F\u0448\u0456\u043A\u0435\u0457",
  "love polygon": "\u041B\u044E\u0431\u043E\u0432\u043D\u0438\u0439 \u0431\u0430\u0433\u0430\u0442\u043E\u043A\u0443\u0442\u043D\u0438\u043A",
  "magical sex shift": "\u041C\u0430\u0433\u0456\u0447\u043D\u0430 \u0437\u043C\u0456\u043D\u0430 \u0441\u0442\u0430\u0442\u0456",
  "mahou shoujo": "\u0414\u0456\u0432\u0447\u0430\u0442\u0430-\u0447\u0430\u0440\u0456\u0432\u043D\u0438\u0446\u0456",
  "maho shojo": "\u0414\u0456\u0432\u0447\u0430\u0442\u0430-\u0447\u0430\u0440\u0456\u0432\u043D\u0438\u0446\u0456",
  "martial arts": "\u0411\u043E\u0439\u043E\u0432\u0456 \u043C\u0438\u0441\u0442\u0435\u0446\u0442\u0432\u0430",
  "mecha": "\u041C\u0435\u0445\u0430",
  "medical": "\u041C\u0435\u0434\u0438\u0446\u0438\u043D\u0430",
  "military": "\u0412\u0456\u0439\u0441\u044C\u043A\u043E\u0432\u0435",
  "music": "\u041C\u0443\u0437\u0438\u043A\u0430",
  "mythology": "\u041C\u0456\u0444\u043E\u043B\u043E\u0433\u0456\u044F",
  "organized crime": "\u041E\u0440\u0433\u0430\u043D\u0456\u0437\u043E\u0432\u0430\u043D\u0430 \u0437\u043B\u043E\u0447\u0438\u043D\u043D\u0456\u0441\u0442\u044C",
  "otaku culture": "\u041E\u0442\u0430\u043A\u0443-\u043A\u0443\u043B\u044C\u0442\u0443\u0440\u0430",
  "parody": "\u041F\u0430\u0440\u043E\u0434\u0456\u044F",
  "performing arts": "\u0421\u0446\u0435\u043D\u0456\u0447\u043D\u0435 \u043C\u0438\u0441\u0442\u0435\u0446\u0442\u0432\u043E",
  "pets": "\u0414\u043E\u043C\u0430\u0448\u043D\u0456 \u0442\u0432\u0430\u0440\u0438\u043D\u0438",
  "psychological": "\u041F\u0441\u0438\u0445\u043E\u043B\u043E\u0433\u0456\u0447\u043D\u0435",
  "racing": "\u041F\u0435\u0440\u0435\u0433\u043E\u043D\u0438",
  "reincarnation": "\u0420\u0435\u0456\u043D\u043A\u0430\u0440\u043D\u0430\u0446\u0456\u044F",
  "reverse harem": "\u0417\u0432\u043E\u0440\u043E\u0442\u043D\u0438\u0439 \u0433\u0430\u0440\u0435\u043C",
  "romantic subtext": "\u0420\u043E\u043C\u0430\u043D\u0442\u0438\u0447\u043D\u0438\u0439 \u043F\u0456\u0434\u0442\u0435\u043A\u0441\u0442",
  "samurai": "\u0421\u0430\u043C\u0443\u0440\u0430\u0457",
  "school": "\u0428\u043A\u043E\u043B\u0430",
  "showbiz": "\u0428\u043E\u0443-\u0431\u0456\u0437\u043D\u0435\u0441",
  "space": "\u041A\u043E\u0441\u043C\u043E\u0441",
  "strategy game": "\u0421\u0442\u0440\u0430\u0442\u0435\u0433\u0456\u0447\u043D\u0430 \u0433\u0440\u0430",
  "super power": "\u041D\u0430\u0434\u0437\u0434\u0456\u0431\u043D\u043E\u0441\u0442\u0456",
  "survival": "\u0412\u0438\u0436\u0438\u0432\u0430\u043D\u043D\u044F",
  "team sports": "\u041A\u043E\u043C\u0430\u043D\u0434\u043D\u0438\u0439 \u0441\u043F\u043E\u0440\u0442",
  "time travel": "\u041F\u043E\u0434\u043E\u0440\u043E\u0436\u0456 \u0432 \u0447\u0430\u0441\u0456",
  "vampire": "\u0412\u0430\u043C\u043F\u0456\u0440\u0438",
  "video game": "\u0412\u0456\u0434\u0435\u043E\u0456\u0433\u0440\u0438",
  "visual arts": "\u041E\u0431\u0440\u0430\u0437\u043E\u0442\u0432\u043E\u0440\u0447\u0435 \u043C\u0438\u0441\u0442\u0435\u0446\u0442\u0432\u043E",
  "workplace": "\u0420\u043E\u0431\u043E\u0442\u0430"
});
function taxonomyUkName(value) {
  const text = plainTitle(value);
  if (!text) return "";
  const key = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
  return TAXONOMY_UK[key] || text;
}
__name(taxonomyUkName, "taxonomyUkName");
function normalizeTaxonomyNames(value = []) {
  const raw = Array.isArray(value) ? value : [value];
  const seen = /* @__PURE__ */ new Set(), out = [];
  for (const item of raw) {
    const name = taxonomyUkName(item && typeof item === "object" ? item.name || item.title || item.english || item.russian || "" : item);
    const key = normalizeName(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 100) break;
  }
  return out;
}
__name(normalizeTaxonomyNames, "normalizeTaxonomyNames");
function normalizeTaxonomy(value, allowedSources) {
  const allowed = Array.isArray(allowedSources) ? allowedSources : [];
  const sources = Object.fromEntries(allowed.map((site) => [site, []]));
  let all = [];
  if (Array.isArray(value)) {
    all = normalizeTaxonomyNames(value);
  } else if (value && typeof value === "object") {
    const src = value.sources && typeof value.sources === "object" ? value.sources : value;
    for (const site of allowed) sources[site] = normalizeTaxonomyNames(src?.[site] || []);
    all = normalizeTaxonomyNames(Array.isArray(value.all) ? value.all : allowed.flatMap((site) => sources[site] || []));
  }
  if (!all.length) all = normalizeTaxonomyNames(allowed.flatMap((site) => sources[site] || []));
  return { all, sources };
}
__name(normalizeTaxonomy, "normalizeTaxonomy");
function mergeTaxonomy(left, right, allowedSources) {
  const a = normalizeTaxonomy(left, allowedSources), b = normalizeTaxonomy(right, allowedSources);
  const sources = {};
  for (const site of allowedSources) sources[site] = normalizeTaxonomyNames([...a.sources[site] || [], ...b.sources[site] || []]);
  return { all: normalizeTaxonomyNames([...a.all, ...b.all, ...allowedSources.flatMap((site) => sources[site])]), sources };
}
__name(mergeTaxonomy, "mergeTaxonomy");
function normalizeCatalogConfig(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const statusGroups = {};
  for (const [status, groups] of Object.entries(raw.statusGroups || {})) {
    const s = plainTitle(status);
    if (!s) continue;
    statusGroups[s] = [...new Set((Array.isArray(groups) ? groups : []).map(plainTitle).filter((x) => x && x !== "\u0411\u0435\u0437 \u0433\u0440\u0443\u043F\u0438"))];
  }
  const starredGroups = [...new Set((Array.isArray(raw.starredGroups) ? raw.starredGroups : []).map(plainTitle).filter((x) => x && x !== "\u0411\u0435\u0437 \u0433\u0440\u0443\u043F\u0438"))];
  return { version: CATALOG_CONFIG_VERSION, statusGroups, starredGroups };
}
__name(normalizeCatalogConfig, "normalizeCatalogConfig");
function isCompletedStatus(status) {
  return normalizeName(status) === normalizeName("\u041F\u0435\u0440\u0435\u0433\u043B\u044F\u043D\u0443\u0432");
}
__name(isCompletedStatus, "isCompletedStatus");
function canonicalSitePropertyForUrl(value) {
  const url = safeHttpUrl(value);
  if (!url) return "";
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  for (const domain of SITE_PROPERTIES) {
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
    for (const alias of SEARCH_HOST_ALIASES[domain] || []) if (host === alias.replace(/^www\./, "")) return domain;
  }
  return "";
}
__name(canonicalSitePropertyForUrl, "canonicalSitePropertyForUrl");
function aliasMatchScore(query, candidate) {
  const q = exactCoreTitleKey(query), c = exactCoreTitleKey(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.includes(q) || q.includes(c)) {
    const ratio = Math.min(q.length, c.length) / Math.max(q.length, c.length);
    if (ratio >= 0.72) return 88;
    if (ratio >= 0.55) return 78;
  }
  const qa = new Set(q.split(" ").filter(Boolean)), ca = new Set(c.split(" ").filter(Boolean));
  let overlap = 0;
  for (const t of qa) if (ca.has(t)) overlap++;
  const coverage = overlap / Math.max(1, Math.min(qa.size, ca.size));
  const union = (/* @__PURE__ */ new Set([...qa, ...ca])).size;
  const jaccard = overlap / Math.max(1, union);
  if (overlap >= 3 && coverage >= 0.72) return 68 + Math.round(jaccard * 18);
  return 0;
}
__name(aliasMatchScore, "aliasMatchScore");
function htmlToPlainText(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}
__name(htmlToPlainText, "htmlToPlainText");
function sanitizeCoreLinkItems(items, domain) {
  const out = [], seen = /* @__PURE__ */ new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const url = safeHttpUrl(item?.url || "");
    if (!url) continue;
    const key = url.replace(/#.*$/, "").replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, title: plainTitle(item?.title || item?.name || "") || domain, kind: item?.kind || "exact" });
  }
  return out.slice(0, 30);
}
__name(sanitizeCoreLinkItems, "sanitizeCoreLinkItems");
function coreSiteLinks(payload) {
  const out = {};
  for (const bucket of [payload?.authority, payload?.catalogs]) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const [domain, items] of Object.entries(bucket)) {
      if (!SITE_PROPERTIES.includes(domain)) continue;
      const clean = sanitizeCoreLinkItems(items, domain);
      if (!clean.length) continue;
      out[domain] = [...out[domain] || [], ...clean].filter((x, i, a) => a.findIndex((y) => y.url.replace(/\/$/, "") === x.url.replace(/\/$/, "")) === i);
    }
  }
  return out;
}
__name(coreSiteLinks, "coreSiteLinks");
function coreTitleData(payload) {
  const title = payload?.title && typeof payload.title === "object" ? payload.title : {};
  const input = payload?.input && typeof payload.input === "object" ? payload.input : {};
  return {
    main: plainTitle(title.ukrainian || input.title || title.original || title.english || title.russian || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0438"),
    original: plainTitle(title.original || ""),
    english: plainTitle(title.english || ""),
    russian: plainTitle(title.russian || ""),
    aliases: Array.isArray(title.aliases) ? title.aliases.map(plainTitle).filter(Boolean) : [],
    description: htmlToPlainText(payload?.description_uk || ""),
    cover: safeHttpUrl(payload?.cover?.url || ""),
    banner: safeHttpUrl(payload?.banner?.url || ""),
    status: plainTitle(payload?.status || input.status || ""),
    group: plainTitle(payload?.group || input.group || ""),
    viewed: Math.max(0, Number(payload?.viewed ?? input.viewed) || 0),
    season: Math.max(0, Number(payload?.season ?? input.season) || 0),
    episode: Math.max(0, Number(payload?.episode ?? input.episode) || 0),
    hasSeason: Object.prototype.hasOwnProperty.call(payload || {}, "season") || Object.prototype.hasOwnProperty.call(input || {}, "season"),
    hasEpisode: Object.prototype.hasOwnProperty.call(payload || {}, "episode") || Object.prototype.hasOwnProperty.call(input || {}, "episode"),
    hasViewed: Object.prototype.hasOwnProperty.call(payload || {}, "viewed") || Object.prototype.hasOwnProperty.call(input || {}, "viewed"),
    sourceUrl: safeHttpUrl(input.url || ""),
    tags: normalizeTags(payload?.tags ?? input.tags ?? []),
    genres: normalizeTaxonomy(payload?.genres, GENRE_SOURCES),
    themes: normalizeTaxonomy(payload?.themes, THEME_SOURCES),
    hasGenres: Object.prototype.hasOwnProperty.call(payload || {}, "genres"),
    hasThemes: Object.prototype.hasOwnProperty.call(payload || {}, "themes")
  };
}
__name(coreTitleData, "coreTitleData");
function checkIngestKey(request, env) {
  if (!env.INGEST_KEY) return;
  if ((request.headers.get("X-Ingest-Key") || "") !== env.INGEST_KEY) throw new HttpError(401, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u0430\u0431\u043E \u0432\u0456\u0434\u0441\u0443\u0442\u043D\u0456\u0439 X-Ingest-Key.", "", "ingest_auth", "ingest");
}
__name(checkIngestKey, "checkIngestKey");
var TURSO_CONFIG_ID = "CONFIG#CATALOG";
var TURSO_STORAGE_VERSION = 1;
var TURSO_GROUP_COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
var TURSO_SCHEMA_READY = false;
var TURSO_SCHEMA_PROMISE = null;
function tursoRequireEnv(env) {
  const missing = [];
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) if (!env[key]) missing.push(key);
  if (missing.length) throw new HttpError(500, `\u0423 Cloudflare \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E Turso secrets: ${missing.join(", ")}`, "", "turso_config", "turso");
}
__name(tursoRequireEnv, "tursoRequireEnv");
function tursoHttpBase(env) {
  tursoRequireEnv(env);
  const raw = String(env.TURSO_DATABASE_URL || "").trim().replace(/\/$/, "");
  if (raw.startsWith("libsql://")) return `https://${raw.slice("libsql://".length)}`;
  if (raw.startsWith("https://")) return raw;
  throw new HttpError(500, "TURSO_DATABASE_URL \u043F\u043E\u0432\u0438\u043D\u0435\u043D \u043F\u043E\u0447\u0438\u043D\u0430\u0442\u0438\u0441\u044F \u0437 libsql:// \u0430\u0431\u043E https://", "", "turso_url", "turso");
}
__name(tursoHttpBase, "tursoHttpBase");
function tursoArg(value) {
  if (value === null || value === void 0) return { type: "null" };
  if (typeof value === "boolean") return { type: "integer", value: value ? "1" : "0" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { type: "null" };
    if (Number.isInteger(value)) return { type: "integer", value: String(value) };
    return { type: "float", value: String(value) };
  }
  return { type: "text", value: String(value) };
}
__name(tursoArg, "tursoArg");
function tursoCellValue(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer") return Number(cell.value || 0);
  if (cell.type === "float") return Number(cell.value || 0);
  if (cell.type === "text") return String(cell.value ?? "");
  if (cell.type === "blob") return cell.base64 || "";
  return cell.value ?? null;
}
__name(tursoCellValue, "tursoCellValue");
function tursoResultRows(result) {
  const cols = result?.cols || [];
  return (result?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c.name, tursoCellValue(row[i])])));
}
__name(tursoResultRows, "tursoResultRows");
async function tursoPipeline(env, statements, { skipSchema = false } = {}) {
  tursoRequireEnv(env);
  if (!skipSchema) await tursoEnsureSchema(env);
  const requests = statements.map((stmt) => ({
    type: "execute",
    stmt: {
      sql: String(stmt.sql || ""),
      ...Array.isArray(stmt.args) ? { args: stmt.args.map(tursoArg) } : {}
    }
  }));
  requests.push({ type: "close" });
  const response = await fetch(`${tursoHttpBase(env)}/v2/pipeline`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.TURSO_AUTH_TOKEN}`,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify({ requests })
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = null;
  }
  if (!response.ok || !payload) {
    throw new HttpError(502, `Turso HTTP ${response.status}: ${payload?.error?.message || raw.slice(0, 700) || response.statusText}`, raw.slice(0, 1200), String(response.status), "turso_http");
  }
  const out = [];
  for (let i = 0; i < statements.length; i++) {
    const entry = payload.results?.[i];
    if (!entry) throw new HttpError(502, `Turso \u043D\u0435 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0432 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0434\u043B\u044F SQL #${i + 1}.`, JSON.stringify(payload).slice(0, 1200), "missing_result", "turso_sql");
    if (entry.type !== "ok") {
      const err = entry.error || entry.response?.error || {};
      throw new HttpError(502, `Turso SQL: ${err.message || err.code || "\u043D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u043F\u043E\u043C\u0438\u043B\u043A\u0430"}`, JSON.stringify(entry).slice(0, 1200), err.code || "sql_error", "turso_sql");
    }
    out.push(entry.response?.result || { cols: [], rows: [], affected_row_count: 0 });
  }
  return out;
}
__name(tursoPipeline, "tursoPipeline");
async function tursoEnsureSchema(env) {
  if (TURSO_SCHEMA_READY) return;
  if (!TURSO_SCHEMA_PROMISE) {
    TURSO_SCHEMA_PROMISE = (async () => {
      await tursoPipeline(env, [
        { sql: `CREATE TABLE IF NOT EXISTS yoru_items (id TEXT PRIMARY KEY NOT NULL, entity TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)` },
        { sql: `CREATE INDEX IF NOT EXISTS idx_yoru_items_entity ON yoru_items(entity)` }
      ], { skipSchema: true });
      TURSO_SCHEMA_READY = true;
    })().finally(() => {
      TURSO_SCHEMA_PROMISE = null;
    });
  }
  return TURSO_SCHEMA_PROMISE;
}
__name(tursoEnsureSchema, "tursoEnsureSchema");
async function tursoGetRaw(env, id) {
  const [r] = await tursoPipeline(env, [{ sql: "SELECT data FROM yoru_items WHERE id = ? LIMIT 1", args: [id] }]);
  const row = tursoResultRows(r)[0];
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}
__name(tursoGetRaw, "tursoGetRaw");
async function tursoPutRaw(env, item) {
  const clean = item && typeof item === "object" ? item : {};
  const id = String(clean.id || "").trim();
  if (!id) throw new HttpError(400, "Turso item \u043D\u0435 \u043C\u0430\u0454 id.", "", "missing_id", "turso_put");
  const entity = String(clean.entity || "anime");
  const updated = String(clean.updatedAt || (/* @__PURE__ */ new Date()).toISOString());
  const data = JSON.stringify(clean);
  await tursoPipeline(env, [{
    sql: `INSERT INTO yoru_items (id, entity, data, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET entity = excluded.entity, data = excluded.data, updated_at = excluded.updated_at`,
    args: [id, entity, data, updated]
  }]);
  return clean;
}
__name(tursoPutRaw, "tursoPutRaw");
async function tursoDeleteRaw(env, id) {
  await tursoPipeline(env, [{ sql: "DELETE FROM yoru_items WHERE id = ?", args: [id] }]);
}
__name(tursoDeleteRaw, "tursoDeleteRaw");
async function tursoScanRaw(env, entity = "") {
  const [r] = await tursoPipeline(env, [{
    sql: entity ? "SELECT data FROM yoru_items WHERE entity = ? ORDER BY updated_at DESC" : "SELECT data FROM yoru_items ORDER BY updated_at DESC",
    args: entity ? [entity] : []
  }]);
  const items = [];
  for (const row of tursoResultRows(r)) {
    try {
      const item = JSON.parse(row.data);
      if (item && typeof item === "object") items.push(item);
    } catch {
    }
  }
  return items;
}
__name(tursoScanRaw, "tursoScanRaw");
async function tursoBatchPut(env, items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    await tursoPipeline(env, chunk.map((item) => {
      const clean = item && typeof item === "object" ? item : {};
      return {
        sql: `INSERT INTO yoru_items (id, entity, data, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET entity = excluded.entity, data = excluded.data, updated_at = excluded.updated_at`,
        args: [String(clean.id || ""), String(clean.entity || "anime"), JSON.stringify(clean), String(clean.updatedAt || (/* @__PURE__ */ new Date()).toISOString())]
      };
    }));
  }
}
__name(tursoBatchPut, "tursoBatchPut");
function tursoNormalizeLinks(value) {
  const seen = /* @__PURE__ */ new Set(), out = [];
  for (const item of Array.isArray(value) ? value : []) {
    const url = safeHttpUrl(item?.url || "");
    if (!url) continue;
    const key = url.replace(/#.*$/, "").replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: plainTitle(item?.name || item?.title || "") || canonicalSitePropertyForUrl(url) || "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F", url });
  }
  return out;
}
__name(tursoNormalizeLinks, "tursoNormalizeLinks");
function tursoNormalizeAnime(raw = {}) {
  const i = raw && typeof raw === "object" ? raw : {}, poster = safeHttpUrl(i.poster || ""), banner = safeHttpUrl(i.banner || "");
  return {
    id: String(i.id || ""),
    entity: "anime",
    title: plainTitle(i.title || "") || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0438",
    originalTitle: plainTitle(i.originalTitle || ""),
    englishTitle: plainTitle(i.englishTitle || ""),
    russianTitle: plainTitle(i.russianTitle || ""),
    aliases: String(i.aliases || ""),
    key: String(i.key || exactCoreTitleKey(i.originalTitle || i.title || "")),
    poster,
    banner: banner || poster,
    description: String(i.description || ""),
    status: plainTitle(i.status || "") || "\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0443",
    group: plainTitle(i.group || "") || "\u0411\u0435\u0437 \u0433\u0440\u0443\u043F\u0438",
    addedAt: String(i.addedAt || (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(i.updatedAt || i.addedAt || (/* @__PURE__ */ new Date()).toISOString()),
    favorite: Boolean(i.favorite),
    liked: Boolean(i.liked),
    viewed: Math.max(0, Math.floor(Number(i.viewed) || 0)),
    season: Math.max(0, Math.floor(Number(i.season) || 0)),
    episode: Math.max(0, Math.floor(Number(i.episode) || 0)),
    tags: normalizeTags(i.tags || []),
    notes: String(i.notes || ""),
    genres: normalizeTaxonomy(i.genres, GENRE_SOURCES),
    themes: normalizeTaxonomy(i.themes, THEME_SOURCES),
    links: tursoNormalizeLinks(i.links),
    sourceUrl: safeHttpUrl(i.sourceUrl || ""),
    migratedFrom: String(i.migratedFrom || "")
  };
}
__name(tursoNormalizeAnime, "tursoNormalizeAnime");
function tursoPublicAnime(raw) {
  const i = tursoNormalizeAnime(raw);
  return { ...i, hasPoster: Boolean(i.poster), hasBanner: Boolean(i.banner) };
}
__name(tursoPublicAnime, "tursoPublicAnime");
function tursoSummaryAnime(raw) {
  const i = tursoPublicAnime(raw);
  return { id: i.id, title: i.title, poster: i.poster, status: i.status, group: i.group, addedAt: i.addedAt, favorite: i.favorite, liked: i.liked, viewed: i.viewed, season: i.season, episode: i.episode, tags: i.tags, genres: i.genres.all, themes: i.themes.all, description: i.description };
}
__name(tursoSummaryAnime, "tursoSummaryAnime");
function tursoDefaultConfig() {
  return { id: TURSO_CONFIG_ID, entity: "config", version: TURSO_STORAGE_VERSION, groupOptions: [], statusGroups: {}, starredGroups: [], updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
__name(tursoDefaultConfig, "tursoDefaultConfig");
async function tursoGetConfig(env) {
  const raw = await tursoGetRaw(env, TURSO_CONFIG_ID);
  if (!raw) return tursoDefaultConfig();
  const c = tursoDefaultConfig();
  c.groupOptions = Array.isArray(raw.groupOptions) ? raw.groupOptions.map((g) => ({ id: String(g?.id || ""), name: plainTitle(g?.name || ""), color: TURSO_GROUP_COLORS.includes(g?.color) ? g.color : "default" })).filter((g) => g.name) : [];
  c.statusGroups = raw.statusGroups && typeof raw.statusGroups === "object" ? raw.statusGroups : {};
  c.starredGroups = Array.isArray(raw.starredGroups) ? raw.starredGroups.map(plainTitle).filter(Boolean) : [];
  return c;
}
__name(tursoGetConfig, "tursoGetConfig");
async function tursoSaveConfig(env, config) {
  const clean = tursoDefaultConfig();
  clean.groupOptions = Array.isArray(config?.groupOptions) ? config.groupOptions.map((g) => ({ id: String(g?.id || crypto.randomUUID()), name: plainTitle(g?.name || ""), color: TURSO_GROUP_COLORS.includes(g?.color) ? g.color : "default" })).filter((g) => g.name) : [];
  clean.statusGroups = normalizeCatalogConfig({ statusGroups: config?.statusGroups || {} }).statusGroups;
  clean.starredGroups = normalizeCatalogConfig({ starredGroups: config?.starredGroups || [] }).starredGroups;
  clean.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await tursoPutRaw(env, clean);
  return clean;
}
__name(tursoSaveConfig, "tursoSaveConfig");
function tursoEnsureGroupsFromItems(config, items) {
  const m = new Map((config.groupOptions || []).map((g) => [normalizeName(g.name), { ...g }]));
  for (const a of items || []) {
    const n = plainTitle(a.group || "");
    if (!n || n === "\u0411\u0435\u0437 \u0433\u0440\u0443\u043F\u0438" || m.has(normalizeName(n))) continue;
    m.set(normalizeName(n), { id: `group-${crypto.randomUUID()}`, name: n, color: "default" });
  }
  return { ...config, groupOptions: [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "uk")) };
}
__name(tursoEnsureGroupsFromItems, "tursoEnsureGroupsFromItems");
function tursoBuildOptions(items, config) {
  const statuses = new Set(TITLE_STATUS_OPTIONS), tags = /* @__PURE__ */ new Set(), genres = /* @__PURE__ */ new Set(), themes = /* @__PURE__ */ new Set();
  for (const i of items || []) {
    if (i.status && i.status !== "\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0443") statuses.add(i.status);
    for (const t of normalizeTags(i.tags || [])) tags.add(t);
    for (const g of normalizeTaxonomy(i.genres, GENRE_SOURCES).all) genres.add(g);
    for (const t of normalizeTaxonomy(i.themes, THEME_SOURCES).all) themes.add(t);
  }
  const groupOptions = (config.groupOptions || []).map((g) => ({ ...g, sourceId: "turso" })).sort((a, b) => a.name.localeCompare(b.name, "uk"));
  return { statuses: [...statuses], groups: groupOptions.map((g) => g.name), groupOptions, tags: [...tags].sort((a, b) => a.localeCompare(b, "uk")), genres: [...genres].sort((a, b) => a.localeCompare(b, "uk")), themes: [...themes].sort((a, b) => a.localeCompare(b, "uk")), statusGroups: config.statusGroups || {}, starredGroups: config.starredGroups || [], storage: "turso-libsql" };
}
__name(tursoBuildOptions, "tursoBuildOptions");
async function tursoLoadState(env) {
  const anime = (await tursoScanRaw(env, "anime")).map(tursoNormalizeAnime);
  let config = await tursoGetConfig(env), expanded = tursoEnsureGroupsFromItems(config, anime);
  if (JSON.stringify(expanded.groupOptions) !== JSON.stringify(config.groupOptions)) config = await tursoSaveConfig(env, expanded);
  return { anime, config, options: tursoBuildOptions(anime, config) };
}
__name(tursoLoadState, "tursoLoadState");
function tursoAliasLines(item) {
  return [...new Set([item.title, item.originalTitle, item.englishTitle, item.russianTitle, ...String(item.aliases || "").split(/\r?\n|\s*[|;]\s*/)].map(plainTitle).filter(Boolean))];
}
__name(tursoAliasLines, "tursoAliasLines");
function tursoFindExisting(items, payload) {
  const d = coreTitleData(payload), wanted = new Set([d.main, d.original, d.english, d.russian, ...d.aliases].map(exactCoreTitleKey).filter(Boolean));
  return items.find((i) => tursoAliasLines(i).some((v) => wanted.has(exactCoreTitleKey(v)))) || null;
}
__name(tursoFindExisting, "tursoFindExisting");
function tursoMergeAliases(existing, values) {
  const seen = /* @__PURE__ */ new Set(), out = [];
  for (const v of [...String(existing || "").split(/\r?\n/), ...values || []]) {
    const c = plainTitle(v || ""), k = exactCoreTitleKey(c);
    if (!c || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.join("\n");
}
__name(tursoMergeAliases, "tursoMergeAliases");
function tursoMergeLinksFromCore(existing, siteLinks) {
  const all = [...existing || []];
  for (const [domain, items] of Object.entries(siteLinks || {})) for (const i of items || []) all.push({ name: plainTitle(i?.title || i?.name || "") || domain, url: i?.url || "" });
  return tursoNormalizeLinks(all);
}
__name(tursoMergeLinksFromCore, "tursoMergeLinksFromCore");
async function tursoIngestCorePayload(env, payload) {
  if (!payload || typeof payload !== "object" || !payload.title || typeof payload.title !== "object") throw new HttpError(400, "\u041E\u0447\u0456\u043A\u0443\u0432\u0430\u0432\u0441\u044F schema-v2/v3 JSON \u0432\u0456\u0434 Python core.");
  const state = await tursoLoadState(env), existing = tursoFindExisting(state.anime, payload), d = coreTitleData(payload), links = coreSiteLinks(payload), now = (/* @__PURE__ */ new Date()).toISOString(), base = existing ? tursoNormalizeAnime(existing) : tursoNormalizeAnime({ id: crypto.randomUUID(), addedAt: now }), status = d.status || base.status || "\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0443";
  let viewed = d.hasViewed ? Math.max(0, Number(d.viewed) || 0) : base.viewed;
  if (isCompletedStatus(status) && viewed < 1) viewed = 1;
  const item = tursoNormalizeAnime({ ...base, id: base.id || crypto.randomUUID(), title: d.main || base.title, originalTitle: d.original || base.originalTitle, englishTitle: d.english || base.englishTitle, russianTitle: d.russian || base.russianTitle, aliases: tursoMergeAliases(base.aliases, [d.main, d.original, d.english, d.russian, ...d.aliases]), key: exactCoreTitleKey(d.original || base.originalTitle || d.main || base.title), description: d.description || base.description, poster: d.cover || base.poster, banner: d.banner || base.banner, status, group: d.group || base.group, viewed, season: d.hasSeason ? d.season : base.season, episode: d.hasEpisode ? d.episode : base.episode, tags: [.../* @__PURE__ */ new Set([...base.tags || [], ...d.tags || []])], genres: d.hasGenres ? d.genres : base.genres, themes: d.hasThemes ? d.themes : base.themes, sourceUrl: d.sourceUrl || base.sourceUrl, links: tursoMergeLinksFromCore(base.links, links), updatedAt: now });
  await tursoPutRaw(env, item);
  let config = state.config;
  if (item.group && item.group !== "\u0411\u0435\u0437 \u0433\u0440\u0443\u043F\u0438" && !config.groupOptions.some((g) => normalizeName(g.name) === normalizeName(item.group))) {
    config.groupOptions.push({ id: `group-${crypto.randomUUID()}`, name: item.group, color: "default" });
    await tursoSaveConfig(env, config);
  }
  return { ok: true, existing: Boolean(existing), item: tursoPublicAnime(item), imported: { schemaVersion: payload.schema_version ?? null, coreVersion: payload?.meta?.core_version || "", sites: Object.fromEntries(Object.entries(links).map(([d2, x]) => [d2, x.length])) } };
}
__name(tursoIngestCorePayload, "tursoIngestCorePayload");
async function tursoHandleAnimeApi(request, env) {
  const url = new URL(request.url), id = url.searchParams.get("id") || "", compact = ["1", "true", "yes"].includes(String(url.searchParams.get("compact") || "").toLowerCase());
  if (request.method === "GET") {
    if (id) {
      const raw = await tursoGetRaw(env, id);
      if (!raw || raw.entity !== "anime") return json({ error: "\u0422\u0430\u0439\u0442\u043B \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E." }, 404);
      if (compact) return json({ item: tursoPublicAnime(raw), count: 1, storage: "turso-libsql", compact: true });
      const state2 = await tursoLoadState(env);
      return json({ item: tursoPublicAnime(raw), count: 1, options: state2.options });
    }
    const state = await tursoLoadState(env), items = state.anime.map(tursoSummaryAnime).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    return json({ items, count: items.length, databaseId: "yoru-turso", sources: [{ id: "yoru-turso", name: "Turso", count: items.length }], options: state.options, storage: "turso-libsql" });
  }
  if (request.method === "PATCH") {
    if (!id) return json({ error: "\u041D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E id \u0442\u0430\u0439\u0442\u043B\u0443." }, 400);
    const raw = await tursoGetRaw(env, id);
    if (!raw || raw.entity !== "anime") return json({ error: "\u0422\u0430\u0439\u0442\u043B \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E." }, 404);
    const body = await request.json().catch(() => ({})), item = tursoNormalizeAnime(raw);
    for (const k of ["title", "description", "originalTitle", "englishTitle", "russianTitle", "aliases", "notes"]) if (Object.prototype.hasOwnProperty.call(body, k)) item[k] = String(body[k] ?? "").trim();
    if ("tags" in body) item.tags = normalizeTags(body.tags);
    if ("genres" in body) item.genres = normalizeTaxonomy(body.genres, GENRE_SOURCES);
    if ("themes" in body) item.themes = normalizeTaxonomy(body.themes, THEME_SOURCES);
    if ("status" in body) item.status = plainTitle(body.status || "") || "\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0443";
    if ("group" in body) item.group = plainTitle(body.group || "") || "\u0411\u0435\u0437 \u0433\u0440\u0443\u043F\u0438";
    if ("favorite" in body) item.favorite = Boolean(body.favorite);
    if ("liked" in body) item.liked = Boolean(body.liked);
    if ("viewed" in body) item.viewed = Math.max(0, Math.floor(Number(body.viewed) || 0));
    if ("season" in body) item.season = Math.max(0, Math.floor(Number(body.season) || 0));
    if ("episode" in body) item.episode = Math.max(0, Math.floor(Number(body.episode) || 0));
    if (isCompletedStatus(item.status) && item.viewed < 1) item.viewed = 1;
    if ("posterUrl" in body) {
      const v = String(body.posterUrl || "").trim();
      if (v && !safeHttpUrl(v)) return json({ error: "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 URL \u043F\u043E\u0441\u0442\u0435\u0440\u0430." }, 400);
      item.poster = safeHttpUrl(v);
    }
    if ("bannerUrl" in body) {
      const v = String(body.bannerUrl || "").trim();
      if (v && !safeHttpUrl(v)) return json({ error: "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 URL \u0431\u0430\u043D\u0435\u0440\u0430." }, 400);
      item.banner = safeHttpUrl(v);
    }
    if (body.siteLinks && typeof body.siteLinks === "object") {
      const links = [];
      for (const [d, vals] of Object.entries(body.siteLinks)) {
        if (!SITE_PROPERTIES.includes(d)) continue;
        for (const v of Array.isArray(vals) ? vals : []) links.push({ name: plainTitle(v?.title || v?.name || "") || d, url: v?.url || "" });
      }
      item.links = tursoNormalizeLinks(links);
    }
    item.key = exactCoreTitleKey(item.originalTitle || item.title);
    item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await tursoPutRaw(env, item);
    if (compact) return json({ ok: true, item: tursoPublicAnime(item), storage: "turso-libsql", compact: true });
    let state = await tursoLoadState(env);
    if (item.group && item.group !== "\u0411\u0435\u0437 \u0433\u0440\u0443\u043F\u0438" && !state.config.groupOptions.some((g) => normalizeName(g.name) === normalizeName(item.group))) {
      state.config.groupOptions.push({ id: `group-${crypto.randomUUID()}`, name: item.group, color: "default" });
      state.config = await tursoSaveConfig(env, state.config);
      state.options = tursoBuildOptions(state.anime.map((x) => x.id === item.id ? item : x), state.config);
    }
    return json({ ok: true, item: tursoPublicAnime(item), options: state.options });
  }
  if (request.method === "DELETE") {
    if (!id) return json({ error: "\u041D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E id \u0442\u0430\u0439\u0442\u043B\u0443." }, 400);
    await tursoDeleteRaw(env, id);
    return json({ ok: true, id, deleted: true });
  }
  return json({ error: "Method not allowed" }, 405);
}
__name(tursoHandleAnimeApi, "tursoHandleAnimeApi");
async function tursoHandleViewedApi(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const id = new URL(request.url).searchParams.get("id") || "", raw = await tursoGetRaw(env, id);
  if (!raw || raw.entity !== "anime") return json({ error: "\u0422\u0430\u0439\u0442\u043B \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E." }, 404);
  const item = tursoNormalizeAnime(raw);
  item.viewed = Math.max(1, item.viewed + 1);
  item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await tursoPutRaw(env, item);
  const state = await tursoLoadState(env);
  return json({ ok: true, viewed: item.viewed, item: tursoPublicAnime(item), options: state.options });
}
__name(tursoHandleViewedApi, "tursoHandleViewedApi");
async function tursoHandleOptionsApi(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  return json((await tursoLoadState(env)).options);
}
__name(tursoHandleOptionsApi, "tursoHandleOptionsApi");
async function tursoHandleGroupsApi(request, env) {
  if (request.method === "GET") return json({ ok: true, ...(await tursoLoadState(env)).options });
  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({})), state = await tursoLoadState(env), oldName = plainTitle(body.oldName || ""), requestedId = String(body.id || "").trim(), newName = plainTitle(body.name || oldName);
  if (!newName) return json({ error: "\u041D\u0430\u0437\u0432\u0430 \u0433\u0440\u0443\u043F\u0438 \u043D\u0435 \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u043F\u043E\u0440\u043E\u0436\u043D\u044C\u043E\u044E." }, 400);
  const color = TURSO_GROUP_COLORS.includes(body.color) ? body.color : "default";
  let config = state.config, group = config.groupOptions.find((g) => requestedId && g.id === requestedId || oldName && normalizeName(g.name) === normalizeName(oldName));
  if (!group) group = { id: requestedId || `group-${crypto.randomUUID()}`, name: oldName || newName, color: "default" };
  const previous = group.name;
  group = { ...group, name: newName, color };
  config.groupOptions = config.groupOptions.filter((g) => g.id !== group.id && normalizeName(g.name) !== normalizeName(previous));
  config.groupOptions.push(group);
  let migrated = 0, changed = [];
  if (previous && normalizeName(previous) !== normalizeName(newName)) {
    for (const a of state.anime) if (normalizeName(a.group) === normalizeName(previous)) {
      a.group = newName;
      a.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      changed.push(a);
      migrated++;
    }
    for (const [s, gs] of Object.entries(config.statusGroups || {})) config.statusGroups[s] = gs.map((n) => normalizeName(n) === normalizeName(previous) ? newName : n);
    config.starredGroups = (config.starredGroups || []).map((n) => normalizeName(n) === normalizeName(previous) ? newName : n);
  }
  if ("starred" in body) {
    config.starredGroups = (config.starredGroups || []).filter((n) => normalizeName(n) !== normalizeName(newName));
    if (body.starred) config.starredGroups.unshift(newName);
  }
  if (changed.length) await tursoBatchPut(env, changed);
  config = await tursoSaveConfig(env, config);
  return json({ ok: true, migrated, ...tursoBuildOptions(state.anime.map((x) => changed.find((c) => c.id === x.id) || x), config) });
}
__name(tursoHandleGroupsApi, "tursoHandleGroupsApi");
async function tursoHandleCatalogSettingsApi(request, env) {
  const state = await tursoLoadState(env);
  if (request.method === "GET") return json({ ok: true, ...state.options });
  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({})), status = plainTitle(body.status || "");
  if (!status) return json({ error: "\u041D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u0441\u0442\u0430\u0442\u0443\u0441." }, 400);
  const valid = new Map(state.config.groupOptions.map((g) => [normalizeName(g.name), g.name])), groups = [...new Set((Array.isArray(body.groups) ? body.groups : []).map((x) => valid.get(normalizeName(x))).filter(Boolean))];
  state.config.statusGroups[status] = groups;
  const config = await tursoSaveConfig(env, state.config);
  return json({ ok: true, ...tursoBuildOptions(state.anime, config) });
}
__name(tursoHandleCatalogSettingsApi, "tursoHandleCatalogSettingsApi");
async function tursoHandleExtensionContextApi(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url), primary = cleanTitle(url.searchParams.get("title") || url.searchParams.get("q") || "");
  let extra = [];
  try {
    const p = JSON.parse(url.searchParams.get("titles") || "[]");
    if (Array.isArray(p)) extra = p.map(cleanTitle).filter(Boolean);
  } catch {
  }
  const queries = [...new Set([primary, ...extra].filter(Boolean))].slice(0, 8), state = await tursoLoadState(env);
  if (!queries.length) return json({ ok: true, exists: false, query: "", queries: [], item: null, options: state.options });
  const ranked = state.anime.map((item) => {
    const scores = queries.map((query) => ({ query, score: Math.max(...tursoAliasLines(item).map((v) => aliasMatchScore(query, v))) }));
    scores.sort((a, b) => b.score - a.score);
    return { item, ...scores[0] };
  }).sort((a, b) => b.score - a.score), best = ranked.find((x) => x.score >= 72) || null;
  return json({ ok: true, exists: Boolean(best), query: queries[0], queries, matchedBy: best?.query || "", item: best ? tursoPublicAnime(best.item) : null, options: state.options, debug: { candidates: ranked.slice(0, 5).map((x) => ({ id: x.item.id, score: x.score, matchedBy: x.query, aliases: String(x.item.aliases || "").slice(0, 240) })) } });
}
__name(tursoHandleExtensionContextApi, "tursoHandleExtensionContextApi");
function tursoMergeSide(body, f) {
  return body?.choices?.[f] === "left" ? "left" : "right";
}
__name(tursoMergeSide, "tursoMergeSide");
function tursoChoose(side, left, right) {
  const a = side === "left" ? left : right, b = side === "left" ? right : left;
  return a || b || "";
}
__name(tursoChoose, "tursoChoose");
async function tursoHandleMergeAnimeApi(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({})), rightId = String(body.rightId || "").trim(), leftId = String(body.leftId || "").trim();
  if (!rightId || !leftId || rightId === leftId) return json({ error: "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0430 \u043F\u0430\u0440\u0430 \u0442\u0430\u0439\u0442\u043B\u0456\u0432." }, 400);
  const [rr, lr] = await Promise.all([tursoGetRaw(env, rightId), tursoGetRaw(env, leftId)]);
  if (!rr || !lr) return json({ error: "\u041E\u0434\u0438\u043D \u0456\u0437 \u0442\u0430\u0439\u0442\u043B\u0456\u0432 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E." }, 404);
  const right = tursoNormalizeAnime(rr), left = tursoNormalizeAnime(lr), ts = tursoMergeSide(body, "title"), ps = tursoMergeSide(body, "poster"), ms = tursoMergeSide(body, "marks"), bs = tursoMergeSide(body, "banner"), ds = tursoMergeSide(body, "description"), marks = ms === "left" ? left : right, merged = tursoNormalizeAnime({ ...right, title: tursoChoose(ts, left.title, right.title), originalTitle: tursoChoose(ts, left.originalTitle, right.originalTitle), englishTitle: tursoChoose(ts, left.englishTitle, right.englishTitle), russianTitle: tursoChoose(ts, left.russianTitle, right.russianTitle), aliases: tursoMergeAliases("", [...tursoAliasLines(right), ...tursoAliasLines(left)]), poster: tursoChoose(ps, left.poster, right.poster), banner: tursoChoose(bs, left.banner, right.banner), description: tursoChoose(ds, left.description, right.description), status: marks.status, group: marks.group, favorite: marks.favorite, liked: marks.liked, viewed: marks.viewed, season: marks.season, episode: marks.episode, tags: [.../* @__PURE__ */ new Set([...right.tags || [], ...left.tags || []])], genres: mergeTaxonomy(right.genres, left.genres, GENRE_SOURCES), themes: mergeTaxonomy(right.themes, left.themes, THEME_SOURCES), notes: [right.notes, left.notes].map((x) => String(x || "").trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join("\n\n"), links: tursoNormalizeLinks([...right.links || [], ...left.links || []]), updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await tursoPutRaw(env, merged);
  await tursoDeleteRaw(env, leftId);
  return json({ ok: true, item: tursoPublicAnime(merged), keptId: rightId, removedId: leftId, choices: { title: ts, poster: ps, marks: ms, banner: bs, description: ds } });
}
__name(tursoHandleMergeAnimeApi, "tursoHandleMergeAnimeApi");
async function tursoHandleIngestApi(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  checkIngestKey(request, env);
  const payload = await request.json().catch(() => null), result = await tursoIngestCorePayload(env, payload);
  return json(result, result.existing ? 200 : 201);
}
__name(tursoHandleIngestApi, "tursoHandleIngestApi");
async function tursoHandleHealthApi(env) {
  tursoRequireEnv(env);
  await tursoEnsureSchema(env);
  const health = await fetch(`${tursoHttpBase(env)}/health`, { headers: { authorization: `Bearer ${env.TURSO_AUTH_TOKEN}` } });
  if (!health.ok) throw new HttpError(502, `Turso health HTTP ${health.status}`, "", String(health.status), "turso_health");
  const state = await tursoLoadState(env);
  return json({ ok: true, storage: "turso-libsql", databaseUrlConfigured: Boolean(env.TURSO_DATABASE_URL), tokenConfigured: Boolean(env.TURSO_AUTH_TOKEN), databaseHost: new URL(tursoHttpBase(env)).host, itemCount: state.anime.length, groupCount: state.config.groupOptions.length, credentialsConfigured: true });
}
__name(tursoHandleHealthApi, "tursoHandleHealthApi");
async function handleCoreSearchApi(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => ({})), title = plainTitle(b.title || ""), limit = Math.min(10, Math.max(1, Number(b.limit) || 8));
  if (!title) return json({ error: "\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u0430 \u043D\u0430\u0437\u0432\u0430 \u0442\u0430\u0439\u0442\u043B\u0443." }, 400);
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.CORE_API_KEY) headers["X-API-Key"] = env.CORE_API_KEY;
  const r = await fetch(env.CORE_SEARCH_URL || CORE_SEARCH_URL, { method: "POST", headers, body: JSON.stringify({ title, limit }) }), raw = await r.text();
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
  }
  if (!r.ok) throw new HttpError(502, `Python core search HTTP ${r.status}: ${p?.detail || p?.error || raw.slice(0, 600)}`);
  return json(p);
}
__name(handleCoreSearchApi, "handleCoreSearchApi");
async function handleCoreTaxonomyApi(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => ({})), title = plainTitle(b.title || "");
  if (!title) return json({ error: "\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u0430 \u043D\u0430\u0437\u0432\u0430 \u0442\u0430\u0439\u0442\u043B\u0443." }, 400);
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.CORE_API_KEY) headers["X-API-Key"] = env.CORE_API_KEY;
  const r = await fetch(env.CORE_TAXONOMY_URL || CORE_TAXONOMY_URL, { method: "POST", headers, body: JSON.stringify({ ...b, title }) }), raw = await r.text();
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
  }
  if (!r.ok || !p) throw new HttpError(502, `Python core taxonomy HTTP ${r.status}: ${p?.detail || p?.error || raw.slice(0, 600)}`);
  return json(p);
}
__name(handleCoreTaxonomyApi, "handleCoreTaxonomyApi");
async function handleProcessTitleStreamApi(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => ({})), title = plainTitle(b.title || ""), url = safeHttpUrl(b.url || "");
  if (!title || !url) return json({ error: "\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u0456 title \u0442\u0430 url." }, 400);
  const headers = { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" };
  if (env.CORE_API_KEY) headers["X-API-Key"] = env.CORE_API_KEY;
  const r = await fetch(env.CORE_PROCESS_STREAM_URL || CORE_PROCESS_STREAM_URL, { method: "POST", headers, body: JSON.stringify({ ...b, title, url }) });
  if (!r.ok || !r.body) {
    const raw = await r.text().catch(() => "");
    return json({ error: `Python core stream HTTP ${r.status}: ${raw.slice(0, 700)}` }, 502);
  }
  return new Response(r.body, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
}
__name(handleProcessTitleStreamApi, "handleProcessTitleStreamApi");
async function handleProcessTitleApi(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => ({})), title = plainTitle(b.title || ""), url = safeHttpUrl(b.url || "");
  if (!title || !url) return json({ error: "\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u0456 title \u0442\u0430 url." }, 400);
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.CORE_API_KEY) headers["X-API-Key"] = env.CORE_API_KEY;
  const r = await fetch(env.CORE_PROCESS_FULL_URL || CORE_PROCESS_FULL_URL, { method: "POST", headers, body: JSON.stringify({ ...b, title, url }) }), raw = await r.text();
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
  }
  if (!r.ok || !p) throw new HttpError(502, `Python core HTTP ${r.status}: ${p?.error || raw.slice(0, 700)}`);
  const saved = await tursoIngestCorePayload(env, p);
  return json({ ...saved, core: { schemaVersion: p.schema_version ?? null, version: p?.meta?.core_version || "" } }, saved.existing ? 200 : 201);
}
__name(handleProcessTitleApi, "handleProcessTitleApi");
var ANILIST_FIELDS = `id idMal siteUrl format seasonYear episodes bannerImage description(asHtml:false) countryOfOrigin coverImage { extraLarge large medium color } title { romaji english native } synonyms`;
async function handleDiscoverApi(request) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const q = cleanTitle(new URL(request.url).searchParams.get("q") || "");
  if (!q) return json({ items: [], provider: null });
  const query = `query($search:String!){Page(page:1,perPage:10){media(search:$search,type:ANIME){${ANILIST_FIELDS}}}}`;
  const r = await fetch(ANILIST_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query, variables: { search: q } }) });
  if (!r.ok) return json({ items: [], provider: "anilist", warning: `AniList HTTP ${r.status}` });
  const p = await r.json();
  const items = (p?.data?.Page?.media || []).map((m) => ({ id: m.id, idMal: m.idMal, siteUrl: m.siteUrl, year: m.seasonYear || null, episodes: m.episodes || null, poster: m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || "", banner: m.bannerImage || "", description: m.description || "", title: m.title || {}, synonyms: m.synonyms || [] }));
  return json({ items, provider: "anilist-server", fallback: false });
}
__name(handleDiscoverApi, "handleDiscoverApi");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "Content-Type, X-Ingest-Key", "access-control-max-age": "86400" } });
      if (url.pathname === "/api/core-search") return handleCoreSearchApi(request, env);
      if (url.pathname === "/api/core-taxonomy") return handleCoreTaxonomyApi(request, env);
      if (url.pathname === "/api/process-title-stream") return handleProcessTitleStreamApi(request, env);
      if (url.pathname === "/api/process-title") return handleProcessTitleApi(request, env);
      if (url.pathname === "/api/ingest" || url.pathname === "/api/anime/import") return tursoHandleIngestApi(request, env);
      if (request.method === "POST" && url.pathname === "/" && (request.headers.get("content-type") || "").includes("application/json")) return tursoHandleIngestApi(request, env);
      if (url.pathname === "/api/anime/merge") return tursoHandleMergeAnimeApi(request, env);
      if (url.pathname === "/api/anime/viewed") return tursoHandleViewedApi(request, env);
      if (url.pathname === "/api/groups") return tursoHandleGroupsApi(request, env);
      if (url.pathname === "/api/catalog-settings") return tursoHandleCatalogSettingsApi(request, env);
      if (url.pathname === "/api/anime/upload") return json({ error: "\u0417\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043D\u044F \u0444\u0430\u0439\u043B\u0456\u0432 \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E. \u0412\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u0439 URL \u043F\u043E\u0441\u0442\u0435\u0440\u0430/\u0431\u0430\u043D\u0435\u0440\u0430." }, 410);
      if (url.pathname === "/api/extension/context") return tursoHandleExtensionContextApi(request, env);
      if (url.pathname === "/api/anime") return tursoHandleAnimeApi(request, env);
      if (url.pathname === "/api/options") return tursoHandleOptionsApi(request, env);
      if (url.pathname === "/api/discover") return handleDiscoverApi(request);
      if (url.pathname === "/api/version") return json({ ok: true, version: "yoru-v7.2.4-uk-taxonomy-2026-09-11", storage: "turso-libsql", pythonCoreSearch: env.CORE_SEARCH_URL || CORE_SEARCH_URL, pythonCoreProcessStream: env.CORE_PROCESS_STREAM_URL || CORE_PROCESS_STREAM_URL, pythonCoreProcessFull: env.CORE_PROCESS_FULL_URL || CORE_PROCESS_FULL_URL, progressProtocol: "ndjson-v1", coreJsonIngest: true, mergeTitles: true, deleteTitles: true, editTitles: true, extensionContext: "/api/extension/context", favoriteStorage: "turso-libsql", likedStorage: "turso-libsql", viewedStorage: "turso-libsql", seasonEpisodeStorage: "turso-libsql", groupSettings: "/api/groups", catalogSettings: "/api/catalog-settings", tagDelimiter: "dot", taxonomy: true, genreSources: GENRE_SOURCES, themeSources: THEME_SOURCES, coreTaxonomy: "/api/core-taxonomy" });
      if (url.pathname === "/api/health") return tursoHandleHealthApi(env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Yoru Turso worker error", error);
      const status = error instanceof HttpError ? error.status : 500;
      const payload = { error: error?.message || "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u043F\u043E\u043C\u0438\u043B\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430." };
      if (error instanceof HttpError) {
        if (error.code) payload.code = error.code;
        if (error.step) payload.step = error.step;
        if (error.details) payload.details = error.details;
      }
      return json(payload, status >= 400 && status < 600 ? status : 500);
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=bundledWorker-0.16213041250511107.mjs.map
