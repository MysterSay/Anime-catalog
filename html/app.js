let db = [];
let apiSources = [];
let apiOptions = { statuses: [], groups: [] };
let discoverSelected = null;

const catalog = document.getElementById('catalog');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const groupFilter = document.getElementById('groupFilter');
const statusFilter = document.getElementById('statusFilter');
const sortSelect = document.getElementById('sortSelect');
const gridViewBtn = document.getElementById('gridViewBtn');
const listViewBtn = document.getElementById('listViewBtn');
const resultCount = document.getElementById('resultCount');
const heroTotal = document.getElementById('heroTotal');
const catalogTitle = document.getElementById('catalogTitle');
const quickButtons = [...document.querySelectorAll('[data-quick]')];
const toast = document.getElementById('toast');
const openAddTitle = document.getElementById('openAddTitle');
const discoverModal = document.getElementById('discoverModal');
const discoverSearchForm = document.getElementById('discoverSearchForm');
const discoverSearchInput = document.getElementById('discoverSearchInput');
const discoverResults = document.getElementById('discoverResults');
const discoverSetup = document.getElementById('discoverSetup');
const discoverStatus = document.getElementById('discoverStatus');

const STATUS_ORDER = ['Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто'];
const FALLBACK_IMAGE = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 700 1000%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%23171b27%22/%3E%3Cstop offset=%221%22 stop-color=%22%23282d42%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22700%22 height=%221000%22 fill=%22url(%23g)%22/%3E%3Ctext x=%22350%22 y=%22520%22 text-anchor=%22middle%22 fill=%22%23798094%22 font-family=%22Arial%22 font-size=%2270%22%3EYORU%3C/text%3E%3C/svg%3E';

let saved = {};
try { saved = JSON.parse(localStorage.getItem('yoru-state') || '{}'); } catch { saved = {}; }


const state = {
  view: saved.view || 'grid',
  quick: 'all',
  search: '',
  group: 'all',
  status: 'all',
  sort: 'added-desc',
  favorite: new Set(Array.isArray(saved.favorite) ? saved.favorite : []),
  liked: new Set(Array.isArray(saved.liked) ? saved.liked : []),
};

function saveState() {
  saved.view = state.view;
  saved.favorite = [...state.favorite];
  saved.liked = [...state.liked];
  saved.customGroups = Array.isArray(saved.customGroups) ? saved.customGroups : [];
  localStorage.setItem('yoru-state', JSON.stringify(saved));
}

function escapeHtml(value = '') {
  const str = String(value ?? '');
  return str.replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('uk-UA').normalize('NFKD');
}

function populateFilters() {
  groupFilter.innerHTML = '<option value="all">Усі групи</option>';
  statusFilter.innerHTML = '<option value="all">Усі статуси</option>';

  [...new Set(db.map(x => x.group).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'uk'))
    .forEach(group => groupFilter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`));

  const statuses = [...new Set(db.map(x => x.status).filter(Boolean))];
  statuses.sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a);
    const bi = STATUS_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'uk');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  statuses.forEach(status => statusFilter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`));
}

function getFiltered() {
  const items = db.filter(item => {
    const haystack = normalize([item.title, item.group, item.status].join(' '));
    const matchesSearch = !state.search || haystack.includes(normalize(state.search));
    const matchesGroup = state.group === 'all' || item.group === state.group;
    const matchesStatus = state.status === 'all' || item.status === state.status;
    const matchesQuick = state.quick === 'all' ||
      (state.quick === 'favorite' && state.favorite.has(item.id)) ||
      (state.quick === 'liked' && state.liked.has(item.id));
    return matchesSearch && matchesGroup && matchesStatus && matchesQuick;
  });

  items.sort((a, b) => {
    if (state.sort === 'added-desc') return (new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
    if (state.sort === 'added-asc') return (new Date(a.addedAt || 0) - new Date(b.addedAt || 0));
    if (state.sort === 'title-desc') return b.title.localeCompare(a.title, 'uk');
    if (state.sort === 'title-asc') return a.title.localeCompare(b.title, 'uk');
    if (state.sort === 'status') {
      const ai = STATUS_ORDER.indexOf(a.status);
      const bi = STATUS_ORDER.indexOf(b.status);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.status.localeCompare(b.status, 'uk');
    }
    return 0;
  });
  return items;
}

function formatDate(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('uk-UA', { day:'2-digit', month:'short', year:'numeric' }).format(parsed);
}

function statusClass(status) {
  return 'status-' + ({
    'Буду дивитись':'planned',
    'Дивлюсь':'watching',
    'Переглянув':'completed',
    'Відкладено':'paused',
    'Кинуто':'dropped',
  }[status] || 'default');
}

function iconHeart(active, filled) {
  if (filled) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2S4 15.6 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 6.1-8 10.7-8 10.7Z" ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a2 2 0 0 1 2 2v14l-7-4-7 4V6a2 2 0 0 1 2-2Z" ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

function cardTemplate(item, index) {
  const favorite = state.favorite.has(item.id);
  const liked = state.liked.has(item.id);
  return `
    <article class="anime-card" style="--delay:${Math.min(index * 35, 280)}ms" data-id="${escapeHtml(item.id)}">
      <a class="card-link" href="title.html?id=${encodeURIComponent(item.id)}" aria-label="Відкрити ${escapeHtml(item.title)}"></a>
      <div class="poster-wrap">
        <img class="poster" src="${escapeHtml(item.poster || FALLBACK_IMAGE)}" alt="${escapeHtml(item.title)}" loading="lazy" />
        <div class="poster-shade"></div>
        <span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status || 'Без статусу')}</span>
        <div class="card-actions">
          <button class="mini-action ${favorite ? 'active' : ''}" data-action="favorite" title="Вибране">${iconHeart(favorite, false)}</button>
          <button class="mini-action ${liked ? 'active liked' : ''}" data-action="liked" title="Улюблене">${iconHeart(liked, true)}</button>
        </div>
      </div>
      <div class="card-body">
        <h3>${escapeHtml(item.title)}</h3>
        <div class="card-meta">
          <span>${escapeHtml(item.group || 'Без групи')}</span>
          <span>${formatDate(item.addedAt)}</span>
        </div>
        <p>${escapeHtml(item.description || 'Опис поки відсутній.')}</p>
      </div>
    </article>`;
}

function render() {
  const items = getFiltered();
  catalog.className = state.view === 'grid' ? 'catalog-grid' : 'catalog-list';
  catalog.innerHTML = items.map(cardTemplate).join('');

  if (items.length === 0) {
    emptyState.classList.remove('hidden');
    if (db.length === 0) {
      const sourceText = apiSources.length
        ? apiSources.map(source => `${source.name || source.id}: ${source.count ?? 0}`).join(' • ')
        : 'Data source не повернув записів.';
      emptyState.innerHTML = `<div class="empty-icon">◇</div><h3>Notion повернув 0 тайтлів</h3><p>${escapeHtml(sourceText)}</p>`;
    } else {
      emptyState.innerHTML = '<div class="empty-icon">◇</div><h3>Нічого не знайдено</h3><p>Спробуй змінити пошук або фільтри.</p>';
    }
  } else {
    emptyState.classList.add('hidden');
  }

  resultCount.textContent = items.length;
  heroTotal.textContent = db.length;

  const ids = new Set(db.map(x => x.id));
  document.getElementById('countAll').textContent = db.length;
  document.getElementById('countFavorite').textContent = [...state.favorite].filter(id => ids.has(id)).length;
  document.getElementById('countLiked').textContent = [...state.liked].filter(id => ids.has(id)).length;
  catalogTitle.textContent = state.quick === 'favorite' ? 'Вибране' : state.quick === 'liked' ? 'Улюблене' : 'Усі тайтли';
  gridViewBtn.classList.toggle('active', state.view === 'grid');
  listViewBtn.classList.toggle('active', state.view === 'list');

  [...catalog.querySelectorAll('.anime-card')].forEach(card => requestAnimationFrame(() => card.classList.add('show')));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1600);
}

function showLoading() {
  emptyState.classList.add('hidden');
  catalog.className = 'catalog-grid loading-grid';
  catalog.innerHTML = Array.from({ length: 10 }, () => '<div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join('');
}

function showLoadError(message) {
  catalog.innerHTML = '';
  emptyState.classList.remove('hidden');
  emptyState.innerHTML = `<div class="empty-icon">!</div><h3>Не вдалося завантажити Notion</h3><p>${escapeHtml(message)}</p>`;
  resultCount.textContent = '0';
  heroTotal.textContent = '0';
}

async function loadAnime() {
  showLoading();
  try {
    const response = await fetch('/api/anime', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.step ? ` [${payload.step}]` : '';
      const err = new Error(`${payload.error || `HTTP ${response.status}`}${detail}`);
      err.payload = payload;
      throw err;
    }

    db = Array.isArray(payload.items) ? payload.items : [];
    apiSources = Array.isArray(payload.sources) ? payload.sources : [];
    apiOptions = payload.options && typeof payload.options === 'object' ? payload.options : apiOptions;

    if (!Array.isArray(saved.favorite)) db.filter(x => x.favorite).forEach(x => state.favorite.add(x.id));
    if (!Array.isArray(saved.liked)) db.filter(x => x.liked).forEach(x => state.liked.add(x.id));

    populateFilters();
    render();
  } catch (error) {
    console.error(error);
    showLoadError(error.message || 'Невідома помилка API.');
  }
}

catalog.addEventListener('click', e => {
  const action = e.target.closest('[data-action]');
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  const card = action.closest('[data-id]');
  const id = card.dataset.id;
  const set = action.dataset.action === 'favorite' ? state.favorite : state.liked;
  if (set.has(id)) set.delete(id); else set.add(id);
  saveState();
  render();
  showToast(action.dataset.action === 'favorite' ? 'Вибране оновлено' : 'Улюблене оновлено');
});

searchInput.addEventListener('input', () => { state.search = searchInput.value.trim(); render(); });
groupFilter.addEventListener('change', () => { state.group = groupFilter.value; render(); });
statusFilter.addEventListener('change', () => { state.status = statusFilter.value; render(); });
sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; render(); });
gridViewBtn.addEventListener('click', () => { state.view = 'grid'; saveState(); render(); });
listViewBtn.addEventListener('click', () => { state.view = 'list'; saveState(); render(); });

quickButtons.forEach(btn => btn.addEventListener('click', () => {
  quickButtons.forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  state.quick = btn.dataset.quick;
  render();
}));

document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    state.search = '';
    searchInput.blur();
    render();
  }
});


const SOURCE_LABELS = {
  'myanimelist.net': 'MyAnimeList',
  'anilist.co': 'AniList',
  'shikimori.io': 'Shikimori',
};


function setDiscoverStatus(text = '', type = '') {
  if (!discoverStatus) return;
  discoverStatus.textContent = text;
  discoverStatus.className = `discover-status ${type}`.trim();
}

function openDiscoverModal() {
  if (!discoverModal) return;
  discoverModal.classList.remove('hidden');
  discoverModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => discoverSearchInput?.focus());
}

function closeDiscoverModal() {
  if (!discoverModal) return;
  discoverModal.classList.add('hidden');
  discoverModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  discoverSelected = null;
  if (discoverResults) discoverResults.innerHTML = '';
  if (discoverSetup) {
    discoverSetup.innerHTML = '';
    discoverSetup.classList.add('hidden');
  }
  setDiscoverStatus('');
}

function sourceResultTile(item, site, index) {
  const title = item?.title || item?.pageTitle || item?.url || 'Без назви';
  return `
    <button class="discover-result source-discover-result" type="button"
      data-source-site="${escapeHtml(site)}"
      data-source-index="${index}">
      <img src="${escapeHtml(item?.image || FALLBACK_IMAGE)}" alt="${escapeHtml(title)}" loading="lazy" />
      <span class="discover-result-copy">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(SOURCE_LABELS[site] || site)} · ${escapeHtml(item?.url || '')}</small>
      </span>
      <span class="discover-result-arrow">→</span>
    </button>`;
}

function renderGoogleSourceGroups(groups) {
  if (!discoverResults) return;
  if (discoverSetup) {
    discoverSetup.classList.add('hidden');
    discoverSetup.innerHTML = '';
  }

  const safeGroups = Array.isArray(groups) ? groups : [];
  const total = safeGroups.reduce((sum, group) => sum + (Array.isArray(group?.items) ? group.items.length : 0), 0);

  if (!safeGroups.length) {
    discoverResults.innerHTML = '<div class="discover-empty">Python core не повернув груп результатів.</div>';
    setDiscoverStatus('Пошук завершено без результатів.', '');
    return;
  }

  discoverResults.innerHTML = `
    <div class="google-source-groups">
      ${safeGroups.map((group, groupIndex) => {
        const items = Array.isArray(group?.items) ? group.items : [];
        const site = group?.site || '';
        const previousHaveResults = safeGroups.slice(0, groupIndex).some(prev => Array.isArray(prev?.items) && prev.items.length);
        const open = groupIndex === 0 || (!previousHaveResults && items.length > 0);
        return `
          <section class="google-source-group ${open ? 'open' : ''}" data-google-group="${escapeHtml(site)}">
            <button class="google-source-trigger" type="button" data-google-toggle aria-expanded="${open ? 'true' : 'false'}">
              <span>
                <strong>${escapeHtml(group?.label || SOURCE_LABELS[site] || site)}</strong>
                <small>${escapeHtml(group?.query || '')}</small>
              </span>
              <span class="google-source-meta">
                <b>${items.length}</b>
                <i>⌄</i>
              </span>
            </button>
            <div class="google-source-body">
              <div class="google-source-list">
                ${group?.error ? `<div class="source-search-error">${escapeHtml(group.error)}</div>` : ''}
                ${items.length ? items.map((item, index) => sourceResultTile(item, site, index)).join('') : '<div class="source-search-empty">Збігів не знайдено.</div>'}
              </div>
            </div>
          </section>`;
      }).join('')}
    </div>`;

  discoverResults.querySelectorAll('[data-google-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.google-source-group');
      if (!group) return;
      const next = !group.classList.contains('open');
      group.classList.toggle('open', next);
      btn.setAttribute('aria-expanded', String(next));
    });
  });

  discoverResults.querySelectorAll('.source-discover-result').forEach(btn => {
    btn.addEventListener('click', async () => {
      const group = safeGroups.find(entry => entry?.site === btn.dataset.sourceSite);
      const item = group?.items?.[Number(btn.dataset.sourceIndex)];
      if (!item?.url) return;
      await processSelectedSource(item, btn);
    });
  });

  setDiscoverStatus(
    total ? `Знайдено сторінок: ${total}. Обери правильний тайтл.` : 'Python core не знайшов сторінок тайтлів на цих трьох сайтах.',
    total ? 'ok' : ''
  );
}

const AUTHORITY_SEARCH_SITES = [
  { domain: 'myanimelist.net', label: 'MyAnimeList', path: /^\/anime\/\d+(?:\/|$)/i },
  { domain: 'anilist.co', label: 'AniList', path: /^\/anime\/\d+(?:\/|$)/i },
  { domain: 'shikimori.io', label: 'Shikimori', path: /^\/animes\/\d+(?:[-\/]|$)/i },
];

async function searchGoogleSources(queryText) {
  const clean = String(queryText || '').replace(/["\r\n]+/g, ' ').trim();
  if (!clean) return { ok: true, query: '', groups: [] };

  setDiscoverStatus('Python core виконує Google site: пошук у MyAnimeList, AniList і Shikimori…', 'loading');
  const response = await fetch('/api/core-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ title: clean, limit: 8 }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
  return payload;
}

async function processSelectedSource(item, button) {
  if (discoverSelected) return;
  discoverSelected = item;
  discoverResults.querySelectorAll('.source-discover-result').forEach(el => { el.disabled = true; });
  button?.classList.add('processing');
  const sourceTitle = String(item.title || discoverSearchInput.value || '').trim();
  setDiscoverStatus(`Визначаю назви й асинхронно шукаю посилання по 17 каталогах для «${sourceTitle || 'тайтл'}»…`, 'loading');

  try {
    const response = await fetch('/api/process-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        title: sourceTitle || discoverSearchInput.value.trim(),
        url: item.url,
        status: '',
        group: '',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload.item?.id) throw new Error('Notion не повернув ID тайтлу.');
    setDiscoverStatus(payload.existing ? 'Повний пошук завершено. Тайтл уже був у Notion — дані оновлено.' : 'Повний асинхронний пошук завершено, JSON записано в Notion.', 'ok');
    await new Promise(resolve => setTimeout(resolve, 550));
    location.href = `title.html?id=${encodeURIComponent(payload.item.id)}`;
  } catch (error) {
    console.error(error);
    discoverSelected = null;
    discoverResults.querySelectorAll('.source-discover-result').forEach(el => { el.disabled = false; });
    button?.classList.remove('processing');
    setDiscoverStatus(error.message || 'Не вдалося обробити тайтл.', 'error');
  }
}

async function executeDiscoverSearch(q) {
  discoverSelected = null;
  discoverSetup.classList.add('hidden');
  discoverSetup.innerHTML = '';
  discoverResults.innerHTML = '<div class="discover-loading"><span class="detail-loader"></span><span>Google через Python core: MyAnimeList · AniList · Shikimori…</span></div>';
  setDiscoverStatus('Шукаю сторінки тайтлу через Vercel Python core…', 'loading');
  try {
    const payload = await searchGoogleSources(q);
    renderGoogleSourceGroups(payload.groups || []);
  } catch (error) {
    console.error(error);
    discoverResults.innerHTML = '';
    setDiscoverStatus(error.message || 'Помилка Google-пошуку у Python core.', 'error');
  }
}

openAddTitle?.addEventListener('click', openDiscoverModal);
discoverModal?.addEventListener('click', e => {
  if (e.target.closest('[data-discover-close]')) closeDiscoverModal();
});
discoverSearchForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const q = discoverSearchInput.value.trim();
  if (!q) return discoverSearchInput.focus();
  await executeDiscoverSearch(q);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && discoverModal && !discoverModal.classList.contains('hidden')) closeDiscoverModal();
});

loadAnime();
