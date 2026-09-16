const root = document.getElementById('titleRoot');
const toast = document.getElementById('toast');
const titleParams = new URLSearchParams(location.search);
const id = titleParams.get('id');
const randomMode = titleParams.get('random') === '1';
const anihubPreviewId = titleParams.get('anihub') || '';
const previewMode = titleParams.get('preview') === 'anihub' || Boolean(anihubPreviewId);
const titleTopActions = document.getElementById('titleTopActions');
let randomExcludeIds = new Set();
try { randomExcludeIds = new Set(JSON.parse(sessionStorage.getItem('yoru-random-exclude') || '[]')); } catch { randomExcludeIds = new Set(); }
const FALLBACK_IMAGE = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 700 1000%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%23171b27%22/%3E%3Cstop offset=%221%22 stop-color=%22%23282d42%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22700%22 height=%221000%22 fill=%22url(%23g)%22/%3E%3Ctext x=%22350%22 y=%22520%22 text-anchor=%22middle%22 fill=%22%23798094%22 font-family=%22Arial%22 font-size=%2270%22%3EYORU%3C/text%3E%3C/svg%3E';
const ANILIST_PUBLIC_ENDPOINT = 'https://graphql.anilist.co';
const STATUS_OPTIONS = ['Добавленно', 'Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто', 'Без статусу'];
const EDIT_CATALOG_DOMAINS = [
  'myanimelist.net', 'anilist.co', 'shikimori.io',
  'jut-su.net', 'ru.yummyani.me', 'crunchyroll.com', 'animevost.org', 'jutsu.tv', 'jut.su', 'animego.studio', 'anilibria.tv',
  'uaserials.com', 'uachan.com', 'anihub.in.ua', 'amanogawa.space', 'animeon.club', 'anidesu.net', 'mikai.me', 'anitube.in.ua',
];
const CATALOG_DOMAIN_ALIASES = {
  'aniliberty.top': 'anilibria.tv', 'www.aniliberty.top': 'anilibria.tv', 'anilibria.top': 'anilibria.tv', 'www.anilibria.top': 'anilibria.tv',
  'uachan.top': 'uachan.com', 'www.uachan.top': 'uachan.com', 'www.uachan.com': 'uachan.com',
  'www.crunchyroll.com': 'crunchyroll.com',
};
const STATUS_THEME = {
  'Добавленно': { solid: '#9b9a97', glow: 'rgba(155,154,151,.26)', border: 'rgba(155,154,151,.46)' },
  'Переглянув': { solid: '#7ee8b5', glow: 'rgba(126,232,181,.34)', border: 'rgba(126,232,181,.55)' },
  'Буду дивитись': { solid: '#a796ff', glow: 'rgba(167,150,255,.34)', border: 'rgba(167,150,255,.55)' },
  'Дивлюсь': { solid: '#70c9ff', glow: 'rgba(112,201,255,.34)', border: 'rgba(112,201,255,.55)' },
  'Відкладено': { solid: '#e7be72', glow: 'rgba(231,190,114,.34)', border: 'rgba(231,190,114,.55)' },
  'Кинуто': { solid: '#d688a3', glow: 'rgba(214,136,163,.34)', border: 'rgba(214,136,163,.55)' },
  'Без статусу': { solid: '#d5dceb', glow: 'rgba(213,220,235,.22)', border: 'rgba(213,220,235,.4)' },
};
const GROUP_COLOR_THEME = {
  default:{solid:'#a8b0bf',soft:'rgba(168,176,191,.12)',border:'rgba(168,176,191,.28)'}, gray:{solid:'#9b9a97',soft:'rgba(155,154,151,.13)',border:'rgba(155,154,151,.30)'},
  brown:{solid:'#b08468',soft:'rgba(176,132,104,.14)',border:'rgba(176,132,104,.30)'}, orange:{solid:'#d99058',soft:'rgba(217,144,88,.14)',border:'rgba(217,144,88,.32)'},
  yellow:{solid:'#d8b55b',soft:'rgba(216,181,91,.14)',border:'rgba(216,181,91,.32)'}, green:{solid:'#6fbe8b',soft:'rgba(111,190,139,.14)',border:'rgba(111,190,139,.32)'},
  blue:{solid:'#65a8df',soft:'rgba(101,168,223,.14)',border:'rgba(101,168,223,.32)'}, purple:{solid:'#a589d4',soft:'rgba(165,137,212,.14)',border:'rgba(165,137,212,.32)'},
  pink:{solid:'#d879a2',soft:'rgba(216,121,162,.14)',border:'rgba(216,121,162,.32)'}, red:{solid:'#d76868',soft:'rgba(215,104,104,.14)',border:'rgba(215,104,104,.32)'},
};


let saved = {};
try { saved = JSON.parse(localStorage.getItem('yoru-state') || '{}'); } catch { saved = {}; }
const favorite = new Set();
const liked = new Set();

// Global site colors. These defaults live in code and apply on every title page.
const DEFAULT_SOURCE_MARKS = Object.freeze({
  'Animevost': 'red',
  'Jut Su': 'green',
});

// Migrate old per-title marks (pageId::Site) to one global mark per site.
const previousLinkMarks = saved.linkMarks && typeof saved.linkMarks === 'object' ? saved.linkMarks : {};
const globalLinkMarks = { ...DEFAULT_SOURCE_MARKS };
for (const [key, mark] of Object.entries(previousLinkMarks)) {
  if (mark !== 'red' && mark !== 'green') continue;
  const separator = key.lastIndexOf('::');
  const site = separator >= 0 ? key.slice(separator + 2) : key;
  if (site) globalLinkMarks[site] = mark;
}
saved.linkMarks = globalLinkMarks;
let currentItem = null;
let apiOptions = { statuses: [], groups: [], groupOptions: [], tags: [], genres: [], themes: [], statusGroups: {}, starredGroups: [], playerSettings: { mikaiApiKeyConfigured: false, mikaiSendToCore: false }, bannerSettings: { trailerEnabled: false } };
let mediaKind = null;
let editSiteLinks = {};

function persistState() {
  saved.favorite = [...favorite];
  saved.liked = [...liked];
  saved.linkMarks = saved.linkMarks && typeof saved.linkMarks === 'object' ? saved.linkMarks : {};
  localStorage.setItem('yoru-state', JSON.stringify(saved));
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}
function normalizeTrailerClient(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const url = safeHttpUrl(raw.url || '');
  const embedUrl = safeHttpUrl(raw.embedUrl || raw.embed_url || '');
  return { url, embedUrl, site:String(raw.site || '').toLowerCase(), id:String(raw.id || ''), thumbnail:safeHttpUrl(raw.thumbnail || ''), source:String(raw.source || '') };
}
function trailerBackgroundEnabled() { return Boolean(apiOptions.bannerSettings?.trailerEnabled); }
function trailerAutoplayUrl(value) {
  const trailer = normalizeTrailerClient(value);
  let raw = trailer.embedUrl || trailer.url;
  if (!raw) return '';
  try {
    let u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./,'');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || trailer.id;
      if (id) u = new URL(`https://www.youtube.com/embed/${encodeURIComponent(id)}`);
    } else if (host.endsWith('youtube.com')) {
      const id = trailer.id || u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/)?.[1] || '');
      if (id) u = new URL(`https://www.youtube.com/embed/${encodeURIComponent(id)}`);
    } else if (host.endsWith('dailymotion.com')) {
      const id = trailer.id || (u.pathname.match(/^\/(?:video|embed\/video)\/([^/?#]+)/)?.[1] || '');
      if (id) u = new URL(`https://www.dailymotion.com/embed/video/${encodeURIComponent(id)}`);
    }
    const finalHost = u.hostname.toLowerCase();
    if (finalHost.includes('youtube.com')) {
      const id = trailer.id || u.pathname.split('/').filter(Boolean).pop() || '';
      u.searchParams.set('autoplay','1');u.searchParams.set('mute','1');u.searchParams.set('controls','0');u.searchParams.set('playsinline','1');u.searchParams.set('rel','0');u.searchParams.set('modestbranding','1');u.searchParams.set('disablekb','1');u.searchParams.set('loop','1');
      if (id) u.searchParams.set('playlist',id);
    } else if (finalHost.includes('dailymotion.com')) {
      u.searchParams.set('autoplay','1');u.searchParams.set('mute','1');u.searchParams.set('controls','0');u.searchParams.set('queue-enable','0');
    } else {
      u.searchParams.set('autoplay','1');u.searchParams.set('muted','1');
    }
    return u.href;
  } catch { return ''; }
}
function trailerBackgroundHtml(item) {
  if (!trailerBackgroundEnabled()) return '';
  const trailer = normalizeTrailerClient(item?.trailer);
  const src = trailerAutoplayUrl(trailer);
  if (!src) return '';
  const direct = /\.(?:mp4|webm)(?:$|[?#])/i.test(trailer.url || '');
  if (direct) return `<div class="banner-trailer-bg" aria-hidden="true"><video src="${escapeHtml(trailer.url)}" autoplay muted loop playsinline preload="auto"></video></div>`;
  return `<div class="banner-trailer-bg" aria-hidden="true"><iframe src="${escapeHtml(src)}" title="" tabindex="-1" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="origin-when-cross-origin"></iframe></div>`;
}

function statusClass(status) {
  return 'status-' + ({ 'Добавленно':'added', 'Буду дивитись':'planned', 'Дивлюсь':'watching', 'Переглянув':'completed', 'Відкладено':'paused', 'Кинуто':'dropped' }[status] || 'default');
}

function statusTheme(status) {
  return STATUS_THEME[status] || STATUS_THEME['Без статусу'];
}

function groupOption(name) {
  const key = String(name || '').trim().toLocaleLowerCase('uk-UA');
  return (apiOptions.groupOptions || []).find(option => String(option.name || '').trim().toLocaleLowerCase('uk-UA') === key) || null;
}
function groupTheme(name) { return GROUP_COLOR_THEME[groupOption(name)?.color || 'default'] || GROUP_COLOR_THEME.default; }
function groupTagStyle(name) { const t = groupTheme(name); return `--group-accent:${t.solid};--group-soft:${t.soft};--group-border:${t.border}`; }

function normalizeOptionKey(value) { return String(value || '').trim().toLocaleLowerCase('uk-UA'); }
function starredGroupSet() { return new Set((apiOptions.starredGroups || []).map(normalizeOptionKey)); }
function configuredStatusGroups() { return apiOptions.statusGroups && typeof apiOptions.statusGroups === 'object' ? apiOptions.statusGroups : {}; }
function configuredGroupsForStatus(status, currentGroup = '') {
  const all = [...new Set((apiOptions.groups || []).filter(Boolean))];
  const stars = starredGroupSet();
  const mapping = configuredStatusGroups();
  const mappingKeys = Object.keys(mapping);
  const assigned = new Set();
  for (const groups of Object.values(mapping)) for (const group of groups || []) assigned.add(normalizeOptionKey(group));
  const selected = new Set((mapping[status] || []).map(normalizeOptionKey));
  let allowed;
  if (!mappingKeys.length) allowed = all;
  else allowed = all.filter(group => stars.has(normalizeOptionKey(group)) || selected.has(normalizeOptionKey(group)) || !assigned.has(normalizeOptionKey(group)));
  const rank = group => {
    const key = normalizeOptionKey(group);
    if (stars.has(key)) return 0;
    if (selected.has(key)) return 1;
    if (!assigned.has(key)) return 2;
    return 3;
  };
  return [...new Set([...allowed, 'Без групи'].filter(Boolean))].sort((a, b) => {
    if (a === 'Без групи' && b !== 'Без групи') return 1;
    if (b === 'Без групи' && a !== 'Без групи') return -1;
    const diff = rank(a) - rank(b);
    return diff || a.localeCompare(b, 'uk');
  });
}

function parseTagsInput(value) {
  return [...new Set(String(value || '').split(/(?:\.\s*|[\n,;]+)/).map(tag => tag.trim().replace(/^#+/, '').replace(/\.+$/, '')).filter(Boolean))].slice(0, 100);
}

function formatTagsInput(tags) {
  const clean = Array.isArray(tags) ? tags.filter(Boolean) : [];
  return clean.length ? `${clean.join('. ')}.` : '';
}

function currentTagFragment(value) {
  const text = String(value || '');
  const parts = text.split('.');
  return String(parts[parts.length - 1] || '').trim().toLocaleLowerCase('uk-UA');
}

function matchingTagSuggestions(value, selectedTags = []) {
  const selected = new Set((selectedTags || []).map(normalizeOptionKey));
  const q = currentTagFragment(value);
  return (apiOptions.tags || [])
    .filter(tag => !selected.has(normalizeOptionKey(tag)))
    .filter(tag => !q || normalizeOptionKey(tag).includes(q))
    .slice(0, 10);
}

function applyTagSuggestionToValue(value, suggestion) {
  const text = String(value || '');
  const parts = text.split('.');
  parts[parts.length - 1] = ` ${suggestion}`;
  return `${parts.map(part => part.trim()).filter(Boolean).join('. ')}. `;
}

function watchProgressField(kind, label, value) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  return `
    <div class="watch-progress-field" data-watch-field="${kind}">
      <span class="watch-progress-label">${label}</span>
      <div class="watch-number-field">
        <button type="button" data-watch-adjust="${kind}" data-delta="-1" aria-label="Зменшити ${label.toLocaleLowerCase('uk-UA')}">‹</button>
        <input type="number" min="0" step="1" inputmode="numeric" value="${safeValue}" data-watch-input="${kind}" aria-label="${label}" />
        <button type="button" data-watch-adjust="${kind}" data-delta="1" aria-label="Збільшити ${label.toLocaleLowerCase('uk-UA')}">›</button>
      </div>
    </div>`;
}

function watchProgressPanel(item) {
  if (String(item?.status || '').trim() !== 'Дивлюсь') return '';
  return `<div class="watch-progress-group reveal delay-1">
    ${watchProgressField('season', 'Сезон', item?.season)}
    ${watchProgressField('episode', 'Серія', item?.episode)}
  </div>`;
}

function sourceMarkKey(site) {
  // Deliberately global: a site's color is the same on every anime title page.
  return String(site || '').trim();
}

function getSourceMark(site) {
  return saved.linkMarks?.[sourceMarkKey(site)] || '';
}

function setSourceMark(site, mark) {
  if (!currentItem) return;
  const key = sourceMarkKey(site);
  if (!mark) delete saved.linkMarks[key];
  else saved.linkMarks[key] = mark;
  persistState();
}

function sourceMarkIcon(kind) {
  if (kind === 'red') return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.8 12.3l2.2 2.2 4.2-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function icon(type, active) {
  if (type === 'favorite') return `<svg viewBox="0 0 24 24"><path d="M7 4h10a2 2 0 0 1 2 2v14l-7-4-7 4V6a2 2 0 0 1 2-2Z" ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  return `<svg viewBox="0 0 24 24"><path d="M12 20.2S4 15.6 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 6.1-8 10.7-8 10.7Z" ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8"/></svg>`;
}

function toastMessage(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastMessage._t);
  toastMessage._t = setTimeout(() => toast.classList.remove('show'), 1800);
}

function renderNotFound(message = 'Тайтл не знайдено') {
  root.innerHTML = `<div class="not-found"><h1>${escapeHtml(message)}</h1><a href="index.html">Повернутися в каталог</a></div>`;
}

function titleCase(value = '') {
  return String(value).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(^|\s)\S/g, s => s.toUpperCase());
}

function getSiteLabel(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const parts = hostname.split('.').filter(Boolean);
    return titleCase(parts.length > 1 ? parts[0] : hostname) || 'Сайт';
  } catch { return 'Сайт'; }
}

function canonicalCatalogDomain(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return CATALOG_DOMAIN_ALIASES[host] || host;
  } catch {
    const host = String(value || '').toLowerCase().replace(/^www\./, '');
    return CATALOG_DOMAIN_ALIASES[host] || host;
  }
}

function catalogLabel(domain) {
  const d = canonicalCatalogDomain(domain);
  const labels = {
    'myanimelist.net': 'Myanimelist', 'anilist.co': 'Anilist', 'shikimori.io': 'Shikimori',
    'jut-su.net': 'Jut Su', 'ru.yummyani.me': 'Yummyani', 'crunchyroll.com': 'Crunchyroll', 'animevost.org': 'Animevost',
    'jutsu.tv': 'Jutsu', 'jut.su': 'Jut', 'animego.studio': 'Animego', 'anilibria.tv': 'Anilibria', 'uaserials.com': 'Uaserials',
    'uachan.com': 'Uachan', 'anihub.in.ua': 'AniHub', 'amanogawa.space': 'Amanogawa', 'animeon.club': 'Animeon',
    'anidesu.net': 'Anidesu', 'mikai.me': 'Mikai', 'anitube.in.ua': 'Anitube',
  };
  return labels[d] || getSiteLabel(`https://${d}`);
}

function sourceMarkRank(site) {
  const mark = getSourceMark(site);
  return mark === 'green' ? 0 : mark === 'red' ? 2 : 1;
}

function sortSourceGroups(groups) {
  return [...groups].sort((a, b) => sourceMarkRank(a.site) - sourceMarkRank(b.site) || a.site.localeCompare(b.site, 'uk'));
}

function groupLinks(links = []) {
  const map = new Map();
  links.filter(link => safeHttpUrl(link.url)).forEach(link => {
    const url = safeHttpUrl(link.url);
    const domain = canonicalCatalogDomain(url);
    const site = catalogLabel(domain);
    if (!map.has(domain)) map.set(domain, { domain, site, items: [] });
    map.get(domain).items.push({ ...link, url });
  });
  return sortSourceGroups([...map.values()]);
}

const PLAYER_PROVIDERS = Object.freeze([
  { domain:'anihub.in.ua', label:'anihub.in.ua', kind:'dom', seasonSwitch:true, tone:'yellow', retryAfterMs:700, target:{ mode:'classes', value:'relative border border-white/10 rounded-2xl p-4 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-violet-500/5' } },
  { domain:'animeon.club', label:'animeon.club', kind:'dom', seasonSwitch:true, tone:'yellow', retryAfterMs:900, target:{ mode:'classes', value:'anime-player-section flex-center' } },
  { domain:'mikai.me', label:'mikai.me', kind:'mikai', seasonSwitch:true, tone:'yellow' },
  { domain:'jut-su.net', label:'jut-su.net', kind:'dom', seasonSwitch:false, tone:'red', retryAfterMs:650, target:{ mode:'classes', value:'jutsu-page__player-video' } },
  { domain:'animego.studio', label:'animego.studio', kind:'dom', seasonSwitch:false, tone:'red', retryAfterMs:1800, target:{ mode:'classes', value:'tabs-block__content video-inside' } },
]);
let titleMediaMode = localStorage.getItem('yoru-title-media-mode') === 'sources' ? 'sources' : 'player';
let titlePlayerProvider = localStorage.getItem('yoru-title-player-provider') || 'anihub.in.ua';
let titlePlayerSeasons = {};
try { titlePlayerSeasons = JSON.parse(localStorage.getItem('yoru-title-player-seasons') || '{}') || {}; } catch { titlePlayerSeasons = {}; }
let titlePlayerLoadSerial = 0;
let mikaiPlayerData = null;
let mikaiPlayerSelection = { release:0, episode:0, source:0 };
let domPlayerCleanup = null;
const DOM_REMOTE_VIEWPORT_W = 1365;
const DOM_REMOTE_VIEWPORT_H = 900;
const DOM_PLAYER_POLL_MS = 200;
const DOM_PLAYER_WAIT_MS = 60000;
const DOM_PLAYER_AUTO_RELOAD_AFTER_MS = 700;
const DOM_PLAYER_AUTO_RELOAD_FORCE_MS = 1800;
const DOM_PLAYER_NATIVE_BRANCHES = Object.freeze({
  'anihub.in.ua':'p-anihub',
  'animeon.club':'p-animeon',
  'jut-su.net':'p-jutsu',
  'animego.studio':'p-animego',
});

function playerProviderConfig(domain) {
  return PLAYER_PROVIDERS.find(item => item.domain === domain) || PLAYER_PROVIDERS[0];
}
function playerGroupMap() {
  return new Map(groupLinks(currentItem?.links || []).map(group => [group.domain, group]));
}
function availablePlayerProviders() {
  const groups = playerGroupMap();
  return PLAYER_PROVIDERS.filter(provider => groups.get(provider.domain)?.items?.length);
}
function ensurePlayerProvider() {
  const available = availablePlayerProviders();
  if (available.some(item => item.domain === titlePlayerProvider)) return titlePlayerProvider;
  titlePlayerProvider = available[0]?.domain || PLAYER_PROVIDERS[0].domain;
  localStorage.setItem('yoru-title-player-provider', titlePlayerProvider);
  return titlePlayerProvider;
}
function playerLinksFor(domain) {
  const items = playerGroupMap().get(domain)?.items || [];
  return [...items].sort((a,b) => {
    const number = value => Number(String(value?.name || '').match(/(?:сезон|season)\s*(\d+)/i)?.[1] || 9999);
    return number(a) - number(b) || String(a?.name || '').localeCompare(String(b?.name || ''), 'uk');
  });
}
function playerSeasonLabel(link, index, total) {
  const raw = String(link?.name || '').trim();
  const match = raw.match(/(?:сезон|season)\s*(\d+)/i);
  if (match) return `Сезон ${match[1]}`;
  if (total > 1) return raw || `Сезон ${index + 1}`;
  return raw || 'Поточний сезон';
}
function currentPlayerLink(domain = titlePlayerProvider) {
  const links = playerLinksFor(domain);
  if (!links.length) return null;
  const provider = playerProviderConfig(domain);
  if (!provider.seasonSwitch) return links[0];
  const index = Math.max(0, Math.min(links.length - 1, Number(titlePlayerSeasons[domain]) || 0));
  titlePlayerSeasons[domain] = index;
  return links[index];
}
function setPlayerSeason(domain, index) {
  const links = playerLinksFor(domain);
  titlePlayerSeasons[domain] = Math.max(0, Math.min(links.length - 1, Number(index) || 0));
  localStorage.setItem('yoru-title-player-seasons', JSON.stringify(titlePlayerSeasons));
}
function mikaiKeyConfigured() { return Boolean(apiOptions.playerSettings?.mikaiApiKeyConfigured); }

function buildPlayerProviderButtons() {
  const groups = playerGroupMap();
  return PLAYER_PROVIDERS.map(provider => {
    const available = Boolean(groups.get(provider.domain)?.items?.length);
    const active = provider.domain === titlePlayerProvider;
    const limited = provider.domain === 'mikai.me' && !mikaiKeyConfigured();
    const mikaiReady = provider.domain === 'mikai.me' && mikaiKeyConfigured();
    const title = !available ? 'Для цього тайтлу немає посилання в базі' : limited ? 'Mikai працює без ключа, але з обмеженням запитів' : provider.label;
    const toneClass = provider.tone === 'red' ? 'tone-red' : 'tone-yellow';
    const mikaiStateClass = provider.domain === 'mikai.me' ? (mikaiReady ? 'mikai-ready' : 'mikai-limited') : '';
    return `<button class="player-source-tab ${toneClass} ${mikaiStateClass} ${active ? 'active' : ''}" type="button" data-player-source="${escapeHtml(provider.domain)}" ${available ? '' : 'disabled'} title="${escapeHtml(title)}">${escapeHtml(provider.label)}</button>`;
  }).join('');
}
function buildPlayerSeasonPicker(domain = titlePlayerProvider) {
  const provider = playerProviderConfig(domain);
  if (!provider.seasonSwitch) return '';
  const links = playerLinksFor(domain);
  if (!links.length) return '';
  const selected = Math.max(0, Math.min(links.length - 1, Number(titlePlayerSeasons[domain]) || 0));
  return `<label class="player-season-control"><span>Сезон</span><select data-player-season>${links.map((link,index) => `<option value="${index}" ${index === selected ? 'selected' : ''}>${escapeHtml(playerSeasonLabel(link,index,links.length))}</option>`).join('')}</select></label>`;
}
function buildPlayerPanelHtml() {
  const provider = ensurePlayerProvider();
  const link = currentPlayerLink(provider);
  const sourceConfig = playerProviderConfig(provider);
  if (!link) return `<div class="player-empty-state"><strong>Немає джерела</strong><span>Для ${escapeHtml(provider)} у базі тайтлу немає посилання.</span></div>`;
  return `
    <div class="player-toolbar">
      ${buildPlayerSeasonPicker(provider)}
      <a class="player-open-source" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">Відкрити джерело ↗</a>
    </div>
    <div class="player-stage" data-player-stage data-player-kind="${escapeHtml(sourceConfig.kind)}" data-player-domain="${escapeHtml(provider)}">
      <div class="player-loading"><span class="detail-loader"></span><strong>Завантажую ${escapeHtml(provider)}…</strong><small>${provider === 'mikai.me' && !mikaiKeyConfigured() ? 'Public API без ключа — можливі ліміти запитів.' : 'Підготовка плеєра…'}</small></div>
    </div>`;
}
function buildMediaWorkspace(linkGroups) {
  return `
    <div class="title-media-workspace">
      <div class="title-media-mode-tabs" role="tablist" aria-label="Плеєр або джерела">
        <button class="title-media-mode ${titleMediaMode === 'player' ? 'active' : ''}" type="button" data-media-mode="player">Плеєр</button>
        <button class="title-media-mode ${titleMediaMode === 'sources' ? 'active' : ''}" type="button" data-media-mode="sources">Джерела</button>
      </div>
      <div class="player-source-tabs">${buildPlayerProviderButtons()}</div>
      <section class="title-media-pane ${titleMediaMode === 'player' ? '' : 'hidden'}" data-media-pane="player">
        <div class="player-panel" data-player-panel>${buildPlayerPanelHtml()}</div>
      </section>
      <section class="title-media-pane ${titleMediaMode === 'sources' ? '' : 'hidden'}" data-media-pane="sources">
        <aside class="sources-card sources-card-wide">
          <div class="sources-head">
            <span class="section-kicker">ПОСИЛАННЯ</span>
            <h3>Сайти та серії</h3>
            <p class="sources-summary">${linkGroups.length ? `Сайтів: ${linkGroups.length} · Посилань: ${linkGroups.reduce((sum, group) => sum + group.items.length, 0)}` : 'Посилань поки немає'}</p>
          </div>
          <div class="source-groups">${buildLinksAccordion(linkGroups)}</div>
        </aside>
      </section>
    </div>`;
}
function setTitleMediaMode(mode) {
  titleMediaMode = mode === 'sources' ? 'sources' : 'player';
  localStorage.setItem('yoru-title-media-mode', titleMediaMode);
  root.querySelectorAll('[data-media-mode]').forEach(button => button.classList.toggle('active', button.dataset.mediaMode === titleMediaMode));
  root.querySelectorAll('[data-media-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.mediaPane !== titleMediaMode));
  if (titleMediaMode === 'player') loadActiveTitlePlayer();
  else stopDomTitlePlayer();
}

function selectTitlePlayerProvider(domain) {
  if (!PLAYER_PROVIDERS.some(item => item.domain === domain)) return;
  if (!playerLinksFor(domain).length) return;
  titlePlayerProvider = domain;
  titleMediaMode = 'player';
  localStorage.setItem('yoru-title-player-provider', domain);
  localStorage.setItem('yoru-title-media-mode', 'player');
  root.querySelectorAll('[data-player-source]').forEach(button => button.classList.toggle('active', button.dataset.playerSource === domain));
  root.querySelectorAll('[data-media-mode]').forEach(button => button.classList.toggle('active', button.dataset.mediaMode === 'player'));
  root.querySelectorAll('[data-media-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.mediaPane !== 'player'));
  renderActivePlayerPanel();
}
function renderActivePlayerPanel() {
  const panel = root.querySelector('[data-player-panel]');
  if (!panel) return;
  panel.innerHTML = buildPlayerPanelHtml();
  loadActiveTitlePlayer();
}
function playerErrorMessage(stage, message) {
  if (!stage) return;
  stage.innerHTML = `<div class="player-empty-state error"><strong>Плеєр недоступний</strong><span>${escapeHtml(message || 'Невідома помилка.')}</span></div>`;
}
function sortedMikaiEpisodes(release) {
  return Array.isArray(release?.episodes) ? [...release.episodes].sort((a,b) => Number(a?.number ?? a?.label ?? 0) - Number(b?.number ?? b?.label ?? 0)) : [];
}
function mikaiReleaseLabel(release) {
  const teams = Array.isArray(release?.teams) ? release.teams.map(item => item?.name).filter(Boolean).join(' + ') : '';
  const kind = release?.kind === 'sub' ? 'Субтитри' : release?.kind === 'voice' ? 'Озвучка' : (release?.kind || 'Реліз');
  return `${teams || release?.id || 'Реліз'} — ${kind}${release?.isCollab ? ' · колаборація' : ''}`;
}
function renderMikaiPlayerStage(stage) {
  const releases = Array.isArray(mikaiPlayerData?.result?.releases) ? mikaiPlayerData.result.releases.filter(item => sortedMikaiEpisodes(item).length) : [];
  if (mikaiPlayerData?.result?.licensed && !releases.length) return playerErrorMessage(stage, 'Mikai позначає цей тайтл як ліцензований і не повертає джерела плеєра.');
  if (!releases.length) return playerErrorMessage(stage, 'Mikai API не повернув серій із джерелами для цього сезону.');
  mikaiPlayerSelection.release = Math.min(mikaiPlayerSelection.release, releases.length - 1);
  const release = releases[mikaiPlayerSelection.release];
  const episodes = sortedMikaiEpisodes(release);
  mikaiPlayerSelection.episode = Math.min(mikaiPlayerSelection.episode, Math.max(0, episodes.length - 1));
  const episode = episodes[mikaiPlayerSelection.episode];
  const sources = Array.isArray(episode?.sources) ? episode.sources : [];
  mikaiPlayerSelection.source = Math.min(mikaiPlayerSelection.source, Math.max(0, sources.length - 1));
  const source = sources[mikaiPlayerSelection.source];
  const rate = mikaiPlayerData?.rateLimit || {};
  const limitText = rate.remaining != null ? ` · залишилось запитів: ${rate.remaining}` : '';
  stage.innerHTML = `
    <div class="mikai-player-controls">
      <label><span>Реліз</span><select data-mikai-release>${releases.map((item,index) => `<option value="${index}" ${index === mikaiPlayerSelection.release ? 'selected' : ''}>${escapeHtml(mikaiReleaseLabel(item))}</option>`).join('')}</select></label>
      <label><span>Серія</span><select data-mikai-episode>${episodes.map((item,index) => `<option value="${index}" ${index === mikaiPlayerSelection.episode ? 'selected' : ''}>${escapeHtml(item?.label ? `Серія ${item.label}` : `Серія ${item?.number ?? index + 1}`)}</option>`).join('')}</select></label>
      <label><span>Провайдер</span><select data-mikai-source>${sources.length ? sources.map((item,index) => `<option value="${index}" ${index === mikaiPlayerSelection.source ? 'selected' : ''}>${escapeHtml(String(item?.provider || `Джерело ${index + 1}`).toUpperCase())}</option>`).join('') : '<option value="0">Немає джерел</option>'}</select></label>
    </div>
    <div class="player-meta-line">${escapeHtml(mikaiReleaseLabel(release))} · ${escapeHtml(episode?.label ? `Серія ${episode.label}` : `Серія ${episode?.number ?? ''}`)}${escapeHtml(limitText)}</div>
    ${source?.embedUrl ? `<div class="player-frame-wrap"><iframe class="title-player-frame" data-mikai-frame src="${escapeHtml(source.embedUrl)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="origin-when-cross-origin"></iframe></div>` : '<div class="player-empty-state"><strong>Немає embedUrl</strong><span>Для вибраної серії Mikai не повернув джерело.</span></div>'}`;
}
async function loadMikaiTitlePlayer(stage, pageUrl, serial) {
  try {
    const response = await fetch(`/api/player/mikai?url=${encodeURIComponent(pageUrl)}`, { headers:{Accept:'application/json'}, cache:'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (serial !== titlePlayerLoadSerial) return;
    if (!response.ok || payload.ok !== true) throw new Error(payload?.error?.message || payload?.error || payload?.message || `HTTP ${response.status}`);
    mikaiPlayerData = payload;
    mikaiPlayerSelection = { release:0, episode:0, source:0 };
    renderMikaiPlayerStage(stage);
  } catch (error) {
    if (serial !== titlePlayerLoadSerial) return;
    playerErrorMessage(stage, error.message || 'Не вдалося завантажити Mikai API.');
  }
}
function stopDomTitlePlayer() {
  try { domPlayerCleanup?.(); } catch (_) {}
  domPlayerCleanup = null;
}

function domPlayerPagesProjectHost() {
  const host=String(location.hostname||'').toLowerCase();
  const parts=host.split('.').filter(Boolean);
  if (parts.length < 3 || parts.slice(-2).join('.') !== 'pages.dev') return 'mrsay.pages.dev';
  // Production: project.pages.dev. Preview: branch.project.pages.dev.
  // In both cases the project name is the label immediately before pages.dev.
  return `${parts[parts.length-3]}.pages.dev`;
}
function domPlayerNativeOrigin(domain) {
  const branch=DOM_PLAYER_NATIVE_BRANCHES[domain];
  const projectHost=domPlayerPagesProjectHost();
  return branch && projectHost ? `https://${branch}.${projectHost}` : '';
}
function domPlayerNativeUrl(domain,pageUrl) {
  const origin=domPlayerNativeOrigin(domain);
  if (!origin) return '';
  try {
    const remote=new URL(pageUrl);
    return `${origin}${remote.pathname}${remote.search}${remote.hash}`;
  } catch (_) { return ''; }
}
function startNativeDomPlayerCrop(stage,frame,viewport,loading,serial,nativeOrigin,sourceUrl,domain,providerConfig={}) {
  stopDomTitlePlayer();
  let found=false, remoteLoadCount=0, retryTimer=null, failTimer=null;
  const setLoadingMessage=(headline,detail)=>{
    if (!loading) return;
    const strong=loading.querySelector('strong'),small=loading.querySelector('small');
    if (strong && headline) strong.textContent=headline;
    if (small && detail) small.textContent=detail;
  };
  const applyRect=data=>{
    const rect=data?.rect||{};
    const width=Number(rect.width)||0,height=Number(rect.height)||0,left=Number(rect.left)||0,top=Number(rect.top)||0;
    if (width<2 || height<2) return;
    const remoteW=Math.max(320,Number(data.viewportW)||DOM_REMOTE_VIEWPORT_W);
    const remoteH=Math.max(240,Number(data.viewportH)||DOM_REMOTE_VIEWPORT_H);
    // Universal DOM Viewer v32: never enlarge a remote fragment. Keep the
    // source site's natural player scale and only shrink when it cannot fit.
    const maxWidth=Math.max(100,Math.min(stage.clientWidth||document.documentElement.clientWidth-40,1080));
    const scale=Math.min(1,maxWidth/width);
    frame.style.width=remoteW+'px';
    frame.style.height=remoteH+'px';
    frame.style.transform=`scale(${scale})`;
    frame.style.left=(-left*scale)+'px';
    frame.style.top=(-top*scale)+'px';
    viewport.style.width=Math.max(1,Math.round(width*scale))+'px';
    viewport.style.height=Math.max(1,Math.round(height*scale))+'px';
    viewport.hidden=false;
    viewport.classList.remove('is-loading');
    if (loading) loading.hidden=true;
    found=true;
    viewport.dataset.playerReady='true';
    if (retryTimer) { clearTimeout(retryTimer); retryTimer=null; }
    if (failTimer) { clearTimeout(failTimer); failTimer=null; }
  };
  const onMessage=event=>{
    if (serial!==titlePlayerLoadSerial || titleMediaMode!=='player') return;
    if (event.source!==frame.contentWindow || event.origin!==nativeOrigin) return;
    const data=event.data;
    if (!data || data.__yoruPlayerBridge!==1 || data.domain!==domain) return;
    if (data.type==='crop') applyRect(data);
    else if (data.type==='searching' && !found && remoteLoadCount<2) setLoadingMessage(`Шукаю плеєр ${domain}…`,'Сторінка вже працює у native-origin режимі; очікую заданий DOM-фрагмент.');
    else if (data.type==='bridge-error' && !found) setLoadingMessage(`Шукаю плеєр ${domain}…`,String(data.message||'Помилка bridge runtime.'));
  };
  const onLoad=()=>{
    if (serial!==titlePlayerLoadSerial || titleMediaMode!=='player') return;
    remoteLoadCount+=1;
    if (found) return;
    if (remoteLoadCount===1) {
      // Universal DOM Viewer starts monitoring ~700 ms after navigation. If the
      // first complete navigation still has no target, repeat the SAME URL in the
      // SAME iframe browsing context immediately. Cookies/storage survive.
      retryTimer=setTimeout(()=>{
        if (found || serial!==titlePlayerLoadSerial || titleMediaMode!=='player') return;
        setLoadingMessage('Повторно запускаю плеєр…','Перше повне завантаження не дало DOM-фрагмент. Повторюю навігацію в тому самому iframe-контексті.');
        try { frame.src=sourceUrl; } catch (_) {}
      },Math.max(300,Number(providerConfig.retryAfterMs)||DOM_PLAYER_AUTO_RELOAD_AFTER_MS));
    } else if (remoteLoadCount>1) {
      setLoadingMessage(`Шукаю плеєр ${domain}…`,'Повторна навігація вже виконана; очікую DOM-фрагмент.');
    }
  };
  window.addEventListener('message',onMessage);
  frame.addEventListener('load',onLoad);
  failTimer=setTimeout(()=>{
    if (!found && serial===titlePlayerLoadSerial && titleMediaMode==='player') {
      playerErrorMessage(stage,`Не знайдено DOM-фрагмент плеєра ${domain}. Перевір, що preview-гілка ${DOM_PLAYER_NATIVE_BRANCHES[domain]} задеплоєна на Cloudflare Pages.`);
    }
  },60000);
  domPlayerCleanup=()=>{
    window.removeEventListener('message',onMessage);
    try { frame.removeEventListener('load',onLoad); } catch (_) {}
    if (retryTimer) clearTimeout(retryTimer);
    if (failTimer) clearTimeout(failTimer);
  };
}
function domPlayerIsUsable(el, win) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = win.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  if (Number(cs.opacity || 1) <= 0.001) return false;
  return true;
}
function domPlayerPickBest(doc, win, targetSpec) {
  let all;
  if (targetSpec?.mode === 'classes') {
    all = Array.from(doc.getElementsByClassName(targetSpec.value));
  } else {
    try { all = Array.from(doc.querySelectorAll(targetSpec?.value || '')); }
    catch (error) { throw new Error('Некоректний selector плеєра: ' + error.message); }
  }
  if (!all.length) return null;
  const usable = all.filter(el => domPlayerIsUsable(el, win));
  const pool = usable.length ? usable : all;
  let best = null;
  let bestScore = -Infinity;
  for (const el of pool) {
    const r = el.getBoundingClientRect();
    let score = Math.max(0, r.width) * Math.max(0, r.height);
    if (el.querySelector?.('iframe,video,audio,canvas,object,embed')) score += 5_000_000;
    if (el.querySelector?.('button,input,select,textarea')) score += 50_000;
    if (score > bestScore) { bestScore = score; best = el; }
  }
  return { el:best, total:all.length, usable:usable.length, index:all.indexOf(best) };
}
function domPlayerCanScrollElement(el, win, dx, dy) {
  if (!el || el.nodeType !== 1) return false;
  const cs = win.getComputedStyle(el);
  if (dy) {
    const scrollableY = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (scrollableY) {
      if (dy < 0 && el.scrollTop > 0) return true;
      if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    }
  }
  if (dx) {
    const scrollableX = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    if (scrollableX) {
      if (dx < 0 && el.scrollLeft > 0) return true;
      if (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    }
  }
  return false;
}
function domPlayerIntersectsExpanded(a, b, pad = 80) {
  return !(b.right < a.left - pad || b.left > a.right + pad || b.bottom < a.top - pad || b.top > a.bottom + pad);
}
function domPlayerUnionRects(rects) {
  const valid = rects.filter(Boolean);
  if (!valid.length) return null;
  let left=valid[0].left, top=valid[0].top, right=valid[0].right, bottom=valid[0].bottom;
  for (const r of valid.slice(1)) {
    left=Math.min(left,r.left); top=Math.min(top,r.top); right=Math.max(right,r.right); bottom=Math.max(bottom,r.bottom);
  }
  return { left,top,right,bottom,width:right-left,height:bottom-top };
}
function domPlayerCollectTransientOverlays(doc, win, target, targetRect, lastInteractionAt) {
  if (Date.now() - lastInteractionAt > 3500) return [];
  const selector = '[role="menu"],[role="listbox"],[role="dialog"],[role="tooltip"],.dropdown-menu,.select2-dropdown,.ui-menu,.ui-autocomplete,[class*="dropdown"],[class*="popup"],[class*="popover"]';
  let nodes=[];
  try { nodes=Array.from(doc.querySelectorAll(selector)); } catch (_) { return []; }
  return nodes.filter(el => {
    if (!el.isConnected || target?.contains(el)) return false;
    const r=el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.width > DOM_REMOTE_VIEWPORT_W*.95 || r.height > DOM_REMOTE_VIEWPORT_H*.95) return false;
    const cs=win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || 1) <= .001) return false;
    return domPlayerIntersectsExpanded(targetRect,r,120);
  });
}
function domPlayerDetectTopOverlayInset(doc, win, target) {
  const vw=Math.max(1,win.innerWidth||DOM_REMOTE_VIEWPORT_W), vh=Math.max(1,win.innerHeight||DOM_REMOTE_VIEWPORT_H);
  const xs=[Math.round(vw*.08),Math.round(vw*.5),Math.round(vw*.92)], ys=[1,12,28,48,72,96,128,160];
  const seen=new Set(); let inset=0;
  for (const x of xs) for (const y of ys) {
    if (y >= vh) continue;
    let stack=[];
    try { stack=doc.elementsFromPoint(x,y)||[]; } catch (_) { continue; }
    for (const el of stack) {
      if (!el || el===doc.documentElement || el===doc.body || seen.has(el)) continue;
      seen.add(el);
      if (target && (el===target || target.contains?.(el))) continue;
      let cs,r;
      try { cs=win.getComputedStyle(el); r=el.getBoundingClientRect(); } catch (_) { continue; }
      if (!r || r.width<20 || r.height<4 || r.bottom<=0) continue;
      if (cs.display==='none' || cs.visibility==='hidden' || Number(cs.opacity||1)<=.001) continue;
      if (cs.position!=='fixed' && cs.position!=='sticky') continue;
      if (r.top>8 || r.bottom>vh*.6) continue;
      inset=Math.max(inset,Math.min(r.bottom,260));
    }
  }
  return Math.max(0,Math.round(inset));
}
function startDomPlayerCrop(stage, frame, viewport, loading, targetSpec, serial, sourceUrl, domain) {
  stopDomTitlePlayer();
  let monitorTimer=null, currentTarget=null, currentAnchor=null, cleanupChildHooks=null, lastInteractionAt=0, found=false;
  const providerConfig=playerProviderConfig(domain)||{};
  let remoteLoadedAt=0, remoteLoadCount=0, autoReloadDone=false, retryInProgress=false;
  const startedAt=Date.now();
  const setLoadingMessage=(headline,detail)=>{
    if (!loading) return;
    const strong=loading.querySelector('strong'), small=loading.querySelector('small');
    if (strong && headline) strong.textContent=headline;
    if (small && detail) small.textContent=detail;
  };
  function cleanup() {
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer=null;
    try { cleanupChildHooks?.(); } catch (_) {}
    cleanupChildHooks=null;
    try { frame.removeEventListener('load',onFrameLoad); } catch (_) {}
  }
  domPlayerCleanup=cleanup;
  function installChildHooks(doc, win) {
    try { cleanupChildHooks?.(); } catch (_) {}
    const onPointer=event => {
      if (currentTarget && currentTarget.contains(event.target)) {
        lastInteractionAt=Date.now();
        setTimeout(()=>updateCrop(false),0);
        setTimeout(()=>updateCrop(false),80);
        setTimeout(()=>updateCrop(false),250);
      }
    };
    const onWheel=event => {
      if (!currentTarget || !currentTarget.contains(event.target)) { event.preventDefault(); return; }
      let n=event.target;
      while (n && n!==currentTarget.parentElement) {
        if (domPlayerCanScrollElement(n,win,event.deltaX,event.deltaY)) return;
        if (n===currentTarget) break;
        n=n.parentElement;
      }
      event.preventDefault();
    };
    doc.addEventListener('pointerdown',onPointer,true);
    doc.addEventListener('click',onPointer,true);
    doc.addEventListener('wheel',onWheel,{capture:true,passive:false});
    cleanupChildHooks=()=>{
      try { doc.removeEventListener('pointerdown',onPointer,true); } catch (_) {}
      try { doc.removeEventListener('click',onPointer,true); } catch (_) {}
      try { doc.removeEventListener('wheel',onWheel,true); } catch (_) {}
    };
  }
  function choosePlayerSurface(anchor, win) {
    if (!anchor || !providerConfig.requireMedia) return anchor;
    let nodes=[];
    try {
      nodes=Array.from(anchor.querySelectorAll('iframe,video,object,embed,canvas,[class*="player" i],[class*="video" i],[id*="player" i],[id*="video" i]'));
    } catch (_) { return null; }
    const usable=nodes.filter(el=>domPlayerIsUsable(el,win));
    if (!usable.length) return null;
    let best=null,bestScore=-Infinity;
    for (const el of usable) {
      const r=el.getBoundingClientRect();
      if (r.width<120 || r.height<70) continue;
      const tag=String(el.tagName||'').toLowerCase();
      const text=((el.className&&String(el.className))||'')+' '+(el.id||'');
      let score=r.width*r.height;
      if (/^(iframe|video|object|embed|canvas)$/.test(tag)) score+=8_000_000;
      if (/player|video|watch|embed/i.test(text)) score+=1_500_000;
      const ratio=r.width/Math.max(1,r.height);
      if (ratio>=1.2 && ratio<=2.4) score+=750_000;
      if (score>bestScore) { bestScore=score; best=el; }
    }
    if (!best) return null;
    if (!providerConfig.tightMedia) return anchor;
    // Keep one/two local wrappers when they are clearly part of the player controls,
    // but never climb back to the large page section supplied as the anchor.
    let crop=best;
    for (let i=0;i<2;i++) {
      const parent=crop.parentElement;
      if (!parent || parent===anchor || !anchor.contains(parent)) break;
      const cr=crop.getBoundingClientRect(), pr=parent.getBoundingClientRect();
      if (pr.width>=cr.width*.90 && pr.width<=cr.width*1.22 && pr.height>=cr.height && pr.height<=cr.height*1.55) crop=parent;
      else break;
    }
    return crop;
  }
  function suppressOuterChrome(doc,win,anchor) {
    if (!doc || !win || !anchor) return;
    const xs=[Math.round(win.innerWidth*.08),Math.round(win.innerWidth*.5),Math.round(win.innerWidth*.92)];
    const ys=[1,18,48,Math.max(1,win.innerHeight-1),Math.max(1,win.innerHeight-24),Math.max(1,win.innerHeight-64)];
    const seen=new Set();
    for (const x of xs) for (const y of ys) {
      let stack=[]; try { stack=doc.elementsFromPoint(x,y)||[]; } catch (_) { continue; }
      for (const el of stack) {
        if (!el || seen.has(el) || el===doc.body || el===doc.documentElement) continue;
        seen.add(el);
        if (anchor.contains(el) || el.contains?.(anchor)) continue;
        let cs,r; try { cs=win.getComputedStyle(el); r=el.getBoundingClientRect(); } catch (_) { continue; }
        if (!r || (cs.position!=='fixed' && cs.position!=='sticky')) continue;
        const edge=r.top<=12 || r.bottom>=win.innerHeight-12;
        if (!edge || r.width<win.innerWidth*.45 || r.height<32) continue;
        try { el.style.setProperty('visibility','hidden','important'); el.style.setProperty('pointer-events','none','important'); } catch (_) {}
      }
    }
  }
  function updateCrop(showStatus=true) {
    if (serial !== titlePlayerLoadSerial || titleMediaMode !== 'player') return false;
    let doc,win;
    try { doc=frame.contentDocument; win=frame.contentWindow; } catch (_) { return false; }
    if (!doc || !win || !targetSpec) return false;
    let picked;
    try { picked=domPlayerPickBest(doc,win,targetSpec); } catch (error) { playerErrorMessage(stage,error.message); cleanup(); return false; }
    if (!picked || !domPlayerIsUsable(picked.el,win)) return false;
    currentAnchor=picked.el;
    const surface=currentAnchor;
    if (!surface || !domPlayerIsUsable(surface,win)) return false;
    const targetChanged=surface!==currentTarget;
    currentTarget=surface;
    if (targetChanged) installChildHooks(doc,win);
    let rect=currentTarget.getBoundingClientRect();
    let topInset=domPlayerDetectTopOverlayInset(doc,win,currentTarget);
    const safeTop=topInset+12;
    const outside=rect.bottom<safeTop || rect.top>DOM_REMOTE_VIEWPORT_H-8 || rect.right<0 || rect.left>DOM_REMOTE_VIEWPORT_W;
    const underHeader=rect.top<safeTop-2;
    if (targetChanged || outside || underHeader) {
      const docY=rect.top+win.scrollY, desiredY=Math.max(0,docY-safeTop);
      try { win.scrollTo({left:win.scrollX,top:desiredY,behavior:'instant'}); } catch (_) { try { win.scrollTo(win.scrollX,desiredY); } catch (_) {} }
      rect=currentTarget.getBoundingClientRect();
      topInset=domPlayerDetectTopOverlayInset(doc,win,currentTarget);
    }
    const overlays=domPlayerCollectTransientOverlays(doc,win,currentTarget,rect,lastInteractionAt).map(el=>el.getBoundingClientRect());
    const visibleRect=domPlayerUnionRects([rect,...overlays]);
    if (!visibleRect || visibleRect.width<2 || visibleRect.height<2) return false;
    const maxWidth=Math.max(100,Math.min(stage.clientWidth||document.documentElement.clientWidth-40,1080));
    const scale=Math.min(1,maxWidth/visibleRect.width);
    frame.style.width=DOM_REMOTE_VIEWPORT_W+'px';
    frame.style.height=DOM_REMOTE_VIEWPORT_H+'px';
    frame.style.transform=`scale(${scale})`;
    frame.style.left=(-visibleRect.left*scale)+'px';
    frame.style.top=(-visibleRect.top*scale)+'px';
    viewport.style.width=Math.max(1,Math.round(visibleRect.width*scale))+'px';
    viewport.style.height=Math.max(1,Math.round(visibleRect.height*scale))+'px';
    viewport.hidden=false;
    viewport.classList.remove('is-loading');
    if (loading) loading.hidden=true;
    found=true;
    if (showStatus || targetChanged) viewport.dataset.playerReady='true';
    return true;
  }
  function retrySameContext() {
    if (autoReloadDone || found || retryInProgress || !sourceUrl) return false;
    autoReloadDone=true;
    retryInProgress=true;
    setLoadingMessage('Повторно запускаю плеєр…','Перше завантаження не створило DOM-фрагмент. Повторюю повну навігацію в тому самому iframe-контексті, зберігаючи localStorage/sessionStorage.');
    const joiner=sourceUrl.includes('?')?'&':'?';
    const retryUrl=`${sourceUrl}${joiner}__yoru_retry=1&__yoru_t=${Date.now()}`;
    try {
      // Важливо: НЕ створюємо новий iframe. Повторна навігація в тому самому
      // browsing context повторює робочий "другий клік" Universal DOM Viewer:
      // стан, який сторінка записала під час першого запуску, переживає reload.
      frame.src=retryUrl;
      return true;
    } catch (_) {
      retryInProgress=false;
      return false;
    }
  }
  function tick() {
    if (serial !== titlePlayerLoadSerial || titleMediaMode !== 'player') { cleanup(); return; }
    if (updateCrop(!found)) return;
    if (!found && remoteLoadedAt && !autoReloadDone) {
      let ready='';
      try { ready=frame.contentDocument?.readyState || ''; } catch (_) {}
      const sinceLoad=Date.now()-remoteLoadedAt;
      const retryAfter=Math.max(300,Number(providerConfig.retryAfterMs)||DOM_PLAYER_AUTO_RELOAD_AFTER_MS);
      if ((ready==='complete' && sinceLoad>=retryAfter) || sinceLoad>=Math.max(DOM_PLAYER_AUTO_RELOAD_FORCE_MS,retryAfter+700)) {
        if (retrySameContext()) return;
      }
    }
    if (!found && Date.now()-startedAt>DOM_PLAYER_WAIT_MS) {
      cleanup();
      playerErrorMessage(stage,'Не знайдено вказаний DOM-фрагмент плеєра за 60 секунд навіть після автоматичного повторного завантаження.');
    }
  }
  function onFrameLoad() {
    if (serial !== titlePlayerLoadSerial || titleMediaMode !== 'player') return;
    let href='';
    try { href=frame.contentWindow?.location?.href || ''; } catch (_) {}
    if (!href || href==='about:blank') return;
    remoteLoadCount+=1;
    remoteLoadedAt=Date.now();
    retryInProgress=false;
    if (remoteLoadCount>1 && !found) setLoadingMessage('Шукаю плеєр після повторного завантаження…','Повторна навігація виконана в тому самому iframe-контексті.');
    setTimeout(tick,0);
    setTimeout(tick,250);
    setTimeout(tick,1000);
    setTimeout(tick,2500);
  }
  frame.addEventListener('load',onFrameLoad);
  monitorTimer=setInterval(tick,DOM_PLAYER_POLL_MS);
}
function loadDomTitlePlayer(stage, domain, pageUrl, serial) {
  const config=playerProviderConfig(domain), targetSpec=config.target;
  if (!targetSpec?.value) return playerErrorMessage(stage,`Для ${domain} не задано DOM-фрагмент плеєра.`);
  const nativeOrigin=domPlayerNativeOrigin(domain);
  const nativeSrc=domPlayerNativeUrl(domain,pageUrl);
  const fallbackSrc=`/api/player/view?site=${encodeURIComponent(domain)}&url=${encodeURIComponent(pageUrl)}`;
  const useNative=Boolean(nativeOrigin&&nativeSrc); // YORU 7.8.9: per-provider native preview origin
  const src=useNative?nativeSrc:fallbackSrc;
  stage.innerHTML=`
    <div class="player-loading" data-dom-player-loading><span class="detail-loader"></span><strong>Шукаю плеєр ${escapeHtml(domain)}…</strong><small>${useNative?'Native Universal DOM Viewer.':'Native preview-origin Universal DOM Viewer v32 mode.'}</small></div>
    <div class="dom-player-viewport is-loading" data-dom-player-viewport>
      <iframe class="dom-player-frame" data-dom-player-frame src="about:blank" scrolling="no" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="origin-when-cross-origin"></iframe>
    </div>`;
  const frame=stage.querySelector('[data-dom-player-frame]'), viewport=stage.querySelector('[data-dom-player-viewport]'), loading=stage.querySelector('[data-dom-player-loading]');
  if (!frame || !viewport) return playerErrorMessage(stage,'Не вдалося створити DOM-плеєр.');
  if (useNative) startNativeDomPlayerCrop(stage,frame,viewport,loading,serial,nativeOrigin,src,domain,config);
  else startDomPlayerCrop(stage,frame,viewport,loading,targetSpec,serial,src,domain);
  requestAnimationFrame(()=>{
    if (serial !== titlePlayerLoadSerial || titleMediaMode !== 'player') return;
    frame.src=src;
  });
}
function loadActiveTitlePlayer() {
  if (titleMediaMode !== 'player') return;
  stopDomTitlePlayer();
  const stage = root.querySelector('[data-player-stage]');
  if (!stage) return;
  const domain = ensurePlayerProvider();
  const link = currentPlayerLink(domain);
  if (!link) return playerErrorMessage(stage, `Для ${domain} немає посилання в базі.`);
  const serial = ++titlePlayerLoadSerial;
  mikaiPlayerData = null;
  if (domain === 'mikai.me') loadMikaiTitlePlayer(stage, link.url, serial);
  else loadDomTitlePlayer(stage, domain, link.url, serial);
}


function buildDropdown(kind, currentValue, options) {
  const valueText = escapeHtml(currentValue || (kind === 'status' ? 'Без статусу' : 'Без групи'));
  const groupStyle = kind === 'group' ? ` style="${groupTagStyle(currentValue)}"` : '';
  const currentClass = kind === 'status' ? `status-badge ${statusClass(currentValue)}` : 'group-pill colored-group-pill';
  const menuItems = options.map(option => {
    const selected = option === currentValue;
    const style = kind === 'group' ? ` style="${groupTagStyle(option)}"` : '';
    return `<button class="dropdown-option ${selected ? 'selected' : ''}" data-select-${kind}="${escapeHtml(option)}" data-option-search="${escapeHtml(option.toLocaleLowerCase('uk-UA'))}"><span class="${kind === 'status' ? `status-badge ${statusClass(option)}` : 'group-pill colored-group-pill'}"${style}>${escapeHtml(option)}</span></button>`;
  }).join('');
  const search = kind === 'group'
    ? `<div class="dropdown-search-wrap"><span>⌕</span><input class="dropdown-search-input" type="search" placeholder="Пошук групи…" data-group-search autocomplete="off" /></div>`
    : '';
  const extra = kind === 'group' ? `<button class="dropdown-option add-new sticky-add-group" data-add-group="true"><span class="group-pill">+ Нова група</span></button>` : '';
  return `
    <div class="control-block">
      <span class="control-label">${kind === 'status' ? 'Статус' : 'Група'}</span>
      <div class="control-dropdown" data-dropdown="${kind}">
        <button class="control-dropdown-btn" data-dropdown-trigger="${kind}" aria-expanded="false">
          <span class="${currentClass}"${groupStyle}>${valueText}</span>
          <span class="dropdown-caret">⌄</span>
        </button>
        <div class="control-dropdown-menu ${kind === 'group' ? 'group-dropdown-menu' : ''}">
          ${search}
          <div class="dropdown-options-scroll" data-dropdown-options>${menuItems}</div>
          ${extra}
        </div>
      </div>
    </div>`;
}

function buildLinksAccordion(linkGroups) {
  if (!linkGroups.length) return '<div class="source-empty">Посилань поки немає</div>';
  return linkGroups.map((group, groupIndex) => {
    const mark = getSourceMark(group.site);
    return `
    <section class="source-group ${groupIndex === 0 ? 'open' : ''} ${mark ? `marked-${mark}` : ''}" data-source-site="${escapeHtml(group.site)}">
      <div class="source-group-head">
        <button class="source-group-trigger" type="button" data-source-toggle aria-expanded="${groupIndex === 0 ? 'true' : 'false'}">
          <span class="source-group-info"><strong>${escapeHtml(group.site)}</strong><small>${group.items.length} посилань</small></span>
          <span class="source-group-caret">⌄</span>
        </button>
        <div class="source-group-tools">
          <button class="source-mark-btn source-mark-red ${mark === 'red' ? 'active' : ''}" type="button" data-source-mark="red" data-source-site="${escapeHtml(group.site)}" aria-label="Позначити червоним">${sourceMarkIcon('red')}</button>
          <button class="source-mark-btn source-mark-green ${mark === 'green' ? 'active' : ''}" type="button" data-source-mark="green" data-source-site="${escapeHtml(group.site)}" aria-label="Позначити зеленим">${sourceMarkIcon('green')}</button>
        </div>
      </div>
      <div class="source-group-body"><div class="source-group-list">
        ${group.items.map((link, index) => `
          <a class="source-btn source-entry" style="--entry-index:${index}" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
            <span>${escapeHtml(link.name || `Посилання ${index + 1}`)}</span><span class="source-arrow">↗</span>
          </a>`).join('')}
      </div></div>
    </section>`;
  }).join('');
}

function syncMarksFromItem(item) {
  if (!item?.id) return;
  if (item.favorite) favorite.add(item.id); else favorite.delete(item.id);
  if (item.liked) liked.add(item.id); else liked.delete(item.id);
  persistState();
}

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
  const text = String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, '')
    .trim();
  if (!text) return '';
  const key = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();
  return TAXONOMY_UK[key] || text;
}

function taxonomyAll(value) {
  if (Array.isArray(value)) return [...new Set(value.map(taxonomyUkName).filter(Boolean))];
  if (value && typeof value === 'object') {
    if (Array.isArray(value.all)) return [...new Set(value.all.map(taxonomyUkName).filter(Boolean))];
    const sourceRoot = value.sources && typeof value.sources === 'object' ? value.sources : value;
    return [...new Set(Object.values(sourceRoot).flatMap(v => Array.isArray(v) ? v : []).map(taxonomyUkName).filter(Boolean))];
  }
  return [];
}
function taxonomySourceNames(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const sourceRoot = value.sources && typeof value.sources === 'object' ? value.sources : value;
  const key = taxonomyUkName(name).toLocaleLowerCase('uk-UA');
  const labels = {'myanimelist.net':'MAL','shikimori.io':'Shikimori','anilist.co':'AniList'};
  return Object.entries(sourceRoot).filter(([,items]) => Array.isArray(items) && items.some(x => taxonomyUkName(x).toLocaleLowerCase('uk-UA') === key)).map(([site]) => labels[site] || site);
}
function taxonomyRow(label, value, kind) {
  const values = taxonomyAll(value);
  if (!values.length) return '';
  return `<div class="title-taxonomy-row title-taxonomy-${kind}"><span class="title-taxonomy-label">${escapeHtml(label)}</span><div class="title-taxonomy-chips">${values.map(name => { const sources = taxonomySourceNames(value, name); const tip = sources.length ? `Джерела: ${sources.join(' · ')}` : ''; return `<span class="title-taxonomy-chip" ${tip ? `title="${escapeHtml(tip)}"` : ''}>${escapeHtml(name)}</span>`; }).join('')}</div></div>`;
}

function setTitleTopActions(html = '') {
  if (!titleTopActions) return;
  titleTopActions.innerHTML = html;
}

function renderNormalTitleTopActions(item) {
  setTitleTopActions(`<a class="top-context-btn" href="index.html?similar=${encodeURIComponent(item.id)}">Схожі тайтли</a>`);
}

function aniHubPreviewCard(item) {
  const genres = Array.isArray(item.genres) ? item.genres : [];
  return `<section class="anihub-preview-hero" style="--preview-banner:url('${escapeHtml(item.banner || item.poster || '').replace(/'/g, '%27')}')">
    <div class="anihub-preview-backdrop"></div>
    <div class="anihub-preview-shell">
      <div class="anihub-preview-poster"><img src="${escapeHtml(item.poster || FALLBACK_IMAGE)}" alt="${escapeHtml(item.title || '')}" /></div>
      <div class="anihub-preview-copy">
        <span class="section-kicker">ANIHUB PREVIEW</span>
        <h1>${escapeHtml(item.title || 'Без назви')}</h1>
        ${item.originalTitle ? `<div class="anihub-preview-original">${escapeHtml(item.originalTitle)}</div>` : ''}
        <div class="anihub-preview-meta">${[item.year,item.type,item.episodes ? `${item.episodes} еп.` : '',item.rating ? `★ ${item.rating}` : ''].filter(Boolean).map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div>
        ${genres.length ? `<div class="anihub-preview-genres">${genres.slice(0,10).map(x=>`<span>${escapeHtml(typeof x==='string'?x:(x?.name||x?.title||''))}</span>`).join('')}</div>` : ''}
        <p>${escapeHtml(item.description || 'Опис відсутній.')}</p>
        ${item.sourceUrl ? `<a class="anihub-preview-source" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Відкрити на AniHub ↗</a>` : ''}
      </div>
    </div>
  </section>`;
}

async function selectAniHubPreview(item, button) {
  if (!item?.sourceUrl || !item?.title || button?.dataset.busy === '1') return;
  if (button) { button.dataset.busy = '1'; button.disabled = true; button.textContent = 'Додаю…'; }
  try {
    const response = await fetch('/api/process-title', { method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json'}, body:JSON.stringify({title:item.title,url:item.sourceUrl}), cache:'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload?.item?.id) throw new Error('Сайт не повернув id доданого тайтлу.');
    location.href = `title.html?id=${encodeURIComponent(payload.item.id)}`;
  } catch (error) {
    console.error(error); toastMessage(error.message || 'Не вдалося додати тайтл.');
    if (button) { button.dataset.busy = ''; button.disabled = false; button.textContent = 'Вибрати'; }
  }
}

async function loadAniHubPreview({ random = false, id = '' } = {}) {
  root.innerHTML = '<div class="not-found"><div class="detail-loader"></div><p>Отримую тайтл з AniHub…</p></div>';
  try {
    let endpoint;
    if (random) {
      const exclude = [...randomExcludeIds].join(',');
      endpoint = `/api/anihub/random${exclude ? `?exclude=${encodeURIComponent(exclude)}` : ''}`;
    } else endpoint = `/api/anihub/title?id=${encodeURIComponent(id)}`;
    const response = await fetch(endpoint, {headers:{Accept:'application/json'}, cache:'no-store'});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const item = payload.item;
    if (!item) throw new Error('AniHub не повернув тайтл.');
    if (item.anihubId) { randomExcludeIds.add(String(item.anihubId)); sessionStorage.setItem('yoru-random-exclude', JSON.stringify([...randomExcludeIds])); }
    document.title = `${item.title || 'AniHub'} — Yoru`;
    setTitleTopActions(`<button class="top-context-btn" type="button" data-random-next>Випадковий тайтл</button><button class="top-context-btn primary" type="button" data-random-select>Вибрати</button>`);
    root.innerHTML = aniHubPreviewCard(item);
    titleTopActions?.querySelector('[data-random-next]')?.addEventListener('click', () => loadAniHubPreview({random:true}));
    titleTopActions?.querySelector('[data-random-select]')?.addEventListener('click', e => selectAniHubPreview(item, e.currentTarget));
  } catch (error) {
    console.error(error);
    setTitleTopActions(`<button class="top-context-btn" type="button" data-random-next>Випадковий тайтл</button>`);
    titleTopActions?.querySelector('[data-random-next]')?.addEventListener('click', () => loadAniHubPreview({random:true}));
    renderNotFound(error.message || 'Не вдалося отримати тайтл AniHub.');
  }
}

function renderItem(item) {
  currentItem = item;
  renderNormalTitleTopActions(currentItem);
  syncMarksFromItem(currentItem);
  document.title = `${currentItem.title} — Yoru`;
  const linkGroups = groupLinks(currentItem.links || []);
  const totalLinks = linkGroups.reduce((sum, group) => sum + group.items.length, 0);
  const statusOptions = [...new Set([currentItem.status || 'Без статусу', ...(apiOptions.statuses || []), ...STATUS_OPTIONS])];
  const groupOptions = configuredGroupsForStatus(currentItem.status || 'Без статусу', currentItem.group || 'Без групи');
  const missingMedia = [
    !currentItem.hasPoster ? '<button class="media-repair-btn" data-media-kind="poster">＋ Додати постер</button>' : '',
    !currentItem.hasBanner ? '<button class="media-repair-btn" data-media-kind="banner">＋ Додати банер</button>' : '',
  ].filter(Boolean).join('');

  const theme = statusTheme(currentItem.status || 'Без статусу');
  const useTrailerBackground = trailerBackgroundEnabled() && currentItem.hasTrailer;
  root.innerHTML = `
    <section class="title-hero ${useTrailerBackground ? 'trailer-active' : ''}">
      ${trailerBackgroundHtml(currentItem)}
      ${useTrailerBackground ? '' : '<div class="banner-bg"></div>'}
      <div class="banner-vignette"></div>
      <div class="title-shell">
        <div class="title-side reveal">
          <div class="title-control-stack">
            ${buildDropdown('status', currentItem.status || 'Без статусу', statusOptions)}
            ${buildDropdown('group', currentItem.group || 'Без групи', groupOptions)}
            <div class="detail-actions detail-actions-vertical">
              <button class="detail-action ${favorite.has(currentItem.id) ? 'active' : ''}" data-toggle="favorite">${icon('favorite', favorite.has(currentItem.id))}<span>Вибране</span></button>
              <button class="detail-action ${liked.has(currentItem.id) ? 'active liked' : ''}" data-toggle="liked">${icon('liked', liked.has(currentItem.id))}<span>Улюблене</span></button>
              <button class="detail-action viewed-action" data-viewed-increment title="Додати один перегляд"><b>＋1</b><span>Переглянуто</span><strong>${Number(currentItem.viewed || 0)}</strong></button>
            </div>
            ${missingMedia ? `<div class="media-repair-actions">${missingMedia}</div>` : ''}
          </div>
          <div class="title-poster-wrap reveal delay-1 ${currentItem.hasPoster ? '' : 'poster-missing'}" style="--status-accent:${theme.solid}; --status-accent-glow:${theme.glow}; --status-accent-border:${theme.border}">
            <img class="title-poster" src="${escapeHtml(currentItem.poster || FALLBACK_IMAGE)}" alt="${escapeHtml(currentItem.title)}" />
            ${!currentItem.hasPoster ? '<button class="poster-add-overlay" data-media-kind="poster">＋ Постер</button>' : ''}
          </div>
          ${watchProgressPanel(currentItem)}
        </div>

        <div class="title-info reveal delay-1">
          <h1>${escapeHtml(currentItem.title)}</h1>
          <div class="title-taxonomy">
            ${taxonomyRow('ЖАНРИ', currentItem.genres, 'genres')}
            ${taxonomyRow('ТЕМИ', currentItem.themes, 'themes')}
          </div>
          <div class="title-tags" aria-label="Теги тайтлу">
            ${(Array.isArray(currentItem.tags) ? currentItem.tags : []).map(tag => `<button class="title-tag" type="button" data-remove-tag="${escapeHtml(tag)}" title="Видалити тег">#${escapeHtml(tag)}<span>×</span></button>`).join('')}
            <button class="title-tag title-tag-add" type="button" data-add-tag>＋ #Тег</button>
            <div class="title-tag-entry hidden" data-tag-entry-box>
              <input type="text" data-tag-entry-input placeholder="Анонс. Круто. Наступний сезон." autocomplete="off" />
              <button type="button" data-tag-entry-save>Додати</button>
              <div class="tag-suggestion-popover hidden" data-tag-entry-suggestions></div>
            </div>
          </div>
          <div class="title-text-grid">
            <section class="title-description-card">
              <span class="section-kicker">ОПИС</span>
              <p class="title-description">${escapeHtml(currentItem.description || 'Опис поки відсутній.')}</p>
            </section>
            <aside class="title-notes-card">
              <div class="title-notes-head"><div><span class="section-kicker">НОТАТКИ</span><h3>Мої нотатки</h3></div><button class="notes-save-btn" type="button" data-notes-save>Зберегти</button></div>
              <textarea class="title-notes-input" data-notes-input placeholder="Запиши свої нотатки про тайтл…">${escapeHtml(currentItem.notes || '')}</textarea>
            </aside>
          </div>
        </div>
      </div>
    </section>

    <section class="detail-links title-shell reveal delay-2">
      ${buildMediaWorkspace(linkGroups)}
      <div class="title-record-actions">
        <button class="record-action-btn refresh-record-btn" type="button" data-refresh-title ${totalLinks ? '' : 'disabled'} title="Взяти перше джерело зі списку, повторно прогнати його через Core і доповнити відсутні дані">
          <span>Оновити картку тайтла</span><b>↻</b>
        </button>
        <a class="record-action-btn merge-record-btn" href="index.html?merge=${encodeURIComponent(currentItem.id)}">
          <span>Об’єднати</span><b>⇄</b>
        </a>
        <button class="record-action-btn edit-record-btn" type="button" data-edit-title>
          <span>Редагувати</span><b>✎</b>
        </button>
        <button class="record-action-btn delete-record-btn" type="button" data-delete-title>
          <span>Видалити</span><b>×</b>
        </button>
      </div>
    </section>`;

  const banner = safeHttpUrl(currentItem.banner || currentItem.poster || '');
  const bannerNode = root.querySelector('.banner-bg');
  if (banner && bannerNode) bannerNode.style.backgroundImage = `url("${banner.replace(/["\\]/g, '\\$&')}")`;
  if (titleMediaMode === 'player') queueMicrotask(loadActiveTitlePlayer);
}

async function patchCurrent(changes, successText) {
  const response = await fetch(`/api/anime?id=${encodeURIComponent(currentItem.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(changes),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  if (payload.options) apiOptions = payload.options;
  if (payload.item) currentItem = payload.item;
  renderItem(currentItem);
  if (successText) toastMessage(successText);
  return currentItem;
}

function firstDisplayedSourceLink() {
  const groups = groupLinks(currentItem?.links || []);
  const first = groups[0]?.items?.[0];
  if (!first?.url) return null;
  return { name: String(first.name || groups[0]?.site || '').trim() || groups[0]?.site || 'Джерело', url: first.url };
}

async function refreshTitleCard(button) {
  if (!currentItem || !button || button.dataset.busy === '1') return;
  const source = firstDisplayedSourceLink();
  if (!source) {
    toastMessage('Немає посилання, з якого можна оновити картку');
    return;
  }
  const label = button.querySelector('span');
  const oldText = label?.textContent || 'Оновити картку тайтла';
  button.dataset.busy = '1';
  button.disabled = true;
  if (label) label.textContent = 'Оновлюю картку…';
  try {
    const response = await fetch(`/api/anime/refresh?id=${encodeURIComponent(currentItem.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title: source.name, url: source.url }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.options) apiOptions = payload.options;
    if (payload.item) currentItem = payload.item;
    const filled = Array.isArray(payload.filled) ? payload.filled : [];
    renderItem(currentItem);
    toastMessage(filled.length ? `Картку оновлено: ${filled.join(', ')}` : 'Нових відсутніх даних Core не знайшов');
  } catch (error) {
    console.error(error);
    button.disabled = false;
    delete button.dataset.busy;
    if (label) label.textContent = oldText;
    toastMessage(error.message || 'Не вдалося оновити картку');
  }
}

function closeDropdowns() {
  root.querySelectorAll('[data-dropdown].open').forEach(el => {
    el.classList.remove('open');
    el.querySelector('[data-dropdown-trigger]')?.setAttribute('aria-expanded', 'false');
  });
}

function ensureMediaModal() {
  let modal = document.getElementById('mediaModal');
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="mediaModal" class="modal-shell hidden" aria-hidden="true">
      <div class="modal-backdrop" data-media-close></div>
      <section class="modal-card media-picker" role="dialog" aria-modal="true">
        <button class="modal-x" type="button" data-media-close aria-label="Закрити">×</button>
        <div class="modal-head"><span class="section-kicker">МЕДІА</span><h2 id="mediaModalTitle">Додати зображення</h2><p>Знайду AniList-варіанти за назвою тайтлу. Якщо потрібного зображення там немає — встав URL вручну.</p></div>
        <div id="mediaPickerStatus" class="discover-status"></div>
        <div id="mediaPickerResults" class="media-picker-results"></div>
        <form id="manualMediaForm" class="manual-media-form">
          <label>URL зображення<input id="manualMediaUrl" type="url" placeholder="https://..." /></label>
          <button class="primary-btn" type="submit">Зберегти URL</button>
        </form>
      </section>
    </div>`);
  modal = document.getElementById('mediaModal');
  modal.addEventListener('click', e => { if (e.target.closest('[data-media-close]')) closeMediaModal(); });
  modal.querySelector('#manualMediaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const value = modal.querySelector('#manualMediaUrl').value.trim();
    if (value) await applyMediaUrl(value);
  });
  return modal;
}

function closeMediaModal() {
  const modal = document.getElementById('mediaModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  mediaKind = null;
}

function simplifyBrowserAniList(media) {
  return {
    id: media?.id ?? null,
    idMal: media?.idMal || null,
    provider: 'anilist',
    providerId: media?.id || null,
    title: media?.title || {},
    originalTitle: media?.title?.native || media?.title?.romaji || media?.title?.english || '',
    romanizedTitle: media?.title?.romaji || media?.title?.english || media?.title?.native || '',
    synonyms: Array.isArray(media?.synonyms) ? media.synonyms : [],
    year: media?.seasonYear || null,
    format: media?.format || '',
    episodes: media?.episodes || null,
    poster: media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium || '',
    banner: media?.bannerImage || '',
    color: media?.coverImage?.color || '',
    siteUrl: media?.siteUrl || '',
    description: media?.description || '',
    countryOfOrigin: media?.countryOfOrigin || '',
  };
}

async function searchAniListInBrowser(queryText) {
  const query = `
    query ($search: String!) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: ANIME) {
          id idMal siteUrl format seasonYear episodes bannerImage description(asHtml:false) countryOfOrigin
          coverImage { extraLarge large medium color }
          title { romaji english native }
          synonyms
        }
      }
    }`;
  const response = await fetch(ANILIST_PUBLIC_ENDPOINT, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { search: queryText } }),
  });
  if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);
  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length) throw new Error(payload.errors.map(x => x?.message).filter(Boolean).join('; ') || 'AniList GraphQL error');
  return (Array.isArray(payload?.data?.Page?.media) ? payload.data.Page.media : []).map(simplifyBrowserAniList);
}

async function searchAnimeDiscovery(queryText) {
  try {
    const items = await searchAniListInBrowser(queryText);
    if (items.length) return { items, provider: 'anilist-browser', fallback: false };
  } catch {}
  const response = await fetch(`/api/discover?q=${encodeURIComponent(queryText)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function mediaCandidateTitle(item) {
  return item?.title?.english || item?.title?.romaji || item?.title?.native || 'Без назви';
}

function mediaNativeTitle(item) {
  return item?.title?.native || item?.originalTitle || item?.title?.romaji || item?.title?.english || '';
}


async function openMediaPicker(kind) {
  mediaKind = kind;
  const modal = ensureMediaModal();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  modal.querySelector('#mediaModalTitle').textContent = kind === 'poster' ? 'Додати постер' : 'Додати банер';
  modal.querySelector('#manualMediaUrl').value = '';
  const status = modal.querySelector('#mediaPickerStatus');
  const resultsBox = modal.querySelector('#mediaPickerResults');
  status.textContent = 'Шукаю в AniList…';
  status.className = 'discover-status loading';
  resultsBox.innerHTML = '<div class="discover-loading"><span class="detail-loader"></span><span>Пошук зображень…</span></div>';
  try {
    const q = currentItem.originalTitle || currentItem.title;
    const payload = await searchAnimeDiscovery(q);
    const items = Array.isArray(payload.items) ? payload.items : [];
    status.textContent = items.length
      ? `Знайдено ${items.length} варіантів${payload.provider === 'jikan' ? ' через резервний Jikan' : ''}.`
      : 'Зображень не знайдено — можна вставити URL вручну.';
    status.className = `discover-status ${items.length ? 'ok' : ''}`;
    resultsBox.innerHTML = items.map(item => {
      const image = kind === 'poster' ? item.poster : item.banner;
      const preview = image || item.poster || FALLBACK_IMAGE;
      return `
        <article class="media-candidate ${image ? '' : 'unavailable'}">
          <img src="${escapeHtml(preview)}" alt="${escapeHtml(mediaCandidateTitle(item))}" />
          <div><strong>${escapeHtml(mediaCandidateTitle(item))}</strong><small>${escapeHtml(mediaNativeTitle(item) || '')}${item.year ? ` · ${item.year}` : ''}</small></div>
          <button class="${image ? 'primary-btn' : 'ghost-btn'}" type="button" ${image ? `data-media-url="${escapeHtml(image)}"` : 'disabled'}>${image ? 'Використати' : kind === 'banner' ? 'Без банера' : 'Без постера'}</button>
        </article>`;
    }).join('') || '<div class="discover-empty">Результатів немає.</div>';
    resultsBox.querySelectorAll('[data-media-url]').forEach(btn => btn.addEventListener('click', () => applyMediaUrl(btn.dataset.mediaUrl)));
  } catch (error) {
    status.textContent = error.message || 'Помилка пошуку.';
    status.className = 'discover-status error';
    resultsBox.innerHTML = '';
  }
}

async function applyMediaUrl(url) {
  const modal = ensureMediaModal();
  const status = modal.querySelector('#mediaPickerStatus');
  status.textContent = 'Зберігаю у Turso…';
  status.className = 'discover-status loading';
  try {
    await patchCurrent(mediaKind === 'poster' ? { posterUrl: url } : { bannerUrl: url }, mediaKind === 'poster' ? 'Постер додано' : 'Банер додано');
    closeMediaModal();
  } catch (error) {
    status.textContent = error.message || 'Не вдалося зберегти зображення.';
    status.className = 'discover-status error';
  }
}



function currentLinksByDomain() {
  const out = Object.fromEntries(EDIT_CATALOG_DOMAINS.map(domain => [domain, []]));
  for (const link of currentItem?.links || []) {
    const url = safeHttpUrl(link.url || '');
    if (!url) continue;
    const domain = canonicalCatalogDomain(url);
    if (!out[domain]) out[domain] = [];
    out[domain].push({ title: link.name || link.title || catalogLabel(domain), url });
  }
  for (const domain of Object.keys(out)) {
    const seen = new Set();
    out[domain] = out[domain].filter(item => {
      const url = safeHttpUrl(item.url || '');
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  }
  return out;
}

function sortedEditCatalogs() {
  return [...EDIT_CATALOG_DOMAINS].sort((a, b) => {
    const la = catalogLabel(a);
    const lb = catalogLabel(b);
    return sourceMarkRank(la) - sourceMarkRank(lb) || la.localeCompare(lb, 'uk');
  });
}

function editLinkInputRow(domain, item, index) {
  return `
    <div class="edit-link-input-row" data-edit-link-row data-domain="${escapeHtml(domain)}" data-index="${index}">
      <input type="text" data-edit-link-title value="${escapeHtml(item?.title || '')}" placeholder="Назва кнопки" />
      <input type="url" data-edit-link-url value="${escapeHtml(item?.url || '')}" placeholder="https://..." />
      <button type="button" class="edit-link-remove" data-edit-link-remove aria-label="Видалити посилання">×</button>
    </div>`;
}

function renderEditLinks() {
  const modal = document.getElementById('editTitleModal');
  const rootBox = modal?.querySelector('#editCatalogsRoot');
  if (!rootBox) return;
  const domains = sortedEditCatalogs();
  rootBox.innerHTML = domains.map((domain, index) => {
    const site = catalogLabel(domain);
    const mark = getSourceMark(site);
    const items = Array.isArray(editSiteLinks[domain]) ? editSiteLinks[domain] : [];
    const isOpen = items.length > 0 && index < 5;
    return `
      <section class="source-group edit-catalog-group ${isOpen ? 'open' : ''} ${mark ? `marked-${mark}` : ''}" data-edit-catalog="${escapeHtml(domain)}">
        <div class="source-group-head">
          <button class="source-group-trigger" type="button" data-edit-catalog-toggle aria-expanded="${isOpen ? 'true' : 'false'}">
            <span class="source-group-info"><strong>${escapeHtml(site)}</strong><small>${items.length} посилань</small></span>
            <span class="source-group-caret">⌄</span>
          </button>
          <div class="source-group-tools">
            <span class="edit-catalog-domain">${escapeHtml(domain)}</span>
          </div>
        </div>
        <div class="source-group-body"><div class="source-group-list edit-link-list">
          ${items.map((item, rowIndex) => editLinkInputRow(domain, item, rowIndex)).join('')}
          <button class="edit-add-link-btn" type="button" data-edit-add-link data-domain="${escapeHtml(domain)}">＋ Додати посилання</button>
        </div></div>
      </section>`;
  }).join('');
}

function existingValueCard(label, value, extra = '') {
  return `<div class="edit-existing-card"><span>${escapeHtml(label)}</span>${extra || `<strong>${escapeHtml(value || '—')}</strong>`}</div>`;
}

function ensureEditModal() {
  let modal = document.getElementById('editTitleModal');
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="editTitleModal" class="modal-shell edit-title-shell hidden" aria-hidden="true">
      <div class="modal-backdrop" data-edit-close></div>
      <section class="edit-title-modal" role="dialog" aria-modal="true" aria-label="Редагування тайтлу">
        <header class="edit-title-header">
          <div><span class="section-kicker">РЕДАГУВАННЯ</span><h2>Редагування тайтлу</h2><p>Зліва — нові значення. Справа — поточні дані з Turso.</p></div>
          <div class="edit-header-actions"><button class="ghost-btn" type="button" data-edit-close>Скасувати</button><button class="primary-btn" type="button" data-edit-save>Зберегти</button></div>
        </header>
        <div id="editTitleStatus" class="discover-status"></div>
        <div class="edit-title-columns">
          <form id="editTitleForm" class="edit-input-pane" autocomplete="off">
            <h3>Нові дані</h3>
            <label class="edit-field"><span>Назва</span><input id="editTitleValue" type="text" /></label>
            <label class="edit-field"><span>Оригінальна назва</span><input id="editOriginalValue" type="text" /></label>
            <label class="edit-field"><span>Англійська назва</span><input id="editEnglishValue" type="text" /></label>
            <label class="edit-field"><span>Російська назва</span><input id="editRussianValue" type="text" /></label>
            <label class="edit-field"><span>Аліаси</span><textarea id="editAliasesValue" rows="5"></textarea></label>
            <label class="edit-field edit-tag-field"><span>#Тег</span><input id="editTagsValue" type="text" placeholder="Анонс. Круто. Наступний сезон." autocomplete="off" /><div class="tag-suggestion-popover edit-tag-suggestions hidden" id="editTagSuggestions"></div></label>
            <div class="edit-two-cols">
              <label class="edit-field"><span>Статус</span><input id="editStatusValue" type="text" /></label>
              <label class="edit-field"><span>Група</span><input id="editGroupValue" type="text" /></label>
            </div>
            <div class="edit-suggestion-row" id="editStatusSuggestions"></div>
            <div class="edit-suggestion-row edit-group-suggestions" id="editGroupSuggestions"></div>
            <label class="edit-field"><span>Опис</span><textarea id="editDescriptionValue" rows="9"></textarea></label>
            <label class="edit-field"><span>Нотатки</span><textarea id="editNotesValue" rows="6" placeholder="Особисті нотатки"></textarea></label>
            <div class="edit-media-field">
              <span>Постер — посилання на зображення</span>
              <input id="editPosterUrl" type="url" placeholder="https://example.com/poster.jpg" />
              <small>Встав пряме http/https посилання. Якщо поле порожнє — поточний постер не зміниться.</small>
            </div>
            <div class="edit-media-field">
              <span>Банер — посилання на зображення</span>
              <input id="editBannerUrl" type="url" placeholder="https://example.com/banner.jpg" />
              <small>Встав пряме http/https посилання. Якщо поле порожнє — поточний банер не зміниться.</small>
            </div>
            <div class="edit-media-field">
              <span>Трейлер — YouTube / Dailymotion / embed URL</span>
              <input id="editTrailerUrl" type="url" placeholder="https://www.youtube.com/watch?v=..." />
              <small>Поточне значення підставляється автоматично. Очисти поле, щоб прибрати трейлер із тайтлу.</small>
            </div>
            <div class="edit-flags">
              <label><input id="editFavoriteValue" type="checkbox" /><span>Вибране</span></label>
              <label><input id="editLikedValue" type="checkbox" /><span>Улюблене</span></label>
            </div>
          </form>
          <aside class="edit-existing-pane">
            <h3>Існуючі дані</h3>
            <div id="editExistingCards"></div>
          </aside>
        </div>
        <section class="edit-links-panel">
          <div class="edit-links-head"><div><span class="section-kicker">ПОСИЛАННЯ</span><h3>Каталоги та посилання</h3></div><p>Порядок: зелені → без кольору → червоні. Показані всі доступні каталоги, навіть якщо в них 0 посилань.</p></div>
          <div id="editCatalogsRoot" class="source-groups edit-catalogs-root"></div>
        </section>
        <footer class="edit-title-footer"><button class="ghost-btn" type="button" data-edit-close>Скасувати</button><button class="primary-btn" type="button" data-edit-save>Зберегти зміни</button></footer>
      </section>
    </div>`);
  modal = document.getElementById('editTitleModal');

  modal.addEventListener('click', async event => {
    if (event.target.closest('[data-edit-close]')) { closeEditModal(); return; }
    if (event.target.closest('[data-edit-save]')) { await saveEditModal(); return; }
    const toggle = event.target.closest('[data-edit-catalog-toggle]');
    if (toggle) {
      const group = toggle.closest('.edit-catalog-group');
      const next = !group.classList.contains('open');
      group.classList.toggle('open', next);
      toggle.setAttribute('aria-expanded', String(next));
      return;
    }
    const add = event.target.closest('[data-edit-add-link]');
    if (add) {
      const domain = add.dataset.domain;
      editSiteLinks[domain] ||= [];
      editSiteLinks[domain].push({ title: '', url: '' });
      renderEditLinks();
      const target = document.querySelector(`[data-edit-catalog="${CSS.escape(domain)}"]`);
      target?.classList.add('open');
      target?.querySelector('[data-edit-catalog-toggle]')?.setAttribute('aria-expanded', 'true');
      return;
    }
    const remove = event.target.closest('[data-edit-link-remove]');
    if (remove) {
      const row = remove.closest('[data-edit-link-row]');
      const domain = row?.dataset.domain;
      const index = Number(row?.dataset.index);
      if (domain && Number.isInteger(index)) editSiteLinks[domain]?.splice(index, 1);
      renderEditLinks();
      return;
    }
    const tagSuggestion = event.target.closest('[data-tag-suggestion]');
    if (tagSuggestion) {
      const input = modal.querySelector('#editTagsValue');
      if (input) input.value = applyTagSuggestionToValue(input.value, tagSuggestion.dataset.tagSuggestion || '');
      renderEditTagSuggestions(modal);
      input?.focus();
      return;
    }
    const suggestion = event.target.closest('[data-edit-set]');
    if (suggestion) {
      const target = modal.querySelector(`#${suggestion.dataset.editTarget}`);
      if (target) target.value = suggestion.dataset.editSet;
      if (suggestion.dataset.editTarget === 'editStatusValue') renderEditGroupSuggestions(modal);
    }
  });

  modal.addEventListener('input', event => {
    if (event.target.id === 'editTagsValue') renderEditTagSuggestions(modal);
    if (event.target.id === 'editStatusValue') renderEditGroupSuggestions(modal);
    const row = event.target.closest('[data-edit-link-row]');
    if (row) {
      const domain = row.dataset.domain;
      const index = Number(row.dataset.index);
      const item = editSiteLinks[domain]?.[index];
      if (item) {
        if (event.target.matches('[data-edit-link-title]')) item.title = event.target.value;
        if (event.target.matches('[data-edit-link-url]')) item.url = event.target.value;
      }
    }
  });
  return modal;
}

function renderEditGroupSuggestions(modal) {
  if (!modal) return;
  const status = modal.querySelector('#editStatusValue')?.value.trim() || currentItem?.status || 'Без статусу';
  const currentGroup = modal.querySelector('#editGroupValue')?.value.trim() || currentItem?.group || 'Без групи';
  const groups = configuredGroupsForStatus(status, currentGroup);
  const root = modal.querySelector('#editGroupSuggestions');
  if (root) root.innerHTML = groups.map(value => `<button type="button" class="edit-group-suggestion" style="${groupTagStyle(value)}" data-edit-set="${escapeHtml(value)}" data-edit-target="editGroupValue">${escapeHtml(value)}</button>`).join('');
}

function renderEditTagSuggestions(modal) {
  if (!modal) return;
  const input = modal.querySelector('#editTagsValue');
  const root = modal.querySelector('#editTagSuggestions');
  if (!input || !root) return;
  const selected = parseTagsInput(input.value);
  const suggestions = matchingTagSuggestions(input.value, selected);
  root.innerHTML = suggestions.map(tag => `<button type="button" data-tag-suggestion="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
  root.classList.toggle('hidden', !suggestions.length || document.activeElement !== input);
}

function renderTitleTagSuggestions() {
  const box = root.querySelector('[data-tag-entry-box]');
  const input = root.querySelector('[data-tag-entry-input]');
  const list = root.querySelector('[data-tag-entry-suggestions]');
  if (!box || !input || !list || box.classList.contains('hidden')) return;
  const current = Array.isArray(currentItem?.tags) ? currentItem.tags : [];
  const suggestions = matchingTagSuggestions(input.value, current);
  list.innerHTML = suggestions.map(tag => `<button type="button" data-tag-suggestion="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
  list.classList.toggle('hidden', !suggestions.length);
}

function openEditModal() {
  if (!currentItem) return;
  const modal = ensureEditModal();
  editSiteLinks = currentLinksByDomain();
  modal.querySelector('#editTitleValue').value = currentItem.title || '';
  modal.querySelector('#editOriginalValue').value = currentItem.originalTitle || '';
  modal.querySelector('#editEnglishValue').value = currentItem.englishTitle || '';
  modal.querySelector('#editRussianValue').value = currentItem.russianTitle || '';
  modal.querySelector('#editAliasesValue').value = currentItem.aliases || '';
  modal.querySelector('#editTagsValue').value = formatTagsInput(Array.isArray(currentItem.tags) ? currentItem.tags : []);
  modal.querySelector('#editStatusValue').value = currentItem.status || 'Без статусу';
  modal.querySelector('#editGroupValue').value = currentItem.group || 'Без групи';
  modal.querySelector('#editDescriptionValue').value = currentItem.description || '';
  modal.querySelector('#editNotesValue').value = currentItem.notes || '';
  modal.querySelector('#editPosterUrl').value = '';
  modal.querySelector('#editBannerUrl').value = '';
  modal.querySelector('#editTrailerUrl').value = currentItem.trailer?.url || currentItem.trailer?.embedUrl || '';
  modal.querySelector('#editFavoriteValue').checked = favorite.has(currentItem.id);
  modal.querySelector('#editLikedValue').checked = liked.has(currentItem.id);
  modal.querySelector('#editTitleStatus').textContent = '';
  modal.querySelector('#editTitleStatus').className = 'discover-status';

  modal.querySelector('#editStatusSuggestions').innerHTML = [...new Set([...(apiOptions.statuses || []), ...STATUS_OPTIONS])]
    .map(value => `<button type="button" data-edit-set="${escapeHtml(value)}" data-edit-target="editStatusValue">${escapeHtml(value)}</button>`).join('');
  renderEditGroupSuggestions(modal);
  renderEditTagSuggestions(modal);

  const descPreview = (currentItem.description || '').slice(0, 420);
  modal.querySelector('#editExistingCards').innerHTML = [
    existingValueCard('Назва', currentItem.title),
    existingValueCard('Оригінальна назва', currentItem.originalTitle),
    existingValueCard('Англійська назва', currentItem.englishTitle),
    existingValueCard('Російська назва', currentItem.russianTitle),
    existingValueCard('Аліаси', currentItem.aliases),
    existingValueCard('#Тег', (Array.isArray(currentItem.tags) ? currentItem.tags.map(tag => `#${tag}`).join(' ') : '')),
    existingValueCard('Статус', currentItem.status),
    existingValueCard('Група', currentItem.group),
    existingValueCard('Постер', '', currentItem.poster ? `<img class="edit-existing-image poster" src="${escapeHtml(currentItem.poster)}" alt="" />` : '<strong>—</strong>'),
    existingValueCard('Банер', '', currentItem.hasBanner && currentItem.banner ? `<img class="edit-existing-image banner" src="${escapeHtml(currentItem.banner)}" alt="" />` : '<strong>—</strong>'),
    existingValueCard('Трейлер', '', currentItem.hasTrailer ? `${currentItem.trailer?.thumbnail ? `<img class="edit-existing-image banner trailer-thumb" src="${escapeHtml(currentItem.trailer.thumbnail)}" alt="" />` : ''}<a class="edit-existing-link" href="${escapeHtml(currentItem.trailer?.url || currentItem.trailer?.embedUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(currentItem.trailer?.site || 'Відкрити трейлер')} ↗</a>` : '<strong>—</strong>'),
    existingValueCard('Опис', descPreview || '—'),
    existingValueCard('Нотатки', (currentItem.notes || '').slice(0, 300) || '—'),
    existingValueCard('Позначення', `${favorite.has(currentItem.id) ? 'Вибране · ' : ''}${liked.has(currentItem.id) ? 'Улюблене' : ''}` || '—'),
  ].join('');
  renderEditLinks();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeEditModal() {
  const modal = document.getElementById('editTitleModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

async function saveEditModal() {
  const modal = ensureEditModal();
  const statusBox = modal.querySelector('#editTitleStatus');
  const saveButtons = [...modal.querySelectorAll('[data-edit-save]')];
  saveButtons.forEach(btn => { btn.disabled = true; });
  statusBox.textContent = 'Зберігаю зміни у Turso…';
  statusBox.className = 'discover-status loading';
  try {
    const payload = {
      title: modal.querySelector('#editTitleValue').value.trim(),
      originalTitle: modal.querySelector('#editOriginalValue').value.trim(),
      englishTitle: modal.querySelector('#editEnglishValue').value.trim(),
      russianTitle: modal.querySelector('#editRussianValue').value.trim(),
      aliases: modal.querySelector('#editAliasesValue').value.trim(),
      tags: parseTagsInput(modal.querySelector('#editTagsValue').value),
      status: modal.querySelector('#editStatusValue').value.trim() || 'Без статусу',
      group: modal.querySelector('#editGroupValue').value.trim() || 'Без групи',
      description: modal.querySelector('#editDescriptionValue').value,
      notes: modal.querySelector('#editNotesValue').value,
      favorite: modal.querySelector('#editFavoriteValue').checked,
      liked: modal.querySelector('#editLikedValue').checked,
      siteLinks: editSiteLinks,
    };
    const posterUrl = modal.querySelector('#editPosterUrl').value.trim();
    const bannerUrl = modal.querySelector('#editBannerUrl').value.trim();
    const trailerUrl = modal.querySelector('#editTrailerUrl').value.trim();
    if (posterUrl) payload.posterUrl = posterUrl;
    if (bannerUrl) payload.bannerUrl = bannerUrl;
    payload.trailerUrl = trailerUrl;

    const response = await fetch(`/api/anime?id=${encodeURIComponent(currentItem.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const savedPayload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(savedPayload.error || `HTTP ${response.status}`);
    if (savedPayload.options) apiOptions = savedPayload.options;
    if (savedPayload.item) currentItem = savedPayload.item;

    if (payload.favorite) favorite.add(currentItem.id); else favorite.delete(currentItem.id);
    if (payload.liked) liked.add(currentItem.id); else liked.delete(currentItem.id);
    persistState();
    statusBox.textContent = 'Зміни збережено.';
    statusBox.className = 'discover-status ok';
    renderItem(currentItem);
    setTimeout(closeEditModal, 350);
  } catch (error) {
    console.error(error);
    statusBox.textContent = error.message || 'Не вдалося зберегти зміни.';
    statusBox.className = 'discover-status error';
  } finally {
    saveButtons.forEach(btn => { btn.disabled = false; });
  }
}

function ensureDeleteModal() {
  let modal = document.getElementById('deleteTitleModal');
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="deleteTitleModal" class="modal-shell hidden" aria-hidden="true">
      <div class="modal-backdrop" data-delete-close></div>
      <section class="modal-card delete-title-modal" role="dialog" aria-modal="true">
        <button class="modal-x" type="button" data-delete-close aria-label="Закрити">×</button>
        <div class="modal-head">
          <span class="section-kicker danger-kicker">ВИДАЛЕННЯ</span>
          <h2>Видалити тайтл?</h2>
          <p>Тайтл буде прибрано з каталогу разом з усіма його даними.</p>
        </div>
        <div class="delete-title-preview" id="deleteTitlePreview"></div>
        <div class="delete-title-actions">
          <button class="ghost-btn" type="button" data-delete-close>Скасувати</button>
          <button class="danger-btn" type="button" data-delete-confirm>Видалити</button>
        </div>
      </section>
    </div>`);
  modal = document.getElementById('deleteTitleModal');
  modal.addEventListener('click', async event => {
    if (event.target.closest('[data-delete-close]')) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      return;
    }
    const confirmBtn = event.target.closest('[data-delete-confirm]');
    if (!confirmBtn || !currentItem) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Видаляю…';
    try {
      const response = await fetch(`/api/anime?id=${encodeURIComponent(currentItem.id)}`, { method: 'DELETE', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      favorite.delete(currentItem.id);
      liked.delete(currentItem.id);
      persistState();
      location.href = 'index.html';
    } catch (error) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Видалити';
      toastMessage(error.message || 'Не вдалося видалити тайтл.');
    }
  });
  return modal;
}

function openDeleteModal() {
  if (!currentItem) return;
  const modal = ensureDeleteModal();
  const preview = modal.querySelector('#deleteTitlePreview');
  preview.innerHTML = `
    <img src="${escapeHtml(currentItem.poster || FALLBACK_IMAGE)}" alt="${escapeHtml(currentItem.title)}" />
    <div><strong>${escapeHtml(currentItem.title)}</strong><small>${escapeHtml(currentItem.status || 'Без статусу')} · ${escapeHtml(currentItem.group || 'Без групи')}</small></div>`;
  const button = modal.querySelector('[data-delete-confirm]');
  button.disabled = false;
  button.textContent = 'Видалити';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

root.addEventListener('change', async e => {
  const seasonSelect = e.target.closest('[data-player-season]');
  if (seasonSelect) {
    setPlayerSeason(titlePlayerProvider, Number(seasonSelect.value) || 0);
    mikaiPlayerData = null;
    mikaiPlayerSelection = { release:0, episode:0, source:0 };
    renderActivePlayerPanel();
    return;
  }
  const mikaiRelease = e.target.closest('[data-mikai-release]');
  if (mikaiRelease) {
    mikaiPlayerSelection.release = Number(mikaiRelease.value) || 0;
    mikaiPlayerSelection.episode = 0; mikaiPlayerSelection.source = 0;
    renderMikaiPlayerStage(root.querySelector('[data-player-stage]'));
    return;
  }
  const mikaiEpisode = e.target.closest('[data-mikai-episode]');
  if (mikaiEpisode) {
    mikaiPlayerSelection.episode = Number(mikaiEpisode.value) || 0;
    mikaiPlayerSelection.source = 0;
    renderMikaiPlayerStage(root.querySelector('[data-player-stage]'));
    return;
  }
  const mikaiSource = e.target.closest('[data-mikai-source]');
  if (mikaiSource) {
    mikaiPlayerSelection.source = Number(mikaiSource.value) || 0;
    renderMikaiPlayerStage(root.querySelector('[data-player-stage]'));
    return;
  }
  const input = e.target.closest('[data-watch-input]');
  if (!input || !currentItem) return;
  const kind = input.dataset.watchInput === 'season' ? 'season' : 'episode';
  const next = Math.max(0, Math.floor(Number(input.value) || 0));
  if (next === Number(currentItem[kind] || 0)) return;
  input.disabled = true;
  try { await patchCurrent({ [kind]: next }, `${kind === 'season' ? 'Сезон' : 'Серію'} оновлено`); }
  catch (error) { input.disabled = false; toastMessage(error.message || 'Не вдалося оновити прогрес'); }
});

root.addEventListener('keydown', e => {
  const tagInput = e.target.closest('[data-tag-entry-input]');
  if (tagInput) {
    if (e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-tag-entry-save]')?.click(); }
    if (e.key === 'Escape') { e.preventDefault(); root.querySelector('[data-tag-entry-box]')?.classList.add('hidden'); }
    return;
  }
  const input = e.target.closest('[data-watch-input]');
  if (input && e.key === 'Enter') input.blur();
});

root.addEventListener('click', async e => {
  const mediaMode = e.target.closest('[data-media-mode]');
  if (mediaMode) { setTitleMediaMode(mediaMode.dataset.mediaMode); return; }

  const playerSource = e.target.closest('[data-player-source]');
  if (playerSource && !playerSource.disabled) { selectTitlePlayerProvider(playerSource.dataset.playerSource); return; }

  const refreshBtn = e.target.closest('[data-refresh-title]');
  if (refreshBtn && !refreshBtn.disabled) { await refreshTitleCard(refreshBtn); return; }

  const editBtn = e.target.closest('[data-edit-title]');
  if (editBtn) { openEditModal(); return; }

  const deleteBtn = e.target.closest('[data-delete-title]');
  if (deleteBtn) { openDeleteModal(); return; }

  const watchAdjust = e.target.closest('[data-watch-adjust]');
  if (watchAdjust && currentItem && !watchAdjust.disabled) {
    const kind = watchAdjust.dataset.watchAdjust === 'season' ? 'season' : 'episode';
    const delta = Number(watchAdjust.dataset.delta || 0);
    const next = Math.max(0, Math.floor(Number(currentItem[kind] || 0) + delta));
    watchAdjust.disabled = true;
    try { await patchCurrent({ [kind]: next }, `${kind === 'season' ? 'Сезон' : 'Серію'} оновлено`); }
    catch (error) { toastMessage(error.message || 'Не вдалося оновити прогрес'); }
    return;
  }

  const viewedBtn = e.target.closest('[data-viewed-increment]');
  if (viewedBtn && currentItem && !viewedBtn.disabled) {
    viewedBtn.disabled = true;
    try {
      const response = await fetch(`/api/anime/viewed?id=${encodeURIComponent(currentItem.id)}`, { method:'POST', headers:{Accept:'application/json'}, cache:'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (payload.options) apiOptions = payload.options;
      if (payload.item) currentItem = payload.item;
      else currentItem.viewed = Number(payload.viewed || currentItem.viewed || 0);
      renderItem(currentItem);
      toastMessage(`Переглянуто: ${Number(currentItem.viewed || 0)}`);
    } catch (error) { toastMessage(error.message || 'Не вдалося оновити лічильник'); }
    return;
  }

  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn && currentItem && toggleBtn.dataset.busy !== '1') {
    const kind = toggleBtn.dataset.toggle === 'favorite' ? 'favorite' : 'liked';
    const next = !Boolean(currentItem[kind]);
    toggleBtn.dataset.busy = '1';
    toggleBtn.disabled = true;
    try {
      await patchCurrent({ [kind]: next }, kind === 'favorite' ? 'Вибране збережено у Turso' : 'Улюблене збережено у Turso');
    } catch (error) {
      toggleBtn.disabled = false;
      delete toggleBtn.dataset.busy;
      toastMessage(error.message || 'Не вдалося зберегти у Turso');
    }
    return;
  }

  const addTagBtn = e.target.closest('[data-add-tag]');
  if (addTagBtn && currentItem) {
    const box = root.querySelector('[data-tag-entry-box]');
    const input = root.querySelector('[data-tag-entry-input]');
    box?.classList.toggle('hidden');
    if (box && !box.classList.contains('hidden')) {
      input?.focus();
      renderTitleTagSuggestions();
    }
    return;
  }

  const tagSuggestion = e.target.closest('[data-tag-suggestion]');
  if (tagSuggestion && currentItem) {
    const scope = tagSuggestion.closest('[data-tag-entry-box]');
    if (scope) {
      const input = scope.querySelector('[data-tag-entry-input]');
      if (input) input.value = applyTagSuggestionToValue(input.value, tagSuggestion.dataset.tagSuggestion || '');
      renderTitleTagSuggestions();
      input?.focus();
      return;
    }
    const editModal = tagSuggestion.closest('#editTitleModal');
    if (editModal) {
      const input = editModal.querySelector('#editTagsValue');
      if (input) input.value = applyTagSuggestionToValue(input.value, tagSuggestion.dataset.tagSuggestion || '');
      renderEditTagSuggestions(editModal);
      input?.focus();
      return;
    }
  }

  const tagSave = e.target.closest('[data-tag-entry-save]');
  if (tagSave && currentItem) {
    const input = root.querySelector('[data-tag-entry-input]');
    const additions = parseTagsInput(input?.value || '');
    if (!additions.length) return;
    const tags = [...new Set([...(Array.isArray(currentItem.tags) ? currentItem.tags : []), ...additions])];
    try { await patchCurrent({ tags }, `Додано тегів: ${additions.join(', ')}`); }
    catch (error) { toastMessage(error.message || 'Не вдалося додати тег'); }
    return;
  }

  const removeTagBtn = e.target.closest('[data-remove-tag]');
  if (removeTagBtn && currentItem) {
    const remove = String(removeTagBtn.dataset.removeTag || '');
    const tags = (Array.isArray(currentItem.tags) ? currentItem.tags : []).filter(tag => tag !== remove);
    try { await patchCurrent({ tags }, `Тег #${remove} видалено`); }
    catch (error) { toastMessage(error.message || 'Не вдалося видалити тег'); }
    return;
  }

  const notesSaveBtn = e.target.closest('[data-notes-save]');
  if (notesSaveBtn && currentItem) {
    const input = root.querySelector('[data-notes-input]');
    notesSaveBtn.disabled = true;
    try { await patchCurrent({ notes: input?.value || '' }, 'Нотатки збережено'); }
    catch (error) { toastMessage(error.message || 'Не вдалося зберегти нотатки'); }
    return;
  }

  const mediaBtn = e.target.closest('[data-media-kind]');
  if (mediaBtn) {
    await openMediaPicker(mediaBtn.dataset.mediaKind);
    return;
  }

  const trigger = e.target.closest('[data-dropdown-trigger]');
  if (trigger) {
    const dropdown = trigger.closest('[data-dropdown]');
    const willOpen = !dropdown.classList.contains('open');
    closeDropdowns();
    if (willOpen) {
      dropdown.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    return;
  }

  const statusOption = e.target.closest('[data-select-status]');
  if (statusOption && currentItem) {
    try { await patchCurrent({ status: statusOption.dataset.selectStatus }, 'Статус оновлено у Turso'); }
    catch (error) { toastMessage(error.message || 'Помилка статусу'); }
    return;
  }

  const groupOption = e.target.closest('[data-select-group]');
  if (groupOption && currentItem) {
    try { await patchCurrent({ group: groupOption.dataset.selectGroup }, 'Групу оновлено у Turso'); }
    catch (error) { toastMessage(error.message || 'Помилка групи'); }
    return;
  }

  const addGroup = e.target.closest('[data-add-group]');
  if (addGroup && currentItem) {
    const value = prompt('Нова група');
    if (!value?.trim()) return;
    try { await patchCurrent({ group: value.trim() }, 'Нову групу додано у Turso'); }
    catch (error) { toastMessage(error.message || 'Не вдалося додати групу'); }
    return;
  }

  const markBtn = e.target.closest('[data-source-mark]');
  if (markBtn) {
    const site = markBtn.dataset.sourceSite;
    const mark = markBtn.dataset.sourceMark;
    const current = getSourceMark(site);
    setSourceMark(site, current === mark ? '' : mark);
    renderItem(currentItem);
    return;
  }

  const groupToggle = e.target.closest('[data-source-toggle]');
  if (groupToggle) {
    const group = groupToggle.closest('.source-group');
    const isOpen = group.classList.contains('open');
    group.classList.toggle('open', !isOpen);
    groupToggle.setAttribute('aria-expanded', String(!isOpen));
    return;
  }

  if (!e.target.closest('[data-dropdown]')) closeDropdowns();
});


root.addEventListener('input', e => {
  if (e.target.closest('[data-tag-entry-input]')) { renderTitleTagSuggestions(); return; }
  const search = e.target.closest('[data-group-search]');
  if (!search) return;
  const q = String(search.value || '').toLocaleLowerCase('uk-UA').trim();
  const dropdown = search.closest('[data-dropdown="group"]');
  dropdown?.querySelectorAll('[data-select-group]').forEach(button => {
    const hay = String(button.dataset.optionSearch || '').toLocaleLowerCase('uk-UA');
    button.hidden = Boolean(q && !hay.includes(q));
  });
});

document.addEventListener('click', e => {
  if (!e.target.closest('#titleRoot [data-dropdown]')) closeDropdowns();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDropdowns();
    const modal = document.getElementById('mediaModal');
    if (modal && !modal.classList.contains('hidden')) closeMediaModal();
    const editModal = document.getElementById('editTitleModal');
    if (editModal && !editModal.classList.contains('hidden')) closeEditModal();
  }
});

window.addEventListener('message', event => {
  if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'yoru-player-waiting') {
    const stage = root.querySelector('[data-player-stage]');
    if (stage && !stage.querySelector('.player-proxy-hint')) stage.insertAdjacentHTML('beforeend', '<div class="player-proxy-hint">Плеєр ще завантажується — очікую DOM-блок джерела…</div>');
  }
  if (event.data.type === 'yoru-player-ready') root.querySelector('.player-proxy-hint')?.remove();
});

async function loadItem() {
  if (randomMode) return loadAniHubPreview({ random:true });
  if (previewMode && anihubPreviewId) return loadAniHubPreview({ id:anihubPreviewId });
  if (!id) return renderNotFound();
  root.innerHTML = '<div class="not-found"><div class="detail-loader"></div><p>Завантаження з Turso…</p></div>';
  try {
    const response = await fetch(`/api/anime?id=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.step ? ` [${payload.step}]` : '';
      throw new Error(`${payload.error || `HTTP ${response.status}`}${detail}`);
    }
    if (!payload.item) return renderNotFound();
    apiOptions = payload.options && typeof payload.options === 'object' ? payload.options : apiOptions;
    renderItem(payload.item);
  } catch (error) {
    console.error(error);
    renderNotFound(`Помилка Turso: ${error.message || 'невідома помилка'}`);
  }
}

loadItem();
