const root = document.getElementById('titleRoot');
const toast = document.getElementById('toast');
const id = new URLSearchParams(location.search).get('id');
const FALLBACK_IMAGE = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 700 1000%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%23171b27%22/%3E%3Cstop offset=%221%22 stop-color=%22%23282d42%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22700%22 height=%221000%22 fill=%22url(%23g)%22/%3E%3Ctext x=%22350%22 y=%22520%22 text-anchor=%22middle%22 fill=%22%23798094%22 font-family=%22Arial%22 font-size=%2270%22%3EYORU%3C/text%3E%3C/svg%3E';
const ANILIST_PUBLIC_ENDPOINT = 'https://graphql.anilist.co';
const STATUS_OPTIONS = ['Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто', 'Без статусу'];
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
let apiOptions = { statuses: [], groups: [], groupOptions: [] };
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

function statusClass(status) {
  return 'status-' + ({ 'Буду дивитись':'planned', 'Дивлюсь':'watching', 'Переглянув':'completed', 'Відкладено':'paused', 'Кинуто':'dropped' }[status] || 'default');
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

function renderItem(item) {
  currentItem = item;
  syncMarksFromItem(currentItem);
  document.title = `${currentItem.title} — Yoru`;
  const linkGroups = groupLinks(currentItem.links || []);
  const totalLinks = linkGroups.reduce((sum, group) => sum + group.items.length, 0);
  const statusOptions = [...new Set([currentItem.status || 'Без статусу', ...(apiOptions.statuses || []), ...STATUS_OPTIONS])];
  const groupOptions = [...new Set(['Без групи', currentItem.group || 'Без групи', ...(apiOptions.groups || [])])].filter(Boolean).sort((a, b) => {
    if (a === 'Без групи') return -1;
    if (b === 'Без групи') return 1;
    return a.localeCompare(b, 'uk');
  });
  const missingMedia = [
    !currentItem.hasPoster ? '<button class="media-repair-btn" data-media-kind="poster">＋ Додати постер</button>' : '',
    !currentItem.hasBanner ? '<button class="media-repair-btn" data-media-kind="banner">＋ Додати банер</button>' : '',
  ].filter(Boolean).join('');

  const theme = statusTheme(currentItem.status || 'Без статусу');
  root.innerHTML = `
    <section class="title-hero">
      <div class="banner-bg"></div>
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
        </div>

        <div class="title-info reveal delay-1">
          <h1>${escapeHtml(currentItem.title)}</h1>
          <p class="title-description">${escapeHtml(currentItem.description || 'Опис поки відсутній.')}</p>
        </div>
      </div>
    </section>

    <section class="detail-links title-shell reveal delay-2">
      <aside class="sources-card sources-card-wide">
        <div class="sources-head">
          <span class="section-kicker">ПОСИЛАННЯ</span>
          <h3>Сайти та серії</h3>
          <p class="sources-summary">${linkGroups.length ? `Сайтів: ${linkGroups.length} · Посилань: ${totalLinks}` : 'Посилань поки немає'}</p>
        </div>
        <div class="source-groups">${buildLinksAccordion(linkGroups)}</div>
      </aside>
      <div class="title-record-actions">
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
  if (banner) root.querySelector('.banner-bg').style.backgroundImage = `url("${banner.replace(/["\\]/g, '\\$&')}")`;
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
  status.textContent = 'Зберігаю в Notion…';
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
          <div><span class="section-kicker">РЕДАГУВАННЯ</span><h2>Редагування тайтлу</h2><p>Зліва — нові значення. Справа — поточні дані з Notion.</p></div>
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
            <div class="edit-two-cols">
              <label class="edit-field"><span>Статус</span><input id="editStatusValue" type="text" /></label>
              <label class="edit-field"><span>Група</span><input id="editGroupValue" type="text" /></label>
            </div>
            <div class="edit-suggestion-row" id="editStatusSuggestions"></div>
            <div class="edit-suggestion-row edit-group-suggestions" id="editGroupSuggestions"></div>
            <label class="edit-field"><span>Опис</span><textarea id="editDescriptionValue" rows="9"></textarea></label>
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
    const suggestion = event.target.closest('[data-edit-set]');
    if (suggestion) {
      const target = modal.querySelector(`#${suggestion.dataset.editTarget}`);
      if (target) target.value = suggestion.dataset.editSet;
    }
  });

  modal.addEventListener('input', event => {
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

function openEditModal() {
  if (!currentItem) return;
  const modal = ensureEditModal();
  editSiteLinks = currentLinksByDomain();
  modal.querySelector('#editTitleValue').value = currentItem.title || '';
  modal.querySelector('#editOriginalValue').value = currentItem.originalTitle || '';
  modal.querySelector('#editEnglishValue').value = currentItem.englishTitle || '';
  modal.querySelector('#editRussianValue').value = currentItem.russianTitle || '';
  modal.querySelector('#editAliasesValue').value = currentItem.aliases || '';
  modal.querySelector('#editStatusValue').value = currentItem.status || 'Без статусу';
  modal.querySelector('#editGroupValue').value = currentItem.group || 'Без групи';
  modal.querySelector('#editDescriptionValue').value = currentItem.description || '';
  modal.querySelector('#editPosterUrl').value = '';
  modal.querySelector('#editBannerUrl').value = '';
  modal.querySelector('#editFavoriteValue').checked = favorite.has(currentItem.id);
  modal.querySelector('#editLikedValue').checked = liked.has(currentItem.id);
  modal.querySelector('#editTitleStatus').textContent = '';
  modal.querySelector('#editTitleStatus').className = 'discover-status';

  modal.querySelector('#editStatusSuggestions').innerHTML = [...new Set([...(apiOptions.statuses || []), ...STATUS_OPTIONS])]
    .map(value => `<button type="button" data-edit-set="${escapeHtml(value)}" data-edit-target="editStatusValue">${escapeHtml(value)}</button>`).join('');
  modal.querySelector('#editGroupSuggestions').innerHTML = [...new Set(['Без групи', ...(apiOptions.groups || [])])]
    .map(value => `<button type="button" class="edit-group-suggestion" style="${groupTagStyle(value)}" data-edit-set="${escapeHtml(value)}" data-edit-target="editGroupValue">${escapeHtml(value)}</button>`).join('');

  const descPreview = (currentItem.description || '').slice(0, 420);
  modal.querySelector('#editExistingCards').innerHTML = [
    existingValueCard('Назва', currentItem.title),
    existingValueCard('Оригінальна назва', currentItem.originalTitle),
    existingValueCard('Англійська назва', currentItem.englishTitle),
    existingValueCard('Російська назва', currentItem.russianTitle),
    existingValueCard('Аліаси', currentItem.aliases),
    existingValueCard('Статус', currentItem.status),
    existingValueCard('Група', currentItem.group),
    existingValueCard('Постер', '', currentItem.poster ? `<img class="edit-existing-image poster" src="${escapeHtml(currentItem.poster)}" alt="" />` : '<strong>—</strong>'),
    existingValueCard('Банер', '', currentItem.hasBanner && currentItem.banner ? `<img class="edit-existing-image banner" src="${escapeHtml(currentItem.banner)}" alt="" />` : '<strong>—</strong>'),
    existingValueCard('Опис', descPreview || '—'),
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
  statusBox.textContent = 'Зберігаю зміни в Notion…';
  statusBox.className = 'discover-status loading';
  try {
    const payload = {
      title: modal.querySelector('#editTitleValue').value.trim(),
      originalTitle: modal.querySelector('#editOriginalValue').value.trim(),
      englishTitle: modal.querySelector('#editEnglishValue').value.trim(),
      russianTitle: modal.querySelector('#editRussianValue').value.trim(),
      aliases: modal.querySelector('#editAliasesValue').value.trim(),
      status: modal.querySelector('#editStatusValue').value.trim() || 'Без статусу',
      group: modal.querySelector('#editGroupValue').value.trim() || 'Без групи',
      description: modal.querySelector('#editDescriptionValue').value,
      favorite: modal.querySelector('#editFavoriteValue').checked,
      liked: modal.querySelector('#editLikedValue').checked,
      siteLinks: editSiteLinks,
    };
    const posterUrl = modal.querySelector('#editPosterUrl').value.trim();
    const bannerUrl = modal.querySelector('#editBannerUrl').value.trim();
    if (posterUrl) payload.posterUrl = posterUrl;
    if (bannerUrl) payload.bannerUrl = bannerUrl;

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

root.addEventListener('click', async e => {
  const editBtn = e.target.closest('[data-edit-title]');
  if (editBtn) { openEditModal(); return; }

  const deleteBtn = e.target.closest('[data-delete-title]');
  if (deleteBtn) { openDeleteModal(); return; }

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
      await patchCurrent({ [kind]: next }, kind === 'favorite' ? 'Вибране збережено в Notion' : 'Улюблене збережено в Notion');
    } catch (error) {
      toggleBtn.disabled = false;
      delete toggleBtn.dataset.busy;
      toastMessage(error.message || 'Не вдалося зберегти в Notion');
    }
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
    try { await patchCurrent({ status: statusOption.dataset.selectStatus }, 'Статус оновлено в Notion'); }
    catch (error) { toastMessage(error.message || 'Помилка статусу'); }
    return;
  }

  const groupOption = e.target.closest('[data-select-group]');
  if (groupOption && currentItem) {
    try { await patchCurrent({ group: groupOption.dataset.selectGroup }, 'Групу оновлено в Notion'); }
    catch (error) { toastMessage(error.message || 'Помилка групи'); }
    return;
  }

  const addGroup = e.target.closest('[data-add-group]');
  if (addGroup && currentItem) {
    const value = prompt('Нова група');
    if (!value?.trim()) return;
    try { await patchCurrent({ group: value.trim() }, 'Нову групу додано в Notion'); }
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

async function loadItem() {
  if (!id) return renderNotFound();
  root.innerHTML = '<div class="not-found"><div class="detail-loader"></div><p>Завантаження з Notion…</p></div>';
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
    renderNotFound(`Помилка Notion: ${error.message || 'невідома помилка'}`);
  }
}

loadItem();
