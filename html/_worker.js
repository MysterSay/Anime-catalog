const NOTION_VERSION = '2026-03-11';
const DEFAULT_DATABASE_ID = '3b87f72ac401804aab37db6332771629';
const DEFAULT_DATA_SOURCE_ID = '3b87f72ac401802a95e4000bc7ababca';
const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const CORE_PROCESS_URL = 'https://anime-catalog-flame.vercel.app/api/process';
const CORE_PROCESS_FULL_URL = 'https://anime-catalog-flame.vercel.app/api/process-full';
const CORE_SEARCH_URL = 'https://anime-catalog-flame.vercel.app/api/search';

const TITLE_STATUS_OPTIONS = ['Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто'];
const CATALOG_GROUPS = {
  RU: ['jut-su.net', 'ru.yummyani.me', 'crunchyroll.com', 'shikimori.io', 'animevost.org', 'jutsu.tv', 'jut.su', 'animego.studio', 'anilibria.tv'],
  UA: ['uaserials.com', 'uachan.com', 'anihub.in.ua', 'amanogawa.space', 'animeon.club', 'anidesu.net', 'mikai.me', 'anitube.in.ua'],
};
const CATALOGS = [...CATALOG_GROUPS.RU, ...CATALOG_GROUPS.UA];
const AUTHORITY_SITES = ['myanimelist.net', 'anilist.co', 'shikimori.io'];
const SITE_PROPERTIES = [...new Set([...AUTHORITY_SITES, ...CATALOGS])];
const GOOGLE_SOURCE_SITES = [
  { domain: 'myanimelist.net', label: 'MyAnimeList', path: /^\/anime\/\d+(?:\/|$)/i },
  { domain: 'anilist.co', label: 'AniList', path: /^\/anime\/\d+(?:\/|$)/i },
  { domain: 'shikimori.io', label: 'Shikimori', path: /^\/animes\/\d+(?:[-\/]|$)/i },
];
const SEARCH_HOST_ALIASES = {
  'anilibria.tv': ['aniliberty.top', 'www.aniliberty.top', 'anilibria.top', 'www.anilibria.top', 'anilibria.tv'],
  'crunchyroll.com': ['www.crunchyroll.com', 'crunchyroll.com'],
  'uachan.com': ['uachan.top', 'www.uachan.top', 'uachan.com', 'www.uachan.com'],
};

const NOTION_PROPERTIES = {
  title: 'Назва',
  description: 'Опис',
  originalTitle: 'Оригінальна назва',
  englishTitle: 'Англійська назва',
  russianTitle: 'Російська назва',
  aliases: 'Аліаси',
  banner: 'Банер',
  coverImage: 'Обкладинка',
  status: 'Статус',
  group: 'Група',
  sourceUrl: 'Сторінка-джерело',
  key: 'Ключ',
  addedAt: 'Додано',
};

class HttpError extends Error {
  constructor(status, message, details = '', code = '', step = '') {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
    this.step = step;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'Content-Type, X-Ingest-Key',
      ...extraHeaders,
    },
  });
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, '')
    .replace(/\s*[|–—-]\s*(?:смотреть|дивитися|watch|anime|аниме|аніме).*$/i, '')
    .replace(/\s*\(\s*(?:смотреть|дивитися) онлайн.*$/i, '')
    .replace(/\s+(?:\d+\s*)?(?:серия|серії|серія|episode)\s*\d*\s*$/i, '')
    .replace(/\s+(?:сезон|season)\s*\d+\s*$/i, '')
    .trim();
}

function exactTitleKey(value) {
  return cleanTitle(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateTitleAliases(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const aliases = [raw];
  for (const part of raw.split(/\s+(?:\/|\||•|·)\s+/)) if (part && part !== raw) aliases.push(part);
  for (const item of [...aliases]) {
    const stripped = item.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();
    if (stripped && stripped !== item) aliases.push(stripped);
  }
  return [...new Set(aliases.map(cleanTitle).filter(Boolean))];
}

function titleMatchKind(query, candidateText) {
  const expected = exactTitleKey(query);
  const candidate = exactTitleKey(candidateText);
  if (!expected || !candidate) return null;
  if (candidate === expected) return 'exact';
  if (!candidate.startsWith(`${expected} `)) return null;
  const suffix = candidate.slice(expected.length).trim();
  if (!suffix || /\b(?:episode|ep|серия|серії|серія|серий|епізод)\b/i.test(suffix)) return null;
  return /(?:\b(?:season|seasons|сезон|сезони|часть|частина|part|cour|arc|арка|глава|hen)\b|\b[a-z0-9]+hen\b|\b\d+(?:st|nd|rd|th)\b|^\d+\s*(?:season|сезон|часть|частина|part)\b)/i.test(suffix)
    ? 'season'
    : null;
}

function getTitleMatch(query, ...candidateTexts) {
  let seasonMatch = null;
  for (const text of candidateTexts) {
    for (const alias of candidateTitleAliases(text)) {
      const kind = titleMatchKind(query, alias);
      if (kind === 'exact') return { kind, title: alias };
      if (kind === 'season' && !seasonMatch) seasonMatch = { kind, title: alias };
    }
  }
  return seasonMatch;
}

function aniListAliases(media) {
  return [
    media?.title?.romaji,
    media?.title?.english,
    media?.title?.native,
    ...(Array.isArray(media?.synonyms) ? media.synonyms : []),
  ].map(cleanTitle).filter(Boolean);
}

function getTitleMatchWithAniListAliases(query, media, ...candidateTexts) {
  const direct = getTitleMatch(query, ...candidateTexts);
  if (direct) return direct;
  for (const alias of aniListAliases(media)) {
    const match = getTitleMatch(alias, ...candidateTexts);
    if (match) return { ...match, matchedAlias: alias };
  }
  return null;
}

function safeHttpUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch { return ''; }
}

function normalizeName(value = '') {
  return String(value)
    .toLocaleLowerCase('uk-UA')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ')
    .trim();
}

function richTextArray(prop) {
  if (!prop) return [];
  if (prop.type === 'title') return prop.title || [];
  if (prop.type === 'rich_text') return prop.rich_text || [];
  return [];
}

function textValue(prop) {
  if (!prop) return '';
  if (prop.type === 'title' || prop.type === 'rich_text') return richTextArray(prop).map(x => x.plain_text || x.text?.content || '').join('').trim();
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'status') return prop.status?.name || '';
  if (prop.type === 'multi_select') return (prop.multi_select || []).map(x => x.name).filter(Boolean).join(', ');
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'date') return prop.date?.start || '';
  if (prop.type === 'created_time') return prop.created_time || '';
  if (prop.type === 'last_edited_time') return prop.last_edited_time || '';
  if (prop.type === 'checkbox') return prop.checkbox ? 'true' : 'false';
  return '';
}

function fileUrl(prop) {
  if (!prop) return '';
  if (prop.type === 'files') {
    for (const file of prop.files || []) {
      const url = safeHttpUrl(file.file?.url || file.external?.url || '');
      if (url) return url;
    }
  }
  if (prop.type === 'url') return safeHttpUrl(prop.url);
  if (prop.type === 'rich_text' || prop.type === 'title') {
    for (const part of richTextArray(prop)) {
      const url = safeHttpUrl(part.href || part.text?.link?.url || part.plain_text || '');
      if (url) return url;
    }
  }
  return '';
}

function coverUrl(page) { return safeHttpUrl(page?.cover?.file?.url || page?.cover?.external?.url || ''); }
function iconUrl(page) { return safeHttpUrl(page?.icon?.file?.url || page?.icon?.external?.url || ''); }

function findProperty(entries, aliases, types = null) {
  const normalizedAliases = aliases.map(normalizeName);
  for (const [name, prop] of entries) {
    if (types && !types.includes(prop.type)) continue;
    if (normalizedAliases.includes(normalizeName(name))) return [name, prop];
  }
  for (const [name, prop] of entries) {
    if (types && !types.includes(prop.type)) continue;
    const normalized = normalizeName(name);
    if (normalizedAliases.some(alias => alias && (normalized.includes(alias) || alias.includes(normalized)))) return [name, prop];
  }
  return null;
}

function boolValue(prop) {
  if (!prop) return false;
  if (prop.type === 'checkbox') return Boolean(prop.checkbox);
  return ['true', 'yes', '1', 'так', 'ага'].includes(normalizeName(textValue(prop)));
}

function extractLinks(entries, excludedNames) {
  const links = [];
  const seen = new Set();
  const push = (name, rawUrl) => {
    const url = safeHttpUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ name: (name || new URL(url).hostname).trim(), url });
  };
  for (const [name, prop] of entries) {
    if (excludedNames.has(name)) continue;
    if (prop.type === 'url') {
      push(name, prop.url);
      continue;
    }
    if (prop.type === 'rich_text') {
      let hyperlinkCount = 0;
      for (const part of prop.rich_text || []) {
        const url = part.href || part.text?.link?.url;
        if (url) {
          hyperlinkCount++;
          const label = (part.plain_text || '').trim();
          push(label && label !== url ? label : name, url);
        }
      }
      if (!hyperlinkCount) {
        const plain = (prop.rich_text || []).map(x => x.plain_text || '').join(' ');
        for (const raw of plain.match(/https?:\/\/[^\s<>()]+/gi) || []) push('', raw.replace(/[.,;!?]+$/, ''));
      }
    }
  }
  return links;
}

function getMappedEntries(page) {
  const props = page?.properties || {};
  const entries = Object.entries(props);
  return {
    entries,
    titleEntry: entries.find(([, prop]) => prop.type === 'title') || null,
    posterEntry: findProperty(entries, ['Постер', 'Poster', 'Обкладинка', 'Cover', 'Зображення', 'Image'], ['files', 'url', 'rich_text']),
    bannerEntry: findProperty(entries, ['Банер', 'Banner', 'Backdrop', 'Background', 'Фон'], ['files', 'url', 'rich_text']),
    descriptionEntry: findProperty(entries, ['Опис', 'Description', 'Synopsis', 'Синопсис', 'Plot', 'Desc'], ['rich_text', 'title']),
    originalEntry: findProperty(entries, ['Оригінальна назва', 'Original title', 'Original name', 'Romaji'], ['rich_text', 'title']),
    englishEntry: findProperty(entries, ['Англійська назва', 'English title', 'English'], ['rich_text', 'title']),
    russianEntry: findProperty(entries, ['Російська назва', 'Russian title', 'Russian'], ['rich_text', 'title']),
    aliasesEntry: findProperty(entries, ['Аліаси', 'Aliases', 'Synonyms'], ['rich_text', 'title']),
    keyEntry: findProperty(entries, ['Ключ', 'Key'], ['rich_text', 'title']),
    statusEntry: findProperty(entries, ['Статус', 'Status'], ['status', 'select', 'rich_text']),
    groupEntry: findProperty(entries, ['Група', 'Group', 'Категорія', 'Category'], ['select', 'multi_select', 'rich_text', 'status']),
    addedEntry: findProperty(entries, ['Дата додавання', 'Added At', 'Added', 'Додано', 'Created', 'Created time'], ['date', 'created_time', 'last_edited_time']),
    favoriteEntry: findProperty(entries, ['Вибране', 'Favorite', 'Bookmark'], ['checkbox', 'select', 'status', 'rich_text']),
    likedEntry: findProperty(entries, ['Улюблене', 'Liked', 'Loved', 'Love'], ['checkbox', 'select', 'status', 'rich_text']),
  };
}

function mapPage(page) {
  const m = getMappedEntries(page);
  const excludedNames = new Set([
    m.titleEntry?.[0], m.posterEntry?.[0], m.bannerEntry?.[0], m.descriptionEntry?.[0], m.originalEntry?.[0], m.englishEntry?.[0], m.russianEntry?.[0], m.aliasesEntry?.[0], m.keyEntry?.[0],
    m.statusEntry?.[0], m.groupEntry?.[0], m.addedEntry?.[0], m.favoriteEntry?.[0], m.likedEntry?.[0],
  ].filter(Boolean));
  const posterRaw = fileUrl(m.posterEntry?.[1]);
  const bannerRaw = fileUrl(m.bannerEntry?.[1]);
  const fallbackPoster = iconUrl(page) || coverUrl(page);
  return {
    id: page.id,
    title: textValue(m.titleEntry?.[1]) || 'Без назви',
    originalTitle: textValue(m.originalEntry?.[1]),
    englishTitle: textValue(m.englishEntry?.[1]),
    russianTitle: textValue(m.russianEntry?.[1]),
    aliases: textValue(m.aliasesEntry?.[1]),
    key: textValue(m.keyEntry?.[1]),
    poster: posterRaw || fallbackPoster,
    banner: bannerRaw || posterRaw || coverUrl(page) || fallbackPoster,
    hasPoster: Boolean(posterRaw),
    hasBanner: Boolean(bannerRaw),
    description: textValue(m.descriptionEntry?.[1]),
    status: textValue(m.statusEntry?.[1]) || 'Без статусу',
    group: textValue(m.groupEntry?.[1]) || 'Без групи',
    addedAt: textValue(m.addedEntry?.[1]) || page.created_time || page.last_edited_time || '',
    favorite: boolValue(m.favoriteEntry?.[1]),
    liked: boolValue(m.likedEntry?.[1]),
    links: extractLinks(m.entries, excludedNames),
    notionUrl: safeHttpUrl(page.url || ''),
  };
}

async function notionFetch(env, path, options = {}) {
  if (!env.NOTION_TOKEN) throw new HttpError(500, 'У Cloudflare не задано секрет NOTION_TOKEN.', '', '', 'cloudflare_secret');
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    throw new HttpError(response.status, `Notion API повернув ${response.status}: ${parsed?.message || body || response.statusText}`, body.slice(0, 1200), parsed?.code || '');
  }
  if (response.status === 204) return null;
  return response.json();
}

async function resolveDatabaseSources(env) {
  const databaseId = env.NOTION_DATABASE_ID || DEFAULT_DATABASE_ID;
  const database = await notionFetch(env, `/databases/${databaseId}`);
  const listed = Array.isArray(database?.data_sources) ? database.data_sources : [];
  if (!listed.length) throw new HttpError(502, 'База доступна, але Notion не повернув жодного data source.', '', '', 'resolve_database');

  const sources = [];
  for (const entry of listed) {
    if (!entry?.id) continue;
    try {
      const source = await notionFetch(env, `/data_sources/${entry.id}`);
      sources.push({ ...source, _databaseListName: entry.name || source?.name || '' });
    } catch (error) {
      if (!(error instanceof HttpError) || ![403, 404].includes(error.status)) throw error;
    }
  }
  if (!sources.length) throw new HttpError(502, 'Data sources знайдено, але інтеграція не може прочитати жоден із них.', '', '', 'resolve_data_sources');
  return { databaseId, database, sources };
}

function compactId(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }

async function getWriteSource(env, resolved = null) {
  const data = resolved || await resolveDatabaseSources(env);
  const preferred = compactId(env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID);
  return data.sources.find(source => compactId(source.id) === preferred) || data.sources[0];
}

async function queryAllPages(env, dataSourceId) {
  const pages = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const result = await notionFetch(env, `/data_sources/${dataSourceId}/query`, { method: 'POST', body: JSON.stringify(body) });
    pages.push(...(result.results || []).filter(item => item?.object === 'page'));
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor && pages.length < 10000);
  return pages;
}

async function queryDatabasePages(env) {
  const resolved = await resolveDatabaseSources(env);
  const pages = [];
  const sourceStats = [];
  const seen = new Set();
  for (const source of resolved.sources) {
    const sourcePages = await queryAllPages(env, source.id);
    sourceStats.push({ id: source.id, name: source.name || source._databaseListName || '', count: sourcePages.length });
    for (const page of sourcePages) {
      if (!page?.id || seen.has(page.id)) continue;
      seen.add(page.id);
      pages.push(page);
    }
  }
  return { databaseId: resolved.databaseId, sources: resolved.sources, sourceStats, pages };
}

function schemaOptionsFromSources(sources) {
  const statuses = new Set(TITLE_STATUS_OPTIONS);
  const groups = new Set();
  for (const source of sources || []) {
    for (const [name, prop] of Object.entries(source?.properties || {})) {
      if (normalizeName(name) === normalizeName(NOTION_PROPERTIES.status) && prop?.type === 'status') {
        for (const option of prop.status?.options || []) if (option?.name) statuses.add(option.name);
      }
      if (normalizeName(name) === normalizeName(NOTION_PROPERTIES.group) && prop?.type === 'select') {
        for (const option of prop.select?.options || []) if (option?.name) groups.add(option.name);
      }
    }
  }
  return { statuses: [...statuses], groups: [...groups].sort((a, b) => a.localeCompare(b, 'uk')) };
}

function richTextValue(value) {
  const text = String(value || '').trim();
  return { rich_text: text ? [{ type: 'text', text: { content: text.slice(0, 1900) } }] : [] };
}

function inferImageExtension(url) {
  try {
    const match = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i);
    if (match) return `.${match[1].toLowerCase().replace('jpeg', 'jpg')}`;
  } catch {}
  return '.jpg';
}

function notionFilesValue(url, baseName, mediaId = '') {
  const clean = safeHttpUrl(url);
  if (!clean) return { files: [] };
  const suffix = mediaId ? `-${mediaId}` : '';
  return { files: [{ name: `${baseName}${suffix}${inferImageExtension(clean)}`, external: { url: clean } }] };
}

function plainTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function exactCoreTitleKey(value) {
  return plainTitle(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function richTextChunksValue(value) {
  const text = String(value || '').trim();
  if (!text) return { rich_text: [] };
  const chunks = [];
  for (let i = 0; i < text.length && chunks.length < 50; i += 1800) {
    chunks.push({ type: 'text', text: { content: text.slice(i, i + 1800) } });
  }
  return { rich_text: chunks };
}

function siteLinksRichText(items) {
  const out = [];
  const unique = [...new Map((items || []).filter(x => safeHttpUrl(x.url)).map(x => [safeHttpUrl(x.url), x])).values()].slice(0, 30);
  unique.forEach((item, index) => {
    const url = safeHttpUrl(item.url);
    const label = plainTitle(item.title || '') || `Посилання ${index + 1}`;
    out.push({ type: 'text', text: { content: label.slice(0, 1900), link: { url } } });
    if (index < unique.length - 1) out.push({ type: 'text', text: { content: '\n' } });
  });
  return { rich_text: out };
}

async function ensureWritableSchema(env, source) {
  let current = source;
  const additions = {};
  const properties = current?.properties || {};
  const required = {
    [NOTION_PROPERTIES.description]: { rich_text: {} },
    [NOTION_PROPERTIES.originalTitle]: { rich_text: {} },
    [NOTION_PROPERTIES.englishTitle]: { rich_text: {} },
    [NOTION_PROPERTIES.russianTitle]: { rich_text: {} },
    [NOTION_PROPERTIES.aliases]: { rich_text: {} },
    [NOTION_PROPERTIES.banner]: { files: {} },
    [NOTION_PROPERTIES.coverImage]: { files: {} },
    [NOTION_PROPERTIES.status]: { status: { options: TITLE_STATUS_OPTIONS.map(name => ({ name })) } },
    [NOTION_PROPERTIES.group]: { select: { options: [] } },
    [NOTION_PROPERTIES.sourceUrl]: { url: {} },
    [NOTION_PROPERTIES.key]: { rich_text: {} },
    [NOTION_PROPERTIES.addedAt]: { date: {} },
  };
  for (const [name, config] of Object.entries(required)) if (!properties[name]) additions[name] = config;
  for (const domain of SITE_PROPERTIES) if (!properties[domain]) additions[domain] = { rich_text: {} };
  if (Object.keys(additions).length) {
    await notionFetch(env, `/data_sources/${current.id}`, { method: 'PATCH', body: JSON.stringify({ properties: additions }) });
    current = await notionFetch(env, `/data_sources/${current.id}`);
  }
  return current;
}

async function ensureGroupOption(env, source, groupName) {
  const clean = String(groupName || '').trim();
  if (!clean || clean === 'Без групи') return source;
  let current = source;
  const prop = current?.properties?.[NOTION_PROPERTIES.group];
  if (prop?.type !== 'select') return current;
  const options = prop.select?.options || [];
  if (options.some(option => normalizeName(option.name) === normalizeName(clean))) return current;
  await notionFetch(env, `/data_sources/${current.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        [prop.id || NOTION_PROPERTIES.group]: {
          select: { options: [...options.map(option => ({ id: option.id })), { name: clean }] },
        },
      },
    }),
  });
  return notionFetch(env, `/data_sources/${current.id}`);
}

async function aniListRequest(query, variables) {
  const response = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; YoruAnimeCatalog/4.2; +https://myster-anime.pages.dev)',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new HttpError(502, `AniList повернув HTTP ${response.status}.`, details, String(response.status), 'anilist');
  }
  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length) throw new HttpError(502, `AniList: ${payload.errors.map(x => x?.message).filter(Boolean).join('; ')}`, '', '', 'anilist');
  return payload.data;
}

const ANILIST_FIELDS = `
  id idMal siteUrl format seasonYear episodes bannerImage description(asHtml:false) countryOfOrigin
  coverImage { extraLarge large medium color }
  title { romaji english native }
  synonyms
`;

function originalTitleForMedia(media) {
  // "Оригінальна назва" = native script from the country of origin when available.
  // Romaji/English are aliases and are never preferred over native here.
  return cleanTitle(media?.title?.native || media?.title?.romaji || media?.title?.english || '');
}

function romanizedTitleForMedia(media) {
  return cleanTitle(media?.title?.romaji || media?.title?.english || media?.title?.native || '');
}

function mediaProviderId(media) {
  if (media?.provider === 'jikan') return media?.idMal || media?.providerId || '';
  return media?.id || media?.providerId || '';
}

async function searchAniListAnime(searchText) {
  const search = cleanTitle(searchText);
  if (!search) return [];
  const data = await aniListRequest(`query ($search: String!) { Page(page:1, perPage:10) { media(search:$search, type:ANIME) { ${ANILIST_FIELDS} } } }`, { search });
  return (Array.isArray(data?.Page?.media) ? data.Page.media : []).map(media => ({ ...media, provider: 'anilist', providerId: media?.id || null }));
}

async function getAniListMedia(id) {
  const mediaId = Number(id);
  if (!Number.isFinite(mediaId)) throw new HttpError(400, 'Некоректний AniList ID.');
  const data = await aniListRequest(`query ($id: Int!) { Media(id:$id, type:ANIME) { ${ANILIST_FIELDS} } }`, { id: mediaId });
  if (!data?.Media) throw new HttpError(404, 'Тайтл AniList не знайдено.');
  return { ...data.Media, provider: 'anilist', providerId: data.Media.id };
}

function normalizeJikanMedia(item) {
  const poster = safeHttpUrl(
    item?.images?.webp?.large_image_url || item?.images?.jpg?.large_image_url ||
    item?.images?.webp?.image_url || item?.images?.jpg?.image_url || ''
  );
  const native = cleanTitle(item?.title_japanese || (Array.isArray(item?.titles) ? item.titles.find(x => /japanese|native/i.test(x?.type || ''))?.title : '') || '');
  const romaji = cleanTitle(item?.title || (Array.isArray(item?.titles) ? item.titles.find(x => /default/i.test(x?.type || ''))?.title : '') || '');
  const english = cleanTitle(item?.title_english || (Array.isArray(item?.titles) ? item.titles.find(x => /english/i.test(x?.type || ''))?.title : '') || '');
  const synonyms = [
    ...(Array.isArray(item?.title_synonyms) ? item.title_synonyms : []),
    ...(Array.isArray(item?.titles) ? item.titles.map(x => x?.title) : []),
  ].map(cleanTitle).filter(Boolean);
  return {
    id: null,
    idMal: item?.mal_id || null,
    provider: 'jikan',
    providerId: item?.mal_id || null,
    siteUrl: safeHttpUrl(item?.url || ''),
    format: item?.type || '',
    seasonYear: item?.year || item?.aired?.prop?.from?.year || null,
    episodes: item?.episodes || null,
    bannerImage: '',
    description: String(item?.synopsis || '').trim(),
    countryOfOrigin: '',
    coverImage: { extraLarge: poster, large: poster, medium: poster, color: '' },
    title: { romaji, english, native },
    synonyms,
  };
}

async function searchJikanAnime(searchText) {
  const search = cleanTitle(searchText);
  if (!search) return [];
  const url = new URL('https://api.jikan.moe/v4/anime');
  url.searchParams.set('q', search);
  url.searchParams.set('limit', '10');
  url.searchParams.set('sfw', 'true');
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; YoruAnimeCatalog/4.2; +https://myster-anime.pages.dev)',
    },
  });
  if (!response.ok) throw new HttpError(502, `Jikan повернув HTTP ${response.status}.`, await response.text().catch(() => ''), String(response.status), 'jikan');
  const payload = await response.json();
  return (Array.isArray(payload?.data) ? payload.data : []).map(normalizeJikanMedia);
}

async function searchPublicAnime(searchText) {
  let aniListError = null;
  try {
    const items = await searchAniListAnime(searchText);
    return { items, provider: 'anilist', fallback: false };
  } catch (error) {
    aniListError = error;
  }
  try {
    const items = await searchJikanAnime(searchText);
    return {
      items,
      provider: 'jikan',
      fallback: true,
      warning: aniListError?.message || 'AniList недоступний з Cloudflare, використано Jikan.',
    };
  } catch (jikanError) {
    throw new HttpError(
      502,
      `Пошук недоступний: ${aniListError?.message || 'AniList error'}; ${jikanError?.message || 'Jikan error'}`,
      '', '', 'discover'
    );
  }
}


async function searchPublicAnimeSmart(searchText) {
  const query = cleanTitle(searchText);
  if (!query) return { items: [], provider: null, fallback: false, searchQuery: '' };
  const first = await searchPublicAnime(query);
  if (first.items.length) return { ...first, searchQuery: query };

  const englishQuery = cleanTitle(await translateToLanguage(query, 'en'));
  if (!englishQuery || exactTitleKey(englishQuery) === exactTitleKey(query)) return { ...first, searchQuery: query };
  const second = await searchPublicAnime(englishQuery);
  return {
    ...second,
    searchQuery: englishQuery,
    translatedSearch: true,
    originalSearchQuery: query,
    warning: second.warning || first.warning || '',
  };
}
function simplifiedAniList(media) {
  return {
    id: media.id ?? null,
    idMal: media.idMal || null,
    provider: media.provider || 'anilist',
    providerId: media.providerId || media.id || media.idMal || null,
    title: media.title || {},
    originalTitle: originalTitleForMedia(media),
    romanizedTitle: romanizedTitleForMedia(media),
    synonyms: media.synonyms || [],
    year: media.seasonYear || null,
    format: media.format || '',
    episodes: media.episodes || null,
    poster: safeHttpUrl(media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || ''),
    banner: safeHttpUrl(media.bannerImage || ''),
    color: media.coverImage?.color || '',
    siteUrl: safeHttpUrl(media.siteUrl || ''),
    description: String(media.description || '').trim(),
    countryOfOrigin: media.countryOfOrigin || '',
  };
}

function normalizeIncomingMedia(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = raw.title && typeof raw.title === 'object' ? raw.title : {};
  const poster = safeHttpUrl(raw.poster || raw.coverImage?.extraLarge || raw.coverImage?.large || raw.coverImage?.medium || '');
  const banner = safeHttpUrl(raw.banner || raw.bannerImage || '');
  const provider = raw.provider === 'jikan' ? 'jikan' : 'anilist';
  const id = provider === 'anilist' && Number.isFinite(Number(raw.id)) ? Number(raw.id) : null;
  const idMal = Number.isFinite(Number(raw.idMal)) ? Number(raw.idMal) : null;
  return {
    id,
    idMal,
    provider,
    providerId: raw.providerId || id || idMal || null,
    siteUrl: safeHttpUrl(raw.siteUrl || ''),
    format: String(raw.format || '').slice(0, 80),
    seasonYear: Number.isFinite(Number(raw.year ?? raw.seasonYear)) ? Number(raw.year ?? raw.seasonYear) : null,
    episodes: Number.isFinite(Number(raw.episodes)) ? Number(raw.episodes) : null,
    bannerImage: banner,
    description: String(raw.description || '').slice(0, 20000),
    countryOfOrigin: String(raw.countryOfOrigin || '').slice(0, 8),
    coverImage: { extraLarge: poster, large: poster, medium: poster, color: String(raw.color || '').slice(0, 32) },
    title: {
      native: cleanTitle(title.native || raw.originalTitle || ''),
      romaji: cleanTitle(title.romaji || raw.romanizedTitle || ''),
      english: cleanTitle(title.english || ''),
    },
    synonyms: (Array.isArray(raw.synonyms) ? raw.synonyms : []).map(cleanTitle).filter(Boolean).slice(0, 30),
  };
}

function splitText(text, maxLen = 1200) {
  const source = String(text || '');
  if (source.length <= maxLen) return [source];
  const out = [];
  let rest = source;
  while (rest.length > maxLen) {
    let cut = Math.max(rest.lastIndexOf('. ', maxLen), rest.lastIndexOf('! ', maxLen), rest.lastIndexOf('? ', maxLen), rest.lastIndexOf(', ', maxLen), rest.lastIndexOf(' ', maxLen));
    if (cut < Math.floor(maxLen * 0.55)) cut = maxLen;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function translateToLanguage(text, targetLanguage) {
  const source = String(text || '').trim();
  if (!source) return '';
  const translated = [];
  for (const chunk of splitText(source, 1200)) {
    try {
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.set('client', 'gtx');
      url.searchParams.set('sl', 'auto');
      url.searchParams.set('tl', targetLanguage);
      url.searchParams.set('dt', 't');
      url.searchParams.set('q', chunk);
      const response = await fetch(url, { headers: { 'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const value = Array.isArray(data?.[0]) ? data[0].map(part => part?.[0] || '').join('') : '';
      translated.push(value || chunk);
    } catch { translated.push(chunk); }
  }
  return translated.join(' ').replace(/\s+/g, ' ').trim();
}

function htmlToPlainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getCatalogGroup(domain) {
  if (CATALOG_GROUPS.RU.includes(domain)) return 'RU';
  if (CATALOG_GROUPS.UA.includes(domain)) return 'UA';
  return null;
}

function makeCatalogQueryVariants(domain, originalTitle, ukTitle, ruTitle, media = null) {
  const nativeTitle = cleanTitle(media?.title?.native || originalTitle || '');
  const romajiTitle = cleanTitle(media?.title?.romaji || '');
  // Native script is the canonical original title. Localized and Romaji variants are fallbacks.
  const preferred = getCatalogGroup(domain) === 'UA'
    ? [['оригінальним письмом', nativeTitle], ['українською', ukTitle], ['ромадзі', romajiTitle], ['російською', ruTitle]]
    : [['оригінальним письмом', nativeTitle], ['російською', ruTitle], ['ромадзі', romajiTitle], ['українською', ukTitle]];
  const seen = new Set();
  const variants = [];
  for (const [label, value] of preferred) {
    const cleaned = cleanTitle(value);
    const key = exactTitleKey(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    variants.push({ label, value: cleaned });
    if (variants.length >= 3) break;
  }
  return variants;
}

function searchHostsForDomain(domain) { return [...new Set(SEARCH_HOST_ALIASES[domain] || [domain])]; }
function hostMatches(host, domain) {
  const a = String(host || '').toLowerCase().replace(/^www\./, '');
  const b = String(domain || '').toLowerCase().replace(/^www\./, '');
  return a === b || a.endsWith(`.${b}`);
}
function isCatalogHost(host, domain) { return searchHostsForDomain(domain).some(candidate => hostMatches(host, candidate)); }

function searchUrlsForHost(host, query) {
  const q = encodeURIComponent(query);
  const routes = {
    'shikimori.io': [`https://shikimori.io/animes?search=${q}`],
    'www.crunchyroll.com': [`https://www.crunchyroll.com/search?q=${q}`],
    'crunchyroll.com': [`https://www.crunchyroll.com/search?q=${q}`],
    'jut.su': [`https://jut.su/anime/?search=${q}`],
    'jut-su.net': [`https://jut-su.net/?s=${q}`],
    'ru.yummyani.me': [`https://ru.yummyani.me/search?word=${q}`],
    'animevost.org': [`https://animevost.org/index.php?do=search&subaction=search&story=${q}`],
    'jutsu.tv': [`https://jutsu.tv/index.php?do=search&subaction=search&story=${q}`],
    'animego.studio': [`https://animego.studio/index.php?do=search&subaction=search&story=${q}`],
    'anilibria.tv': [`https://aniliberty.top/anime/catalog?search=${q}`],
    'uaserials.com': [`https://uaserials.com/search/${q}/`],
    'uachan.com': [`https://uachan.top/index.php?do=search&subaction=search&story=${q}`],
    'anihub.in.ua': [`https://anihub.in.ua/search?q=${q}`],
    'amanogawa.space': [`https://amanogawa.space/?s=${q}`],
    'animeon.club': [`https://animeon.club/anime?search=${q}`],
    'anidesu.net': [`https://anidesu.net/?s=${q}`],
    'mikai.me': [`https://mikai.me/catalog?search=${q}`],
    'anitube.in.ua': [`https://anitube.in.ua/index.php?do=search&subaction=search&story=${q}`],
  };
  return routes[host] || [`https://${host}/?s=${q}`];
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(value) { return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }

function attrValue(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || '');
}

function slugText(url) {
  try {
    const part = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return part.replace(/[-_]+/g, ' ').replace(/\.(?:html?|php)$/i, '').trim();
  } catch { return ''; }
}

function isSearchOrNavigationUrl(url) {
  try {
    const parsed = new URL(url);
    const p = parsed.pathname.toLowerCase();
    if (p === '/' || !p) return true;
    return /\/(?:search|find|login|register|forum|news|schedule|browse|users?|genres?|studios?|characters?)(?:\/|$)/.test(p);
  } catch { return true; }
}

function findStrictSearchResults(html, responseUrl, domain, query, aniListMedia = null) {
  const found = new Map();
  const anchorRx = /<a\b([^>]*\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  let count = 0;
  while ((match = anchorRx.exec(html || '')) && count++ < 3000) {
    const href = attrValue(match[1], 'href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    let candidateUrl;
    try { candidateUrl = new URL(href, responseUrl).href; } catch { continue; }
    let parsed;
    try { parsed = new URL(candidateUrl); } catch { continue; }
    if (!isCatalogHost(parsed.hostname, domain) || isSearchOrNavigationUrl(candidateUrl)) continue;
    const texts = [stripTags(match[2]), attrValue(match[1], 'title'), attrValue(match[1], 'aria-label'), slugText(candidateUrl)];
    const titleMatch = getTitleMatchWithAniListAliases(query, aniListMedia, ...texts);
    if (!titleMatch) continue;
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(?:utm_|yclid|ysclid|ref|from)/i.test(key)) parsed.searchParams.delete(key);
    const cleanUrl = parsed.href;
    const item = { domain, url: cleanUrl, title: titleMatch.title || query, kind: titleMatch.kind };
    const existing = found.get(cleanUrl);
    if (!existing || (existing.kind !== 'exact' && item.kind === 'exact')) found.set(cleanUrl, item);
  }
  return [...found.values()].sort((a, b) => a.kind === b.kind ? a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) : (a.kind === 'exact' ? -1 : 1)).slice(0, 20);
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    ...options,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.6',
      'User-Agent': 'Mozilla/5.0 YoruCatalog/1.0',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text: await response.text(), url: response.url || url };
}

function apiAnimeTitles(item) {
  const titles = item?.titles || {};
  const aliases = item?.alias || item?.aliases || item?.synonyms || [];
  return [item?.title_ukrainian, item?.title_english, item?.title_original, titles?.ukrainian, titles?.uk, titles?.english, titles?.en, titles?.original, titles?.romaji, ...(Array.isArray(aliases) ? aliases : [])].map(cleanTitle).filter(Boolean);
}
function buildAniHubUrl(item) {
  const id = item?.id;
  const slug = String(item?.slug || '').replace(/^\/+|\/+$/g, '');
  if (slug && id) return `https://anihub.in.ua/anime/${slug}-${id}`;
  if (id) return `https://anihub.in.ua/anime/${id}`;
  return '';
}

async function searchAniHubApi(queryVariants, media) {
  for (const variant of queryVariants) {
    const q = variant.value;
    const anilistId = media?.provider === 'jikan' ? null : media?.id;
    const urls = anilistId ? [`https://api.anihub.in.ua/anime?anilist_id=${encodeURIComponent(anilistId)}&page_size=20`, `https://api.anihub.in.ua/anime?search=${encodeURIComponent(q)}&page_size=20`] : [`https://api.anihub.in.ua/anime?search=${encodeURIComponent(q)}&page_size=20`];
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) continue;
        const payload = await response.json();
        const collected = [];
        for (const item of payload?.items || []) {
          const texts = apiAnimeTitles(item);
          const titleMatch = getTitleMatchWithAniListAliases(q, media, ...texts);
          if (!titleMatch && anilistId && String(item?.anilist_id || '') !== String(anilistId)) continue;
          const itemUrl = buildAniHubUrl(item);
          if (itemUrl) collected.push({ domain: 'anihub.in.ua', url: itemUrl, title: titleMatch?.title || texts[0] || q, kind: titleMatch?.kind || 'exact' });
        }
        if (collected.length) return { domain: 'anihub.in.ua', items: collected.slice(0, 20), matchedBy: `${variant.label} (AniHub API)`, matchedTitle: q };
      } catch {}
    }
  }
  return null;
}

async function searchShikimoriApi(queryVariants, media) {
  for (const variant of queryVariants) {
    const q = variant.value;
    const urls = [`https://shikimori.io/api/animes?limit=50&search=${encodeURIComponent(q)}`];
    if (media?.idMal) urls.push(`https://shikimori.io/api/animes?limit=50&ids=${encodeURIComponent(media.idMal)}`);
    const collected = new Map();
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'YoruCatalog/1.0' } });
        if (!response.ok) continue;
        const payload = await response.json();
        for (const item of Array.isArray(payload) ? payload : []) {
          const titleMatch = getTitleMatchWithAniListAliases(q, media, item?.name, item?.russian);
          const malExact = media?.idMal && String(item?.id || '') === String(media.idMal);
          if (!titleMatch && !malExact) continue;
          const itemUrl = new URL(item?.url || `/animes/${item?.id || ''}`, 'https://shikimori.io').href;
          collected.set(itemUrl, { domain: 'shikimori.io', url: itemUrl, title: titleMatch?.title || cleanTitle(item?.name || item?.russian || q), kind: titleMatch?.kind || 'exact' });
        }
      } catch {}
    }
    if (collected.size) return { domain: 'shikimori.io', items: [...collected.values()].slice(0, 20), matchedBy: `${variant.label} (Shikimori API)`, matchedTitle: q };
  }
  return null;
}

async function searchAnimeOnApi(queryVariants, media) {
  for (const variant of queryVariants) {
    const q = variant.value;
    const urls = [`https://animeon.club/api/anime/?search=${encodeURIComponent(q)}`];
    if (media?.idMal) urls.unshift(`https://animeon.club/api/anime/?malId=${encodeURIComponent(media.idMal)}`);
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) continue;
        const payload = await response.json();
        const items = Array.isArray(payload) ? payload : (payload?.results || payload?.items || payload?.data || []);
        const collected = [];
        for (const item of Array.isArray(items) ? items : []) {
          const texts = [item?.titleUa, item?.title, String(item?.hikkaSlug || '').replace(/-[a-f0-9]{5,}$/i, '').replace(/[-_]+/g, ' ')].map(cleanTitle).filter(Boolean);
          const titleMatch = getTitleMatchWithAniListAliases(q, media, ...texts);
          const malExact = media?.idMal && String(item?.malId || item?.mal_id || '') === String(media.idMal);
          if (!titleMatch && !malExact) continue;
          const slug = String(item?.slug || '').replace(/^\/+|\/+$/g, '');
          const itemUrl = slug ? `https://animeon.club/anime/${slug}` : (item?.id ? `https://animeon.club/anime/${item.id}` : '');
          if (itemUrl) collected.push({ domain: 'animeon.club', url: itemUrl, title: titleMatch?.title || texts[0] || q, kind: titleMatch?.kind || 'exact' });
        }
        if (collected.length) return { domain: 'animeon.club', items: collected.slice(0, 20), matchedBy: `${variant.label} (AnimeON API)`, matchedTitle: q };
      } catch {}
    }
  }
  return null;
}

async function searchCatalogGeneric(domain, queryVariants, media) {
  for (const variant of queryVariants) {
    const q = variant.value;
    const hosts = searchHostsForDomain(domain);
    for (const host of hosts.slice(0, 2)) {
      const urls = searchUrlsForHost(host, q).slice(0, 1);
      for (const url of urls) {
        try {
          let options = {};
          if ((domain === 'uachan.com' || domain === 'anitube.in.ua') && url.includes('do=search')) {
            const data = new URLSearchParams({ do: 'search', subaction: 'search', search_start: '1', full_search: '0', result_from: '1', story: q }).toString();
            options = { method: 'POST', body: data, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } };
          }
          const result = await fetchText(url, options);
          const items = findStrictSearchResults(result.text, result.url, domain, q, media);
          if (items.length) return { domain, items, matchedBy: `${variant.label} (пошук сайту)`, matchedTitle: q };
        } catch {}
      }
    }
  }
  return null;
}

async function searchDomain(domain, queryVariants, media) {
  if (domain === 'anihub.in.ua') return await searchAniHubApi(queryVariants, media) || await searchCatalogGeneric(domain, queryVariants, media);
  if (domain === 'shikimori.io') return await searchShikimoriApi(queryVariants, media) || await searchCatalogGeneric(domain, queryVariants, media);
  if (domain === 'animeon.club') return await searchAnimeOnApi(queryVariants, media) || await searchCatalogGeneric(domain, queryVariants, media);
  return searchCatalogGeneric(domain, queryVariants, media);
}

async function searchAllCatalogs(originalTitle, ukTitle, ruTitle, media) {
  const tasks = CATALOGS.map(async domain => {
    const variants = makeCatalogQueryVariants(domain, originalTitle, ukTitle, ruTitle, media);
    try { return await searchDomain(domain, variants, media); } catch { return null; }
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

function mergeLinkItems(...lists) {
  const map = new Map();
  for (const item of lists.flat()) {
    const url = safeHttpUrl(item?.url);
    if (!url) continue;
    const existing = map.get(url);
    const clean = { url, title: plainTitle(item?.title || '') || new URL(url).hostname, kind: item?.kind || 'exact' };
    if (!existing || (existing.kind !== 'exact' && clean.kind === 'exact')) map.set(url, clean);
  }
  return [...map.values()];
}

function buildCreateProperties(media, payload, translated, siteLinks, source) {
  const titlePropName = Object.entries(source.properties || {}).find(([, prop]) => prop?.type === 'title')?.[0] || NOTION_PROPERTIES.title;
  const original = originalTitleForMedia(media) || cleanTitle(payload.title || '');
  const ukTitle = cleanTitle(payload.title || translated.ukTitle || media?.title?.english || media?.title?.romaji || original || 'Без назви');
  const ruTitle = cleanTitle(translated.ruTitle || media?.title?.english || media?.title?.romaji || original || ukTitle);
  const description = String(translated.ukDescription || htmlToPlainText(media?.description || '') || '').trim();
  const key = exactTitleKey(original || ukTitle || ruTitle);
  const properties = {
    [titlePropName]: { title: [{ type: 'text', text: { content: ukTitle.slice(0, 1900) } }] },
    [NOTION_PROPERTIES.description]: richTextValue(description),
    [NOTION_PROPERTIES.originalTitle]: richTextValue(original),
    [NOTION_PROPERTIES.russianTitle]: richTextValue(ruTitle),
    [NOTION_PROPERTIES.key]: richTextValue(key),
    [NOTION_PROPERTIES.addedAt]: { date: { start: new Date().toISOString() } },
  };
  if (payload.status && payload.status !== 'Без статусу') properties[NOTION_PROPERTIES.status] = { status: { name: payload.status } };
  if (payload.group && payload.group !== 'Без групи') properties[NOTION_PROPERTIES.group] = { select: { name: payload.group } };
  const cover = safeHttpUrl(media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium || '');
  const banner = safeHttpUrl(media?.bannerImage || '');
  if (cover) properties[NOTION_PROPERTIES.coverImage] = notionFilesValue(cover, `${media?.provider || 'anime'}-cover`, mediaProviderId(media));
  if (banner) properties[NOTION_PROPERTIES.banner] = notionFilesValue(banner, `${media?.provider || 'anime'}-banner`, mediaProviderId(media));
  for (const domain of SITE_PROPERTIES) {
    const links = siteLinks?.[domain] || [];
    if (links.length) properties[domain] = siteLinksRichText(links);
  }
  if (safeHttpUrl(media?.siteUrl || '')) properties[NOTION_PROPERTIES.sourceUrl] = { url: safeHttpUrl(media.siteUrl) };
  return { properties, meta: { original, ukTitle, ruTitle, key, description } };
}

function findExistingMapped(items, media, ukTitle = '') {
  const aliases = new Set([...aniListAliases(media), ukTitle].map(exactTitleKey).filter(Boolean));
  return items.find(item => [item.title, item.originalTitle, item.russianTitle, item.key].some(value => aliases.has(exactTitleKey(value)))) || null;
}

async function handleAnimeApi(request, env) {
  const url = new URL(request.url);
  const requestedId = url.searchParams.get('id');

  if (request.method === 'GET') {
    const queried = await queryDatabasePages(env);
    const items = queried.pages.map(mapPage);
    const options = schemaOptionsFromSources(queried.sources);
    if (requestedId) {
      const norm = compactId(requestedId);
      const item = items.find(entry => compactId(entry.id) === norm);
      if (!item) return json({ error: 'Тайтл не знайдено.' }, 404);
      return json({ item, count: 1, options });
    }
    return json({ items, count: items.length, databaseId: queried.databaseId, sources: queried.sourceStats, options });
  }

  if (request.method === 'PATCH') {
    if (!requestedId) return json({ error: 'Не передано id тайтлу.' }, 400);
    const page = await notionFetch(env, `/pages/${requestedId}`);
    const mapped = getMappedEntries(page);
    const sourceId = page?.parent?.data_source_id;
    let source = sourceId ? await notionFetch(env, `/data_sources/${sourceId}`) : await getWriteSource(env);
    source = await ensureWritableSchema(env, source);
    const body = await request.json().catch(() => ({}));
    const properties = {};

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const statusName = String(body.status || '').trim();
      const name = mapped.statusEntry?.[0] || NOTION_PROPERTIES.status;
      properties[name] = statusName && statusName !== 'Без статусу' ? { status: { name: statusName } } : { status: null };
    }

    if (Object.prototype.hasOwnProperty.call(body, 'group')) {
      const groupName = String(body.group || '').trim();
      source = await ensureGroupOption(env, source, groupName);
      const name = mapped.groupEntry?.[0] || NOTION_PROPERTIES.group;
      properties[name] = groupName && groupName !== 'Без групи' ? { select: { name: groupName } } : { select: null };
    }

    if (Object.prototype.hasOwnProperty.call(body, 'posterUrl')) {
      const posterUrl = safeHttpUrl(body.posterUrl || '');
      if (!posterUrl) return json({ error: 'Некоректний URL постера.' }, 400);
      const name = mapped.posterEntry?.[0] || NOTION_PROPERTIES.coverImage;
      properties[name] = notionFilesValue(posterUrl, 'manual-cover');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'bannerUrl')) {
      const bannerUrl = safeHttpUrl(body.bannerUrl || '');
      if (!bannerUrl) return json({ error: 'Некоректний URL банера.' }, 400);
      const name = mapped.bannerEntry?.[0] || NOTION_PROPERTIES.banner;
      properties[name] = notionFilesValue(bannerUrl, 'manual-banner');
    }

    if (!Object.keys(properties).length) return json({ error: 'Немає змін для збереження.' }, 400);
    const updated = await notionFetch(env, `/pages/${requestedId}`, { method: 'PATCH', body: JSON.stringify({ properties }) });
    return json({ ok: true, item: mapPage(updated), options: schemaOptionsFromSources([source]) });
  }

  return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PATCH' });
}

async function handleOptionsApi(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  const resolved = await resolveDatabaseSources(env);
  return json(schemaOptionsFromSources(resolved.sources));
}


function sanitizeSiteLinks(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const domain of CATALOGS) {
    const items = Array.isArray(raw[domain]) ? raw[domain] : [];
    const clean = [];
    const seen = new Set();
    for (const item of items.slice(0, 30)) {
      const url = safeHttpUrl(item?.url || '');
      if (!url || seen.has(url)) continue;
      let parsed;
      try { parsed = new URL(url); } catch { continue; }
      if (!isCatalogHost(parsed.hostname, domain)) continue;
      seen.add(url);
      clean.push({
        url,
        title: cleanTitle(item?.title || '') || domain,
        kind: item?.kind === 'season' ? 'season' : 'exact',
      });
    }
    if (clean.length) out[domain] = clean;
  }
  return out;
}


function htmlEntityDecode(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 0))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16) || 0));
}

function metaContent(html, keys) {
  const wanted = new Set((keys || []).map(key => String(key).toLowerCase()));
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = (attrValue(tag, 'property') || attrValue(tag, 'name')).toLowerCase();
    if (!wanted.has(name)) continue;
    const content = attrValue(tag, 'content');
    if (content) return content;
  }
  return '';
}

function htmlTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlEntityDecode(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
}

function cleanSourcePageTitle(value, domain) {
  let title = plainTitle(htmlEntityDecode(value));
  if (!title) return '';
  const suffixes = domain === 'myanimelist.net'
    ? [/\s+-\s+MyAnimeList\.net.*$/i, /\s+[-|]\s+MyAnimeList.*$/i]
    : domain === 'anilist.co'
      ? [/\s+[-|]\s+AniList.*$/i]
      : [/\s+[-|]\s+Shikimori.*$/i, /\s+—\s+Shikimori.*$/i];
  for (const rx of suffixes) title = title.replace(rx, '').trim();
  return title;
}

function fallbackTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pieces = parsed.pathname.split('/').filter(Boolean);
    let slug = pieces[pieces.length - 1] || pieces[pieces.length - 2] || '';
    slug = decodeURIComponent(slug).replace(/^\d+-?/, '').replace(/[-_]+/g, ' ').trim();
    return plainTitle(slug) || parsed.hostname;
  } catch { return ''; }
}

function absoluteHttpUrl(value, base) {
  if (!value) return '';
  try {
    const url = new URL(htmlEntityDecode(value), base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function normalizeGoogleHref(raw) {
  const href = htmlEntityDecode(String(raw || '')).replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&');
  if (!href) return '';
  try {
    if (href.startsWith('/url?') || href.startsWith('https://www.google.com/url?') || href.startsWith('http://www.google.com/url?')) {
      const parsed = new URL(href, 'https://www.google.com');
      return safeHttpUrl(parsed.searchParams.get('q') || parsed.searchParams.get('url') || '');
    }
    return safeHttpUrl(href);
  } catch { return ''; }
}

function resultUrlAllowed(url, site) {
  try {
    const parsed = new URL(url);
    return hostMatches(parsed.hostname, site.domain) && site.path.test(parsed.pathname);
  } catch { return false; }
}

function extractGoogleResultUrls(html, site) {
  const found = [];
  const seen = new Set();
  const push = value => {
    const url = normalizeGoogleHref(value);
    if (!url || seen.has(url) || !resultUrlAllowed(url, site)) return;
    const parsed = new URL(url);
    parsed.hash = '';
    const clean = parsed.href;
    if (seen.has(clean)) return;
    seen.add(clean);
    found.push(clean);
  };

  const text = htmlEntityDecode(String(html || '')).replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&');
  for (const match of text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) push(match[1]);

  const escapedDomain = site.domain.replace(/\./g, '\\.');
  const directRx = new RegExp(`https?:\\/\\/(?:www\\.)?${escapedDomain}\\/[^\\s"'<>]+`, 'gi');
  for (const match of text.matchAll(directRx)) push(match[0]);
  return found.slice(0, 8);
}

async function fetchGoogleCandidates(site, queryText) {
  const query = `site:${site.domain} "${String(queryText || '').replace(/["\r\n]+/g, ' ').trim()}"`;
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('hl', 'uk');
  url.searchParams.set('gbv', '1');
  url.searchParams.set('filter', '0');
  url.searchParams.set('num', '10');
  url.searchParams.set('q', query);
  const response = await fetch(url.href, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.7',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new HttpError(502, `Google повернув HTTP ${response.status} для ${site.label}.`, '', String(response.status), 'google_search');
  const html = await response.text();
  if (/unusual traffic|\/sorry\/index|detected unusual traffic/i.test(html)) {
    throw new HttpError(502, `Google тимчасово заблокував автоматичний пошук для ${site.label}.`, '', 'google_blocked', 'google_search');
  }
  return { query, urls: extractGoogleResultUrls(html, site) };
}

async function mapLimit(items, limit, mapper) {
  const input = Array.from(items || []);
  const output = new Array(input.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= input.length) return;
      output[index] = await mapper(input[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), input.length || 1) }, () => worker()));
  return output;
}

async function fetchSourcePagePreview(task) {
  const { site, url } = task;
  const fallback = { site: site.domain, requestedUrl: url, url, title: fallbackTitleFromUrl(url), image: '', imageSource: 'page' };
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.7',
        'Range': 'bytes=0-350000',
      },
      redirect: 'follow',
    });
    if (!response.ok) return { ...fallback, pageStatus: response.status };
    const html = await response.text();
    const rawTitle = metaContent(html, ['og:title', 'twitter:title']) || htmlTitle(html);
    const image = absoluteHttpUrl(metaContent(html, ['og:image', 'twitter:image', 'twitter:image:src']), response.url || url);
    return {
      site: site.domain,
      requestedUrl: url,
      url: response.url && resultUrlAllowed(response.url, site) ? response.url : url,
      title: cleanSourcePageTitle(rawTitle, site.domain) || fallback.title,
      image,
      imageSource: 'page',
      pageStatus: response.status,
    };
  } catch {
    return fallback;
  }
}


async function handleGoogleConfigApi(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  return json({
    ok: true,
    cx: String(env.GOOGLE_CX || '').trim(),
    mode: 'programmable-search-element',
    sourceSites: AUTHORITY_SITES,
  });
}

async function handleSourcePreviewApi(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
  const body = await request.json().catch(() => ({}));
  const input = Array.isArray(body.items) ? body.items.slice(0, 24) : [];
  const tasks = [];

  for (const raw of input) {
    const url = safeHttpUrl(raw?.url || '');
    if (!url) continue;
    const site = GOOGLE_SOURCE_SITES.find(candidate => {
      try {
        const parsed = new URL(url);
        return hostMatches(parsed.hostname, candidate.domain) && candidate.path.test(parsed.pathname);
      } catch { return false; }
    });
    if (!site) continue;
    tasks.push({ site, url, searchTitle: plainTitle(raw?.title || '') });
  }

  const previews = await mapLimit(tasks, 6, async task => {
    const preview = await fetchSourcePagePreview(task);
    return {
      ...preview,
      searchTitle: task.searchTitle,
      title: preview.title || task.searchTitle || fallbackTitleFromUrl(task.url),
    };
  });

  return json({ ok: true, items: previews });
}

async function handleSourceSearchApi(request) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  const url = new URL(request.url);
  const q = plainTitle(url.searchParams.get('q') || '');
  if (q.length < 2) return json({ groups: [], query: q });

  const searched = await Promise.all(GOOGLE_SOURCE_SITES.map(async site => {
    try {
      const result = await fetchGoogleCandidates(site, q);
      return { site, query: result.query, urls: result.urls, error: '' };
    } catch (error) {
      return { site, query: `site:${site.domain} "${q}"`, urls: [], error: error?.message || 'Google search error' };
    }
  }));

  const previewTasks = searched.flatMap(group => group.urls.map(url => ({ site: group.site, url })));
  const previews = await mapLimit(previewTasks, 5, fetchSourcePagePreview);
  const previewMap = new Map(previews.map(item => [`${item.site}|${item.requestedUrl || item.url}`, item]));

  const groups = searched.map(group => ({
    site: group.site.domain,
    label: group.site.label,
    query: group.query,
    error: group.error,
    items: group.urls.map(url => previewMap.get(`${group.site.domain}|${url}`) || { site: group.site.domain, url, title: fallbackTitleFromUrl(url), image: '', imageSource: 'page' }),
  }));
  return json({ ok: true, query: q, groups, total: groups.reduce((sum, group) => sum + group.items.length, 0) });
}

function sanitizeCoreLinkItems(items, domain) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const url = safeHttpUrl(item?.url || '');
    if (!url || seen.has(url)) continue;
    try {
      const parsed = new URL(url);
      if (!hostMatches(parsed.hostname, domain)) continue;
    } catch { continue; }
    seen.add(url);
    out.push({ url, title: plainTitle(item?.title || '') || domain, kind: 'exact' });
  }
  return out.slice(0, 30);
}

function coreSiteLinks(payload) {
  const out = {};
  for (const bucket of [payload?.authority, payload?.catalogs]) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [domain, items] of Object.entries(bucket)) {
      if (!SITE_PROPERTIES.includes(domain)) continue;
      const clean = sanitizeCoreLinkItems(items, domain);
      if (!clean.length) continue;
      out[domain] = mergeLinkItems(out[domain] || [], clean);
    }
  }
  return out;
}

function coreTitleData(payload) {
  const title = payload?.title && typeof payload.title === 'object' ? payload.title : {};
  const input = payload?.input && typeof payload.input === 'object' ? payload.input : {};
  return {
    main: plainTitle(title.ukrainian || input.title || title.original || title.english || title.russian || 'Без назви'),
    original: plainTitle(title.original || ''),
    english: plainTitle(title.english || ''),
    russian: plainTitle(title.russian || ''),
    aliases: Array.isArray(title.aliases) ? title.aliases.map(plainTitle).filter(Boolean) : [],
    description: htmlToPlainText(payload?.description_uk || ''),
    cover: safeHttpUrl(payload?.cover?.url || ''),
    banner: safeHttpUrl(payload?.banner?.url || ''),
    status: plainTitle(payload?.status || input.status || ''),
    group: plainTitle(payload?.group || input.group || ''),
    sourceUrl: safeHttpUrl(input.url || ''),
  };
}

function findExistingCoreItem(items, payload) {
  const data = coreTitleData(payload);
  const wanted = new Set([data.main, data.original, data.english, data.russian, ...data.aliases].map(exactCoreTitleKey).filter(Boolean));
  if (!wanted.size) return null;
  return items.find(item => [item.title, item.originalTitle, item.englishTitle, item.russianTitle, item.aliases]
    .some(value => wanted.has(exactCoreTitleKey(value)))) || null;
}

function buildCoreProperties(payload, source, { includeAddedAt = true } = {}) {
  const data = coreTitleData(payload);
  const siteLinks = coreSiteLinks(payload);
  const titlePropName = Object.entries(source.properties || {}).find(([, prop]) => prop?.type === 'title')?.[0] || NOTION_PROPERTIES.title;
  const properties = {
    [titlePropName]: { title: [{ type: 'text', text: { content: data.main.slice(0, 1900) } }] },
    [NOTION_PROPERTIES.description]: richTextChunksValue(data.description),
    [NOTION_PROPERTIES.originalTitle]: richTextChunksValue(data.original),
    [NOTION_PROPERTIES.englishTitle]: richTextChunksValue(data.english),
    [NOTION_PROPERTIES.russianTitle]: richTextChunksValue(data.russian),
    [NOTION_PROPERTIES.aliases]: richTextChunksValue(data.aliases.join('\n')),
    [NOTION_PROPERTIES.key]: richTextValue(exactCoreTitleKey(data.original || data.main)),
  };
  if (includeAddedAt) properties[NOTION_PROPERTIES.addedAt] = { date: { start: new Date().toISOString() } };
  if (data.status && data.status !== 'Без статусу') properties[NOTION_PROPERTIES.status] = { status: { name: data.status } };
  if (data.group && data.group !== 'Без групи') properties[NOTION_PROPERTIES.group] = { select: { name: data.group } };
  if (data.cover) properties[NOTION_PROPERTIES.coverImage] = notionFilesValue(data.cover, 'core-cover', payload?.meta?.anilist_id || payload?.meta?.mal_id || '');
  if (data.banner) properties[NOTION_PROPERTIES.banner] = notionFilesValue(data.banner, 'core-banner', payload?.meta?.anilist_id || payload?.meta?.mal_id || '');
  if (data.sourceUrl) properties[NOTION_PROPERTIES.sourceUrl] = { url: data.sourceUrl };
  for (const domain of SITE_PROPERTIES) if (siteLinks[domain]?.length) properties[domain] = siteLinksRichText(siteLinks[domain]);
  return { properties, data, siteLinks };
}

function checkIngestKey(request, env) {
  if (!env.INGEST_KEY) return;
  const provided = request.headers.get('X-Ingest-Key') || '';
  if (provided !== env.INGEST_KEY) throw new HttpError(401, 'Невірний або відсутній X-Ingest-Key.', '', 'ingest_auth', 'ingest');
}

async function ingestCorePayload(env, payload) {
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Очікувався JSON-об’єкт від Python core.', '', 'bad_json', 'ingest');
  if (!payload.title || typeof payload.title !== 'object') throw new HttpError(400, 'У JSON немає об’єкта title.', '', 'bad_schema', 'ingest');

  const queried = await queryDatabasePages(env);
  const mapped = queried.pages.map(mapPage);
  const existing = findExistingCoreItem(mapped, payload);
  let source;
  let existingPage = null;
  if (existing) {
    existingPage = queried.pages.find(page => compactId(page.id) === compactId(existing.id)) || await notionFetch(env, `/pages/${existing.id}`);
    const sourceId = existingPage?.parent?.data_source_id;
    source = sourceId ? await notionFetch(env, `/data_sources/${sourceId}`) : await getWriteSource(env, queried);
  } else {
    source = await getWriteSource(env, queried);
  }
  source = await ensureWritableSchema(env, source);
  const titleData = coreTitleData(payload);
  if (titleData.group) source = await ensureGroupOption(env, source, titleData.group);
  const built = buildCoreProperties(payload, source, { includeAddedAt: !existing });

  let savedPage;
  if (existing) {
    savedPage = await notionFetch(env, `/pages/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ properties: built.properties }) });
  } else {
    savedPage = await notionFetch(env, '/pages', { method: 'POST', body: JSON.stringify({ parent: { data_source_id: source.id }, properties: built.properties }) });
  }
  return {
    ok: true,
    existing: Boolean(existing),
    item: mapPage(savedPage),
    imported: {
      schemaVersion: payload.schema_version ?? null,
      coreVersion: payload?.meta?.core_version || '',
      sites: Object.fromEntries(Object.entries(built.siteLinks).map(([domain, items]) => [domain, items.length])),
    },
  };
}

async function handleIngestApi(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, X-Ingest-Key' } });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST, OPTIONS' });
  checkIngestKey(request, env);
  const payload = await request.json().catch(() => null);
  const result = await ingestCorePayload(env, payload);
  return json(result, result.existing ? 200 : 201);
}

async function handleCoreSearchApi(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
  const body = await request.json().catch(() => ({}));
  const title = plainTitle(body.title || '');
  const limit = Math.min(10, Math.max(1, Number(body.limit) || 8));
  if (!title) return json({ error: 'Потрібна назва тайтлу.' }, 400);

  const coreUrl = env.CORE_SEARCH_URL || CORE_SEARCH_URL;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (env.CORE_API_KEY) headers['X-API-Key'] = env.CORE_API_KEY;
  const response = await fetch(coreUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, limit }),
  });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch {}
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || raw.slice(0, 800) || response.statusText;
    throw new HttpError(502, `Python core search повернув HTTP ${response.status}: ${detail}`, raw.slice(0, 1200), String(response.status), 'python_core_search');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(502, 'Python core search не повернув валідний JSON.', raw.slice(0, 1200), 'invalid_json', 'python_core_search');
  return json(payload);
}

async function handleProcessTitleApi(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
  const body = await request.json().catch(() => ({}));
  const title = plainTitle(body.title || '');
  const sourceUrl = safeHttpUrl(body.url || '');
  if (!title || !sourceUrl) return json({ error: 'Потрібні title та url.' }, 400);
  const coreUrl = env.CORE_PROCESS_FULL_URL || CORE_PROCESS_FULL_URL;
  const coreHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (env.CORE_API_KEY) coreHeaders['X-API-Key'] = env.CORE_API_KEY;
  const coreResponse = await fetch(coreUrl, {
    method: 'POST',
    headers: coreHeaders,
    body: JSON.stringify({ title, url: sourceUrl, status: plainTitle(body.status || ''), group: plainTitle(body.group || '') }),
  });
  const raw = await coreResponse.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch {}
  if (!coreResponse.ok) throw new HttpError(502, `Python core повернув HTTP ${coreResponse.status}: ${payload?.error || raw.slice(0, 700) || coreResponse.statusText}`, raw.slice(0, 1200), String(coreResponse.status), 'python_core');
  if (!payload || typeof payload !== 'object') throw new HttpError(502, 'Python core не повернув валідний JSON.', raw.slice(0, 1200), 'invalid_json', 'python_core');
  const ingested = await ingestCorePayload(env, payload);
  return json({ ...ingested, core: { schemaVersion: payload.schema_version ?? null, version: payload?.meta?.core_version || '', sourceCatalog: payload?.meta?.source_catalog || '' } }, ingested.existing ? 200 : 201);
}

async function handleDiscoverPrepareApi(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
  const body = await request.json().catch(() => ({}));
  const media = normalizeIncomingMedia(body.media);
  if (!media) return json({ error: 'Не передано дані вибраного тайтлу.' }, 400);

  const requestedTitle = cleanTitle(body.title || '');
  const translationSource = cleanTitle(media?.title?.english || media?.title?.romaji || media?.title?.native || '');
  const [ukTitleAuto, ruTitle] = await Promise.all([
    requestedTitle ? Promise.resolve(requestedTitle) : translateToLanguage(translationSource, 'uk'),
    translateToLanguage(translationSource, 'ru'),
  ]);
  const originalTitle = originalTitleForMedia(media);
  const ukTitle = requestedTitle || cleanTitle(ukTitleAuto) || romanizedTitleForMedia(media) || originalTitle;
  const ru = cleanTitle(ruTitle) || romanizedTitleForMedia(media) || originalTitle;
  return json({
    ok: true,
    originalTitle,
    romanizedTitle: romanizedTitleForMedia(media),
    ukTitle,
    ruTitle: ru,
  });
}

async function handleCatalogSearchApi(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
  const body = await request.json().catch(() => ({}));
  const media = normalizeIncomingMedia(body.media);
  if (!media) return json({ error: 'Не передано дані вибраного тайтлу.' }, 400);

  const requestedDomains = Array.isArray(body.domains) ? body.domains : [];
  const domains = [...new Set(requestedDomains.filter(domain => CATALOGS.includes(domain)))].slice(0, 3);
  if (!domains.length) return json({ results: [], searched: 0 });

  const originalTitle = cleanTitle(body.originalTitle || originalTitleForMedia(media));
  const ukTitle = cleanTitle(body.ukTitle || '');
  const ruTitle = cleanTitle(body.ruTitle || '');

  const results = (await Promise.all(domains.map(async domain => {
    const variants = makeCatalogQueryVariants(domain, originalTitle, ukTitle, ruTitle, media);
    try { return await searchDomain(domain, variants, media); } catch { return null; }
  }))).filter(Boolean);

  return json({
    ok: true,
    searched: domains.length,
    domains,
    results: results.map(result => ({
      domain: result.domain,
      items: Array.isArray(result.items) ? result.items : [],
      matchedBy: result.matchedBy || '',
      matchedTitle: result.matchedTitle || '',
    })),
  });
}

async function handleDiscoverApi(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (!cleanTitle(q)) return json({ items: [], provider: null });
    const searched = await searchPublicAnimeSmart(q);
    return json({
      items: searched.items.map(simplifiedAniList),
      provider: searched.provider,
      fallback: searched.fallback,
      warning: searched.warning || '',
      searchQuery: searched.searchQuery || cleanTitle(q),
      translatedSearch: Boolean(searched.translatedSearch),
    });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    let media = normalizeIncomingMedia(body.media);
    if (!media && body.mediaId) media = await getAniListMedia(body.mediaId);
    if (!media) return json({ error: 'Не передано дані вибраного тайтлу.' }, 400);

    const queried = await queryDatabasePages(env);
    const existingItems = queried.pages.map(mapPage);
    const defaultTitle = cleanTitle(media?.title?.english || media?.title?.romaji || media?.title?.native || '');
    const requestedTitle = cleanTitle(body.title || '');
    const quickExisting = findExistingMapped(existingItems, media, requestedTitle || defaultTitle);
    if (quickExisting) return json({ ok: true, existing: true, item: quickExisting });

    let source = await getWriteSource(env, { databaseId: queried.databaseId, database: null, sources: queried.sources });
    source = await ensureWritableSchema(env, source);
    if (body.group) source = await ensureGroupOption(env, source, body.group);

    // English/romaji may be useful as a translation source, but never as the stored original title.
    const translationSource = cleanTitle(media?.title?.english || media?.title?.romaji || media?.title?.native || '');
    const descriptionSource = htmlToPlainText(media?.description || '');
    const prepared = body.preparedTitles && typeof body.preparedTitles === 'object' ? body.preparedTitles : {};
    const preparedUk = cleanTitle(prepared.ukTitle || '');
    const preparedRu = cleanTitle(prepared.ruTitle || '');
    const [ukTitleAuto, ruTitle, ukDescription] = await Promise.all([
      requestedTitle || preparedUk ? Promise.resolve(requestedTitle || preparedUk) : translateToLanguage(translationSource, 'uk'),
      preparedRu ? Promise.resolve(preparedRu) : translateToLanguage(translationSource, 'ru'),
      translateToLanguage(descriptionSource, 'uk'),
    ]);
    const originalTitle = originalTitleForMedia(media);
    const ukTitle = requestedTitle || preparedUk || cleanTitle(ukTitleAuto) || defaultTitle || originalTitle;
    const ru = preparedRu || cleanTitle(ruTitle) || defaultTitle || originalTitle;

    // Catalog crawling is split into separate browser-triggered Worker invocations in v4.3,
    // so a single Free-plan Worker request never crosses Cloudflare's external subrequest limit.
    const siteLinks = sanitizeSiteLinks(body.siteLinks);
    let found = [];
    if (body.searchCatalogs === true && !Object.keys(siteLinks).length) {
      // Backward-compatible safe fallback: search only a small batch instead of all catalogs.
      const safeDomains = CATALOGS.slice(0, 3);
      found = (await Promise.all(safeDomains.map(async domain => {
        const variants = makeCatalogQueryVariants(domain, originalTitle, ukTitle, ru, media);
        try { return await searchDomain(domain, variants, media); } catch { return null; }
      }))).filter(Boolean);
      for (const result of found) if (result?.domain && Array.isArray(result.items)) siteLinks[result.domain] = mergeLinkItems(siteLinks[result.domain], result.items);
    }

    const built = buildCreateProperties(media, { ...body, title: ukTitle }, { ukTitle, ruTitle: ru, ukDescription }, siteLinks, source);
    const created = await notionFetch(env, '/pages', { method: 'POST', body: JSON.stringify({ parent: { data_source_id: source.id }, properties: built.properties }) });
    const item = mapPage(created);
    return json({
      ok: true,
      existing: false,
      item,
      originalTitle,
      romanizedTitle: romanizedTitleForMedia(media),
      provider: media.provider || 'anilist',
      foundSites: Object.entries(siteLinks).map(([domain, items]) => ({ domain, count: items.length, matchedBy: found.find(result => result?.domain === domain)?.matchedBy || 'batched search' })),
      searchedCatalogs: Number(body.searchedCatalogs || (body.searchCatalogs === true ? 3 : 0)),
    }, 201);
  }

  return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
        return new Response(null, { status: 204, headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
          'access-control-allow-headers': 'Content-Type, X-Ingest-Key',
          'access-control-max-age': '86400',
        } });
      }
      if (url.pathname === '/api/source-preview') return await handleSourcePreviewApi(request);
      if (url.pathname === '/api/core-search') return await handleCoreSearchApi(request, env);
      if (url.pathname === '/api/process-title') return await handleProcessTitleApi(request, env);
      if (url.pathname === '/api/ingest' || url.pathname === '/api/anime/import') return await handleIngestApi(request, env);
      if (request.method === 'POST' && url.pathname === '/' && (request.headers.get('content-type') || '').includes('application/json')) return await handleIngestApi(request, env);
      if (url.pathname === '/api/anime') return await handleAnimeApi(request, env);
      if (url.pathname === '/api/options') return await handleOptionsApi(request, env);
      if (url.pathname === '/api/discover') return await handleDiscoverApi(request, env);
      if (url.pathname === '/api/discover/prepare') return await handleDiscoverPrepareApi(request, env);
      if (url.pathname === '/api/catalog-search') return await handleCatalogSearchApi(request, env);
      if (url.pathname === '/api/version') return json({ ok: true, version: 'yoru-v4.8-async-full-catalog-search-2026-08-11', addTitle: true, googleSourceSearch: true, googleSearchMode: 'vercel-python-core', sourceSites: AUTHORITY_SITES, pythonCoreSearch: env.CORE_SEARCH_URL || CORE_SEARCH_URL, pythonCoreProcessFull: env.CORE_PROCESS_FULL_URL || CORE_PROCESS_FULL_URL, pythonCoreProcess: env.CORE_PROCESS_URL || CORE_PROCESS_URL, coreJsonIngest: true, ingestEndpoint: '/api/ingest', mediaRepair: true });

      if (url.pathname === '/api/health') {
        const databaseId = env.NOTION_DATABASE_ID || DEFAULT_DATABASE_ID;
        if (!env.NOTION_TOKEN) return json({ ok: false, notion: false, tokenConfigured: false, databaseId, step: 'cloudflare_secret', error: 'У Cloudflare не задано NOTION_TOKEN.' }, 500);
        const queried = await queryDatabasePages(env);
        return json({ ok: true, notion: true, tokenConfigured: true, databaseId: queried.databaseId, sourceCount: queried.sourceStats.length, sources: queried.sourceStats, totalPages: queried.pages.length });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Yoru worker error', error);
      const status = error instanceof HttpError ? error.status : 500;
      const payload = { error: error?.message || 'Невідома помилка сервера.' };
      if (error instanceof HttpError) {
        if (error.code) payload.code = error.code;
        if (error.step) payload.step = error.step;
        if (error.details) payload.details = error.details;
      }
      return json(payload, status >= 400 && status < 600 ? status : 500);
    }
  },
};
