(() => {
  'use strict';

  const VERSION = '7.8.8';
  const MODE_ANNOUNCED = '__announced__';
  const MODE_RECOMMENDED = '__recommended__';
  const MODE_INCOMPLETE = '__incomplete_season__';
  const isTitlePage = document.body.classList.contains('title-page');
  let timerId = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const safeUrl = value => {
    try {
      const u = new URL(String(value || '').trim(), location.href);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch { return ''; }
  };
  const text = value => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const key = value => text(value).normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/[’'`´]/g, '').replace(/[‐‑‒–—―]/g, '-').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const first = (...values) => {
    for (const value of values.flat(Infinity)) if (typeof value === 'string' && value.trim()) return value.trim();
    return '';
  };
  const pad2 = value => String(Math.max(0, Math.floor(Number(value) || 0))).padStart(2, '0');
  const intLabel = value => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return Number.isInteger(num) ? String(num) : String(value).replace(/\.0$/, '');
  };
  const image = value => {
    if (typeof value === 'string') return safeUrl(value);
    if (!value || typeof value !== 'object') return '';
    return safeUrl(value.original || value.extraLarge || value.large || value.medium || value.small || value.url || value.src || '');
  };

  function aniHubItem(raw = {}) {
    const titles = raw.titles && typeof raw.titles === 'object' ? raw.titles : {};
    const id = String(raw.id ?? raw.anime_id ?? '').trim();
    const slug = String(raw.slug || '').trim();
    const title = text(first(raw.title_ukrainian, titles.ukrainian, titles.uk, titles.ua, raw.title, raw.name, raw.title_english, titles.english, raw.title_original, titles.original)) || 'Без назви';
    const originalTitle = text(first(raw.title_original, titles.original, titles.romaji, titles.native));
    const englishTitle = text(first(raw.title_english, titles.english));
    const poster = image(raw.poster || raw.poster_url || raw.posterImage || raw.image || raw.cover || raw.images?.poster || raw.images?.cover);
    const banner = image(raw.banner || raw.banner_url || raw.bannerImage || raw.coverImage || raw.images?.banner || raw.background) || poster;
    const sourceUrl = safeUrl(raw.site_url || raw.siteUrl || raw.public_url || raw.publicUrl || raw.url || '') || (slug && id ? `https://anihub.in.ua/anime/${encodeURIComponent(slug)}-${encodeURIComponent(id)}` : id ? `https://anihub.in.ua/anime/${encodeURIComponent(id)}` : '');
    const genresRaw = Array.isArray(raw.genres) ? raw.genres : [];
    const genres = genresRaw.map(x => typeof x === 'string' ? x : text(x?.name || x?.title || x?.title_ukrainian || '')).filter(Boolean);
    return {
      remote: true,
      anihubId: id,
      id,
      slug,
      malId: raw.mal_id ?? raw.malId ?? null,
      anilistId: raw.anilist_id ?? raw.anilistId ?? raw.anilist_media_id ?? null,
      title,
      originalTitle,
      englishTitle,
      poster,
      banner,
      description: text(raw.description_ukrainian || raw.description || raw.synopsis || raw.overview || ''),
      genres,
      year: raw.year || raw.season_year || null,
      type: text(raw.type || ''),
      status: text(raw.status || ''),
      episodes: raw.episodes_count ?? raw.episodes ?? null,
      rating: raw.rating?.value ?? raw.rating ?? raw.score ?? null,
      sourceUrl,
      previewUrl: id ? `title.html?preview=anihub&anihub=${encodeURIComponent(id)}` : sourceUrl,
    };
  }

  function payloadItems(payload) {
    if (Array.isArray(payload)) return payload;
    for (const name of ['items', 'results', 'data', 'similar', 'recommendations', 'anime']) {
      if (Array.isArray(payload?.[name])) return payload[name];
    }
    return [];
  }

  function localSavedIndex() {
    const titles = new Set(), anihubIds = new Set(), anilistIds = new Set(), malIds = new Set();
    if (typeof db !== 'undefined' && Array.isArray(db)) {
      for (const item of db) {
        for (const value of [item?.title, item?.originalTitle, item?.englishTitle, item?.russianTitle]) {
          const k = key(value); if (k) titles.add(k);
        }
        if (item?.anihubId) anihubIds.add(String(item.anihubId));
        if (item?.anilistId) anilistIds.add(String(item.anilistId));
        if (item?.malId) malIds.add(String(item.malId));
      }
    }
    return { titles, anihubIds, anilistIds, malIds };
  }

  function isStoredCandidate(item, index = localSavedIndex()) {
    if (!item) return false;
    if (item.anihubId && index.anihubIds.has(String(item.anihubId))) return true;
    if (item.anilistId && index.anilistIds.has(String(item.anilistId))) return true;
    if (item.malId && index.malIds.has(String(item.malId))) return true;
    return [item.title, item.originalTitle, item.englishTitle].some(value => {
      const k = key(value); return Boolean(k && index.titles.has(k));
    });
  }

  async function waitMainReady() {
    if (isTitlePage) return;
    for (let i = 0; i < 120; i++) {
      const node = document.getElementById('catalog');
      if (node && !node.classList.contains('loading-grid')) return;
      await sleep(100);
    }
  }

  function setCatalogHeading(title, count) {
    const heading = document.getElementById('catalogTitle');
    if (heading) heading.textContent = title;
    const result = document.getElementById('resultCount');
    if (result) result.textContent = String(count || 0);
    document.title = `${title} — Yoru`;
  }

  function showCatalogEmpty(title, message) {
    setCatalogHeading(title, 0);
    const empty = document.getElementById('emptyState');
    if (empty) {
      empty.classList.remove('hidden');
      empty.innerHTML = `<div class="empty-icon">◇</div><h3>Нічого не знайдено</h3><p>${message}</p>`;
    }
  }

  function renderRemoteMode(items, title, emptyMessage) {
    if (typeof similarItems !== 'undefined') similarItems = items.map(item => ({ ...item, remote: true }));
    if (typeof render === 'function') render();
    setCatalogHeading(title, items.length);
    if (!items.length) showCatalogEmpty(title, emptyMessage);
    requestAnimationFrame(augmentCatalogCards);
  }

  function cloneLocalItem(item) {
    return {
      ...item,
      remote: false,
      previewUrl: `title.html?id=${encodeURIComponent(item.id)}`,
    };
  }

  function renderLocalMode(items, title, emptyMessage) {
    if (typeof similarItems !== 'undefined') similarItems = items.map(cloneLocalItem);
    if (typeof render === 'function') render();
    setCatalogHeading(title, items.length);
    if (!items.length) showCatalogEmpty(title, emptyMessage);
    requestAnimationFrame(() => {
      augmentCatalogCards();
      updateCountdowns();
    });
  }

  async function loadCollection(kind) {
    if (typeof showLoading === 'function') showLoading();
    const title = kind === 'announced' ? 'Анонсовані тайтли' : 'Рекомендовані тайтли';
    try {
      const response = await fetch(`/api/anihub/collection?kind=${encodeURIComponent(kind)}&limit=20`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const savedIndex = localSavedIndex();
      const items = payloadItems(payload).map(aniHubItem).filter(item => !isStoredCandidate(item, savedIndex));
      for (const item of items) item.previewUrl = `title.html?preview=anihub&anihub=${encodeURIComponent(item.anihubId)}&from=${encodeURIComponent(kind)}`;
      renderRemoteMode(items, title, 'AniHub не повернув нових тайтлів, яких ще немає у твоїй базі.');
    } catch (error) {
      console.error('[YORU AniHub collection]', error);
      renderRemoteMode([], title, error.message || 'Не вдалося отримати добірку AniHub.');
    }
  }

  async function loadOfficialSimilar(tursoId) {
    if (typeof showLoading === 'function') showLoading();
    try {
      const params = new URLSearchParams({ id: tursoId, limit: '24' });
      const hinted = String(new URLSearchParams(location.search).get('anihub') || '').trim();
      if (hinted) params.set('anihub', hinted);
      const response = await fetch(`/api/anihub/similar-v2?${params.toString()}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const savedIndex = localSavedIndex();
      const items = payloadItems(payload).map(aniHubItem).filter(item => !isStoredCandidate(item, savedIndex));
      for (const item of items) item.previewUrl = `title.html?preview=anihub&anihub=${encodeURIComponent(item.anihubId)}&from=similar`;
      renderRemoteMode(items, 'Схожі тайтли', 'AniHub не повернув схожих тайтлів, яких ще немає у твоїй базі.');
    } catch (error) {
      console.error('[YORU similar]', error);
      renderRemoteMode([], 'Схожі тайтли', error.message || 'Не вдалося отримати схожі тайтли.');
    }
  }

  function addCollectionButtons() {
    const row = document.querySelector('.filters-row.compact-controls-row');
    if (!row || row.querySelector('.anihub-collection-actions')) return;
    const mode = new URLSearchParams(location.search).get('similar') || '';
    const wrap = document.createElement('div');
    wrap.className = 'anihub-collection-actions';
    wrap.innerHTML = `
      <a class="anihub-collection-btn${mode === MODE_ANNOUNCED ? ' active' : ''}" href="index.html?similar=${encodeURIComponent(MODE_ANNOUNCED)}" title="Анонсовані тайтли AniHub"><span class="anihub-collection-icon">◌</span><span>Анонси</span></a>
      <a class="anihub-collection-btn${mode === MODE_RECOMMENDED ? ' active' : ''}" href="index.html?similar=${encodeURIComponent(MODE_RECOMMENDED)}" title="Рекомендовані тайтли AniHub"><span class="anihub-collection-icon">✦</span><span>Рекомендовані</span></a>
      <a class="anihub-collection-btn incomplete-season-btn${mode === MODE_INCOMPLETE ? ' active' : ''}" href="index.html?similar=${encodeURIComponent(MODE_INCOMPLETE)}" title="Тайтли, де сезон ще не вийшов повністю"><span class="anihub-collection-icon">◔</span><span>Не повний сезон</span></a>`;
    row.prepend(wrap);
  }

  function idsFromLinks(item) {
    let anihubId = String(item?.anihubId || ''), anilistId = String(item?.anilistId || '');
    for (const link of item?.links || []) {
      const value = String(link?.url || '');
      if (!anilistId) anilistId = value.match(/anilist\.co\/anime\/(\d+)/i)?.[1] || '';
      if (!anihubId && /anihub\.in\.ua/i.test(value)) {
        try {
          const pathname = new URL(value).pathname;
          anihubId = pathname.match(/(?:-|\/)(\d+)(?:\/?$|[?#])/)?.[1] || '';
        } catch {}
      }
    }
    return { anihubId, anilistId };
  }

  function scheduleState(item) {
    const airing = item?.airing && typeof item.airing === 'object' ? item.airing : null;
    if (!airing) return null;
    const lastEpisode = airing.releasedEpisodes ?? airing.lastEpisode ?? null;
    const totalRaw = airing.totalEpisodes ?? item?.episodesCount ?? item?.totalEpisodes ?? null;
    const totalNumber = Number(totalRaw);
    const totalEpisodes = Number.isFinite(totalNumber) && totalNumber > 0 ? totalNumber : null;
    const nextEpisode = airing.nextEpisode ?? null;
    const nextAt = Number(airing.nextAt || 0);
    if (lastEpisode == null && !nextAt) return null;
    return { lastEpisode, totalEpisodes, nextEpisode, nextAt };
  }

  function isIncompleteSeasonItem(item) {
    const state = scheduleState(item);
    if (!state) return false;
    const released = Number(state.lastEpisode);
    const total = Number(state.totalEpisodes);
    if (Number.isFinite(released) && Number.isFinite(total) && total > 0) return released < total;
    return Boolean(state.nextAt);
  }

  function buildIncompleteSeasonItems() {
    if (typeof db === 'undefined' || !Array.isArray(db)) return [];
    return db.filter(isIncompleteSeasonItem);
  }

  let airingLoadPromise = null;
  async function fetchAiringMap({ id = '', retry = true } = {}) {
    const qs = new URLSearchParams();
    if (id) qs.set('id', id);
    let response = await fetch(`/api/anihub/airing-map${qs.size ? `?${qs.toString()}` : ''}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    let payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload?.cache?.state === 'warming' && retry) {
      await sleep(1800);
      response = await fetch(`/api/anihub/airing-map${qs.size ? `?${qs.toString()}` : ''}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
  }

  async function hydrateCatalogAiring() {
    if (isTitlePage || typeof db === 'undefined' || !Array.isArray(db) || !db.length) return;
    if (airingLoadPromise) return airingLoadPromise;
    airingLoadPromise = (async () => {
      try {
        const payload = await fetchAiringMap({ retry: true });
        const map = payload?.items && typeof payload.items === 'object' ? payload.items : {};
        for (const item of db) item.airing = map[String(item.id)] || null;
        augmentCatalogCards();
      } catch (error) {
        console.warn('[YORU airing map]', error);
      }
    })().finally(() => { airingLoadPromise = null; });
    return airingLoadPromise;
  }

  async function hydrateTitleAiring() {
    if (!isTitlePage || typeof currentItem === 'undefined' || !currentItem?.id) return;
    try {
      const payload = await fetchAiringMap({ id: String(currentItem.id), retry: true });
      currentItem.airing = payload?.item || null;
      augmentTitleSchedule();
    } catch (error) {
      console.warn('[YORU title airing]', error);
    }
  }

  function formatLegacyCountdown(timestamp) {
    const total = Math.max(0, Math.floor(Number(timestamp || 0) - Date.now() / 1000));
    if (total <= 0) return 'виходить зараз';
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const hms = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    return days ? `${days} д ${hms}` : hms;
  }

  function formatCardSchedule(timestamp) {
    const ts = Number(timestamp || 0);
    if (!ts) return 'дата не оголошена';
    const remaining = Math.max(0, Math.floor(ts - Date.now() / 1000));
    const days = Math.floor(remaining / 86400);
    const dt = new Date(ts * 1000);
    const clock = `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
    return days > 0 ? `через ${days} д, о ${clock}` : `о ${clock}`;
  }

  function formatTitleCountdown(timestamp) {
    const total = Math.max(0, Math.floor(Number(timestamp || 0) - Date.now() / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${days}д:${pad2(hours)}г:${pad2(minutes)}х:${pad2(seconds)}с`;
  }

  function updateCountdowns() {
    document.querySelectorAll('[data-airing-at]').forEach(node => {
      const ts = Number(node.dataset.airingAt || 0);
      const format = String(node.dataset.airingFormat || '');
      let label = '';
      if (format === 'card-schedule') label = formatCardSchedule(ts);
      else if (format === 'title-countdown') label = formatTitleCountdown(ts);
      else label = formatLegacyCountdown(ts);
      const prefix = node.dataset.airingPrefix || '';
      node.textContent = prefix ? `${prefix}${label}` : label;
    });
  }

  function findCatalogItem(card) {
    const id = card?.dataset?.id || '';
    if (typeof db !== 'undefined' && Array.isArray(db)) {
      const local = db.find(item => String(item.id) === id);
      if (local) return local;
    }
    if (typeof similarItems !== 'undefined' && Array.isArray(similarItems)) return similarItems.find(item => String(item.id) === id || String(item.anihubId) === id) || null;
    return null;
  }

  function airingSignature(state) {
    if (!state) return '';
    return `${state.lastEpisode ?? ''}|${state.totalEpisodes ?? ''}|${state.nextEpisode ?? ''}|${Number(state.nextAt || 0)}`;
  }

  function decorateIncompleteCardMode(card, item, state) {
    const params = new URLSearchParams(location.search);
    const active = params.get('similar') === MODE_INCOMPLETE;
    card.classList.remove('airing-progress-match', 'airing-progress-mismatch');
    if (!active || !item || !state) return;
    const watched = Number(item?.episode || 0);
    const released = Number(state.lastEpisode || 0);
    if (!Number.isFinite(released)) return;
    card.classList.add(watched === released ? 'airing-progress-match' : 'airing-progress-mismatch');
  }

  function augmentCatalogCards() {
    if (isTitlePage) return;
    document.querySelectorAll('#catalog .anime-card').forEach(card => {
      const item = findCatalogItem(card);
      if (!item || item.remote) return;
      const state = scheduleState(item);
      const old = card.querySelector('.airing-card-row');
      decorateIncompleteCardMode(card, item, state);
      if (!state || (state.lastEpisode == null && !state.nextAt)) {
        if (old) old.remove();
        return;
      }
      const body = card.querySelector('.card-body');
      if (!body) return;
      const signature = airingSignature(state);
      if (old?.dataset.airingSignature === signature) return;
      const lastHtml = state.lastEpisode != null
        ? `<span class="airing-last"><b>${intLabel(state.lastEpisode)}</b></span>`
        : '<span class="airing-last"><b>—</b></span>';
      const nextLabel = state.nextEpisode != null ? `${intLabel(state.nextEpisode)} · ` : '';
      const nextHtml = state.nextAt
        ? `<span class="airing-next"><b>${nextLabel}</b><i data-airing-format="card-schedule" data-airing-at="${state.nextAt}"></i></span>`
        : '<span class="airing-next"><i>дата не оголошена</i></span>';
      const html = `<div class="airing-card-row" data-airing-signature="${signature}">${lastHtml}${nextHtml}</div>`;
      if (old) old.outerHTML = html;
      else body.insertAdjacentHTML('beforeend', html);
    });
    updateCountdowns();
  }

  function augmentTitleSchedule() {
    if (!isTitlePage || typeof currentItem === 'undefined' || !currentItem) return;
    const workspace = document.querySelector('#titleRoot .title-media-workspace');
    if (!workspace) return;
    const state = scheduleState(currentItem);
    const old = document.querySelector('#titleRoot .title-airing-strip');
    if (!state || (state.lastEpisode == null && !state.nextAt)) {
      if (old) old.remove();
      return;
    }
    const signature = airingSignature(state);
    if (old?.dataset.airingSignature === signature) return;
    const lastValue = state.lastEpisode != null
      ? `${intLabel(state.lastEpisode)}${state.totalEpisodes ? `/${intLabel(state.totalEpisodes)}` : ''}`
      : '—';
    const timerText = state.nextAt
      ? `<strong><i data-airing-format="title-countdown" data-airing-at="${state.nextAt}"></i></strong>`
      : '<strong><i>дата не оголошена</i></strong>';
    const html = `<div class="title-airing-strip reveal delay-2" data-airing-signature="${signature}">
      <div class="title-airing-timer">${timerText}</div>
      <div class="title-airing-last"><strong><b>${lastValue}</b></strong></div>
    </div>`;
    if (old) old.outerHTML = html;
    else workspace.insertAdjacentHTML('beforebegin', html);
    updateCountdowns();
  }

  function enhanceSimilarLink() {
    if (!isTitlePage || typeof currentItem === 'undefined' || !currentItem) return;
    const link = document.querySelector('#titleTopActions a[href*="similar="]');
    if (!link) return;
    const ids = idsFromLinks(currentItem);
    if (!ids.anihubId) return;
    const u = new URL(link.href, location.href);
    u.searchParams.set('anihub', ids.anihubId);
    link.href = u.pathname.split('/').pop() + u.search;
  }

  function removeRandomButtonFromNonRandomPreview() {
    if (!isTitlePage) return;
    const params = new URLSearchParams(location.search);
    if (params.get('preview') !== 'anihub' || params.get('random') === '1') return;
    document.querySelector('#titleTopActions [data-random-next]')?.remove();
  }

  function installObservers() {
    if (!isTitlePage) {
      const catalog = document.getElementById('catalog');
      if (catalog) {
        let queued = false;
        new MutationObserver(() => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => { queued = false; augmentCatalogCards(); });
        }).observe(catalog, { childList: true, subtree: false });
      }
    } else {
      const root = document.getElementById('titleRoot');
      if (root) {
        let queued = false;
        new MutationObserver(() => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            augmentTitleSchedule();
            enhanceSimilarLink();
            removeRandomButtonFromNonRandomPreview();
          });
        }).observe(root, { childList: true, subtree: false });
      }
      const top = document.getElementById('titleTopActions');
      if (top) new MutationObserver(removeRandomButtonFromNonRandomPreview).observe(top, { childList: true, subtree: false });
    }
  }

  async function initIndex() {
    addCollectionButtons();
    installObservers();
    const params = new URLSearchParams(location.search);
    const mode = params.get('similar') || '';
    await waitMainReady();
    if (mode === MODE_ANNOUNCED) {
      await loadCollection('announced');
      return;
    }
    if (mode === MODE_RECOMMENDED) {
      await loadCollection('recommended');
      return;
    }
    if (mode && mode !== MODE_INCOMPLETE) {
      await loadOfficialSimilar(mode);
      return;
    }
    await hydrateCatalogAiring();
    if (mode === MODE_INCOMPLETE) {
      const items = buildIncompleteSeasonItems();
      renderLocalMode(items, 'Не повний сезон', 'У каталозі немає тайтлів, де сезон ще не вийшов повністю.');
    }
    augmentCatalogCards();
  }

  async function initTitle() {
    installObservers();
    removeRandomButtonFromNonRandomPreview();
    for (let i = 0; i < 100; i++) {
      if (typeof currentItem !== 'undefined' && currentItem) break;
      await sleep(100);
    }
    enhanceSimilarLink();
    await hydrateTitleAiring();
    augmentTitleSchedule();
  }

  timerId = window.setInterval(updateCountdowns, 1000);
  window.addEventListener('beforeunload', () => timerId && clearInterval(timerId), { once: true });
  if (isTitlePage) initTitle();
  else initIndex();
})();
