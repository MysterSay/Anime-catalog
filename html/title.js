const root = document.getElementById('titleRoot');
const toast = document.getElementById('toast');
const id = new URLSearchParams(location.search).get('id');
const FALLBACK_IMAGE = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 700 1000%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%23171b27%22/%3E%3Cstop offset=%221%22 stop-color=%22%23282d42%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22700%22 height=%221000%22 fill=%22url(%23g)%22/%3E%3Ctext x=%22350%22 y=%22520%22 text-anchor=%22middle%22 fill=%22%23798094%22 font-family=%22Arial%22 font-size=%2270%22%3EYORU%3C/text%3E%3C/svg%3E';
const ANILIST_PUBLIC_ENDPOINT = 'https://graphql.anilist.co';
const STATUS_OPTIONS = ['Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто', 'Без статусу'];

let saved = {};
try { saved = JSON.parse(localStorage.getItem('yoru-state') || '{}'); } catch { saved = {}; }
const favorite = new Set(Array.isArray(saved.favorite) ? saved.favorite : []);
const liked = new Set(Array.isArray(saved.liked) ? saved.liked : []);
let currentItem = null;
let apiOptions = { statuses: [], groups: [] };
let mediaKind = null;

function persistState() {
  saved.favorite = [...favorite];
  saved.liked = [...liked];
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

function groupLinks(links = []) {
  const map = new Map();
  links.filter(link => safeHttpUrl(link.url)).forEach(link => {
    const url = safeHttpUrl(link.url);
    const site = getSiteLabel(url);
    if (!map.has(site)) map.set(site, []);
    map.get(site).push({ ...link, url });
  });
  return [...map.entries()].map(([site, items]) => ({ site, items })).sort((a, b) => a.site.localeCompare(b.site, 'uk'));
}

function buildDropdown(kind, currentValue, options) {
  const valueText = escapeHtml(currentValue || (kind === 'status' ? 'Без статусу' : 'Без групи'));
  const currentClass = kind === 'status' ? `status-badge ${statusClass(currentValue)}` : 'group-pill';
  const menuItems = options.map(option => {
    const selected = option === currentValue;
    return `<button class="dropdown-option ${selected ? 'selected' : ''}" data-select-${kind}="${escapeHtml(option)}"><span class="${kind === 'status' ? `status-badge ${statusClass(option)}` : 'group-pill'}">${escapeHtml(option)}</span></button>`;
  }).join('');
  const extra = kind === 'group' ? `<button class="dropdown-option add-new" data-add-group="true"><span class="group-pill">+ Нова група</span></button>` : '';
  return `
    <div class="control-block">
      <span class="control-label">${kind === 'status' ? 'Статус' : 'Група'}</span>
      <div class="control-dropdown" data-dropdown="${kind}">
        <button class="control-dropdown-btn" data-dropdown-trigger="${kind}" aria-expanded="false">
          <span class="${currentClass}">${valueText}</span>
          <span class="dropdown-caret">⌄</span>
        </button>
        <div class="control-dropdown-menu">${menuItems}${extra}</div>
      </div>
    </div>`;
}

function buildLinksAccordion(linkGroups) {
  if (!linkGroups.length) return '<div class="source-empty">Посилань поки немає</div>';
  return linkGroups.map((group, groupIndex) => `
    <section class="source-group ${groupIndex === 0 ? 'open' : ''}">
      <button class="source-group-trigger" data-source-toggle aria-expanded="${groupIndex === 0 ? 'true' : 'false'}">
        <span class="source-group-info"><strong>${escapeHtml(group.site)}</strong><small>${group.items.length} посилань</small></span>
        <span class="source-group-caret">⌄</span>
      </button>
      <div class="source-group-body"><div class="source-group-list">
        ${group.items.map((link, index) => `
          <a class="source-btn source-entry" style="--entry-index:${index}" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
            <span>${escapeHtml(link.name || `Посилання ${index + 1}`)}</span><span class="source-arrow">↗</span>
          </a>`).join('')}
      </div></div>
    </section>`).join('');
}

function renderItem(item) {
  currentItem = item;
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
            </div>
            ${missingMedia ? `<div class="media-repair-actions">${missingMedia}</div>` : ''}
          </div>
          <div class="title-poster-wrap reveal delay-1 ${currentItem.hasPoster ? '' : 'poster-missing'}">
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

root.addEventListener('click', async e => {
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn && currentItem) {
    const set = toggleBtn.dataset.toggle === 'favorite' ? favorite : liked;
    if (set.has(currentItem.id)) set.delete(currentItem.id); else set.add(currentItem.id);
    persistState();
    renderItem(currentItem);
    toastMessage('Збережено');
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

document.addEventListener('click', e => {
  if (!e.target.closest('#titleRoot [data-dropdown]')) closeDropdowns();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDropdowns();
    const modal = document.getElementById('mediaModal');
    if (modal && !modal.classList.contains('hidden')) closeMediaModal();
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
