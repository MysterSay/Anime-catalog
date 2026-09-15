const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const CORE_PROCESS_URL = 'https://anime-catalog-flame.vercel.app/api/process';
const CORE_PROCESS_FULL_URL = 'https://anime-catalog-flame.vercel.app/api/process-full';
const CORE_PROCESS_STREAM_URL = 'https://anime-catalog-flame.vercel.app/api/process-stream';
const CORE_SEARCH_URL = 'https://anime-catalog-flame.vercel.app/api/search';
const CORE_TAXONOMY_URL = 'https://anime-catalog-flame.vercel.app/api/taxonomy';

const TITLE_STATUS_OPTIONS = ['Добавленно', 'Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто'];
const CATALOG_CONFIG_VERSION = 1;
const CATALOG_GROUPS = {
  RU: ['jut-su.net', 'ru.yummyani.me', 'crunchyroll.com', 'shikimori.io', 'animevost.org', 'jutsu.tv', 'jut.su', 'animego.studio', 'anilibria.tv'],
  UA: ['uaserials.com', 'uachan.com', 'anihub.in.ua', 'amanogawa.space', 'animeon.club', 'anidesu.net', 'mikai.me', 'anitube.in.ua'],
};
const CATALOGS = [...CATALOG_GROUPS.RU, ...CATALOG_GROUPS.UA];
const AUTHORITY_SITES = ['myanimelist.net', 'anilist.co', 'shikimori.io'];
const SITE_PROPERTIES = [...new Set([...AUTHORITY_SITES, ...CATALOGS])];
const SEARCH_HOST_ALIASES = {
  'anilibria.tv': ['aniliberty.top', 'www.aniliberty.top', 'anilibria.top', 'www.anilibria.top', 'anilibria.tv'],
  'crunchyroll.com': ['www.crunchyroll.com', 'crunchyroll.com'],
  'uachan.com': ['uachan.top', 'www.uachan.top', 'uachan.com', 'www.uachan.com'],
};

class HttpError extends Error {
  constructor(status, message, details = '', code = '', step = '') {
    super(message);
    this.status = status; this.details = details; this.code = code; this.step = step;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, X-Ingest-Key',
      ...extraHeaders,
    },
  });
}
function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, '').trim();
}
function plainTitle(value) { return cleanTitle(String(value || '').replace(/<[^>]+>/g, ' ')); }
function normalizeName(value) { return plainTitle(value).normalize('NFKC').toLocaleLowerCase(); }
function exactCoreTitleKey(value) {
  return plainTitle(value).normalize('NFKC').toLocaleLowerCase().replace(/[’'`´]/g, '').replace(/[‐‑‒–—―]/g, '-').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function safeHttpUrl(value) {
  try { const u = new URL(String(value || '').trim()); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; }
}
function trailerIdFromUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || '';
    if (host.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/);
      return m ? m[1] : '';
    }
    if (host.endsWith('dailymotion.com')) {
      const m = u.pathname.match(/^\/(?:video|embed\/video)\/([^/?#]+)/);
      return m ? m[1] : '';
    }
  } catch {}
  return '';
}
function normalizeTrailer(value) {
  const raw = typeof value === 'string' ? { url: value } : (value && typeof value === 'object' ? value : {});
  let url = safeHttpUrl(raw.url || raw.trailer_url || '');
  let embedUrl = safeHttpUrl(raw.embedUrl || raw.embed_url || raw.playerUrl || raw.player_url || '');
  let id = plainTitle(raw.id || raw.trailer_id || '') || trailerIdFromUrl(embedUrl || url);
  let site = plainTitle(raw.site || raw.trailer_site || '').toLowerCase();
  const source = plainTitle(raw.source || raw.trailer_source || '');
  const thumbnail = safeHttpUrl(raw.thumbnail || raw.image || raw.image_url || raw.trailer_thumbnail || '');
  const probe = `${embedUrl} ${url}`.toLowerCase();
  if (!site) {
    if (probe.includes('youtu')) site = 'youtube';
    else if (probe.includes('dailymotion')) site = 'dailymotion';
  }
  if (id && !url) {
    if (site === 'youtube') url = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    else if (site === 'dailymotion') url = `https://www.dailymotion.com/video/${encodeURIComponent(id)}`;
  }
  if (id && !embedUrl) {
    if (site === 'youtube') embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    else if (site === 'dailymotion') embedUrl = `https://www.dailymotion.com/embed/video/${encodeURIComponent(id)}`;
  }
  if (!url && !embedUrl) return { url:'', embedUrl:'', site:'', id:'', thumbnail:'', source:'' };
  return { url, embedUrl, site, id, thumbnail, source };
}
function normalizeTags(value = []) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/(?:\.\s*|[\n,;]+)/);
  return [...new Set(raw.map(x => String(x || '').trim().replace(/^#+/, '').replace(/\.+$/, '')).filter(Boolean))].slice(0, 100);
}
const GENRE_SOURCES = ['myanimelist.net','shikimori.io','anilist.co'];
const THEME_SOURCES = ['myanimelist.net','shikimori.io'];
const TAXONOMY_UK = Object.freeze({
  'action': 'Екшен',
  'adventure': 'Пригоди',
  'avant garde': 'Авангард',
  'award winning': 'Відзначене нагородами',
  'boys love': 'Хлопчаче кохання',
  'comedy': 'Комедія',
  'drama': 'Драма',
  'fantasy': 'Фентезі',
  'girls love': 'Дівоче кохання',
  'gourmet': 'Гурманське',
  'horror': 'Жахи',
  'mystery': 'Таємниці',
  'romance': 'Романтика',
  'sci fi': 'Наукова фантастика',
  'science fiction': 'Наукова фантастика',
  'slice of life': 'Повсякденність',
  'sports': 'Спорт',
  'supernatural': 'Надприродне',
  'suspense': 'Трилер',
  'thriller': 'Трилер',
  'ecchi': 'Етті',
  'erotica': 'Еротика',
  'hentai': 'Хентай',
  'josei': 'Дзьосей',
  'kids': 'Для дітей',
  'seinen': 'Сейнен',
  'shoujo': 'Сьодзьо',
  'shojo': 'Сьодзьо',
  'shounen': 'Сьонен',
  'shonen': 'Сьонен',
  'adult cast': 'Дорослі персонажі',
  'anthropomorphic': 'Антропоморфізм',
  'cgdct': 'Милі дівчата роблять милі речі',
  'childcare': 'Догляд за дітьми',
  'combat sports': 'Бойові види спорту',
  'crossdressing': 'Кросдресинг',
  'delinquents': 'Хулігани',
  'detective': 'Детектив',
  'educational': 'Освітнє',
  'gag humor': 'Гег-гумор',
  'gore': 'Криваві сцени',
  'harem': 'Гарем',
  'high stakes game': 'Гра з високими ставками',
  'historical': 'Історичне',
  'idols female': 'Жіночі айдоли',
  'idols male': 'Чоловічі айдоли',
  'isekai': 'Ісекай',
  'iyashikei': 'Іяшікеї',
  'love polygon': 'Любовний багатокутник',
  'magical sex shift': 'Магічна зміна статі',
  'mahou shoujo': 'Дівчата-чарівниці',
  'maho shojo': 'Дівчата-чарівниці',
  'martial arts': 'Бойові мистецтва',
  'mecha': 'Меха',
  'medical': 'Медицина',
  'military': 'Військове',
  'music': 'Музика',
  'mythology': 'Міфологія',
  'organized crime': 'Організована злочинність',
  'otaku culture': 'Отаку-культура',
  'parody': 'Пародія',
  'performing arts': 'Сценічне мистецтво',
  'pets': 'Домашні тварини',
  'psychological': 'Психологічне',
  'racing': 'Перегони',
  'reincarnation': 'Реінкарнація',
  'reverse harem': 'Зворотний гарем',
  'romantic subtext': 'Романтичний підтекст',
  'samurai': 'Самураї',
  'school': 'Школа',
  'showbiz': 'Шоу-бізнес',
  'space': 'Космос',
  'strategy game': 'Стратегічна гра',
  'super power': 'Надздібності',
  'survival': 'Виживання',
  'team sports': 'Командний спорт',
  'time travel': 'Подорожі в часі',
  'vampire': 'Вампіри',
  'video game': 'Відеоігри',
  'visual arts': 'Образотворче мистецтво',
  'workplace': 'Робота',
});
function taxonomyUkName(value) {
  const text = plainTitle(value);
  if (!text) return "";
  const key = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " " ).trim();
  return TAXONOMY_UK[key] || text;
}
function normalizeTaxonomyNames(value = []) {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set(), out = [];
  for (const item of raw) {
    const name = taxonomyUkName(item && typeof item === 'object' ? (item.name || item.title || item.english || item.russian || '') : item);
    const key = normalizeName(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key); out.push(name);
    if (out.length >= 100) break;
  }
  return out;
}
function normalizeTaxonomy(value, allowedSources) {
  const allowed = Array.isArray(allowedSources) ? allowedSources : [];
  const sources = Object.fromEntries(allowed.map(site => [site, []]));
  let all = [];
  if (Array.isArray(value)) {
    all = normalizeTaxonomyNames(value);
  } else if (value && typeof value === 'object') {
    const src = value.sources && typeof value.sources === 'object' ? value.sources : value;
    for (const site of allowed) sources[site] = normalizeTaxonomyNames(src?.[site] || []);
    all = normalizeTaxonomyNames(Array.isArray(value.all) ? value.all : allowed.flatMap(site => sources[site] || []));
  }
  if (!all.length) all = normalizeTaxonomyNames(allowed.flatMap(site => sources[site] || []));
  return { all, sources };
}
function mergeTaxonomy(left, right, allowedSources) {
  const a = normalizeTaxonomy(left, allowedSources), b = normalizeTaxonomy(right, allowedSources);
  const sources = {};
  for (const site of allowedSources) sources[site] = normalizeTaxonomyNames([...(a.sources[site] || []), ...(b.sources[site] || [])]);
  return { all: normalizeTaxonomyNames([...a.all, ...b.all, ...allowedSources.flatMap(site => sources[site])]), sources };
}
function normalizeCatalogConfig(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const statusGroups = {};
  for (const [status, groups] of Object.entries(raw.statusGroups || {})) {
    const s = plainTitle(status); if (!s) continue;
    statusGroups[s] = [...new Set((Array.isArray(groups) ? groups : []).map(plainTitle).filter(x => x && x !== 'Без групи'))];
  }
  const starredGroups = [...new Set((Array.isArray(raw.starredGroups) ? raw.starredGroups : []).map(plainTitle).filter(x => x && x !== 'Без групи'))];
  return { version: CATALOG_CONFIG_VERSION, statusGroups, starredGroups };
}
function isCompletedStatus(status) { return normalizeName(status) === normalizeName('Переглянув'); }
function canonicalSitePropertyForUrl(value) {
  const url = safeHttpUrl(value); if (!url) return '';
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  for (const domain of SITE_PROPERTIES) {
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
    for (const alias of SEARCH_HOST_ALIASES[domain] || []) if (host === alias.replace(/^www\./, '')) return domain;
  }
  return '';
}
function aliasMatchScore(query, candidate) {
  const q = exactCoreTitleKey(query), c = exactCoreTitleKey(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.includes(q) || q.includes(c)) {
    const ratio = Math.min(q.length, c.length) / Math.max(q.length, c.length);
    if (ratio >= .72) return 88;
    if (ratio >= .55) return 78;
  }
  const qa = new Set(q.split(' ').filter(Boolean)), ca = new Set(c.split(' ').filter(Boolean));
  let overlap = 0; for (const t of qa) if (ca.has(t)) overlap++;
  const coverage = overlap / Math.max(1, Math.min(qa.size, ca.size));
  const union = new Set([...qa, ...ca]).size;
  const jaccard = overlap / Math.max(1, union);
  if (overlap >= 3 && coverage >= .72) return 68 + Math.round(jaccard * 18);
  return 0;
}
function htmlToPlainText(value) {
  return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}
function coreBucketItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['items','results','links','data']) if (Array.isArray(value[key])) return value[key];
  return [];
}
function coreLinkEntries(payload) {
  const out = [], seen = new Set();
  for (const bucket of [payload?.authority, payload?.catalogs]) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [declaredDomain, rawItems] of Object.entries(bucket)) {
      const items = coreBucketItems(rawItems);
      for (const item of items) {
        const url = safeHttpUrl(item?.url || item?.link || item?.href || '');
        if (!url) continue;
        const key = url.replace(/#.*$/, '').replace(/\/$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        const canonical = canonicalSitePropertyForUrl(url) || String(declaredDomain || '').trim().toLowerCase().replace(/^www\./, '') || new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        out.push({
          domain: canonical,
          url,
          title: plainTitle(item?.title || item?.name || item?.label || '') || canonical || 'Посилання',
          kind: item?.kind || 'exact',
        });
      }
    }
  }
  return out;
}
function coreSiteLinks(payload) {
  const out = {};
  for (const item of coreLinkEntries(payload)) {
    const domain = item.domain || canonicalSitePropertyForUrl(item.url) || 'links';
    if (!out[domain]) out[domain] = [];
    out[domain].push({ url: item.url, title: item.title, kind: item.kind });
  }
  return out;
}
function coreTitleData(payload) {
  const title = payload?.title && typeof payload.title === 'object' ? payload.title : {};
  const input = payload?.input && typeof payload.input === 'object' ? payload.input : {};
  return {
    main: plainTitle(title.ukrainian || input.title || title.original || title.english || title.russian || 'Без назви'),
    original: plainTitle(title.original || ''), english: plainTitle(title.english || ''), russian: plainTitle(title.russian || ''),
    aliases: Array.isArray(title.aliases) ? title.aliases.map(plainTitle).filter(Boolean) : [],
    description: htmlToPlainText(payload?.description_uk || ''), cover: safeHttpUrl(payload?.cover?.url || ''), banner: safeHttpUrl(payload?.banner?.url || ''), trailer: normalizeTrailer(payload?.trailer),
    status: plainTitle(payload?.status || input.status || ''), group: plainTitle(payload?.group || input.group || ''),
    viewed: Math.max(0, Number(payload?.viewed ?? input.viewed) || 0), season: Math.max(0, Number(payload?.season ?? input.season) || 0), episode: Math.max(0, Number(payload?.episode ?? input.episode) || 0),
    hasSeason: Object.prototype.hasOwnProperty.call(payload || {}, 'season') || Object.prototype.hasOwnProperty.call(input || {}, 'season'),
    hasEpisode: Object.prototype.hasOwnProperty.call(payload || {}, 'episode') || Object.prototype.hasOwnProperty.call(input || {}, 'episode'),
    hasViewed: Object.prototype.hasOwnProperty.call(payload || {}, 'viewed') || Object.prototype.hasOwnProperty.call(input || {}, 'viewed'),
    sourceUrl: safeHttpUrl(input.url || ''), tags: normalizeTags(payload?.tags ?? input.tags ?? []),
    genres: normalizeTaxonomy(payload?.genres, GENRE_SOURCES),
    themes: normalizeTaxonomy(payload?.themes, THEME_SOURCES),
    hasGenres: Object.prototype.hasOwnProperty.call(payload || {}, 'genres'),
    hasThemes: Object.prototype.hasOwnProperty.call(payload || {}, 'themes'),
  };
}

function checkIngestKey(request, env) {
  if (!env.INGEST_KEY) return;
  if ((request.headers.get('X-Ingest-Key') || '') !== env.INGEST_KEY) throw new HttpError(401, 'Невірний або відсутній X-Ingest-Key.', '', 'ingest_auth', 'ingest');
}

// ==================== TURSO LIBSQL STORAGE ====================
const TURSO_CONFIG_ID = 'CONFIG#CATALOG';
const TURSO_STORAGE_VERSION = 2;
const TURSO_GROUP_COLORS = ['default','gray','brown','orange','yellow','green','blue','purple','pink','red'];

let TURSO_SCHEMA_READY = false;
let TURSO_SCHEMA_PROMISE = null;

function tursoRequireEnv(env) {
  const missing = [];
  for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']) if (!env[key]) missing.push(key);
  if (missing.length) throw new HttpError(500, `У Cloudflare не задано Turso secrets: ${missing.join(', ')}`, '', 'turso_config', 'turso');
}
function tursoHttpBase(env) {
  tursoRequireEnv(env);
  const raw = String(env.TURSO_DATABASE_URL || '').trim().replace(/\/$/, '');
  if (raw.startsWith('libsql://')) return `https://${raw.slice('libsql://'.length)}`;
  if (raw.startsWith('https://')) return raw;
  throw new HttpError(500, 'TURSO_DATABASE_URL повинен починатися з libsql:// або https://', '', 'turso_url', 'turso');
}
function tursoArg(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { type: 'null' };
    if (Number.isInteger(value)) return { type: 'integer', value: String(value) };
    return { type: 'float', value: String(value) };
  }
  return { type: 'text', value: String(value) };
}
function tursoCellValue(cell) {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer') return Number(cell.value || 0);
  if (cell.type === 'float') return Number(cell.value || 0);
  if (cell.type === 'text') return String(cell.value ?? '');
  if (cell.type === 'blob') return cell.base64 || '';
  return cell.value ?? null;
}
function tursoResultRows(result) {
  const cols = result?.cols || [];
  return (result?.rows || []).map(row => Object.fromEntries(cols.map((c, i) => [c.name, tursoCellValue(row[i])] )));
}
async function tursoPipeline(env, statements, { skipSchema = false } = {}) {
  tursoRequireEnv(env);
  if (!skipSchema) await tursoEnsureSchema(env);
  const requests = statements.map(stmt => ({
    type: 'execute',
    stmt: {
      sql: String(stmt.sql || ''),
      ...(Array.isArray(stmt.args) ? { args: stmt.args.map(tursoArg) } : {}),
    },
  }));
  requests.push({ type: 'close' });
  const response = await fetch(`${tursoHttpBase(env)}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.TURSO_AUTH_TOKEN}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = null; }
  if (!response.ok || !payload) {
    throw new HttpError(502, `Turso HTTP ${response.status}: ${payload?.error?.message || raw.slice(0, 700) || response.statusText}`, raw.slice(0, 1200), String(response.status), 'turso_http');
  }
  const out = [];
  for (let i = 0; i < statements.length; i++) {
    const entry = payload.results?.[i];
    if (!entry) throw new HttpError(502, `Turso не повернув результат для SQL #${i + 1}.`, JSON.stringify(payload).slice(0, 1200), 'missing_result', 'turso_sql');
    if (entry.type !== 'ok') {
      const err = entry.error || entry.response?.error || {};
      throw new HttpError(502, `Turso SQL: ${err.message || err.code || 'невідома помилка'}`, JSON.stringify(entry).slice(0, 1200), err.code || 'sql_error', 'turso_sql');
    }
    out.push(entry.response?.result || { cols: [], rows: [], affected_row_count: 0 });
  }
  return out;
}
async function tursoEnsureSchema(env) {
  if (TURSO_SCHEMA_READY) return;
  if (!TURSO_SCHEMA_PROMISE) {
    TURSO_SCHEMA_PROMISE = (async () => {
      await tursoPipeline(env, [
        { sql: `CREATE TABLE IF NOT EXISTS yoru_items (id TEXT PRIMARY KEY NOT NULL, entity TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)` },
        { sql: `CREATE INDEX IF NOT EXISTS idx_yoru_items_entity ON yoru_items(entity)` },
      ], { skipSchema: true });
      TURSO_SCHEMA_READY = true;
    })().finally(() => { TURSO_SCHEMA_PROMISE = null; });
  }
  return TURSO_SCHEMA_PROMISE;
}
async function tursoGetRaw(env, id) {
  const [r] = await tursoPipeline(env, [{ sql: 'SELECT data FROM yoru_items WHERE id = ? LIMIT 1', args: [id] }]);
  const row = tursoResultRows(r)[0];
  if (!row?.data) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}
async function tursoPutRaw(env, item) {
  const clean = item && typeof item === 'object' ? item : {};
  const id = String(clean.id || '').trim();
  if (!id) throw new HttpError(400, 'Turso item не має id.', '', 'missing_id', 'turso_put');
  const entity = String(clean.entity || 'anime');
  const updated = String(clean.updatedAt || new Date().toISOString());
  const data = JSON.stringify(clean);
  await tursoPipeline(env, [{
    sql: `INSERT INTO yoru_items (id, entity, data, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET entity = excluded.entity, data = excluded.data, updated_at = excluded.updated_at`,
    args: [id, entity, data, updated],
  }]);
  return clean;
}
async function tursoDeleteRaw(env, id) {
  await tursoPipeline(env, [{ sql: 'DELETE FROM yoru_items WHERE id = ?', args: [id] }]);
}
async function tursoScanRaw(env, entity = '') {
  const [r] = await tursoPipeline(env, [{
    sql: entity ? 'SELECT data FROM yoru_items WHERE entity = ? ORDER BY updated_at DESC' : 'SELECT data FROM yoru_items ORDER BY updated_at DESC',
    args: entity ? [entity] : [],
  }]);
  const items = [];
  for (const row of tursoResultRows(r)) {
    try { const item = JSON.parse(row.data); if (item && typeof item === 'object') items.push(item); } catch {}
  }
  return items;
}
async function tursoBatchPut(env, items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    await tursoPipeline(env, chunk.map(item => {
      const clean = item && typeof item === 'object' ? item : {};
      return {
        sql: `INSERT INTO yoru_items (id, entity, data, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET entity = excluded.entity, data = excluded.data, updated_at = excluded.updated_at`,
        args: [String(clean.id || ''), String(clean.entity || 'anime'), JSON.stringify(clean), String(clean.updatedAt || new Date().toISOString())],
      };
    }));
  }
}
function tursoNormalizeLinks(value){const seen=new Set(),out=[];for(const item of Array.isArray(value)?value:[]){const url=safeHttpUrl(item?.url||item?.link||item?.href||'');if(!url)continue;const key=url.replace(/#.*$/,'').replace(/\/$/,'');if(seen.has(key))continue;seen.add(key);out.push({name:plainTitle(item?.name||item?.title||item?.label||'')||canonicalSitePropertyForUrl(url)||new URL(url).hostname.replace(/^www\./,'')||'Посилання',url})}return out}
function tursoSiteLinksFromFlat(value){const out={};for(const item of tursoNormalizeLinks(value)){const domain=canonicalSitePropertyForUrl(item.url)||new URL(item.url).hostname.toLowerCase().replace(/^www\./,'');if(!out[domain])out[domain]=[];out[domain].push({name:item.name,url:item.url})}return out}
function tursoNormalizeSiteLinks(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const[declaredDomain,raw]of Object.entries(value)){for(const item of coreBucketItems(raw)){const url=safeHttpUrl(item?.url||item?.link||item?.href||'');if(!url)continue;const domain=canonicalSitePropertyForUrl(url)||String(declaredDomain||'').trim().toLowerCase().replace(/^www\./,'')||new URL(url).hostname.toLowerCase().replace(/^www\./,'');if(!out[domain])out[domain]=[];out[domain].push({name:plainTitle(item?.name||item?.title||item?.label||'')||domain,url})}}for(const domain of Object.keys(out))out[domain]=tursoNormalizeLinks(out[domain]);return out}
function tursoMergeSiteLinks(...maps){const out={};for(const map of maps){const normalized=tursoNormalizeSiteLinks(map);for(const[domain,items]of Object.entries(normalized)){if(!out[domain])out[domain]=[];out[domain]=tursoNormalizeLinks([...out[domain],...items])}}return out}
function tursoFlattenSiteLinks(map){const all=[];for(const items of Object.values(tursoNormalizeSiteLinks(map)))all.push(...items);return tursoNormalizeLinks(all)}
function tursoSiteCounts(map){return Object.fromEntries(Object.entries(tursoNormalizeSiteLinks(map)).map(([domain,items])=>[domain,items.length]).filter(([,count])=>count>0))}
function tursoNormalizeAnime(raw={}){
  const i=raw&&typeof raw==='object'?raw:{},poster=safeHttpUrl(i.poster||''),banner=safeHttpUrl(i.banner||'');
  const legacyLinks=tursoNormalizeLinks(i.links);
  const siteLinks=tursoMergeSiteLinks(tursoSiteLinksFromFlat(legacyLinks),i.siteLinks);
  const links=tursoNormalizeLinks([...legacyLinks,...tursoFlattenSiteLinks(siteLinks)]);
  return {
    id:String(i.id||''),entity:'anime',title:plainTitle(i.title||'')||'Без назви',originalTitle:plainTitle(i.originalTitle||''),englishTitle:plainTitle(i.englishTitle||''),russianTitle:plainTitle(i.russianTitle||''),aliases:String(i.aliases||''),key:String(i.key||exactCoreTitleKey(i.originalTitle||i.title||'')),
    poster,banner:banner||poster,trailer:normalizeTrailer(i.trailer),description:String(i.description||''),status:plainTitle(i.status||'')||'Без статусу',group:plainTitle(i.group||'')||'Без групи',addedAt:String(i.addedAt||new Date().toISOString()),updatedAt:String(i.updatedAt||i.addedAt||new Date().toISOString()),favorite:Boolean(i.favorite),liked:Boolean(i.liked),viewed:Math.max(0,Math.floor(Number(i.viewed)||0)),season:Math.max(0,Math.floor(Number(i.season)||0)),episode:Math.max(0,Math.floor(Number(i.episode)||0)),
    tags:normalizeTags(i.tags||[]),notes:String(i.notes||''),genres:normalizeTaxonomy(i.genres,GENRE_SOURCES),themes:normalizeTaxonomy(i.themes,THEME_SOURCES),links,siteLinks,sourceUrl:safeHttpUrl(i.sourceUrl||''),migratedFrom:String(i.migratedFrom||'')
  };
}
function tursoPublicAnime(raw){const i=tursoNormalizeAnime(raw);return{...i,hasPoster:Boolean(i.poster),hasBanner:Boolean(i.banner),hasTrailer:Boolean(i.trailer?.embedUrl||i.trailer?.url)}}
function tursoSummaryAnime(raw){const i=tursoPublicAnime(raw);return{id:i.id,title:i.title,poster:i.poster,status:i.status,group:i.group,addedAt:i.addedAt,favorite:i.favorite,liked:i.liked,viewed:i.viewed,season:i.season,episode:i.episode,tags:i.tags,genres:i.genres.all,themes:i.themes.all,description:String(i.description||'').slice(0,420)}}
function tursoDefaultConfig(){return{id:TURSO_CONFIG_ID,entity:'config',version:TURSO_STORAGE_VERSION,groupOptions:[],statusGroups:{},starredGroups:[],mikaiApiKey:'',mikaiSendToCore:false,trailerBackgroundEnabled:false,updatedAt:new Date().toISOString()}}
async function tursoGetConfig(env){const raw=await tursoGetRaw(env,TURSO_CONFIG_ID);if(!raw)return tursoDefaultConfig();const c=tursoDefaultConfig();c.groupOptions=Array.isArray(raw.groupOptions)?raw.groupOptions.map(g=>({id:String(g?.id||''),name:plainTitle(g?.name||''),color:TURSO_GROUP_COLORS.includes(g?.color)?g.color:'default'})).filter(g=>g.name):[];c.statusGroups=raw.statusGroups&&typeof raw.statusGroups==='object'?raw.statusGroups:{};c.starredGroups=Array.isArray(raw.starredGroups)?raw.starredGroups.map(plainTitle).filter(Boolean):[];c.mikaiApiKey=String(raw.mikaiApiKey||'').trim();c.mikaiSendToCore=Boolean(raw.mikaiSendToCore);c.trailerBackgroundEnabled=Boolean(raw.trailerBackgroundEnabled);return c}
async function tursoSaveConfig(env,config){const clean=tursoDefaultConfig();clean.groupOptions=Array.isArray(config?.groupOptions)?config.groupOptions.map(g=>({id:String(g?.id||crypto.randomUUID()),name:plainTitle(g?.name||''),color:TURSO_GROUP_COLORS.includes(g?.color)?g.color:'default'})).filter(g=>g.name):[];clean.statusGroups=normalizeCatalogConfig({statusGroups:config?.statusGroups||{}}).statusGroups;clean.starredGroups=normalizeCatalogConfig({starredGroups:config?.starredGroups||[]}).starredGroups;clean.mikaiApiKey=String(config?.mikaiApiKey||'').trim();clean.mikaiSendToCore=Boolean(config?.mikaiSendToCore&&clean.mikaiApiKey);clean.trailerBackgroundEnabled=Boolean(config?.trailerBackgroundEnabled);clean.updatedAt=new Date().toISOString();await tursoPutRaw(env,clean);return clean}
function tursoEnsureGroupsFromItems(config,items){const m=new Map((config.groupOptions||[]).map(g=>[normalizeName(g.name),{...g}]));for(const a of items||[]){const n=plainTitle(a.group||'');if(!n||n==='Без групи'||m.has(normalizeName(n)))continue;m.set(normalizeName(n),{id:`group-${crypto.randomUUID()}`,name:n,color:'default'})}return{...config,groupOptions:[...m.values()].sort((a,b)=>a.name.localeCompare(b.name,'uk'))}}
function tursoBuildOptions(items,config){
  const statuses=new Set(TITLE_STATUS_OPTIONS),tags=new Set(),genres=new Set(),themes=new Set();
  for(const i of items||[]){
    if(i.status&&i.status!=='Без статусу')statuses.add(i.status);
    for(const t of normalizeTags(i.tags||[]))tags.add(t);
    for(const g of normalizeTaxonomy(i.genres,GENRE_SOURCES).all)genres.add(g);
    for(const t of normalizeTaxonomy(i.themes,THEME_SOURCES).all)themes.add(t);
  }
  const groupOptions=(config.groupOptions||[]).map(g=>({...g,sourceId:'turso'})).sort((a,b)=>a.name.localeCompare(b.name,'uk'));
  return{statuses:[...statuses],groups:groupOptions.map(g=>g.name),groupOptions,tags:[...tags].sort((a,b)=>a.localeCompare(b,'uk')),genres:[...genres].sort((a,b)=>a.localeCompare(b,'uk')),themes:[...themes].sort((a,b)=>a.localeCompare(b,'uk')),statusGroups:config.statusGroups||{},starredGroups:config.starredGroups||[],playerSettings:{mikaiApiKeyConfigured:Boolean(config.mikaiApiKey),mikaiSendToCore:Boolean(config.mikaiSendToCore&&config.mikaiApiKey)},bannerSettings:{trailerEnabled:Boolean(config.trailerBackgroundEnabled)},storage:'turso-libsql'};
}
async function tursoLoadState(env){const anime=(await tursoScanRaw(env,'anime')).map(tursoNormalizeAnime);let config=await tursoGetConfig(env),expanded=tursoEnsureGroupsFromItems(config,anime);if(JSON.stringify(expanded.groupOptions)!==JSON.stringify(config.groupOptions))config=await tursoSaveConfig(env,expanded);return{anime,config,options:tursoBuildOptions(anime,config)}}
function tursoAliasLines(item){return[...new Set([item.title,item.originalTitle,item.englishTitle,item.russianTitle,...String(item.aliases||'').split(/\r?\n|\s*[|;]\s*/)].map(plainTitle).filter(Boolean))]}
function tursoFindExisting(items,payload){const d=coreTitleData(payload),wanted=new Set([d.main,d.original,d.english,d.russian,...d.aliases].map(exactCoreTitleKey).filter(Boolean));return items.find(i=>tursoAliasLines(i).some(v=>wanted.has(exactCoreTitleKey(v))))||null}
function tursoMergeAliases(existing,values){const seen=new Set(),out=[];for(const v of [...String(existing||'').split(/\r?\n/),...(values||[])]){const c=plainTitle(v||''),k=exactCoreTitleKey(c);if(!c||!k||seen.has(k))continue;seen.add(k);out.push(c)}return out.join('\n')}
function tursoMergeLinksFromCore(existing,siteLinks){const all=[...(existing||[])];for(const[domain,items]of Object.entries(siteLinks||{}))for(const i of items||[])all.push({name:plainTitle(i?.title||i?.name||'')||domain,url:i?.url||''});return tursoNormalizeLinks(all)}
function coreCatalogReportedCounts(payload){return payload?.meta?.catalog_search?.result_counts&&typeof payload.meta.catalog_search.result_counts==='object'&&!Array.isArray(payload.meta.catalog_search.result_counts)?payload.meta.catalog_search.result_counts:{}}
function coreCatalogParsedCounts(payload){const parsed=coreSiteLinks({catalogs:payload?.catalogs||{}});return Object.fromEntries(Object.entries(parsed).map(([domain,items])=>[domain,items.length]))}
async function tursoIngestCorePayload(env,payload){
  if(!payload||typeof payload!=='object'||!payload.title||typeof payload.title!=='object')throw new HttpError(400,'Очікувався schema-v2/v3 JSON від Python core.');
  const state=await tursoLoadState(env),existing=tursoFindExisting(state.anime,payload),d=coreTitleData(payload),links=coreSiteLinks(payload),now=new Date().toISOString(),base=existing?tursoNormalizeAnime(existing):tursoNormalizeAnime({id:crypto.randomUUID(),addedAt:now}),status=d.status||base.status||'Без статусу';
  const reported=coreCatalogReportedCounts(payload),parsedCatalogCounts=coreCatalogParsedCounts(payload),catalogMismatches=[];
  for(const[domain,countRaw]of Object.entries(reported)){const count=Math.max(0,Number(countRaw)||0),parsed=Math.max(0,Number(parsedCatalogCounts[domain])||0);if(count>parsed)catalogMismatches.push({domain,reported:count,parsed})}
  let viewed=d.hasViewed?Math.max(0,Number(d.viewed)||0):base.viewed;if(isCompletedStatus(status)&&viewed<1)viewed=1;
  const incomingSiteLinks=tursoNormalizeSiteLinks(links);
  const mergedSiteLinks=tursoMergeSiteLinks(base.siteLinks,tursoSiteLinksFromFlat(base.links),incomingSiteLinks);
  const mergedFlatLinks=tursoNormalizeLinks([...base.links,...tursoFlattenSiteLinks(mergedSiteLinks)]);
  const item=tursoNormalizeAnime({...base,id:base.id||crypto.randomUUID(),title:d.main||base.title,originalTitle:d.original||base.originalTitle,englishTitle:d.english||base.englishTitle,russianTitle:d.russian||base.russianTitle,aliases:tursoMergeAliases(base.aliases,[d.main,d.original,d.english,d.russian,...d.aliases]),key:exactCoreTitleKey(d.original||base.originalTitle||d.main||base.title),description:d.description||base.description,poster:d.cover||base.poster,banner:d.banner||base.banner,trailer:(d.trailer?.embedUrl||d.trailer?.url)?d.trailer:base.trailer,status,group:d.group||base.group,viewed,season:d.hasSeason?d.season:base.season,episode:d.hasEpisode?d.episode:base.episode,tags:[...new Set([...(base.tags||[]),...(d.tags||[])])],genres:d.hasGenres?d.genres:base.genres,themes:d.hasThemes?d.themes:base.themes,sourceUrl:d.sourceUrl||base.sourceUrl,siteLinks:mergedSiteLinks,links:mergedFlatLinks,updatedAt:now});
  await tursoPutRaw(env,item);
  const rawAfterWrite=await tursoGetRaw(env,item.id),readBack=rawAfterWrite?tursoNormalizeAnime(rawAfterWrite):null;
  if(!readBack)throw new HttpError(502,'Turso записав тайтл, але контрольне читання не повернуло JSON.','','readback_missing','turso_verify');
  if(readBack.links.length<item.links.length)throw new HttpError(502,`Turso read-back втратив посилання: записано ${item.links.length}, прочитано ${readBack.links.length}.`,'','readback_links','turso_verify');
  let config=state.config;if(item.group&&item.group!=='Без групи'&&!config.groupOptions.some(g=>normalizeName(g.name)===normalizeName(item.group))){config.groupOptions.push({id:`group-${crypto.randomUUID()}`,name:item.group,color:'default'});await tursoSaveConfig(env,config)}
  const receivedLinks=coreLinkEntries(payload).length;
  const coreReportedCounts=reported;
  return{ok:true,existing:Boolean(existing),item:tursoPublicAnime(readBack),imported:{schemaVersion:payload.schema_version??null,coreVersion:payload?.meta?.core_version||'',sites:tursoSiteCounts(readBack.siteLinks),receivedLinks,storedLinks:readBack.links.length,coreReportedCounts,parsedCatalogCounts,catalogMismatches,dbReadBackLinks:readBack.links.length}};
}

function hasUsefulTaxonomy(value, allowedSources){return normalizeTaxonomy(value,allowedSources).all.length>0}
async function tursoRefreshAnimeFromCore(env,id,payload){
  if(!payload||typeof payload!=='object'||!payload.title||typeof payload.title!=='object')throw new HttpError(400,'Core не повернув повний JSON тайтлу.');
  const raw=await tursoGetRaw(env,id);
  if(!raw||raw.entity!=='anime')throw new HttpError(404,'Тайтл не знайдено.');
  const base=tursoNormalizeAnime(raw),d=coreTitleData(payload),incoming=tursoNormalizeSiteLinks(coreSiteLinks(payload)),filled=[];
  const next={...base};
  const fillText=(key,value,label)=>{if(!plainTitle(next[key]||'')&&plainTitle(value||'')){next[key]=plainTitle(value);filled.push(label)}};
  fillText('originalTitle',d.original,'оригінальну назву');
  fillText('englishTitle',d.english,'англійську назву');
  fillText('russianTitle',d.russian,'російську назву');
  if(!String(next.description||'').trim()&&String(d.description||'').trim()){next.description=d.description;filled.push('опис')}
  const rawPoster=safeHttpUrl(raw.poster||''),rawBanner=safeHttpUrl(raw.banner||'');
  if(!rawPoster&&d.cover){next.poster=d.cover;filled.push('постер')}
  if((!rawBanner||rawBanner===rawPoster)&&d.banner&&d.banner!==rawBanner){next.banner=d.banner;filled.push('банер')}
  if(!(next.trailer?.embedUrl||next.trailer?.url)&&(d.trailer?.embedUrl||d.trailer?.url)){next.trailer=d.trailer;filled.push('трейлер')}
  const mergedAliases=tursoMergeAliases(next.aliases,[d.main,d.original,d.english,d.russian,...d.aliases]);
  if(mergedAliases!==String(next.aliases||'')){next.aliases=mergedAliases;filled.push('аліаси')}
  const mergedGenres=mergeTaxonomy(next.genres,d.genres,GENRE_SOURCES);
  if(JSON.stringify(mergedGenres)!==JSON.stringify(normalizeTaxonomy(next.genres,GENRE_SOURCES))){next.genres=mergedGenres;filled.push('жанри')}
  const mergedThemes=mergeTaxonomy(next.themes,d.themes,THEME_SOURCES);
  if(JSON.stringify(mergedThemes)!==JSON.stringify(normalizeTaxonomy(next.themes,THEME_SOURCES))){next.themes=mergedThemes;filled.push('теми')}
  const oldLinkCount=(next.links||[]).length;
  next.siteLinks=tursoMergeSiteLinks(next.siteLinks,tursoSiteLinksFromFlat(next.links),incoming);
  next.links=tursoFlattenSiteLinks(next.siteLinks);
  if(next.links.length>oldLinkCount)filled.push(`посилання +${next.links.length-oldLinkCount}`);
  if(!next.sourceUrl&&d.sourceUrl){next.sourceUrl=d.sourceUrl;filled.push('джерело')}
  next.key=exactCoreTitleKey(next.originalTitle||next.title);
  next.updatedAt=new Date().toISOString();
  await tursoPutRaw(env,tursoNormalizeAnime(next));
  const saved=tursoPublicAnime(await tursoGetRaw(env,id));
  const state=await tursoLoadState(env);
  return{ok:true,item:saved,options:state.options,filled:[...new Set(filled)],core:{schemaVersion:payload.schema_version??null,version:payload?.meta?.core_version||''},source:{title:d.main||'',url:d.sourceUrl||''}};
}
async function tursoHandleAnimeRefreshApi(request,env){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const id=new URL(request.url).searchParams.get('id')||'';
  if(!id)return json({error:'Не передано id тайтлу.'},400);
  const b=await request.json().catch(()=>({})),title=plainTitle(b.title||''),url=safeHttpUrl(b.url||'');
  if(!title||!url)return json({error:'Для оновлення потрібні назва та URL першого джерела.'},400);
  const headers={'Content-Type':'application/json',Accept:'application/json'};
  if(env.CORE_API_KEY)headers['X-API-Key']=env.CORE_API_KEY;
  const coreBody=await corePayloadWithStoredMikaiKey(env,{title,url});
  const r=await fetch(env.CORE_PROCESS_FULL_URL||CORE_PROCESS_FULL_URL,{method:'POST',headers,body:JSON.stringify(coreBody)}),raw=await r.text();
  let p;try{p=JSON.parse(raw)}catch{}
  if(!r.ok||!p)throw new HttpError(502,`Python core HTTP ${r.status}: ${p?.error||p?.detail||raw.slice(0,700)}`);
  return json(await tursoRefreshAnimeFromCore(env,id,p));
}

async function tursoHandleAnimeApi(request,env){const url=new URL(request.url),id=url.searchParams.get('id')||'',compact=['1','true','yes'].includes(String(url.searchParams.get('compact')||'').toLowerCase()),debug=['1','true','yes'].includes(String(url.searchParams.get('debug')||'').toLowerCase());if(request.method==='GET'){if(id){const raw=await tursoGetRaw(env,id);if(!raw||raw.entity!=='anime')return json({error:'Тайтл не знайдено.'},404);const normalized=tursoPublicAnime(raw);if(debug)return json({item:normalized,count:1,storage:'turso-libsql',debug:{rawLinkCount:Array.isArray(raw.links)?raw.links.length:0,rawSiteLinkCounts:tursoSiteCounts(raw.siteLinks||{}),normalizedLinkCount:normalized.links.length,normalizedSiteLinkCounts:tursoSiteCounts(normalized.siteLinks||{})}});if(compact)return json({item:normalized,count:1,storage:'turso-libsql',compact:true});const state=await tursoLoadState(env);return json({item:normalized,count:1,options:state.options})}const state=await tursoLoadState(env),items=state.anime.map(tursoSummaryAnime).sort((a,b)=>String(b.addedAt).localeCompare(String(a.addedAt)));return json({items,count:items.length,databaseId:'yoru-turso',sources:[{id:'yoru-turso',name:'Turso',count:items.length}],options:state.options,storage:'turso-libsql'})}
if(request.method==='PATCH'){if(!id)return json({error:'Не передано id тайтлу.'},400);const raw=await tursoGetRaw(env,id);if(!raw||raw.entity!=='anime')return json({error:'Тайтл не знайдено.'},404);const body=await request.json().catch(()=>({})),item=tursoNormalizeAnime(raw);for(const k of ['title','description','originalTitle','englishTitle','russianTitle','aliases','notes'])if(Object.prototype.hasOwnProperty.call(body,k))item[k]=String(body[k]??'').trim();if('tags'in body)item.tags=normalizeTags(body.tags);if('genres'in body)item.genres=normalizeTaxonomy(body.genres,GENRE_SOURCES);if('themes'in body)item.themes=normalizeTaxonomy(body.themes,THEME_SOURCES);if('status'in body)item.status=plainTitle(body.status||'')||'Без статусу';if('group'in body)item.group=plainTitle(body.group||'')||'Без групи';if('favorite'in body)item.favorite=Boolean(body.favorite);if('liked'in body)item.liked=Boolean(body.liked);if('viewed'in body)item.viewed=Math.max(0,Math.floor(Number(body.viewed)||0));if('season'in body)item.season=Math.max(0,Math.floor(Number(body.season)||0));if('episode'in body)item.episode=Math.max(0,Math.floor(Number(body.episode)||0));if(isCompletedStatus(item.status)&&item.viewed<1)item.viewed=1;if('posterUrl'in body){const v=String(body.posterUrl||'').trim();if(v&&!safeHttpUrl(v))return json({error:'Некоректний URL постера.'},400);item.poster=safeHttpUrl(v)}if('bannerUrl'in body){const v=String(body.bannerUrl||'').trim();if(v&&!safeHttpUrl(v))return json({error:'Некоректний URL банера.'},400);item.banner=safeHttpUrl(v)}if('trailerUrl'in body){const v=String(body.trailerUrl||'').trim();if(v&&!safeHttpUrl(v))return json({error:'Некоректний URL трейлера.'},400);item.trailer=normalizeTrailer(v)}if('trailer'in body)item.trailer=normalizeTrailer(body.trailer);if(body.siteLinks&&typeof body.siteLinks==='object'){item.siteLinks=tursoNormalizeSiteLinks(body.siteLinks);item.links=tursoFlattenSiteLinks(item.siteLinks)}item.key=exactCoreTitleKey(item.originalTitle||item.title);item.updatedAt=new Date().toISOString();await tursoPutRaw(env,item);if(compact)return json({ok:true,item:tursoPublicAnime(item),storage:'turso-libsql',compact:true});let state=await tursoLoadState(env);if(item.group&&item.group!=='Без групи'&&!state.config.groupOptions.some(g=>normalizeName(g.name)===normalizeName(item.group))){state.config.groupOptions.push({id:`group-${crypto.randomUUID()}`,name:item.group,color:'default'});state.config=await tursoSaveConfig(env,state.config);state.options=tursoBuildOptions(state.anime.map(x=>x.id===item.id?item:x),state.config)}return json({ok:true,item:tursoPublicAnime(item),options:state.options})}
if(request.method==='DELETE'){if(!id)return json({error:'Не передано id тайтлу.'},400);await tursoDeleteRaw(env,id);return json({ok:true,id,deleted:true})}return json({error:'Method not allowed'},405)}
async function tursoHandleViewedApi(request,env){if(request.method!=='POST')return json({error:'Method not allowed'},405);const id=new URL(request.url).searchParams.get('id')||'',raw=await tursoGetRaw(env,id);if(!raw||raw.entity!=='anime')return json({error:'Тайтл не знайдено.'},404);const item=tursoNormalizeAnime(raw);item.viewed=Math.max(1,item.viewed+1);item.updatedAt=new Date().toISOString();await tursoPutRaw(env,item);const state=await tursoLoadState(env);return json({ok:true,viewed:item.viewed,item:tursoPublicAnime(item),options:state.options})}
async function tursoHandleOptionsApi(request,env){if(request.method!=='GET')return json({error:'Method not allowed'},405);return json((await tursoLoadState(env)).options)}
async function tursoHandleGroupsApi(request,env){if(request.method==='GET')return json({ok:true,...(await tursoLoadState(env)).options});if(request.method!=='PATCH')return json({error:'Method not allowed'},405);const body=await request.json().catch(()=>({})),state=await tursoLoadState(env),oldName=plainTitle(body.oldName||''),requestedId=String(body.id||'').trim(),newName=plainTitle(body.name||oldName);if(!newName)return json({error:'Назва групи не може бути порожньою.'},400);const color=TURSO_GROUP_COLORS.includes(body.color)?body.color:'default';let config=state.config,group=config.groupOptions.find(g=>(requestedId&&g.id===requestedId)||(oldName&&normalizeName(g.name)===normalizeName(oldName)));if(!group)group={id:requestedId||`group-${crypto.randomUUID()}`,name:oldName||newName,color:'default'};const previous=group.name;group={...group,name:newName,color};config.groupOptions=config.groupOptions.filter(g=>g.id!==group.id&&normalizeName(g.name)!==normalizeName(previous));config.groupOptions.push(group);let migrated=0,changed=[];if(previous&&normalizeName(previous)!==normalizeName(newName)){for(const a of state.anime)if(normalizeName(a.group)===normalizeName(previous)){a.group=newName;a.updatedAt=new Date().toISOString();changed.push(a);migrated++}for(const[s,gs]of Object.entries(config.statusGroups||{}))config.statusGroups[s]=gs.map(n=>normalizeName(n)===normalizeName(previous)?newName:n);config.starredGroups=(config.starredGroups||[]).map(n=>normalizeName(n)===normalizeName(previous)?newName:n)}if('starred'in body){config.starredGroups=(config.starredGroups||[]).filter(n=>normalizeName(n)!==normalizeName(newName));if(body.starred)config.starredGroups.unshift(newName)}if(changed.length)await tursoBatchPut(env,changed);config=await tursoSaveConfig(env,config);return json({ok:true,migrated,...tursoBuildOptions(state.anime.map(x=>changed.find(c=>c.id===x.id)||x),config)})}
async function tursoHandleCatalogSettingsApi(request,env){
  const state=await tursoLoadState(env);
  if(request.method==='GET')return json({ok:true,...state.options});
  if(request.method!=='PATCH')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({}));
  const hasMikaiKey=Object.prototype.hasOwnProperty.call(body,'mikaiApiKey');
  const hasMikaiForward=Object.prototype.hasOwnProperty.call(body,'mikaiSendToCore');
  const hasTrailerBackground=Object.prototype.hasOwnProperty.call(body,'trailerEnabled');
  if(hasTrailerBackground){
    state.config.trailerBackgroundEnabled=Boolean(body.trailerEnabled);
    const config=await tursoSaveConfig(env,state.config);
    return json({ok:true,...tursoBuildOptions(state.anime,config),trailerEnabled:Boolean(config.trailerBackgroundEnabled)});
  }
  if(hasMikaiKey||hasMikaiForward){
    if(hasMikaiKey){
      const key=String(body.mikaiApiKey||'').trim();
      if(key&&!/^mk_\S+$/i.test(key))return json({error:'Mikai API key має починатися з mk_.'},400);
      state.config.mikaiApiKey=key;
      if(!key)state.config.mikaiSendToCore=false;
    }
    if(hasMikaiForward){
      const enabled=Boolean(body.mikaiSendToCore);
      if(enabled&&!state.config.mikaiApiKey)return json({error:'Спочатку збережи Mikai API key.'},400);
      state.config.mikaiSendToCore=enabled;
    }
    const config=await tursoSaveConfig(env,state.config);
    return json({ok:true,...tursoBuildOptions(state.anime,config),mikaiApiKeyConfigured:Boolean(config.mikaiApiKey),mikaiSendToCore:Boolean(config.mikaiSendToCore&&config.mikaiApiKey)});
  }
  const status=plainTitle(body.status||'');
  if(!status)return json({error:'Не передано статус.'},400);
  const valid=new Map(state.config.groupOptions.map(g=>[normalizeName(g.name),g.name])),groups=[...new Set((Array.isArray(body.groups)?body.groups:[]).map(x=>valid.get(normalizeName(x))).filter(Boolean))];
  state.config.statusGroups[status]=groups;
  const config=await tursoSaveConfig(env,state.config);
  return json({ok:true,...tursoBuildOptions(state.anime,config)});
}
async function tursoHandleExtensionContextApi(request,env){if(request.method!=='GET')return json({error:'Method not allowed'},405);const url=new URL(request.url),primary=cleanTitle(url.searchParams.get('title')||url.searchParams.get('q')||'');let extra=[];try{const p=JSON.parse(url.searchParams.get('titles')||'[]');if(Array.isArray(p))extra=p.map(cleanTitle).filter(Boolean)}catch{}const queries=[...new Set([primary,...extra].filter(Boolean))].slice(0,8),state=await tursoLoadState(env);if(!queries.length)return json({ok:true,exists:false,query:'',queries:[],item:null,options:state.options});const ranked=state.anime.map(item=>{const scores=queries.map(query=>({query,score:Math.max(...tursoAliasLines(item).map(v=>aliasMatchScore(query,v))) }));scores.sort((a,b)=>b.score-a.score);return{item,...scores[0]}}).sort((a,b)=>b.score-a.score),best=ranked.find(x=>x.score>=72)||null;return json({ok:true,exists:Boolean(best),query:queries[0],queries,matchedBy:best?.query||'',item:best?tursoPublicAnime(best.item):null,options:state.options,debug:{candidates:ranked.slice(0,5).map(x=>({id:x.item.id,score:x.score,matchedBy:x.query,aliases:String(x.item.aliases||'').slice(0,240)}))}})}
function tursoMergeSide(body,f){return body?.choices?.[f]==='left'?'left':'right'}function tursoChoose(side,left,right){const a=side==='left'?left:right,b=side==='left'?right:left;return a||b||''}
async function tursoHandleMergeAnimeApi(request,env){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({})),rightId=String(body.rightId||'').trim(),leftId=String(body.leftId||'').trim();
  if(!rightId||!leftId||rightId===leftId)return json({error:'Некоректна пара тайтлів.'},400);
  const[rr,lr]=await Promise.all([tursoGetRaw(env,rightId),tursoGetRaw(env,leftId)]);
  if(!rr||!lr)return json({error:'Один із тайтлів не знайдено.'},404);
  const right=tursoNormalizeAnime(rr),left=tursoNormalizeAnime(lr);
  const ts=tursoMergeSide(body,'title'),ps=tursoMergeSide(body,'poster'),ms=tursoMergeSide(body,'marks'),bs=tursoMergeSide(body,'banner'),trs=tursoMergeSide(body,'trailer'),ds=tursoMergeSide(body,'description');
  const marks=ms==='left'?left:right;
  const trailer=trs==='left'?left.trailer:right.trailer;
  const merged=tursoNormalizeAnime({...right,
    title:tursoChoose(ts,left.title,right.title),originalTitle:tursoChoose(ts,left.originalTitle,right.originalTitle),englishTitle:tursoChoose(ts,left.englishTitle,right.englishTitle),russianTitle:tursoChoose(ts,left.russianTitle,right.russianTitle),
    aliases:tursoMergeAliases('',[...tursoAliasLines(right),...tursoAliasLines(left)]),poster:tursoChoose(ps,left.poster,right.poster),banner:tursoChoose(bs,left.banner,right.banner),trailer,description:tursoChoose(ds,left.description,right.description),
    status:marks.status,group:marks.group,favorite:marks.favorite,liked:marks.liked,viewed:marks.viewed,season:marks.season,episode:marks.episode,
    tags:[...new Set([...(right.tags||[]),...(left.tags||[])])],genres:mergeTaxonomy(right.genres,left.genres,GENRE_SOURCES),themes:mergeTaxonomy(right.themes,left.themes,THEME_SOURCES),
    notes:[right.notes,left.notes].map(x=>String(x||'').trim()).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join('\n\n'),
    siteLinks:tursoMergeSiteLinks(right.siteLinks,left.siteLinks,tursoSiteLinksFromFlat([...(right.links||[]),...(left.links||[])])),links:tursoNormalizeLinks([...(right.links||[]),...(left.links||[])]),updatedAt:new Date().toISOString()
  });
  await tursoPutRaw(env,merged);await tursoDeleteRaw(env,leftId);
  return json({ok:true,item:tursoPublicAnime(merged),keptId:rightId,removedId:leftId,choices:{title:ts,poster:ps,marks:ms,banner:bs,trailer:trs,description:ds}});
}
async function tursoHandleIngestApi(request,env){if(request.method!=='POST')return json({error:'Method not allowed'},405);checkIngestKey(request,env);const payload=await request.json().catch(()=>null),result=await tursoIngestCorePayload(env,payload);return json(result,result.existing?200:201)}
async function tursoHandleHealthApi(env){
  tursoRequireEnv(env);
  await tursoEnsureSchema(env);
  const health = await fetch(`${tursoHttpBase(env)}/health`, { headers: { authorization: `Bearer ${env.TURSO_AUTH_TOKEN}` } });
  if (!health.ok) throw new HttpError(502, `Turso health HTTP ${health.status}`, '', String(health.status), 'turso_health');
  const state = await tursoLoadState(env);
  return json({ok:true,storage:'turso-libsql',databaseUrlConfigured:Boolean(env.TURSO_DATABASE_URL),tokenConfigured:Boolean(env.TURSO_AUTH_TOKEN),databaseHost:new URL(tursoHttpBase(env)).host,itemCount:state.anime.length,groupCount:state.config.groupOptions.length,credentialsConfigured:true});
}

async function corePayloadWithStoredMikaiKey(env,body){
  const clean={...(body&&typeof body==='object'?body:{})};
  delete clean.mikai_api_key;
  const config=await tursoGetConfig(env);
  const key=String(config.mikaiApiKey||'').trim();
  if(config.mikaiSendToCore&&/^mk_\S+$/i.test(key))clean.mikai_api_key=key;
  return clean;
}

// ==================== CORE / DISCOVERY ====================
async function handleCoreSearchApi(request,env){if(request.method!=='POST')return json({error:'Method not allowed'},405);const b=await request.json().catch(()=>({})),title=plainTitle(b.title||''),limit=Math.min(10,Math.max(1,Number(b.limit)||8));if(!title)return json({error:'Потрібна назва тайтлу.'},400);const headers={'Content-Type':'application/json',Accept:'application/json'};if(env.CORE_API_KEY)headers['X-API-Key']=env.CORE_API_KEY;const r=await fetch(env.CORE_SEARCH_URL||CORE_SEARCH_URL,{method:'POST',headers,body:JSON.stringify({title,limit})}),raw=await r.text();let p;try{p=JSON.parse(raw)}catch{}if(!r.ok)throw new HttpError(502,`Python core search HTTP ${r.status}: ${p?.detail||p?.error||raw.slice(0,600)}`);return json(p)}
async function handleCoreTaxonomyApi(request,env){if(request.method!=='POST')return json({error:'Method not allowed'},405);const b=await request.json().catch(()=>({})),title=plainTitle(b.title||'');if(!title)return json({error:'Потрібна назва тайтлу.'},400);const headers={'Content-Type':'application/json',Accept:'application/json'};if(env.CORE_API_KEY)headers['X-API-Key']=env.CORE_API_KEY;const coreBody=await corePayloadWithStoredMikaiKey(env,{...b,title});const r=await fetch(env.CORE_TAXONOMY_URL||CORE_TAXONOMY_URL,{method:'POST',headers,body:JSON.stringify(coreBody)}),raw=await r.text();let p;try{p=JSON.parse(raw)}catch{}if(!r.ok||!p)throw new HttpError(502,`Python core taxonomy HTTP ${r.status}: ${p?.detail||p?.error||raw.slice(0,600)}`);return json(p)}
async function handleProcessTitleStreamApi(request,env){if(request.method!=='POST')return json({error:'Method not allowed'},405);const b=await request.json().catch(()=>({})),title=plainTitle(b.title||''),url=safeHttpUrl(b.url||'');if(!title||!url)return json({error:'Потрібні title та url.'},400);const headers={'Content-Type':'application/json',Accept:'application/x-ndjson, application/json'};if(env.CORE_API_KEY)headers['X-API-Key']=env.CORE_API_KEY;const coreBody=await corePayloadWithStoredMikaiKey(env,{...b,title,url});const r=await fetch(env.CORE_PROCESS_STREAM_URL||CORE_PROCESS_STREAM_URL,{method:'POST',headers,body:JSON.stringify(coreBody)});if(!r.ok||!r.body){const raw=await r.text().catch(()=>'');return json({error:`Python core stream HTTP ${r.status}: ${raw.slice(0,700)}`},502)}return new Response(r.body,{status:200,headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-cache, no-transform','access-control-allow-origin':'*','x-content-type-options':'nosniff'}})}
async function handleProcessTitleApi(request,env){if(request.method!=='POST')return json({error:'Method not allowed'},405);const b=await request.json().catch(()=>({})),title=plainTitle(b.title||''),url=safeHttpUrl(b.url||'');if(!title||!url)return json({error:'Потрібні title та url.'},400);const headers={'Content-Type':'application/json',Accept:'application/json'};if(env.CORE_API_KEY)headers['X-API-Key']=env.CORE_API_KEY;const coreBody=await corePayloadWithStoredMikaiKey(env,{...b,title,url});const r=await fetch(env.CORE_PROCESS_FULL_URL||CORE_PROCESS_FULL_URL,{method:'POST',headers,body:JSON.stringify(coreBody)}),raw=await r.text();let p;try{p=JSON.parse(raw)}catch{}if(!r.ok||!p)throw new HttpError(502,`Python core HTTP ${r.status}: ${p?.error||raw.slice(0,700)}`);const saved=await tursoIngestCorePayload(env,p);return json({...saved,core:{schemaVersion:p.schema_version??null,version:p?.meta?.core_version||''}},saved.existing?200:201)}
const ANILIST_FIELDS=`id idMal siteUrl format seasonYear episodes bannerImage description(asHtml:false) countryOfOrigin coverImage { extraLarge large medium color } title { romaji english native } synonyms`;
async function handleDiscoverApi(request){if(request.method!=='GET')return json({error:'Method not allowed'},405);const q=cleanTitle(new URL(request.url).searchParams.get('q')||'');if(!q)return json({items:[],provider:null});const query=`query($search:String!){Page(page:1,perPage:10){media(search:$search,type:ANIME){${ANILIST_FIELDS}}}}`;const r=await fetch(ANILIST_ENDPOINT,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({query,variables:{search:q}})});if(!r.ok)return json({items:[],provider:'anilist',warning:`AniList HTTP ${r.status}`});const p=await r.json();const items=(p?.data?.Page?.media||[]).map(m=>({id:m.id,idMal:m.idMal,siteUrl:m.siteUrl,year:m.seasonYear||null,episodes:m.episodes||null,poster:m.coverImage?.extraLarge||m.coverImage?.large||m.coverImage?.medium||'',banner:m.bannerImage||'',description:m.description||'',title:m.title||{},synonyms:m.synonyms||[]}));return json({items,provider:'anilist-server',fallback:false})}


// --- AniHub discovery + screenshot identification --------------------------
const ANIHUB_API = 'https://api.anihub.in.ua';
const KITSU_API = 'https://kitsu.io/api/edge';
const TRACE_MOE_API = 'https://api.trace.moe';

function pickFirstString(...values){for(const value of values.flat(Infinity)){if(typeof value==='string'&&value.trim())return value.trim()}return''}
function pickImageValue(value){if(typeof value==='string')return safeHttpUrl(value);if(!value||typeof value!=='object')return'';return safeHttpUrl(value.original||value.large||value.medium||value.small||value.url||value.src||'')}
function aniHubGenres(raw){const values=raw?.genres||raw?.genre||[];return (Array.isArray(values)?values:[]).map(x=>typeof x==='string'?x:plainTitle(x?.name||x?.title||x?.title_ukrainian||'')).filter(Boolean)}
function aniHubTitle(raw){const t=raw?.titles||{};return plainTitle(pickFirstString(raw?.title_ukrainian,t?.ukrainian,t?.uk,t?.ua,raw?.title,raw?.name,raw?.title_english,t?.english,raw?.title_original,t?.original))||'Без назви'}
function aniHubSourceUrl(raw){const direct=safeHttpUrl(raw?.site_url||raw?.siteUrl||raw?.public_url||raw?.publicUrl||raw?.url||'');if(direct&&/(^|\.)anihub\.in\.ua$/i.test(new URL(direct).hostname))return direct;const id=String(raw?.id||'').trim(),slug=String(raw?.slug||'').trim();if(slug&&id)return `https://anihub.in.ua/anime/${encodeURIComponent(slug)}-${encodeURIComponent(id)}`;if(slug)return `https://anihub.in.ua/anime/${encodeURIComponent(slug)}`;if(id)return `https://anihub.in.ua/anime/${encodeURIComponent(id)}`;return''}
async function resolveAniHubPublicUrl(raw){const direct=aniHubSourceUrl(raw),id=String(raw?.id||'').trim(),slug=String(raw?.slug||'').trim(),candidates=[safeHttpUrl(raw?.site_url||raw?.siteUrl||raw?.public_url||raw?.publicUrl||raw?.url||''),slug?`https://anihub.in.ua/anime/${encodeURIComponent(slug)}`:'',slug&&id?`https://anihub.in.ua/anime/${encodeURIComponent(slug)}-${encodeURIComponent(id)}`:'',id?`https://anihub.in.ua/anime/${encodeURIComponent(id)}`:'',direct].filter(Boolean);for(const candidate of [...new Set(candidates)]){try{const r=await fetch(candidate,{method:'GET',redirect:'follow',headers:{Accept:'text/html','User-Agent':'Mozilla/5.0 YORU/7.7'}});if(r.ok&&/(^|\.)anihub\.in\.ua$/i.test(new URL(r.url).hostname)&&new URL(r.url).pathname.startsWith('/anime/'))return r.url}catch{}}return direct}
function normalizeAniHubAnime(raw){
  const t=raw?.titles||{};
  const poster=pickImageValue(raw?.poster||raw?.poster_url||raw?.posterImage||raw?.image||raw?.cover||raw?.images?.poster||raw?.images?.cover);
  const banner=pickImageValue(raw?.banner||raw?.banner_url||raw?.bannerImage||raw?.coverImage||raw?.images?.banner||raw?.background)||poster;
  const original=plainTitle(pickFirstString(raw?.title_original,t?.original,t?.romaji,t?.native));
  const english=plainTitle(pickFirstString(raw?.title_english,t?.english));
  return {anihubId:String(raw?.id||''),id:String(raw?.id||''),slug:String(raw?.slug||''),malId:raw?.mal_id??raw?.malId??null,anilistId:raw?.anilist_id??raw?.anilistId??null,title:aniHubTitle(raw),originalTitle:original,englishTitle:english,poster,banner,description:String(raw?.description_ukrainian||raw?.description||raw?.synopsis||raw?.overview||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),genres:aniHubGenres(raw),year:raw?.year||raw?.season_year||null,type:plainTitle(raw?.type||''),status:plainTitle(raw?.status||''),episodes:raw?.episodes_count||raw?.episodes||null,rating:raw?.rating?.value??raw?.rating??raw?.score??null,sourceUrl:aniHubSourceUrl(raw)};
}
async function aniHubJson(path){const r=await fetch(`${ANIHUB_API}${path}`,{headers:{Accept:'application/json','User-Agent':'YORU/7.7'}}),text=await r.text();let p={};try{p=text?JSON.parse(text):{}}catch{}if(!r.ok)throw new HttpError(r.status===429?429:502,`AniHub API HTTP ${r.status}: ${p?.detail||p?.error||text.slice(0,300)}`);return p}
function storedAniHubIds(state){const ids=new Set();for(const item of state.anime||[]){for(const link of item.links||[]){try{const u=new URL(link.url||'');if(!/(^|\.)anihub\.in\.ua$/i.test(u.hostname))continue;const m=u.pathname.match(/(?:-|\/)(\d+)(?:\/?$|[?#])/);if(m)ids.add(m[1])}catch{}}}return ids}
function sameStoredAnime(candidate,item){if(!candidate||!item)return false;const links=item.links||[];if(candidate.anihubId&&links.some(l=>{try{const u=new URL(l.url);return /(^|\.)anihub\.in\.ua$/i.test(u.hostname)&&new RegExp(`(?:-|/)${candidate.anihubId}(?:/?$|[?#])`).test(u.pathname)}catch{return false}}))return true;if(candidate.malId&&links.some(l=>String(l.url||'').includes(`/anime/${candidate.malId}`)&&String(l.url||'').includes('myanimelist.net')))return true;if(candidate.anilistId&&links.some(l=>String(l.url||'').includes(`/anime/${candidate.anilistId}`)&&String(l.url||'').includes('anilist.co')))return true;const ck=normalizeName(candidate.title||candidate.originalTitle||'');return ck&&[item.title,item.originalTitle,item.englishTitle,item.russianTitle,...String(item.aliases||'').split(/\r?\n/)].some(x=>normalizeName(x)===ck)}
async function handleAniHubRandomApi(request,env){if(request.method!=='GET')return json({error:'Method not allowed'},405);const state=await tursoLoadState(env),u=new URL(request.url),exclude=new Set(String(u.searchParams.get('exclude')||'').split(',').map(x=>x.trim()).filter(Boolean));for(const id of storedAniHubIds(state))exclude.add(id);for(let attempt=0;attempt<12;attempt++){const q=exclude.size?`?exclude=${encodeURIComponent([...exclude].join(','))}`:'';let raw;try{raw=await aniHubJson(`/anime/random${q}`)}catch(error){if(!q)throw error;raw=await aniHubJson('/anime/random')}const item=normalizeAniHubAnime(raw?.anime||raw?.item||raw);if(item.anihubId)exclude.add(item.anihubId);if(!state.anime.some(x=>sameStoredAnime(item,x))){item.sourceUrl=await resolveAniHubPublicUrl(raw?.anime||raw?.item||raw);if(item.sourceUrl)return json({ok:true,item,exclude:[...exclude]})}}return json({error:'Не вдалося знайти випадковий тайтл, якого ще немає в базі.'},404)}
async function handleAniHubTitleApi(request){if(request.method!=='GET')return json({error:'Method not allowed'},405);const id=String(new URL(request.url).searchParams.get('id')||'').trim();if(!id)return json({error:'Не передано AniHub id.'},400);const raw=await aniHubJson(`/anime/${encodeURIComponent(id)}`),source=raw?.anime||raw?.item||raw,item=normalizeAniHubAnime(source);item.sourceUrl=await resolveAniHubPublicUrl(source);return json({ok:true,item})}
function findAniHubLink(item){return (item?.links||[]).find(l=>{try{return /(^|\.)anihub\.in\.ua$/i.test(new URL(l.url||'').hostname)}catch{return false}})||null}
function extractAniHubIdFromUrl(value){try{const u=new URL(value);const m=u.pathname.match(/(?:-|\/)(\d+)(?:\/?$|[?#])/);return m?m[1]:''}catch{return''}}
async function resolveAniHubForStored(item){let link=findAniHubLink(item),id=link?extractAniHubIdFromUrl(link.url):'';if(id)return {id,url:link.url};for(const l of item?.links||[]){const value=String(l.url||'');let m=value.match(/myanimelist\.net\/anime\/(\d+)/i);if(m){const p=await aniHubJson(`/anime?mal_id=${encodeURIComponent(m[1])}&page_size=1`);const r=(p?.results||p?.items||p?.data||[])[0];if(r)return {id:String(r.id),url:aniHubSourceUrl(r)}}m=value.match(/anilist\.co\/anime\/(\d+)/i);if(m){const p=await aniHubJson(`/anime?anilist_id=${encodeURIComponent(m[1])}&page_size=1`);const r=(p?.results||p?.items||p?.data||[])[0];if(r)return {id:String(r.id),url:aniHubSourceUrl(r)}}}const q=encodeURIComponent(item?.originalTitle||item?.title||'');if(q){const p=await aniHubJson(`/anime?search=${q}&page_size=3`);const r=(p?.results||p?.items||p?.data||[])[0];if(r)return {id:String(r.id),url:aniHubSourceUrl(r)}}return null}
function pickRelatedArrays(raw){for(const key of ['similar_anime','similar','recommendations','recommended','related','recommendation_items']){const v=raw?.[key];if(Array.isArray(v)&&v.length)return v}return []}
async function scrapeAniHubSimilar(url){if(!url)return[];const r=await fetch(url,{headers:{Accept:'text/html','User-Agent':'Mozilla/5.0 YORU/7.7'}});if(!r.ok)return[];const html=await r.text(),idx=html.search(/Схоже\s+аніме/i),area=idx>=0?html.slice(idx,idx+55000):'';const found=[],seen=new Set();for(const m of area.matchAll(/href=["'](\/anime\/[^"'#?]+)["']/gi)){const href=m[1],id=extractAniHubIdFromUrl(`https://anihub.in.ua${href}`);if(!id||seen.has(id))continue;seen.add(id);found.push({id,sourceUrl:`https://anihub.in.ua${href}`});if(found.length>=12)break}return found}
async function handleAniHubSimilarApi(request,env){if(request.method!=='GET')return json({error:'Method not allowed'},405);const id=String(new URL(request.url).searchParams.get('id')||'').trim(),raw=await tursoGetRaw(env,id);if(!raw||raw.entity!=='anime')return json({error:'Тайтл не знайдено.'},404);const item=tursoPublicAnime(raw),resolved=await resolveAniHubForStored(item);if(!resolved)return json({items:[],source:'anihub'});const detailRaw=await aniHubJson(`/anime/${encodeURIComponent(resolved.id)}`),detail=detailRaw?.anime||detailRaw?.item||detailRaw;let related=pickRelatedArrays(detail).map(normalizeAniHubAnime).filter(x=>x.anihubId&&x.anihubId!==resolved.id);if(!related.length){const refs=await scrapeAniHubSimilar(resolved.url||aniHubSourceUrl(detail));for(const ref of refs){try{const p=await aniHubJson(`/anime/${encodeURIComponent(ref.id)}`);related.push(normalizeAniHubAnime(p?.anime||p?.item||p))}catch{}}}if(!related.length){const p=await aniHubJson('/anime/recommended?limit=12');related=(p?.items||p?.results||[]).map(normalizeAniHubAnime)}const state=await tursoLoadState(env),seen=new Set();related=related.filter(x=>x.anihubId!==resolved.id&&!seen.has(x.anihubId)&&(seen.add(x.anihubId)||true)).slice(0,18).map(x=>{const existing=state.anime.find(a=>sameStoredAnime(x,a));return{...x,existingId:existing?.id||'',previewUrl:existing?.id?`title.html?id=${encodeURIComponent(existing.id)}`:`title.html?preview=anihub&anihub=${encodeURIComponent(x.anihubId)}`}});return json({ok:true,items:related,source:'anihub',resolvedAniHubId:resolved.id})}
function secondsLabel(value){const n=Math.max(0,Number(value)||0),m=Math.floor(n/60),s=Math.floor(n%60);return `${m}:${String(s).padStart(2,'0')}`}
async function kitsuLookup(title){if(!title)return null;const url=`${KITSU_API}/anime?filter%5Btext%5D=${encodeURIComponent(title)}&page%5Blimit%5D=3`,r=await fetch(url,{headers:{Accept:'application/vnd.api+json'}});if(!r.ok)return null;const p=await r.json().catch(()=>({})),rows=Array.isArray(p?.data)?p.data:[];return rows[0]||null}
function normalizeKitsu(row){const a=row?.attributes||{};return {title:plainTitle(a?.canonicalTitle||a?.titles?.en_jp||a?.titles?.en||a?.titles?.ja_jp||''),titleEnglish:plainTitle(a?.titles?.en||''),poster:pickImageValue(a?.posterImage),banner:pickImageValue(a?.coverImage),description:String(a?.synopsis||a?.description||'').replace(/\s+/g,' ').trim(),type:plainTitle(a?.subtype||''),year:String(a?.startDate||'').slice(0,4),episodes:a?.episodeCount||null,rating:a?.averageRating||null}}
async function handleAnimeIdentifyApi(request){if(request.method!=='POST')return json({error:'Method not allowed'},405);const form=await request.formData().catch(()=>null),image=form?.get('image');if(!(image instanceof File))return json({error:'Не передано зображення.'},400);if(!String(image.type||'').startsWith('image/'))return json({error:'Потрібен файл зображення.'},400);if(image.size>10*1024*1024)return json({error:'Зображення завелике. Максимум 10 MB.'},413);const tr=await fetch(`${TRACE_MOE_API}/search?cutBorders&anilistInfo`,{method:'POST',headers:{'Content-Type':image.type||'application/octet-stream'},body:await image.arrayBuffer()}),tp=await tr.json().catch(()=>({}));if(!tr.ok)throw new HttpError(502,`trace.moe HTTP ${tr.status}: ${tp?.error||''}`);const out=[];for(const hit of (tp?.result||[]).slice(0,5)){const ai=hit?.anilist||{},title=plainTitle(ai?.title?.english||ai?.title?.romaji||ai?.title?.native||'');const kitsu=normalizeKitsu(await kitsuLookup(title));out.push({title:kitsu.title||title,titleEnglish:kitsu.titleEnglish||plainTitle(ai?.title?.english||''),titleRomaji:plainTitle(ai?.title?.romaji||''),anilistId:typeof ai==='object'?ai.id:ai,poster:kitsu.poster||safeHttpUrl(hit?.image||''),banner:kitsu.banner||'',description:kitsu.description||'',type:kitsu.type||'',year:kitsu.year||'',episodes:kitsu.episodes||null,rating:kitsu.rating||null,episode:hit?.episode||null,from:hit?.from||0,to:hit?.to||0,time:secondsLabel(hit?.from),similarity:Number(hit?.similarity||0),traceImage:safeHttpUrl(hit?.image||''),traceVideo:safeHttpUrl(hit?.video||'')})}return json({ok:true,items:out,recognition:'trace.moe',metadata:'kitsu'})}
// ---------------------------------------------------------------------------

// --- YORU player gateway v1 -------------------------------------------------
// Mikai uses its official Public API. The other supported catalogues are
// mirrored through the Pages Worker and cropped to the configured DOM classes.
const PLAYER_DOM_SOURCES = Object.freeze({
  'anihub.in.ua': {
    classes: ['relative','border','border-white/10','rounded-2xl','p-4','shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)]','ring-1','ring-violet-500/5'],
    seasonSwitch: true,
  },
  'animeon.club': { classes: ['anime-player-section','flex-center'], seasonSwitch: true },
  'jut-su.net': { classes: ['jutsu-page__player-video'], seasonSwitch: false },
  'animego.studio': { classes: ['tabs-block__content','video-inside'], seasonSwitch: false },
});
const PLAYER_HOST_ALIASES = Object.freeze({
  'www.anihub.in.ua':'anihub.in.ua',
  'www.animeon.club':'animeon.club',
  'www.jut-su.net':'jut-su.net',
  'www.animego.studio':'animego.studio',
});

const PLAYER_NATIVE_BRANCHES = Object.freeze({
  'p-anihub':'anihub.in.ua',
  'p-animeon':'animeon.club',
  'p-jutsu':'jut-su.net',
  'p-animego':'animego.studio',
});
function playerNativeBranchInfo(hostname) {
  const parts=String(hostname||'').toLowerCase().split('.').filter(Boolean);
  // Branch alias shape: branch.project.pages.dev. Do not treat a production
  // project whose name happens to equal p-anihub/etc as a native proxy host.
  if (parts.length < 4 || parts.slice(-2).join('.') !== 'pages.dev') return null;
  const branch=parts[0],site=PLAYER_NATIVE_BRANCHES[branch];
  if (!site) return null;
  return { branch,site,remoteOrigin:`https://${site}` };
}

function playerCanonicalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return PLAYER_HOST_ALIASES[String(hostname || '').toLowerCase()] || host;
}
function playerDomConfigForUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value || ''));
    if (!/^https?:$/.test(url.protocol)) return null;
    const site = playerCanonicalHost(url.hostname);
    const config = PLAYER_DOM_SOURCES[site];
    return config ? { site, config, url } : null;
  } catch { return null; }
}
function playerEncodeOrigin(origin) {
  return btoa(String(origin)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function playerDecodeOrigin(token) {
  try {
    const raw = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
    const origin = atob(padded);
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.origin;
  } catch { return ''; }
}
function playerProxyUrl(requestOrigin, remoteUrl) {
  const remote = remoteUrl instanceof URL ? remoteUrl : new URL(String(remoteUrl));
  const token = playerEncodeOrigin(remote.origin);
  return `${requestOrigin}/api/player/p/${token}${remote.pathname}${remote.search}${remote.hash}`;
}
function playerSameSiteAllowed(origin) {
  try { return Boolean(playerDomConfigForUrl(new URL(origin))); } catch { return false; }
}
function playerIsHttpLike(raw) {
  return /^(?:https?:)?\/\//i.test(String(raw || '')) || /^\//.test(String(raw || '')) || /^[.]{0,2}\//.test(String(raw || ''));
}
function playerMapResource(requestOrigin, remoteBase, raw) {
  const value = String(raw || '').trim();
  if (!value || /^(?:data|blob|javascript|mailto|tel):/i.test(value) || value.startsWith('#')) return value;
  try {
    const remote = new URL(value, remoteBase);
    const base = new URL(remoteBase);
    if (remote.origin === base.origin) return playerProxyUrl(requestOrigin, remote);
    return remote.href;
  } catch { return value; }
}
function playerRewriteHtmlAttributes(html, finalUrl, requestOrigin) {
  let out = String(html || '');
  out = out.replace(/\b(src|href|action|poster|data-src)\s*=\s*(["'])([^"']+)\2/gi, (all, attr, quote, raw) => {
    const mapped = playerMapResource(requestOrigin, finalUrl, raw);
    return `${attr}=${quote}${String(mapped).replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`;
  });
  out = out.replace(/\bsrcset\s*=\s*(["'])([^"']+)\1/gi, (all, quote, raw) => {
    const parts = String(raw).split(',').map(part => {
      const match = part.trim().match(/^(\S+)(\s+.+)?$/);
      if (!match) return part.trim();
      return playerMapResource(requestOrigin, finalUrl, match[1]) + (match[2] || '');
    });
    return `srcset=${quote}${parts.join(', ')}${quote}`;
  });
  return out;
}
function playerRewriteCss(css, finalUrl, requestOrigin) {
  return String(css || '')
    .replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (all, quote, raw) => {
      const value = String(raw || '').trim();
      if (!value || /^(?:data|blob):/i.test(value)) return all;
      const mapped = playerMapResource(requestOrigin, finalUrl, value);
      return `url("${mapped.replace(/"/g, '%22')}")`;
    })
    .replace(/@import\s+(["'])([^"']+)\1/gi, (all, quote, raw) => `@import ${quote}${playerMapResource(requestOrigin, finalUrl, raw)}${quote}`);
}
function playerRewriteAniHubGuard(jsText) {
  let out = String(jsText || '');
  const candidate = out.includes('fetchEpisodeSources') && out.includes('episodeSources') && out.includes('Не вдалося завантажити джерела перегляду');
  if (!candidate) return out;
  const oldGuard = 'if(!tr||null!=e6)return;';
  if (!out.includes(oldGuard)) return out;
  const newGuard = 'if(!tr)return;if(null!=e6&&((Array.isArray(e6.ashdi)&&e6.ashdi.length)||(Array.isArray(e6.moonanime)&&e6.moonanime.length)||(Array.isArray(e6.fenix)&&e6.fenix.length)||e6.fenix_embed_url))return;';
  return out.split(oldGuard).join(newGuard);
}
function playerRewriteJs(jsText, finalUrl, requestOrigin) {
  let out = String(jsText || '');
  try {
    const remoteOrigin = new URL(finalUrl).origin;
    const localOrigin = `${requestOrigin}/api/player/p/${playerEncodeOrigin(remoteOrigin)}`;
    if (out.includes(remoteOrigin)) out = out.split(remoteOrigin).join(localOrigin);
    const escapedRemote = remoteOrigin.replace(/\//g, '\\/');
    const escapedLocal = localOrigin.replace(/\//g, '\\/');
    if (out.includes(escapedRemote)) out = out.split(escapedRemote).join(escapedLocal);
    out = out.replace(/\b(?:window\.)?location\.(hostname|host|origin|pathname|href)\b/g, 'window.__yoruRemoteLocation.$1');
  } catch {}
  return playerRewriteAniHubGuard(out);
}
function playerRuntime(remoteUrl, requestOrigin) {
  const remote = new URL(remoteUrl);
  const proxyBase = `${requestOrigin}/api/player/p/${playerEncodeOrigin(remote.origin)}`;
  return `<script data-yoru-player-runtime>
(() => {
  const REMOTE_URL=${JSON.stringify(remote.href)};
  const REMOTE_ORIGIN=${JSON.stringify(remote.origin)};
  const PROXY_BASE=${JSON.stringify(proxyBase)};
  const NATIVE_FETCH=typeof window.fetch==='function'?window.fetch.bind(window):null;

  function mapUrl(value) {
    try {
      const raw=value instanceof URL?value.href:(value instanceof Request?value.url:String(value||''));
      if (!raw || /^(?:data|blob|javascript|mailto|tel):/i.test(raw) || raw.startsWith('#')) return raw;
      if (raw.startsWith(PROXY_BASE) || raw.startsWith(location.origin+'/api/player/p/')) return raw;
      let u=new URL(raw, REMOTE_URL);
      if (u.origin===location.origin && !u.pathname.startsWith('/api/player/')) u=new URL(u.pathname+u.search+u.hash, REMOTE_ORIGIN);
      if (u.origin===REMOTE_ORIGIN) return PROXY_BASE+u.pathname+u.search+u.hash;
      return u.href;
    } catch (_) { return String(value||''); }
  }
  window.__yoruRemoteUrl=REMOTE_URL;
  window.__yoruRemoteLocation=new URL(REMOTE_URL);
  window.__yoruMapPlayerUrl=mapUrl;

  try {
    if (NATIVE_FETCH) window.fetch=(input,init)=>{
      if (input instanceof Request) return NATIVE_FETCH(new Request(mapUrl(input.url),input),init);
      return NATIVE_FETCH(mapUrl(input),init);
    };
  } catch (_) {}
  try {
    const nativeOpen=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method,url,...rest){return nativeOpen.call(this,method,mapUrl(url),...rest)};
  } catch (_) {}
  try {
    if (navigator.sendBeacon) { const native=navigator.sendBeacon.bind(navigator); navigator.sendBeacon=(url,data)=>native(mapUrl(url),data); }
  } catch (_) {}
  try {
    if (window.EventSource) { const Native=window.EventSource; window.EventSource=function(url,cfg){return new Native(mapUrl(url),cfg)}; window.EventSource.prototype=Native.prototype; }
  } catch (_) {}
  try {
    if (window.Worker) { const Native=window.Worker; window.Worker=function(url,opts){return new Native(mapUrl(url),opts)}; window.Worker.prototype=Native.prototype; }
    if (window.SharedWorker) { const Native=window.SharedWorker; window.SharedWorker=function(url,opts){return new Native(mapUrl(url),opts)}; window.SharedWorker.prototype=Native.prototype; }
  } catch (_) {}
  try {
    const nativeSet=Element.prototype.setAttribute;
    Element.prototype.setAttribute=function(name,value){
      const n=String(name||'').toLowerCase();
      if (['src','href','action','poster','data-src','xlink:href'].includes(n)) value=mapUrl(value);
      return nativeSet.call(this,name,value);
    };
  } catch (_) {}
  function patchProperty(proto,prop) {
    try {
      const d=Object.getOwnPropertyDescriptor(proto,prop);
      if(!d||!d.get||!d.set||d.configurable===false)return;
      Object.defineProperty(proto,prop,{configurable:d.configurable,enumerable:d.enumerable,get:d.get,set(value){return d.set.call(this,mapUrl(value))}});
    } catch (_) {}
  }
  try {
    [[HTMLIFrameElement.prototype,'src'],[HTMLScriptElement.prototype,'src'],[HTMLImageElement.prototype,'src'],[HTMLSourceElement.prototype,'src'],[HTMLMediaElement.prototype,'src'],[HTMLVideoElement.prototype,'poster'],[HTMLLinkElement.prototype,'href'],[HTMLAnchorElement.prototype,'href'],[HTMLFormElement.prototype,'action']].forEach(x=>patchProperty(x[0],x[1]));
  } catch (_) {}
  try {
    const nativeOpen=window.open;
    window.open=function(url,...rest){return nativeOpen.call(window,mapUrl(url),...rest)};
  } catch (_) {}
  try {
    const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
    history.pushState=(state,title,url)=>push(state,title,url==null?url:mapUrl(url));
    history.replaceState=(state,title,url)=>replace(state,title,url==null?url:mapUrl(url));
  } catch (_) {}
  try {
    const nativePost=Window.prototype.postMessage;
    Window.prototype.postMessage=function(message,targetOrigin,transfer){
      let target=targetOrigin;
      if (typeof target==='string' && /^https?:\/\//i.test(target)) target=location.origin;
      if (arguments.length>=3) return nativePost.call(this,message,target,transfer);
      return nativePost.call(this,message,target);
    };
  } catch (_) {}
  document.addEventListener('click',event=>{
    const a=event.target&&event.target.closest?event.target.closest('a[href]'):null;
    if(!a)return;
    try{const mapped=mapUrl(a.getAttribute('href'));if(mapped&&mapped!==a.href)a.href=mapped;}catch(_){}
  },true);

})();
</script>`;
}
function playerInjectHtml(html, finalUrl, requestOrigin) {
  let out = playerRewriteHtmlAttributes(html, finalUrl, requestOrigin);
  const runtime = playerRuntime(finalUrl, requestOrigin);
  const match = out.match(/<head\b[^>]*>/i);
  if (match) {
    const index = match.index + match[0].length;
    return out.slice(0,index) + runtime + out.slice(index);
  }
  return runtime + out;
}
function playerUpstreamHeaders(request, target) {
  const headers = new Headers();
  const pass = ['accept','accept-language','content-type','range','if-range','if-none-match','if-modified-since','user-agent','x-requested-with'];
  for (const name of pass) { const value=request.headers.get(name); if(value) headers.set(name,value); }
  for (const [name,value] of request.headers.entries()) {
    const lower=name.toLowerCase();
    if (lower.startsWith('x-') && !lower.startsWith('x-forwarded-') && !lower.startsWith('x-vercel-') && !lower.startsWith('x-real-') && lower!=='x-ingest-key') {
      try{headers.set(name,value)}catch{}
    }
  }
  headers.set('referer', target.origin + '/');
  if (!['GET','HEAD'].includes(request.method)) headers.set('origin', target.origin);
  return headers;
}
function playerResponseHeaders(upstream, transformed = false) {
  const headers = new Headers();
  const blocked = new Set(['content-security-policy','content-security-policy-report-only','x-frame-options','frame-options','cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy','permissions-policy','content-encoding','transfer-encoding','connection','keep-alive','set-cookie']);
  for (const [name,value] of upstream.headers.entries()) {
    const lower=name.toLowerCase();
    if(blocked.has(lower))continue;
    if(transformed && ['content-length','etag','last-modified','expires'].includes(lower))continue;
    try{headers.set(name,value)}catch{}
  }
  headers.set('x-content-type-options','nosniff');
  if(transformed)headers.set('cache-control','no-store, no-cache, must-revalidate, max-age=0');
  return headers;
}
async function playerProxyFetch(request, target) {
  const requestUrl = new URL(request.url);
  const init = { method:request.method, headers:playerUpstreamHeaders(request,target), redirect:'follow' };
  if(!['GET','HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  const upstream = await fetch(target, init);
  const finalUrl = upstream.url || target.href;
  const type = upstream.headers.get('content-type') || 'application/octet-stream';
  const requestOrigin = requestUrl.origin;
  if (/text\/html|application\/xhtml\+xml/i.test(type)) {
    const text = await upstream.text();
    const body = playerInjectHtml(text, finalUrl, requestOrigin);
    const headers = playerResponseHeaders(upstream, true); headers.set('content-type','text/html; charset=utf-8');
    return new Response(body,{status:upstream.status,headers});
  }
  if (/javascript|ecmascript/i.test(type) || /\.(?:m?js)(?:$|\?)/i.test(finalUrl)) {
    const text = await upstream.text();
    const body = playerRewriteJs(text, finalUrl, requestOrigin);
    const headers = playerResponseHeaders(upstream, true); headers.set('content-type',type || 'application/javascript; charset=utf-8');
    return new Response(body,{status:upstream.status,headers});
  }
  if (/text\/css/i.test(type)) {
    const text = await upstream.text();
    const body = playerRewriteCss(text, finalUrl, requestOrigin);
    const headers = playerResponseHeaders(upstream, true); headers.set('content-type',type || 'text/css; charset=utf-8');
    return new Response(body,{status:upstream.status,headers});
  }
  return new Response(upstream.body,{status:upstream.status,headers:playerResponseHeaders(upstream,false)});
}
async function handlePlayerDomView(request) {
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  const requestUrl=new URL(request.url),raw=requestUrl.searchParams.get('url')||'',expected=playerCanonicalHost(requestUrl.searchParams.get('site')||'');
  const info=playerDomConfigForUrl(raw);
  if(!info)return json({error:'Цей сайт не підтримується DOM-плеєром YORU.'},400);
  if(expected&&expected!==info.site)return json({error:'Домен посилання не відповідає вибраному джерелу.'},400);
  return playerProxyFetch(request,info.url);
}
async function handlePlayerProxy(request) {
  const requestUrl=new URL(request.url),prefix='/api/player/p/',rest=requestUrl.pathname.slice(prefix.length),slash=rest.indexOf('/');
  if(slash<1)return json({error:'Некоректний player proxy URL.'},400);
  const token=rest.slice(0,slash),origin=playerDecodeOrigin(token);
  if(!origin||!playerSameSiteAllowed(origin))return json({error:'Player proxy origin не дозволений.'},403);
  let target;
  try{target=new URL(rest.slice(slash)+requestUrl.search,origin)}catch{return json({error:'Некоректний upstream URL.'},400)}
  if(target.origin!==origin)return json({error:'Зміна origin у player proxy заборонена.'},403);
  return playerProxyFetch(request,target);
}

function playerNativeMapAbsolute(value, remoteOrigin, localOrigin) {
  try {
    if (value == null) return value;
    const raw=String(value);
    if (!/^(?:https?:)?\/\//i.test(raw)) return value; // relative/root paths stay native
    const u=new URL(raw,remoteOrigin+'/');
    if (u.origin!==remoteOrigin) return value;
    return localOrigin+u.pathname+u.search+u.hash;
  } catch { return value; }
}
function playerNativeRewriteHtml(html, remoteUrl, localOrigin) {
  const remoteOrigin=new URL(remoteUrl).origin;
  return String(html||'').replace(/\b(src|href|action|poster|data-src)\s*=\s*(["'])([^"']+)\2/gi,(all,attr,quote,raw)=>{
    const mapped=playerNativeMapAbsolute(raw,remoteOrigin,localOrigin);
    return mapped===raw?all:`${attr}=${quote}${String(mapped).replace(new RegExp(quote,'g'),quote==='"'?'&quot;':'&#39;')}${quote}`;
  }).replace(/\bsrcset\s*=\s*(["'])([^"']+)\1/gi,(all,quote,raw)=>{
    const parts=String(raw).split(',').map(part=>{
      const m=part.trim().match(/^(\S+)(\s+.+)?$/);if(!m)return part.trim();
      return String(playerNativeMapAbsolute(m[1],remoteOrigin,localOrigin))+(m[2]||'');
    });
    return `srcset=${quote}${parts.join(', ')}${quote}`;
  });
}
function playerNativeRewriteCss(css, remoteUrl, localOrigin) {
  const remoteOrigin=new URL(remoteUrl).origin;
  return String(css||'')
    .replace(/url\(\s*(["']?)(https?:\/\/|\/\/)(.*?)\1\s*\)/gi,(all,q,scheme,rest)=>{
      const raw=scheme+rest,mapped=playerNativeMapAbsolute(raw,remoteOrigin,localOrigin);
      return mapped===raw?all:`url("${String(mapped).replace(/"/g,'%22')}")`;
    })
    .replace(/@import\s+(["'])(https?:\/\/|\/\/)(.*?)\1/gi,(all,q,scheme,rest)=>{
      const raw=scheme+rest,mapped=playerNativeMapAbsolute(raw,remoteOrigin,localOrigin);
      return mapped===raw?all:`@import ${q}${mapped}${q}`;
    });
}
function playerNativeRewriteJs(jsText, remoteUrl, localOrigin) {
  let out=String(jsText||'');
  try {
    const remoteOrigin=new URL(remoteUrl).origin;
    const apiBase=remoteOrigin+'/api',localApi=localOrigin+'/api';
    if(out.includes(apiBase))out=out.split(apiBase).join(localApi);
    const escapedApi=apiBase.replace(/\//g,'\\/'),escapedLocalApi=localApi.replace(/\//g,'\\/');
    if(out.includes(escapedApi))out=out.split(escapedApi).join(escapedLocalApi);
    if(out.includes(remoteOrigin))out=out.split(remoteOrigin).join(localOrigin);
    const escapedRemote=remoteOrigin.replace(/\//g,'\\/'),escapedLocal=localOrigin.replace(/\//g,'\\/');
    if(out.includes(escapedRemote))out=out.split(escapedRemote).join(escapedLocal);
  } catch {}
  return playerRewriteAniHubGuard(out);
}
function playerNativeRuntime(remoteUrl, localOrigin, site) {
  const remote=new URL(remoteUrl),sourceCfg=PLAYER_DOM_SOURCES[site]||{},targetClasses=sourceCfg.classes||[];
  return `<script data-yoru-native-player-runtime>
(()=>{
  const REMOTE_URL=${JSON.stringify(remote.href)};
  const REMOTE_ORIGIN=${JSON.stringify(remote.origin)};
  const LOCAL_ORIGIN=${JSON.stringify(localOrigin)};
  const DOMAIN=${JSON.stringify(site)};
  const TARGET_CLASSES=${JSON.stringify(targetClasses)};
  const RAW_FETCH=typeof window.fetch==='function'?window.fetch.bind(window):null;
  let currentTarget=null,lastInteractionAt=0;
  function mapAbsolute(value){
    try{
      if(value==null)return value;
      const raw=value instanceof URL?value.href:(value instanceof Request?value.url:String(value));
      if(!/^(?:https?:)?\\/\\//i.test(raw))return value;
      const u=new URL(raw,REMOTE_ORIGIN+'/');
      if(u.origin!==REMOTE_ORIGIN)return value;
      return LOCAL_ORIGIN+u.pathname+u.search+u.hash;
    }catch(_){return value}
  }
  function send(type,extra={}){try{parent.postMessage({__yoruPlayerBridge:1,type,domain:DOMAIN,...extra},'*')}catch(_){}}
  window.__yoruRemoteUrl=REMOTE_URL;
  try{
    if(RAW_FETCH)window.fetch=(input,init)=>{
      if(input instanceof Request){const mapped=mapAbsolute(input.url);return RAW_FETCH(mapped===input.url?input:new Request(mapped,input),init)}
      return RAW_FETCH(mapAbsolute(input),init)
    };
  }catch(_){}
  try{const native=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){return native.call(this,method,mapAbsolute(url),...rest)}}catch(_){}
  try{if(navigator.sendBeacon){const native=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(url,data)=>native(mapAbsolute(url),data)}}catch(_){}
  try{if(window.EventSource){const Native=window.EventSource;window.EventSource=function(url,cfg){return new Native(mapAbsolute(url),cfg)};window.EventSource.prototype=Native.prototype}}catch(_){}
  try{if(window.Worker){const Native=window.Worker;window.Worker=function(url,opts){return new Native(mapAbsolute(url),opts)};window.Worker.prototype=Native.prototype}if(window.SharedWorker){const Native=window.SharedWorker;window.SharedWorker=function(url,opts){return new Native(mapAbsolute(url),opts)};window.SharedWorker.prototype=Native.prototype}}catch(_){}
  try{
    const nativeSet=Element.prototype.setAttribute;
    Element.prototype.setAttribute=function(name,value){const n=String(name||'').toLowerCase();if(['src','href','action','poster','data-src','xlink:href'].includes(n))value=mapAbsolute(value);return nativeSet.call(this,name,value)};
  }catch(_){}
  function patchProp(proto,prop){try{const d=Object.getOwnPropertyDescriptor(proto,prop);if(!d||!d.get||!d.set||d.configurable===false)return;Object.defineProperty(proto,prop,{configurable:d.configurable,enumerable:d.enumerable,get:d.get,set(value){return d.set.call(this,mapAbsolute(value))}})}catch(_){}}
  try{[[HTMLIFrameElement.prototype,'src'],[HTMLScriptElement.prototype,'src'],[HTMLImageElement.prototype,'src'],[HTMLSourceElement.prototype,'src'],[HTMLMediaElement.prototype,'src'],[HTMLVideoElement.prototype,'poster'],[HTMLLinkElement.prototype,'href']].forEach(x=>patchProp(x[0],x[1]))}catch(_){}
  try{const nativePost=Window.prototype.postMessage;Window.prototype.postMessage=function(message,targetOrigin,transfer){let mapped=targetOrigin;try{if(typeof targetOrigin==='string'&&new URL(targetOrigin).origin===REMOTE_ORIGIN)mapped=LOCAL_ORIGIN}catch(_){}if(arguments.length>=3)return nativePost.call(this,message,mapped,transfer);return nativePost.call(this,message,mapped)}}catch(_){}

  function usable(el){if(!el||!el.isConnected)return false;const r=el.getBoundingClientRect();if(r.width<2||r.height<2)return false;const cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden'&&cs.visibility!=='collapse'&&Number(cs.opacity||1)>.001}
  function pickAnchor(){const all=Array.from(document.getElementsByClassName(TARGET_CLASSES.join(' ')));if(!all.length)return null;const good=all.filter(usable),pool=good.length?good:all;let best=null,score=-Infinity;for(const el of pool){const r=el.getBoundingClientRect();let s=Math.max(0,r.width)*Math.max(0,r.height);if(el.querySelector?.('iframe,video,audio,canvas,object,embed'))s+=5000000;if(el.querySelector?.('button,input,select,textarea'))s+=50000;if(s>score){score=s;best=el}}return best}
  function playerSurface(anchor){return anchor}
  function canScroll(el,dx,dy){if(!el||el.nodeType!==1)return false;const cs=getComputedStyle(el);if(dy){const ok=/(auto|scroll|overlay)/.test(cs.overflowY)&&el.scrollHeight>el.clientHeight+1;if(ok&&((dy<0&&el.scrollTop>0)||(dy>0&&el.scrollTop+el.clientHeight<el.scrollHeight-1)))return true}if(dx){const ok=/(auto|scroll|overlay)/.test(cs.overflowX)&&el.scrollWidth>el.clientWidth+1;if(ok&&((dx<0&&el.scrollLeft>0)||(dx>0&&el.scrollLeft+el.clientWidth<el.scrollWidth-1)))return true}return false}
  function topInset(target){const vw=Math.max(1,innerWidth),vh=Math.max(1,innerHeight),xs=[Math.round(vw*.08),Math.round(vw*.5),Math.round(vw*.92)],ys=[1,12,28,48,72,96,128,160],seen=new Set();let inset=0;for(const x of xs)for(const y of ys){if(y>=vh)continue;let stack=[];try{stack=document.elementsFromPoint(x,y)||[]}catch(_){continue}for(const el of stack){if(!el||el===document.documentElement||el===document.body||seen.has(el))continue;seen.add(el);if(target&&(el===target||target.contains?.(el)))continue;let cs,r;try{cs=getComputedStyle(el);r=el.getBoundingClientRect()}catch(_){continue}if(!r||r.width<20||r.height<4||r.bottom<=0)continue;if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity||1)<=.001)continue;if(cs.position!=='fixed'&&cs.position!=='sticky')continue;if(r.top>8||r.bottom>vh*.6)continue;inset=Math.max(inset,Math.min(r.bottom,260))}}return Math.max(0,Math.round(inset))}
  function intersects(a,b,pad=80){return !(b.right<a.left-pad||b.left>a.right+pad||b.bottom<a.top-pad||b.top>a.bottom+pad)}
  function overlays(rect){if(Date.now()-lastInteractionAt>3500)return[];const q='[role="menu"],[role="listbox"],[role="dialog"],[role="tooltip"],.dropdown-menu,.select2-dropdown,.ui-menu,.ui-autocomplete,[class*="dropdown"],[class*="popup"],[class*="popover"]';let nodes=[];try{nodes=Array.from(document.querySelectorAll(q))}catch(_){return[]}return nodes.filter(el=>{if(!el.isConnected||currentTarget?.contains(el))return false;const r=el.getBoundingClientRect(),cs=getComputedStyle(el);if(r.width<8||r.height<8||r.width>innerWidth*.95||r.height>innerHeight*.95)return false;if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity||1)<=.001)return false;return intersects(rect,r,120)}).map(el=>el.getBoundingClientRect())}
  function union(rects){const v=rects.filter(Boolean);if(!v.length)return null;let left=v[0].left,top=v[0].top,right=v[0].right,bottom=v[0].bottom;for(const r of v.slice(1)){left=Math.min(left,r.left);top=Math.min(top,r.top);right=Math.max(right,r.right);bottom=Math.max(bottom,r.bottom)}return{left,top,right,bottom,width:right-left,height:bottom-top}}
  function update(){
    const anchor=pickAnchor();if(!anchor||!usable(anchor))return false;
    const target=playerSurface(anchor);if(!target||!usable(target))return false;
    const changed=target!==currentTarget;currentTarget=target;
    let rect=target.getBoundingClientRect(),inset=topInset(target),safeTop=inset+12;
    const outside=rect.bottom<safeTop||rect.top>innerHeight-8||rect.right<0||rect.left>innerWidth,under=rect.top<safeTop-2;
    if(changed||outside||under){const docY=rect.top+scrollY,desired=Math.max(0,docY-safeTop);try{scrollTo({left:scrollX,top:desired,behavior:'instant'})}catch(_){try{scrollTo(scrollX,desired)}catch(__){}}rect=target.getBoundingClientRect();inset=topInset(target)}
    const vr=union([rect,...overlays(rect)]);if(!vr||vr.width<2||vr.height<2)return false;
    send('crop',{rect:{left:vr.left,top:vr.top,width:vr.width,height:vr.height},viewportW:Math.max(1,innerWidth),viewportH:Math.max(1,innerHeight),topInset:inset});
    return true;
  }
  document.addEventListener('pointerdown',e=>{if(currentTarget&&currentTarget.contains(e.target)){lastInteractionAt=Date.now();setTimeout(update,0);setTimeout(update,80);setTimeout(update,250)}},true);
  document.addEventListener('click',e=>{if(currentTarget&&currentTarget.contains(e.target)){lastInteractionAt=Date.now();setTimeout(update,0);setTimeout(update,80);setTimeout(update,250)}},true);
  document.addEventListener('wheel',e=>{if(!currentTarget||!currentTarget.contains(e.target)){e.preventDefault();return}let n=e.target;while(n&&n!==currentTarget.parentElement){if(canScroll(n,e.deltaX,e.deltaY))return;if(n===currentTarget)break;n=n.parentElement}e.preventDefault()},{capture:true,passive:false});
  send('ready',{href:location.href});
  let lastSearch=0;const tick=()=>{try{const ok=update();if(!ok&&Date.now()-lastSearch>700){lastSearch=Date.now();send('searching',{readyState:document.readyState})}}catch(e){send('bridge-error',{message:e?.message||String(e)})}};
  tick();setInterval(tick,120);
})();
</script>`;
}
function playerNativeInjectHtml(html, remoteUrl, localOrigin, site) {
  let out=playerNativeRewriteHtml(html,remoteUrl,localOrigin);
  const runtime=playerNativeRuntime(remoteUrl,localOrigin,site),m=out.match(/<head\b[^>]*>/i);
  if(m){const i=m.index+m[0].length;return out.slice(0,i)+runtime+out.slice(i)}
  return runtime+out;
}
function playerNativeRewriteSetCookie(raw) {
  const parts=String(raw||'').split(';'),first=parts.shift()||'';if(!first.includes('='))return null;
  const attrs=[];for(const p0 of parts){const p=p0.trim();if(!p)continue;if(/^domain=/i.test(p)||/^samesite=/i.test(p))continue;attrs.push(p)}attrs.push('SameSite=Lax');return `${first.trim()}; ${attrs.join('; ')}`;
}
function playerNativeUpstreamHeaders(request,target,localOrigin) {
  const headers=new Headers(),drop=new Set(['host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','content-length','accept-encoding','origin','referer','via','forwarded']);
  for(const [name,value] of request.headers.entries()){
    const n=name.toLowerCase();if(drop.has(n)||n.startsWith('proxy-')||n.startsWith('cf-')||n.startsWith('x-forwarded-')||n.startsWith('x-yoru-'))continue;
    try{headers.set(name,value)}catch{}
  }
  if(request.headers.get('cookie'))headers.set('cookie',request.headers.get('cookie'));
  headers.set('user-agent',request.headers.get('user-agent')||'Mozilla/5.0');
  const ref=request.headers.get('referer');
  if(ref){try{const r=new URL(ref);headers.set('referer',new URL(r.pathname+r.search,target.origin).href)}catch{headers.set('referer',target.origin+'/')}}else headers.set('referer',target.origin+'/');
  const origin=request.headers.get('origin');if(origin){try{if(new URL(origin).origin===localOrigin)headers.set('origin',target.origin);else headers.set('origin',origin)}catch{}}
  return headers;
}
function playerNativeResponseHeaders(upstream,request,localOrigin,remoteOrigin,finalUrl,transformed=false) {
  const headers=new Headers(),blocked=new Set(['content-security-policy','content-security-policy-report-only','x-frame-options','frame-options','content-length','content-encoding','transfer-encoding','connection','keep-alive','cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy','origin-agent-cluster','set-cookie','location']);
  for(const [name,value] of upstream.headers.entries()){const n=name.toLowerCase();if(blocked.has(n)||n.startsWith('access-control-'))continue;if(transformed&&['etag','last-modified','expires'].includes(n))continue;try{headers.set(name,value)}catch{}}
  const cookies=typeof upstream.headers.getSetCookie==='function'?upstream.headers.getSetCookie():[];
  if(cookies.length){for(const raw of cookies){const c=playerNativeRewriteSetCookie(raw);if(c)headers.append('set-cookie',c)}}else{const raw=upstream.headers.get('set-cookie');const c=raw&&playerNativeRewriteSetCookie(raw);if(c)headers.append('set-cookie',c)}
  const reqOrigin=request.headers.get('origin');if(reqOrigin){headers.set('access-control-allow-origin',reqOrigin);headers.set('access-control-allow-credentials','true');headers.append('vary','Origin')}
  const loc=upstream.headers.get('location');if(loc){try{const u=new URL(loc,finalUrl);headers.set('location',u.origin===remoteOrigin?localOrigin+u.pathname+u.search+u.hash:u.href)}catch{headers.set('location',loc)}}
  return headers;
}
async function handlePlayerNativeBranch(request,info) {
  const requestUrl=new URL(request.url),localOrigin=requestUrl.origin,remoteOrigin=info.remoteOrigin;
  const target=new URL(requestUrl.pathname+requestUrl.search,remoteOrigin);
  const headers=playerNativeUpstreamHeaders(request,target,localOrigin);
  const init={method:request.method,headers,redirect:'manual'};
  if(!['GET','HEAD'].includes(request.method))init.body=await request.arrayBuffer();
  const upstream=await fetch(target,init),finalUrl=upstream.url||target.href,type=upstream.headers.get('content-type')||'application/octet-stream';
  if(/text\/html|application\/xhtml\+xml/i.test(type)){
    const text=await upstream.text(),body=playerNativeInjectHtml(text,finalUrl,localOrigin,info.site),h=playerNativeResponseHeaders(upstream,request,localOrigin,remoteOrigin,finalUrl,true);h.set('content-type','text/html; charset=utf-8');return new Response(body,{status:upstream.status,headers:h});
  }
  if(/javascript|ecmascript/i.test(type)||/\/_next\/static\/chunks\//i.test(finalUrl)){
    const text=await upstream.text(),body=playerNativeRewriteJs(text,finalUrl,localOrigin),h=playerNativeResponseHeaders(upstream,request,localOrigin,remoteOrigin,finalUrl,true);h.set('content-type',type||'application/javascript; charset=utf-8');return new Response(body,{status:upstream.status,headers:h});
  }
  if(/text\/css/i.test(type)){
    const text=await upstream.text(),body=playerNativeRewriteCss(text,finalUrl,localOrigin),h=playerNativeResponseHeaders(upstream,request,localOrigin,remoteOrigin,finalUrl,true);h.set('content-type',type);return new Response(body,{status:upstream.status,headers:h});
  }
  return new Response(upstream.body,{status:upstream.status,headers:playerNativeResponseHeaders(upstream,request,localOrigin,remoteOrigin,finalUrl,false)});
}

function parseMikaiPlayerRef(pageUrl) {
  let url;
  try{url=new URL(String(pageUrl||'').trim())}catch{throw new HttpError(400,'Некоректний URL Mikai.')}
  if(!/(^|\.)mikai\.me$/i.test(url.hostname))throw new HttpError(400,'URL має вести на mikai.me.');
  const match=url.pathname.match(/^\/anime\/([^/?#]+)/i);
  if(!match)throw new HttpError(400,'Очікується URL виду https://mikai.me/anime/1234-slug');
  const segment=decodeURIComponent(match[1]),id=segment.match(/^(\d+)(?:-|$)/);
  if(id)return id[1];
  const slug=segment.replace(/^slug:/i,'').trim();
  if(!slug)throw new HttpError(400,'Не вдалося визначити anime ref з URL Mikai.');
  return 'slug:'+slug;
}
async function handleMikaiPlayerApi(request,env) {
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  const state=await tursoLoadState(env),requestUrl=new URL(request.url),pageUrl=requestUrl.searchParams.get('url')||'',ref=parseMikaiPlayerRef(pageUrl),apiKey=String(state.config.mikaiApiKey||'').trim();
  const endpoint=`https://api.mikai.me/public/v1/anime/${encodeURIComponent(ref)}/player`,headers=new Headers({accept:'application/json'});
  if(apiKey)headers.set('x-api-key',apiKey);
  const upstream=await fetch(endpoint,{method:'GET',headers,redirect:'follow'}),text=await upstream.text();
  let payload={};try{payload=text?JSON.parse(text):{}}catch{payload={}}
  const rateLimit={limit:upstream.headers.get('x-ratelimit-limit'),remaining:upstream.headers.get('x-ratelimit-remaining'),reset:upstream.headers.get('x-ratelimit-reset'),quotaLimit:upstream.headers.get('x-quota-limit'),quotaRemaining:upstream.headers.get('x-quota-remaining'),quotaReset:upstream.headers.get('x-quota-reset')};
  if(!upstream.ok)return json({ok:false,error:payload?.error||{message:payload?.message||`Mikai API HTTP ${upstream.status}`},keyConfigured:Boolean(apiKey),rateLimit},upstream.status);
  if(payload?.ok!==true)return json({ok:false,error:payload?.error||{message:'Некоректна відповідь Mikai API'},keyConfigured:Boolean(apiKey),rateLimit},502);
  return json({ok:true,result:payload.result,keyConfigured:Boolean(apiKey),rateLimit});
}
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const nativeBranch=playerNativeBranchInfo(url.hostname);
      if (nativeBranch) return handlePlayerNativeBranch(request,nativeBranch);
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, PATCH, DELETE, OPTIONS','access-control-allow-headers':'Content-Type, X-Ingest-Key','access-control-max-age':'86400'}});
      if (url.pathname === '/api/anihub/random') return handleAniHubRandomApi(request,env);
      if (url.pathname === '/api/anihub/title') return handleAniHubTitleApi(request);
      if (url.pathname === '/api/anihub/similar') return handleAniHubSimilarApi(request,env);
      if (url.pathname === '/api/anime-identify') return handleAnimeIdentifyApi(request);
      if (url.pathname === '/api/player/mikai') return handleMikaiPlayerApi(request,env);
      if (url.pathname === '/api/player/view') return handlePlayerDomView(request);
      if (url.pathname.startsWith('/api/player/p/')) return handlePlayerProxy(request);
      if (url.pathname === '/api/core-search') return handleCoreSearchApi(request,env);
      if (url.pathname === '/api/core-taxonomy') return handleCoreTaxonomyApi(request,env);
      if (url.pathname === '/api/process-title-stream') return handleProcessTitleStreamApi(request,env);
      if (url.pathname === '/api/process-title') return handleProcessTitleApi(request,env);
      if (url.pathname === '/api/ingest' || url.pathname === '/api/anime/import') return tursoHandleIngestApi(request,env);
      if (request.method==='POST' && url.pathname==='/' && (request.headers.get('content-type')||'').includes('application/json')) return tursoHandleIngestApi(request,env);
      if (url.pathname === '/api/anime/merge') return tursoHandleMergeAnimeApi(request,env);
      if (url.pathname === '/api/anime/refresh') return tursoHandleAnimeRefreshApi(request,env);
      if (url.pathname === '/api/anime/viewed') return tursoHandleViewedApi(request,env);
      if (url.pathname === '/api/groups') return tursoHandleGroupsApi(request,env);
      if (url.pathname === '/api/catalog-settings') return tursoHandleCatalogSettingsApi(request,env);
      if (url.pathname === '/api/anime/upload') return json({error:'Завантаження файлів вимкнено. Використай URL постера/банера.'},410);
      if (url.pathname === '/api/extension/context') return tursoHandleExtensionContextApi(request,env);
      if (url.pathname === '/api/anime') return tursoHandleAnimeApi(request,env);
      if (url.pathname === '/api/options') return tursoHandleOptionsApi(request,env);
      if (url.pathname === '/api/discover') return handleDiscoverApi(request);
      if (url.pathname === '/api/version') return json({ok:true,version:'yoru-v7.7.0-anihub-discovery-2026-09-15',storage:'turso-libsql',pythonCoreSearch:env.CORE_SEARCH_URL||CORE_SEARCH_URL,pythonCoreProcessStream:env.CORE_PROCESS_STREAM_URL||CORE_PROCESS_STREAM_URL,pythonCoreProcessFull:env.CORE_PROCESS_FULL_URL||CORE_PROCESS_FULL_URL,progressProtocol:'ndjson-v1',coreJsonIngest:true,mergeTitles:true,deleteTitles:true,editTitles:true,extensionContext:'/api/extension/context',favoriteStorage:'turso-libsql',likedStorage:'turso-libsql',viewedStorage:'turso-libsql',seasonEpisodeStorage:'turso-libsql',groupSettings:'/api/groups',catalogSettings:'/api/catalog-settings',tagDelimiter:'dot',taxonomy:true,genreSources:GENRE_SOURCES,themeSources:THEME_SOURCES,coreTaxonomy:'/api/core-taxonomy',playerHub:true,playerSources:['anihub.in.ua','animeon.club','mikai.me','jut-su.net','animego.studio'],mikaiPlayerApi:'/api/player/mikai',domPlayerView:'/api/player/view',trailerBackground:true,titleCardRefresh:'/api/anime/refresh',anihubRandom:'/api/anihub/random',anihubSimilar:'/api/anihub/similar',screenshotIdentify:'/api/anime-identify'});
      if (url.pathname === '/api/health') return tursoHandleHealthApi(env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Yoru Turso worker error', error);
      const status = error instanceof HttpError ? error.status : 500;
      const payload = { error: error?.message || 'Невідома помилка сервера.' };
      if (error instanceof HttpError) { if(error.code)payload.code=error.code;if(error.step)payload.step=error.step;if(error.details)payload.details=error.details; }
      return json(payload,status>=400&&status<600?status:500);
    }
  }
};
