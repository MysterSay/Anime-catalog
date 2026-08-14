let db = [];
let apiSources = [];
let apiOptions = { statuses: [], groups: [], groupOptions: [] };
let discoverSelected = null;

const catalog = document.getElementById('catalog');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const groupFilter = document.getElementById('groupFilter');
const statusFilter = document.getElementById('statusFilter');
const sortSelect = document.getElementById('sortSelect');
const excludeGroupFilter = document.getElementById('excludeGroupFilter');
const excludeStatusFilter = document.getElementById('excludeStatusFilter');
const hideFavoriteFilter = document.getElementById('hideFavoriteFilter');
const hideLikedFilter = document.getElementById('hideLikedFilter');
const excludeFilterMenu = document.getElementById('excludeFilterMenu');
const excludeFilterBtn = document.getElementById('excludeFilterBtn');
const excludeFilterPanel = document.getElementById('excludeFilterPanel');
const excludeFilterCount = document.getElementById('excludeFilterCount');
const clearExcludeFilters = document.getElementById('clearExcludeFilters');
const gridViewBtn = document.getElementById('gridViewBtn');
const listViewBtn = document.getElementById('listViewBtn');
const resultCount = document.getElementById('resultCount');
const heroTotal = document.getElementById('heroTotal');
const catalogTitle = document.getElementById('catalogTitle');
const quickButtons = [...document.querySelectorAll('[data-quick]')];
const toast = document.getElementById('toast');
const openAddTitle = document.getElementById('openAddTitle');
const openSettings = document.getElementById('openSettings');
const settingsModal = document.getElementById('settingsModal');
const settingsGroupsList = document.getElementById('settingsGroupsList');
const settingsStatus = document.getElementById('settingsStatus');
const discoverModal = document.getElementById('discoverModal');
const discoverSearchForm = document.getElementById('discoverSearchForm');
const discoverSearchInput = document.getElementById('discoverSearchInput');
const discoverResults = document.getElementById('discoverResults');
const discoverSetup = document.getElementById('discoverSetup');
const discoverStatus = document.getElementById('discoverStatus');
const discoverProgress = document.getElementById('discoverProgress');
const discoverProgressBar = document.getElementById('discoverProgressBar');
const discoverProgressPercent = document.getElementById('discoverProgressPercent');
const discoverProgressText = document.getElementById('discoverProgressText');

const STATUS_ORDER = ['Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто'];
const FALLBACK_IMAGE = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 700 1000%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%23171b27%22/%3E%3Cstop offset=%221%22 stop-color=%22%23282d42%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22700%22 height=%221000%22 fill=%22url(%23g)%22/%3E%3Ctext x=%22350%22 y=%22520%22 text-anchor=%22middle%22 fill=%22%23798094%22 font-family=%22Arial%22 font-size=%2270%22%3EYORU%3C/text%3E%3C/svg%3E';
const STATUS_THEME = {
  'Переглянув': { solid: '#7ee8b5', glow: 'rgba(126,232,181,.34)', border: 'rgba(126,232,181,.55)' },
  'Буду дивитись': { solid: '#a796ff', glow: 'rgba(167,150,255,.34)', border: 'rgba(167,150,255,.55)' },
  'Дивлюсь': { solid: '#70c9ff', glow: 'rgba(112,201,255,.34)', border: 'rgba(112,201,255,.55)' },
  'Відкладено': { solid: '#e7be72', glow: 'rgba(231,190,114,.34)', border: 'rgba(231,190,114,.55)' },
  'Кинуто': { solid: '#d688a3', glow: 'rgba(214,136,163,.34)', border: 'rgba(214,136,163,.55)' },
  'Без статусу': { solid: '#d5dceb', glow: 'rgba(213,220,235,.22)', border: 'rgba(213,220,235,.4)' },
};
const GROUP_COLOR_THEME = {
  default:{solid:'#a8b0bf',soft:'rgba(168,176,191,.12)',border:'rgba(168,176,191,.28)'},
  gray:{solid:'#9b9a97',soft:'rgba(155,154,151,.13)',border:'rgba(155,154,151,.30)'},
  brown:{solid:'#b08468',soft:'rgba(176,132,104,.14)',border:'rgba(176,132,104,.30)'},
  orange:{solid:'#d99058',soft:'rgba(217,144,88,.14)',border:'rgba(217,144,88,.32)'},
  yellow:{solid:'#d8b55b',soft:'rgba(216,181,91,.14)',border:'rgba(216,181,91,.32)'},
  green:{solid:'#6fbe8b',soft:'rgba(111,190,139,.14)',border:'rgba(111,190,139,.32)'},
  blue:{solid:'#65a8df',soft:'rgba(101,168,223,.14)',border:'rgba(101,168,223,.32)'},
  purple:{solid:'#a589d4',soft:'rgba(165,137,212,.14)',border:'rgba(165,137,212,.32)'},
  pink:{solid:'#d879a2',soft:'rgba(216,121,162,.14)',border:'rgba(216,121,162,.32)'},
  red:{solid:'#d76868',soft:'rgba(215,104,104,.14)',border:'rgba(215,104,104,.32)'},
};
const GROUP_COLOR_ORDER = ['default','gray','brown','orange','yellow','green','blue','purple','pink','red'];


const mergeFirstId = new URLSearchParams(location.search).get('merge') || '';
const mergeMode = Boolean(mergeFirstId);

let saved = {};
try { saved = JSON.parse(localStorage.getItem('yoru-state') || '{}'); } catch { saved = {}; }

const state = {
  view: saved.view || 'grid',
  quick: 'all',
  search: '',
  group: 'all',
  status: 'all',
  sort: 'added-desc',
  excludeGroup: saved.excludeGroup || 'all',
  excludeStatus: saved.excludeStatus || 'all',
  hideFavorite: Boolean(saved.hideFavorite),
  hideLiked: Boolean(saved.hideLiked),
  favorite: new Set(),
  liked: new Set(),
};

function saveState() {
  saved.view = state.view;
  saved.favorite = [...state.favorite];
  saved.liked = [...state.liked];
  saved.excludeGroup = state.excludeGroup;
  saved.excludeStatus = state.excludeStatus;
  saved.hideFavorite = state.hideFavorite;
  saved.hideLiked = state.hideLiked;
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

function statusTheme(status) {
  return STATUS_THEME[status] || STATUS_THEME['Без статусу'];
}

function groupOption(name) {
  return (apiOptions.groupOptions || []).find(option => normalize(option.name) === normalize(name)) || null;
}
function groupTheme(name) {
  const color = groupOption(name)?.color || 'default';
  return GROUP_COLOR_THEME[color] || GROUP_COLOR_THEME.default;
}
function groupTagStyle(name) {
  const t = groupTheme(name);
  return `--group-accent:${t.solid};--group-soft:${t.soft};--group-border:${t.border}`;
}

function syncExcludeControls() {
  if (excludeGroupFilter) excludeGroupFilter.value = state.excludeGroup;
  if (excludeStatusFilter) excludeStatusFilter.value = state.excludeStatus;
  if (hideFavoriteFilter) hideFavoriteFilter.checked = state.hideFavorite;
  if (hideLikedFilter) hideLikedFilter.checked = state.hideLiked;
  const count = [
    state.excludeGroup !== 'all',
    state.excludeStatus !== 'all',
    state.hideFavorite,
    state.hideLiked,
  ].filter(Boolean).length;
  if (excludeFilterCount) excludeFilterCount.textContent = String(count);
  excludeFilterBtn?.classList.toggle('has-active', count > 0);
  if (excludeFilterBtn) {
    excludeFilterBtn.dataset.tooltip = count ? `Фільтр: активно ${count}` : 'Фільтр: нічого не приховується';
    excludeFilterBtn.setAttribute('aria-label', excludeFilterBtn.dataset.tooltip);
  }
}

function toggleExcludePanel(force) {
  if (!excludeFilterPanel || !excludeFilterBtn) return;
  const next = typeof force === 'boolean' ? force : excludeFilterPanel.classList.contains('hidden');
  if (next) closeCustomSelects();
  excludeFilterPanel.classList.toggle('hidden', !next);
  excludeFilterBtn.setAttribute('aria-expanded', String(next));
  excludeFilterMenu?.classList.toggle('open', next);
}

const CUSTOM_SELECT_LABELS = {
  groupFilter: 'Група',
  statusFilter: 'Статус',
  sortSelect: 'Сортування',
  excludeStatusFilter: 'Не показувати статус',
  excludeGroupFilter: 'Не показувати групу',
};

function closeCustomSelects(except = null) {
  document.querySelectorAll('.custom-select.open').forEach(wrapper => {
    if (wrapper === except) return;
    wrapper.classList.remove('open');
    wrapper.querySelector('.custom-select-menu')?.classList.add('hidden');
    wrapper.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function syncCustomSelect(wrapper) {
  if (!wrapper) return;
  const selectId = wrapper.dataset.customSelect;
  const select = document.getElementById(selectId);
  const trigger = wrapper.querySelector('.custom-select-trigger');
  const menu = wrapper.querySelector('.custom-select-menu');
  if (!select || !trigger || !menu) return;

  const selected = select.options[select.selectedIndex] || select.options[0];
  const selectedText = selected?.textContent || '';
  const nestedValue = trigger.querySelector('.nested-select-value');
  if (nestedValue) nestedValue.textContent = selectedText;

  if (trigger.classList.contains('icon-control')) {
    const label = CUSTOM_SELECT_LABELS[selectId] || 'Фільтр';
    trigger.dataset.tooltip = `${label}: ${selectedText}`;
    trigger.setAttribute('aria-label', `${label}: ${selectedText}`);
  }

  const isGroupSelect = selectId === 'groupFilter' || selectId === 'excludeGroupFilter';
  menu.innerHTML = [...select.options].map(option => {
    const group = isGroupSelect && option.value !== 'all' ? groupOption(option.value) : null;
    const theme = group ? (GROUP_COLOR_THEME[group.color] || GROUP_COLOR_THEME.default) : null;
    const dot = theme ? `<b class="group-color-dot" style="--dot:${theme.solid}"></b>` : '';
    return `
    <button class="custom-select-option ${option.value === select.value ? 'selected' : ''}" type="button" role="option"
      aria-selected="${option.value === select.value ? 'true' : 'false'}" data-custom-option="${escapeHtml(option.value)}">
      <span class="custom-option-label">${dot}<span>${escapeHtml(option.textContent)}</span></span>
      <i>✓</i>
    </button>`;
  }).join('');
}

function syncCustomSelects() {
  document.querySelectorAll('.custom-select[data-custom-select]').forEach(syncCustomSelect);
}

function openCustomSelect(wrapper) {
  const menu = wrapper?.querySelector('.custom-select-menu');
  const trigger = wrapper?.querySelector('.custom-select-trigger');
  if (!wrapper || !menu || !trigger) return;
  const willOpen = !wrapper.classList.contains('open');
  closeCustomSelects(wrapper);
  if (willOpen) {
    toggleExcludePanel(wrapper.closest('#excludeFilterPanel') ? true : false);
    wrapper.classList.add('open');
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  } else {
    wrapper.classList.remove('open');
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }
}

function populateFilters() {
  groupFilter.innerHTML = '<option value="all">Усі групи</option>';
  statusFilter.innerHTML = '<option value="all">Усі статуси</option>';
  if (excludeGroupFilter) excludeGroupFilter.innerHTML = '<option value="all">Нічого не приховувати</option>';
  if (excludeStatusFilter) excludeStatusFilter.innerHTML = '<option value="all">Нічого не приховувати</option>';

  const groups = [...new Set([...(apiOptions.groups || []), ...db.map(x => x.group).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'uk'));
  groups.forEach(group => {
    const option = `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`;
    groupFilter.insertAdjacentHTML('beforeend', option);
    excludeGroupFilter?.insertAdjacentHTML('beforeend', option);
  });

  const statuses = [...new Set(db.map(x => x.status).filter(Boolean))];
  statuses.sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a);
    const bi = STATUS_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'uk');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  statuses.forEach(status => {
    const option = `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`;
    statusFilter.insertAdjacentHTML('beforeend', option);
    excludeStatusFilter?.insertAdjacentHTML('beforeend', option);
  });

  syncExcludeControls();
  syncCustomSelects();
}

function getFiltered() {
  const items = db.filter(item => {
    if (mergeMode && item.id === mergeFirstId) return false;
    const haystack = normalize([item.title, item.group, item.status].join(' '));
    const matchesSearch = !state.search || haystack.includes(normalize(state.search));
    const matchesGroup = state.group === 'all' || item.group === state.group;
    const matchesStatus = state.status === 'all' || item.status === state.status;
    const matchesQuick = state.quick === 'all' ||
      (state.quick === 'favorite' && state.favorite.has(item.id)) ||
      (state.quick === 'liked' && state.liked.has(item.id));
    const excludedGroup = state.excludeGroup !== 'all' && item.group === state.excludeGroup;
    const excludedStatus = state.excludeStatus !== 'all' && item.status === state.excludeStatus;
    const excludedFavorite = state.hideFavorite && state.favorite.has(item.id);
    const excludedLiked = state.hideLiked && state.liked.has(item.id);
    return matchesSearch && matchesGroup && matchesStatus && matchesQuick && !excludedGroup && !excludedStatus && !excludedFavorite && !excludedLiked;
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
  const theme = statusTheme(item.status || 'Без статусу');
  const href = mergeMode
    ? `merge.html?right=${encodeURIComponent(mergeFirstId)}&left=${encodeURIComponent(item.id)}`
    : `title.html?id=${encodeURIComponent(item.id)}`;
  return `
    <article class="anime-card ${mergeMode ? 'merge-candidate-card' : ''}" style="--delay:${Math.min(index * 35, 280)}ms; --status-accent:${theme.solid}; --status-accent-glow:${theme.glow}; --status-accent-border:${theme.border}" data-id="${escapeHtml(item.id)}">
      <a class="card-link" href="${href}" aria-label="${mergeMode ? 'Обрати для об’єднання' : 'Відкрити'} ${escapeHtml(item.title)}"></a>
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
          <span class="card-group-tag" style="${groupTagStyle(item.group || 'Без групи')}">${escapeHtml(item.group || 'Без групи')}</span>
          <span>${formatDate(item.addedAt)}</span>
        </div>
        <p>${escapeHtml(item.description || 'Опис поки відсутній.')}</p>
      </div>
    </article>`;
}


function renderMergeDock() {
  document.getElementById('mergeSelectionDock')?.remove();
  document.body.classList.toggle('merge-pick-mode', mergeMode);
  if (!mergeMode) return;
  const first = db.find(item => item.id === mergeFirstId);
  if (!first) return;
  const theme = statusTheme(first.status || 'Без статусу');
  document.body.insertAdjacentHTML('beforeend', `
    <aside id="mergeSelectionDock" class="merge-selection-dock" style="--status-accent:${theme.solid}; --status-accent-glow:${theme.glow}; --status-accent-border:${theme.border}">
      <a class="merge-selection-back" href="title.html?id=${encodeURIComponent(first.id)}" aria-label="Скасувати об’єднання">×</a>
      <span class="merge-selection-kicker">ПЕРШИЙ ТАЙТЛ</span>
      <div class="merge-selection-card">
        <img src="${escapeHtml(first.poster || FALLBACK_IMAGE)}" alt="${escapeHtml(first.title)}" />
        <div><strong>${escapeHtml(first.title)}</strong><small>${escapeHtml(first.status || 'Без статусу')} · ${escapeHtml(first.group || 'Без групи')}</small></div>
      </div>
      <p>Обери другий тайтл у каталозі. Пошук, сортування та фільтри працюють як звичайно.</p>
    </aside>`);
  catalogTitle.textContent = 'Обери тайтл для об’єднання';
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
  groupFilter.value = state.group;
  statusFilter.value = state.status;
  sortSelect.value = state.sort;
  syncExcludeControls();
  syncCustomSelects();
  renderMergeDock();

  const ids = new Set(db.map(x => x.id));
  document.getElementById('countAll').textContent = db.length;
  document.getElementById('countFavorite').textContent = [...state.favorite].filter(id => ids.has(id)).length;
  document.getElementById('countLiked').textContent = [...state.liked].filter(id => ids.has(id)).length;
  catalogTitle.textContent = mergeMode ? 'Обери тайтл для об’єднання' : (state.quick === 'favorite' ? 'Вибране' : state.quick === 'liked' ? 'Улюблене' : 'Усі тайтли');
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

    state.favorite.clear();
    state.liked.clear();
    db.filter(x => x.favorite).forEach(x => state.favorite.add(x.id));
    db.filter(x => x.liked).forEach(x => state.liked.add(x.id));
    saveState();

    populateFilters();
    render();
  } catch (error) {
    console.error(error);
    showLoadError(error.message || 'Невідома помилка API.');
  }
}

catalog.addEventListener('click', async e => {
  const action = e.target.closest('[data-action]');
  if (!action || action.dataset.busy === '1') return;
  e.preventDefault();
  e.stopPropagation();
  const card = action.closest('[data-id]');
  const id = card?.dataset.id;
  if (!id) return;
  const kind = action.dataset.action === 'favorite' ? 'favorite' : 'liked';
  const set = kind === 'favorite' ? state.favorite : state.liked;
  const next = !set.has(id);
  action.dataset.busy = '1';
  action.disabled = true;
  if (next) set.add(id); else set.delete(id);
  render();
  try {
    const response = await fetch(`/api/anime?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ [kind]: next }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const item = payload.item;
    const actual = Boolean(item?.[kind]);
    if (actual) set.add(id); else set.delete(id);
    const dbItem = db.find(x => x.id === id);
    if (dbItem) dbItem[kind] = actual;
    saveState();
    render();
    showToast(kind === 'favorite' ? 'Вибране збережено в Notion' : 'Улюблене збережено в Notion');
  } catch (error) {
    if (next) set.delete(id); else set.add(id);
    render();
    showToast(error.message || 'Не вдалося зберегти в Notion');
  }
});

searchInput.addEventListener('input', () => { state.search = searchInput.value.trim(); render(); });
groupFilter.addEventListener('change', () => { state.group = groupFilter.value; render(); });
statusFilter.addEventListener('change', () => { state.status = statusFilter.value; render(); });
sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; render(); });
excludeGroupFilter?.addEventListener('change', () => { state.excludeGroup = excludeGroupFilter.value; saveState(); render(); });
excludeStatusFilter?.addEventListener('change', () => { state.excludeStatus = excludeStatusFilter.value; saveState(); render(); });
hideFavoriteFilter?.addEventListener('change', () => { state.hideFavorite = hideFavoriteFilter.checked; saveState(); render(); });
hideLikedFilter?.addEventListener('change', () => { state.hideLiked = hideLikedFilter.checked; saveState(); render(); });
clearExcludeFilters?.addEventListener('click', () => {
  state.excludeGroup = 'all';
  state.excludeStatus = 'all';
  state.hideFavorite = false;
  state.hideLiked = false;
  saveState();
  render();
});
excludeFilterBtn?.addEventListener('click', () => toggleExcludePanel());
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
  if (e.key === 'Escape') toggleExcludePanel(false);
});

document.addEventListener('click', e => {
  const option = e.target.closest('[data-custom-option]');
  if (option) {
    const wrapper = option.closest('.custom-select');
    const select = document.getElementById(wrapper?.dataset.customSelect || '');
    if (wrapper && select) {
      select.value = option.dataset.customOption;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncCustomSelect(wrapper);
      closeCustomSelects();
    }
    return;
  }

  const trigger = e.target.closest('.custom-select-trigger');
  if (trigger) {
    openCustomSelect(trigger.closest('.custom-select'));
    return;
  }

  if (!e.target.closest('.custom-select')) closeCustomSelects();
  if (excludeFilterMenu && !excludeFilterMenu.contains(e.target)) toggleExcludePanel(false);
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


function resetDiscoverProgress() {
  if (!discoverProgress) return;
  discoverProgress.classList.add('hidden');
  if (discoverProgressBar) discoverProgressBar.style.width = '0%';
  if (discoverProgressPercent) discoverProgressPercent.textContent = '0%';
  if (discoverProgressText) discoverProgressText.textContent = 'Очікую запуск…';
}

function updateDiscoverProgress(packet = {}) {
  if (!discoverProgress) return;
  const percent = Math.max(0, Math.min(100, Number(packet.percent) || 0));
  discoverProgress.classList.remove('hidden');
  if (discoverProgressBar) discoverProgressBar.style.width = `${percent}%`;
  if (discoverProgressPercent) discoverProgressPercent.textContent = `${Math.round(percent)}%`;
  if (discoverProgressText) {
    const domain = packet.domain ? ` · ${packet.domain}` : '';
    discoverProgressText.textContent = `${packet.message || packet.stage || 'Обробка…'}${domain}`;
  }
}

async function readNdjsonStream(response, onPacket) {
  if (!response.body?.getReader) throw new Error('Браузер не підтримує streaming response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) buffer += decoder.decode();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let packet;
      try { packet = JSON.parse(line); } catch { continue; }
      onPacket?.(packet);
      if (packet.type === 'error') throw new Error(packet.message || 'Python core завершився з помилкою.');
      if (packet.type === 'result' && packet.result) finalResult = packet.result;
    }
    if (done) break;
  }

  if (buffer.trim()) {
    let packet = null;
    try { packet = JSON.parse(buffer); } catch {}
    if (packet) {
      onPacket?.(packet);
      if (packet.type === 'error') throw new Error(packet.message || 'Python core завершився з помилкою.');
      if (packet.type === 'result' && packet.result) finalResult = packet.result;
    }
  }
  return finalResult;
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
  resetDiscoverProgress();
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
  resetDiscoverProgress();
  updateDiscoverProgress({ percent: 0, stage: 'queued', message: 'Запускаю повний пошук…' });
  setDiscoverStatus(`Повний пошук для «${sourceTitle || 'тайтл'}» запущено.`, 'loading');

  try {
    const response = await fetch('/api/process-title-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        title: sourceTitle || discoverSearchInput.value.trim(),
        url: item.url,
        status: '',
        group: '',
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    const coreResult = await readNdjsonStream(response, packet => {
      if (packet.type === 'progress' || packet.type === 'heartbeat') {
        updateDiscoverProgress(packet);
        setDiscoverStatus(packet.message || 'Python core працює…', 'loading');
      }
    });
    if (!coreResult?.title) throw new Error('Python core завершив stream без фінального JSON.');

    updateDiscoverProgress({ percent: 99, stage: 'notion', message: 'JSON готовий. Записую в Notion…' });
    setDiscoverStatus('Повний JSON отримано. Записую в Notion…', 'loading');
    const ingestResponse = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(coreResult),
      cache: 'no-store',
    });
    const payload = await ingestResponse.json().catch(() => ({}));
    if (!ingestResponse.ok) throw new Error(payload.error || `Notion ingest HTTP ${ingestResponse.status}`);
    if (!payload.item?.id) throw new Error('Notion не повернув ID тайтлу.');

    updateDiscoverProgress({ percent: 100, stage: 'done', message: payload.existing ? 'Дані тайтлу оновлено.' : 'Тайтл додано в Notion.' });
    setDiscoverStatus(payload.existing ? 'Тайтл уже був у Notion — дані оновлено.' : 'Повний пошук завершено, тайтл додано в Notion.', 'ok');
    await new Promise(resolve => setTimeout(resolve, 650));
    location.href = `title.html?id=${encodeURIComponent(payload.item.id)}`;
  } catch (error) {
    console.error(error);
    discoverSelected = null;
    discoverResults.querySelectorAll('.source-discover-result').forEach(el => { el.disabled = false; });
    button?.classList.remove('processing');
    const current = Number(String(discoverProgressPercent?.textContent || '0').replace('%', '')) || 0;
    updateDiscoverProgress({ percent: current, stage: 'error', message: error.message || 'Помилка.' });
    setDiscoverStatus(error.message || 'Не вдалося обробити тайтл.', 'error');
  }
}


async function executeDiscoverSearch(q) {
  discoverSelected = null;
  resetDiscoverProgress();
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


function setSettingsStatus(message = '', type = '') {
  if (!settingsStatus) return;
  settingsStatus.textContent = message;
  settingsStatus.className = `discover-status ${type}`.trim();
}

function renderSettingsGroups() {
  if (!settingsGroupsList) return;
  const groups = Array.isArray(apiOptions.groupOptions) ? apiOptions.groupOptions : [];
  if (!groups.length) {
    settingsGroupsList.innerHTML = '<div class="settings-empty">У Notion ще немає груп.</div>';
    return;
  }
  settingsGroupsList.innerHTML = groups.map(group => {
    const color = GROUP_COLOR_THEME[group.color] || GROUP_COLOR_THEME.default;
    return `<article class="group-setting-row" data-group-setting="${escapeHtml(group.id || group.name)}" data-group-id="${escapeHtml(group.id || '')}" data-group-old-name="${escapeHtml(group.name)}">
      <div class="group-setting-main">
        <span class="group-setting-preview" style="--group-accent:${color.solid};--group-soft:${color.soft};--group-border:${color.border}">${escapeHtml(group.name)}</span>
        <input class="group-setting-name" type="text" value="${escapeHtml(group.name)}" aria-label="Назва групи ${escapeHtml(group.name)}" />
      </div>
      <div class="group-color-palette" role="group" aria-label="Колір групи ${escapeHtml(group.name)}">
        ${GROUP_COLOR_ORDER.map(colorName => {
          const t = GROUP_COLOR_THEME[colorName];
          return `<button class="group-color-swatch ${colorName === group.color ? 'selected' : ''}" type="button" data-group-color="${colorName}" style="--swatch:${t.solid}" title="${colorName}"></button>`;
        }).join('')}
      </div>
      <button class="group-setting-save" type="button" data-save-group>Зберегти</button>
    </article>`;
  }).join('');
}

function openSettingsModal() {
  if (!settingsModal) return;
  renderSettingsGroups();
  setSettingsStatus('');
  settingsModal.classList.remove('hidden');
  settingsModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}
function closeSettingsModal() {
  if (!settingsModal) return;
  settingsModal.classList.add('hidden');
  settingsModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

async function saveGroupSetting(row) {
  const button = row.querySelector('[data-save-group]');
  const input = row.querySelector('.group-setting-name');
  const selected = row.querySelector('.group-color-swatch.selected');
  const name = input?.value.trim() || '';
  const color = selected?.dataset.groupColor || 'default';
  if (!name) return setSettingsStatus('Назва групи не може бути порожньою.', 'error');
  button.disabled = true;
  setSettingsStatus(`Оновлюю «${row.dataset.groupOldName}» у Notion…`, 'loading');
  try {
    const response = await fetch('/api/groups', {
      method:'PATCH', headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({ id:row.dataset.groupId, oldName:row.dataset.groupOldName, name, color }), cache:'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    apiOptions = { ...apiOptions, groups: payload.groups || [], groupOptions: payload.groupOptions || [] };
    setSettingsStatus(`Готово. Оновлено записів: ${payload.migrated || 0}.`, 'ok');
    await loadAnime();
    renderSettingsGroups();
  } catch (error) {
    setSettingsStatus(error.message || 'Не вдалося оновити групу.', 'error');
  } finally { button.disabled = false; }
}

openSettings?.addEventListener('click', openSettingsModal);
settingsModal?.addEventListener('click', e => {
  if (e.target.closest('[data-settings-close]')) return closeSettingsModal();
  const swatch = e.target.closest('[data-group-color]');
  if (swatch) {
    const row = swatch.closest('[data-group-setting]');
    row?.querySelectorAll('.group-color-swatch').forEach(el => el.classList.toggle('selected', el === swatch));
    const theme = GROUP_COLOR_THEME[swatch.dataset.groupColor] || GROUP_COLOR_THEME.default;
    const preview = row?.querySelector('.group-setting-preview');
    if (preview) preview.style.cssText = `--group-accent:${theme.solid};--group-soft:${theme.soft};--group-border:${theme.border}`;
    return;
  }
  const save = e.target.closest('[data-save-group]');
  if (save) saveGroupSetting(save.closest('[data-group-setting]'));
});

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
  if (e.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) closeSettingsModal();
});

loadAnime();
