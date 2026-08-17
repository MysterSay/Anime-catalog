// ==UserScript==
// @name         Anime -> Notion Collector
// @namespace    myster.anime.notion
// @version      2.7.0
// @description  Thin client for Anime Title Core: streams progress packets, runs full catalog search on Vercel, then imports schema-v2 JSON into Notion through Yoru.
// @author       Myster
//
// @match        *://myanimelist.net/*
// @match        *://*.myanimelist.net/*
// @match        *://anilist.co/*
// @match        *://*.anilist.co/*
// @match        *://jut-su.net/*
// @match        *://*.jut-su.net/*
// @match        *://ru.yummyani.me/*
// @match        *://*.ru.yummyani.me/*
// @match        *://crunchyroll.com/*
// @match        *://*.crunchyroll.com/*
// @match        *://shikimori.io/*
// @match        *://*.shikimori.io/*
// @match        *://animevost.org/*
// @match        *://*.animevost.org/*
// @match        *://jutsu.tv/*
// @match        *://*.jutsu.tv/*
// @match        *://jut.su/*
// @match        *://*.jut.su/*
// @match        *://animego.studio/*
// @match        *://*.animego.studio/*
// @match        *://anilibria.tv/*
// @match        *://*.anilibria.tv/*
// @match        *://anilibria.top/*
// @match        *://*.anilibria.top/*
// @match        *://aniliberty.top/*
// @match        *://*.aniliberty.top/*
//
// @match        *://uaserials.com/*
// @match        *://*.uaserials.com/*
// @match        *://uachan.com/*
// @match        *://*.uachan.com/*
// @match        *://uachan.top/*
// @match        *://*.uachan.top/*
// @match        *://anihub.in.ua/*
// @match        *://*.anihub.in.ua/*
// @match        *://amanogawa.space/*
// @match        *://*.amanogawa.space/*
// @match        *://animeon.club/*
// @match        *://*.animeon.club/*
// @match        *://anidesu.net/*
// @match        *://*.anidesu.net/*
// @match        *://mikai.me/*
// @match        *://*.mikai.me/*
// @match        *://anitube.in.ua/*
// @match        *://*.anitube.in.ua/*
//
// @connect      myster-anime.pages.dev
//
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_setClipboard
//
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '2.7.0';
  const BASE = 'https://myster-anime.pages.dev';
  const STREAM_URL = `${BASE}/api/process-title-stream`;
  const INGEST_URL = `${BASE}/api/ingest`;
  const CONTEXT_URL = `${BASE}/api/extension/context`;
  const ANIME_URL = `${BASE}/api/anime`;
  const VIEWED_URL = `${BASE}/api/anime/viewed`;
  const PROCESS_FALLBACK_URL = `${BASE}/api/process-title`;
  const DEFAULT_STATUSES = ['Без статусу', 'Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто'];
  const GROUP_COLORS = { default:'#a8b0bf', gray:'#9b9a97', brown:'#b08468', orange:'#d99058', yellow:'#d8b55b', green:'#6fbe8b', blue:'#65a8df', purple:'#a589d4', pink:'#d879a2', red:'#d76868' };

  const state = {
    running: false,
    panel: null,
    button: null,
    titleInput: null,
    statusSelect: null,
    groupSelect: null,
    favoriteInput: null,
    likedInput: null,
    viewedButton: null,
    viewed: 0,
    watchProgress: null,
    seasonInput: null,
    episodeInput: null,
    season: 0,
    episode: 0,
    startButton: null,
    renameButton: null,
    lookupButton: null,
    lookupStatus: null,
    progressBar: null,
    progressPercent: null,
    progressText: null,
    log: null,
    copyLogButton: null,
    logEntries: [],
    existingItem: null,
    options: { statuses: [], groups: [], groupOptions: [] },
  };

  function cleanTitle(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, '')
      .replace(/\s*[|–—-]\s*(?:смотреть|дивитися|watch|anime|аниме|аніме).*$/i, '')
      .replace(/\s*[|–—-]\s*(?:jut\.?su|animego|shikimori|crunchyroll|anilibria|uaserials|myanimelist|anilist).*$/i, '')
      .trim();
  }

  function titleKey(value) {
    return cleanTitle(value)
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[’'`´]/g, '')
      .replace(/[‐‑‒–—―]/g, '-')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = cleanTitle(el?.textContent || '');
      if (text && text.length >= 2) return text;
    }
    return '';
  }

  function metaContent(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = cleanTitle(el?.getAttribute('content') || '');
      if (text) return text;
    }
    return '';
  }

  function isJutSu() {
    return /(^|\.)jut\.su$/i.test(location.hostname);
  }

  function cleanJutSuDisplayTitle(value) {
    let text = cleanTitle(value);
    text = text
      .replace(/^смотреть\s+/i, '')
      .replace(/\s+(?:все\s+серии(?:\s+и\s+сезоны)?|все\s+сезоны)\s*$/i, '')
      .replace(/\s+смотреть\s+онлайн.*$/i, '')
      .trim();
    return text;
  }

  function extractJutSuOriginal() {
    // Old/classic jut.su layout: the canonical romanized title is inside
    // .watch_l > .under_video_additional.the_hildi and follows the label
    // "Оригинальное название:" in a <b>/<strong> element.
    const watchInfoBlocks = [
      ...document.querySelectorAll('.watch_l .under_video_additional.the_hildi'),
    ];
    for (const container of watchInfoBlocks) {
      const full = cleanTitle(container.textContent || '');
      if (!/оригинальн(?:ое|ая)\s+названи[ея]/i.test(full)) continue;

      for (const bold of container.querySelectorAll('b, strong')) {
        const value = cleanTitle(bold.textContent || '');
        if (!value || value.length < 3) continue;

        let prefix = '';
        let node = bold.previousSibling;
        while (node && prefix.length < 240) {
          prefix = `${node.textContent || ''} ${prefix}`;
          if (/оригинальн(?:ое|ая)\s+названи[ея]/i.test(prefix)) break;
          node = node.previousSibling;
        }
        if (/оригинальн(?:ое|ая)\s+названи[ея]/i.test(prefix)) return value;
      }

      const match = full.match(/оригинальн(?:ое|ая)\s+названи[ея]\s*[:—-]?\s*([^\n\r]{3,220})/i);
      if (match) {
        const value = cleanTitle(match[1]).split(/возрастной рейтинг|жанр|годы выпуска|описание/i)[0].trim();
        if (value) return value;
      }
    }

    // New jut.su / jut-su style pages.
    const direct = firstText([
      '.jutsu-page__original',
      '.jutsu-page__title-text .jutsu-page__original',
      '[class*="jutsu-page__original"]',
    ]);
    if (direct) return direct;

    // Generic fallback, only after the exact .watch_l selector above.
    const containers = [
      ...document.querySelectorAll('.under_video_additional, .jutsu-page__info, .jutsu-page__meta, #dle-content, main'),
    ];
    for (const container of containers) {
      const full = cleanTitle(container.textContent || '');
      if (!/оригинальн(?:ое|ая)\s+названи[ея]/i.test(full)) continue;

      const bolds = [...container.querySelectorAll('b, strong')];
      for (const bold of bolds) {
        const value = cleanTitle(bold.textContent || '');
        if (!value || value.length < 3) continue;
        const before = cleanTitle((bold.previousSibling?.textContent || '') + ' ' + (bold.parentElement?.textContent || ''));
        if (/оригинальн(?:ое|ая)\s+названи[ея]/i.test(before)) return value;
      }

      const match = full.match(/оригинальн(?:ое|ая)\s+названи[ея]\s*[:—-]?\s*([^\n\r]{3,220})/i);
      if (match) {
        const value = cleanTitle(match[1]).split(/возрастной рейтинг|жанр|годы выпуска|описание/i)[0].trim();
        if (value) return value;
      }
    }
    return '';
  }

  function extractJutSuTitle() {
    const direct = firstText([
      '.jutsu-page__title-text h1',
      '.jutsu-page__title h1',
      '.jutsu-page__header h1',
      'main h1',
      'article h1',
      'h1',
    ]);
    const cleaned = cleanJutSuDisplayTitle(direct);
    if (cleaned && !/^смотреть$/i.test(cleaned)) return cleaned;

    const og = cleanJutSuDisplayTitle(metaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]']));
    if (og) return og;
    return '';
  }

  function jutSuCanonicalUrl() {
    if (!isJutSu()) return location.href;
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && /^season-?\d+/i.test(parts[1])) {
      return `${location.origin}/${parts[0]}/`;
    }
    if (parts.length >= 2 && /episode-?\d+/i.test(parts[1])) {
      return `${location.origin}/${parts[0]}/`;
    }
    if (parts.length >= 3 && parts.some(part => /episode-?\d+/i.test(part))) {
      return `${location.origin}/${parts[0]}/`;
    }
    return location.href;
  }

  function extractTitleCandidates() {
    // For jut.su the romanized "Оригинальное название" is the strongest
    // identifier for matching an existing Notion record, so keep it first.
    const siteSpecific = isJutSu() ? [extractJutSuOriginal(), extractJutSuTitle()] : [];
    const values = [
      ...siteSpecific,
      firstText([
        'h1[itemprop="name"]', '[itemprop="name"] h1', '.anime-title h1',
        '.release-title h1', '.post-title h1', '.entry-title', 'main h1', 'article h1', 'h1',
      ]),
      metaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]']),
      cleanTitle(document.title),
    ].map(value => isJutSu() ? cleanJutSuDisplayTitle(value) : cleanTitle(value)).filter(Boolean);

    return [...new Set(values
      .map(value => value.trim())
      .filter(value => value.length >= 2)
      .filter(value => !isJutSu() || !/^(jut-su|jut\.su|смотреть онлайн)$/i.test(value))
    )];
  }

  function extractTitle() {
    if (isJutSu()) {
      return extractJutSuTitle() || extractJutSuOriginal() || extractTitleCandidates()[0] || '';
    }
    const candidates = extractTitleCandidates();
    return [...candidates].sort((a, b) => a.length - b.length)[0] || '';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function notify(title, text) {
    try { GM_notification({ title, text, timeout: 4500 }); }
    catch { console.log(`[${title}] ${text}`); }
  }

  function setProgress(percent, text, type = '') {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    if (state.progressBar) state.progressBar.style.width = `${p}%`;
    if (state.progressPercent) state.progressPercent.textContent = `${Math.round(p)}%`;
    if (state.progressText) {
      state.progressText.textContent = text || '';
      state.progressText.dataset.type = type;
    }
  }

  function addLog(message, type = '') {
    if (!message) return;
    const text = String(message);
    state.logEntries.push(text);
    if (state.logEntries.length > 1000) state.logEntries.splice(0, state.logEntries.length - 1000);
    if (state.log) {
      state.log.className = `an2n2-log-latest ${type}`.trim();
      state.log.textContent = text;
      state.log.title = text;
    }
  }

  function resetLogs() {
    state.logEntries = [];
    if (state.log) {
      state.log.className = 'an2n2-log-latest';
      state.log.textContent = 'Лог сеансу порожній.';
      state.log.title = '';
    }
  }

  function copySessionLog() {
    const text = state.logEntries.join('\n');
    if (!text) return;
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text, 'text');
      else navigator.clipboard?.writeText(text);
      const old = state.copyLogButton?.textContent;
      if (state.copyLogButton) state.copyLogButton.textContent = '✓';
      setTimeout(() => { if (state.copyLogButton) state.copyLogButton.textContent = old || '⧉'; }, 900);
    } catch (error) {
      console.warn('[Anime -> Notion] copy log failed', error);
    }
  }

  function gmJson(method, url, payload = null) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        data: payload == null ? undefined : JSON.stringify(payload),
        onload: response => {
          let data = {};
          try { data = JSON.parse(response.responseText || '{}'); } catch {}
          if (response.status >= 200 && response.status < 400) resolve(data);
          else reject(new Error(data.error || `HTTP ${response.status}: ${String(response.responseText || '').slice(0, 500)}`));
        },
        onerror: error => reject(new Error(`Network error: ${error?.error || 'GM_xmlhttpRequest'}`)),
      });
    });
  }

  function populateSelect(select, values, current, emptyLabel) {
    const unique = [...new Set(values.map(x => String(x || '').trim()).filter(Boolean))];
    if (current && !unique.includes(current)) unique.unshift(current);
    select.innerHTML = unique.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    if (!unique.length && emptyLabel) select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>`;
    if (current && unique.includes(current)) select.value = current;
  }


  function groupOption(name) {
    const key = String(name || '').trim().toLocaleLowerCase('uk-UA');
    return (state.options.groupOptions || []).find(option => String(option.name || '').trim().toLocaleLowerCase('uk-UA') === key) || null;
  }

  function applyGroupColor() {
    const wrap = state.groupSelect?.closest('.an2n2-group-wrap');
    if (!wrap) return;
    const option = groupOption(state.groupSelect.value);
    const color = GROUP_COLORS[option?.color || 'default'] || GROUP_COLORS.default;
    wrap.style.setProperty('--group-color', color);
    wrap.dataset.groupColor = option?.color || 'default';
  }

  function populateGroupSelect(current) {
    const details = Array.isArray(state.options.groupOptions) ? state.options.groupOptions : [];
    const names = [...new Set(['Без групи', ...(state.options.groups || []), ...details.map(x => x.name)].filter(Boolean))];
    populateSelect(state.groupSelect, names, current || 'Без групи');
    [...state.groupSelect.options].forEach(option => {
      const detail = details.find(item => item.name === option.value);
      option.dataset.color = detail?.color || 'default';
    });
    applyGroupColor();
  }

  function setToggle(input, value) {
    if (!input) return;
    input.checked = Boolean(value);
    input.closest('.an2n2-toggle')?.classList.toggle('active', input.checked);
  }

  function setViewed(value) {
    state.viewed = Math.max(0, Number(value) || 0);
    const count = state.viewedButton?.querySelector('[data-viewed-count]');
    if (count) count.textContent = String(state.viewed);
    if (state.viewedButton) state.viewedButton.title = `Додати один перегляд. Зараз: ${state.viewed}`;
  }


  function setWatchValue(kind, value) {
    const key = kind === 'season' ? 'season' : 'episode';
    const next = Math.max(0, Math.floor(Number(value) || 0));
    state[key] = next;
    const input = key === 'season' ? state.seasonInput : state.episodeInput;
    if (input && Number(input.value) !== next) input.value = String(next);
  }

  function syncWatchProgressVisibility() {
    if (!state.watchProgress) return;
    state.watchProgress.hidden = String(state.statusSelect?.value || '').trim() !== 'Дивлюсь';
  }

  async function persistWatchValue(kind, value) {
    const key = kind === 'season' ? 'season' : 'episode';
    const next = Math.max(0, Math.floor(Number(value) || 0));
    setWatchValue(key, next);
    if (!state.existingItem?.id || state.running) return;
    try {
      const payload = await gmJson('PATCH', `${ANIME_URL}?id=${encodeURIComponent(state.existingItem.id)}`, { [key]: next });
      if (payload?.item) state.existingItem = payload.item;
      setWatchValue(key, state.existingItem?.[key] ?? next);
      addLog(`${key === 'season' ? 'Сезон' : 'Серія'} → ${state[key]}`, 'ok');
    } catch (error) {
      addLog(`Не вдалося оновити ${key === 'season' ? 'сезон' : 'серію'}: ${error.message}`, 'error');
    }
  }

  async function incrementViewed() {
    if (state.running || !state.viewedButton) return;
    if (!state.existingItem?.id) {
      setViewed(state.viewed + 1);
      addLog(`Переглянуто → ${state.viewed} (буде записано після створення)`, 'ok');
      return;
    }
    state.viewedButton.disabled = true;
    try {
      const payload = await gmJson('POST', `${VIEWED_URL}?id=${encodeURIComponent(state.existingItem.id)}`);
      if (payload?.item) state.existingItem = payload.item;
      setViewed(payload?.viewed ?? state.existingItem?.viewed ?? (state.viewed + 1));
      addLog(`Переглянуто → ${state.viewed}`, 'ok');
      setLookupStatus(`Переглянуто: ${state.viewed}`, 'ok');
    } catch (error) {
      addLog(`Не вдалося додати перегляд: ${error.message}`, 'error');
      setLookupStatus(`Помилка лічильника: ${error.message}`, 'error');
    } finally {
      state.viewedButton.disabled = false;
    }
  }

  function currentMarks() {
    return {
      favorite: Boolean(state.favoriteInput?.checked),
      liked: Boolean(state.likedInput?.checked),
      season: state.season,
      episode: state.episode,
    };
  }

  async function saveMarksForItem(itemId) {
    if (!itemId) return null;
    const marks = currentMarks();
    if (state.viewed > 0) marks.viewed = state.viewed;
    return gmJson('PATCH', `${ANIME_URL}?id=${encodeURIComponent(itemId)}`, marks);
  }

  function setLookupStatus(text, type = '') {
    if (!state.lookupStatus) return;
    state.lookupStatus.textContent = text || '';
    state.lookupStatus.dataset.type = type;
  }

  function updateRenameButton() {
    if (!state.renameButton) return;
    const existing = state.existingItem;
    const typed = cleanTitle(state.titleInput?.value || '');
    const differs = Boolean(existing?.id && typed && titleKey(typed) !== titleKey(existing.title));
    state.renameButton.hidden = !differs;
  }

  function applyContext(payload) {
    state.options = payload?.options || { statuses: [], groups: [], groupOptions: [] };
    state.existingItem = payload?.exists ? payload.item : null;
    const statuses = [...new Set(['Без статусу', ...(state.options.statuses || []), ...DEFAULT_STATUSES])];
    const groups = [...new Set(['Без групи', ...(state.options.groups || [])])];
    addLog(`Груп із Notion: ${Math.max(0, groups.length - 1)}`, groups.length > 1 ? 'ok' : 'warn');

    if (state.existingItem) {
      populateSelect(state.statusSelect, statuses, state.existingItem.status || 'Без статусу');
      populateGroupSelect(state.existingItem.group || 'Без групи');
      setToggle(state.favoriteInput, state.existingItem.favorite);
      setToggle(state.likedInput, state.existingItem.liked);
      setViewed(state.existingItem.viewed || 0);
      setWatchValue('season', state.existingItem.season || 0);
      setWatchValue('episode', state.existingItem.episode || 0);
      syncWatchProgressVisibility();
      state.startButton.textContent = 'Оновити';
      state.startButton.dataset.mode = 'update';
      setLookupStatus(`Знайдено в базі: ${state.existingItem.title}`, 'ok');
      addLog(`База: знайдено ${state.existingItem.title}`, 'ok');
    } else {
      populateSelect(state.statusSelect, statuses, 'Буду дивитись');
      populateGroupSelect('Без групи');
      setToggle(state.favoriteInput, false);
      setToggle(state.likedInput, false);
      setViewed(0);
      setWatchValue('season', 0);
      setWatchValue('episode', 0);
      syncWatchProgressVisibility();
      state.startButton.textContent = 'Підтвердити та запустити пошук';
      state.startButton.dataset.mode = 'create';
      setLookupStatus('У базі не знайдено · після підтвердження запуститься Python-ядро', 'new');
      addLog('База: тайтл не знайдено. Групи та статуси підтягнуто.', 'warn');
    }
    updateRenameButton();
  }

  async function refreshContext() {
    const typed = cleanTitle(state.titleInput?.value || extractTitle());
    if (!typed) return;
    state.lookupButton.disabled = true;
    setLookupStatus('Шукаю по «Аліасах» усіма назвами зі сторінки та завантажую групи…', 'loading');
    try {
      const jutOriginal = isJutSu() ? cleanTitle(extractJutSuOriginal()) : '';
      const lookupTitle = jutOriginal || typed;
      const candidates = [...new Set([lookupTitle, typed, ...extractTitleCandidates()].map(cleanTitle).filter(Boolean))].slice(0, 8);
      if (jutOriginal) addLog(`Jut.su первинна назва для перевірки бази: ${jutOriginal}`, 'ok');
      candidates.forEach(candidate => addLog(`Аліас-кандидат: ${candidate}`));
      const params = new URLSearchParams({ title: lookupTitle, titles: JSON.stringify(candidates) });
      const payload = await gmJson('GET', `${CONTEXT_URL}?${params.toString()}`);
      if (payload?.exists && payload?.matchedBy) addLog(`Збіг по аліасу: ${payload.matchedBy}`, 'ok');
      applyContext(payload);
    } catch (error) {
      state.existingItem = null;
      setLookupStatus(`Помилка перевірки бази: ${error.message}`, 'error');
      addLog(error.message, 'error');
    } finally {
      state.lookupButton.disabled = false;
    }
  }

  async function renameExisting() {
    const item = state.existingItem;
    const title = cleanTitle(state.titleInput?.value || '');
    if (!item?.id || !title) return;
    state.renameButton.disabled = true;
    try {
      const payload = await gmJson('PATCH', `${ANIME_URL}?id=${encodeURIComponent(item.id)}`, { title });
      state.existingItem = payload.item || { ...item, title };
      setLookupStatus(`Основну назву оновлено: ${state.existingItem.title}`, 'ok');
      addLog(`Назва в Notion → ${state.existingItem.title}`, 'ok');
      notify('Anime → Notion', 'Основну назву оновлено');
      updateRenameButton();
    } catch (error) {
      setLookupStatus(`Не вдалося оновити назву: ${error.message}`, 'error');
    } finally {
      state.renameButton.disabled = false;
    }
  }

  async function updateExisting() {
    const item = state.existingItem;
    if (!item?.id) return refreshContext();
    state.running = true;
    state.startButton.disabled = true;
    state.button.disabled = true;
    setProgress(20, 'Оновлюю статус і групу в Notion…');
    try {
      const payload = await gmJson('PATCH', `${ANIME_URL}?id=${encodeURIComponent(item.id)}`, {
        status: state.statusSelect?.value || 'Без статусу',
        group: state.groupSelect?.value || 'Без групи',
        viewed: state.viewed,
        ...currentMarks(),
      });
      state.existingItem = payload.item || item;
      setViewed(state.existingItem.viewed ?? state.viewed);
      setWatchValue('season', state.existingItem.season ?? state.season);
      setWatchValue('episode', state.existingItem.episode ?? state.episode);
      syncWatchProgressVisibility();
      if (payload.options) state.options = payload.options;
      populateGroupSelect(state.existingItem.group || state.groupSelect?.value || 'Без групи');
      setProgress(100, 'Готово: дані тайтлу оновлено.', 'ok');
      setLookupStatus(`Оновлено: ${state.existingItem.title}`, 'ok');
      addLog(`Статус → ${state.existingItem.status}; група → ${state.existingItem.group}; вибране → ${state.existingItem.favorite ? 'так' : 'ні'}; улюблене → ${state.existingItem.liked ? 'так' : 'ні'}; переглянуто → ${state.existingItem.viewed || 0}; сезон → ${state.existingItem.season || 0}; серія → ${state.existingItem.episode || 0}`, 'ok');
      notify('Anime → Notion', `Оновлено: ${state.existingItem.title}`);
    } catch (error) {
      setProgress(20, `Помилка: ${error.message}`, 'error');
      addLog(error.message, 'error');
    } finally {
      state.running = false;
      state.startButton.disabled = false;
      state.button.disabled = false;
    }
  }

  async function parseReadableStream(stream, onPacket) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let packet;
        try { packet = JSON.parse(line); } catch { continue; }
        onPacket(packet);
        if (packet.type === 'error') throw new Error(`CORE:${packet.message || 'Python core завершився з помилкою.'}`);
        if (packet.type === 'result' && packet.result) {
          // The final JSON is complete. Do not wait for server-side HTTP client cleanup
          // or for Tampermonkey to emit a second end event.
          try { await reader.cancel(); } catch {}
          return packet.result;
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      try {
        const packet = JSON.parse(buffer);
        onPacket(packet);
        if (packet.type === 'error') throw new Error(`CORE:${packet.message || 'Python core завершився з помилкою.'}`);
        if (packet.type === 'result' && packet.result) return packet.result;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return null;
  }

  async function streamWithFetch(payload, onPacket) {
    const response = await fetch(STREAM_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(payload), cache: 'no-store', credentials: 'omit',
    });
    if (!response.ok) throw new Error(`Stream HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    if (!response.body) throw new Error('Streaming body відсутній.');
    return parseReadableStream(response.body, onPacket);
  }

  function streamWithGM(payload, onPacket) {
    return new Promise((resolve, reject) => {
      let streamStarted = false;
      let settled = false;
      let lastPacketAt = Date.now();
      let lastPercent = 0;
      let requestHandle = null;
      const trackedPacket = packet => {
        lastPacketAt = Date.now();
        lastPercent = Number(packet?.percent || lastPercent || 0);
        onPacket(packet);
      };
      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        ok ? resolve(value) : reject(value);
      };
      const watchdog = setInterval(() => {
        // After 95% only JSON assembly/serialization remains. If the transport is
        // silent for 35s, treat it as a broken stream and use the non-stream fallback.
        if (lastPercent >= 95 && Date.now() - lastPacketAt > 35000) {
          try { requestHandle?.abort?.(); } catch {}
          finish(false, new Error('STREAM_STALLED: фінальний пакет не прийшов після 95%.'));
        }
      }, 4000);

      requestHandle = GM_xmlhttpRequest({
        method: 'POST', url: STREAM_URL,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        data: JSON.stringify(payload), responseType: 'stream',
        onloadstart: response => {
          const stream = response?.response;
          if (!stream?.getReader) return;
          streamStarted = true;
          parseReadableStream(stream, trackedPacket)
            .then(result => finish(true, result))
            .catch(error => finish(false, error));
        },
        onload: response => {
          if (settled || streamStarted) return;
          if (response.status < 200 || response.status >= 400) return finish(false, new Error(`Stream HTTP ${response.status}: ${String(response.responseText || '').slice(0, 500)}`));
          let result = null;
          for (const line of String(response.responseText || '').split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const packet = JSON.parse(line); trackedPacket(packet);
              if (packet.type === 'error') throw new Error(`CORE:${packet.message || 'Python core error'}`);
              if (packet.type === 'result') result = packet.result;
            } catch (error) { if (!(error instanceof SyntaxError)) return finish(false, error); }
          }
          finish(true, result);
        },
        onerror: error => finish(false, new Error(`Network error: ${error?.error || 'GM_xmlhttpRequest'}`)),
        ontimeout: () => finish(false, new Error('STREAM_TIMEOUT: Tampermonkey stream timeout')),
      });
    });
  }


  async function streamProcess(payload, onPacket) {
    // On third-party anime sites a normal fetch is usually blocked by CORS. Use
    // Tampermonkey's privileged transport directly instead of failing once first.
    return streamWithGM(payload, onPacket);
  }

  function onProgressPacket(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.type === 'heartbeat') return setProgress(packet.percent, packet.message || 'Python core працює…');
    if (packet.type === 'progress') {
      const domain = packet.domain ? ` · ${packet.domain}` : '';
      setProgress(packet.percent, `${packet.message || packet.stage}${domain}`);
      if (packet.domain || ['identity', 'catalogs_done', 'finalize'].includes(packet.stage)) addLog(`${packet.percent}% · ${packet.message || packet.stage}${domain}`, packet.error ? 'warn' : '');
    }
  }

  async function runNonStreamFallback(requestPayload) {
    addLog('Стрім не віддав фінальний JSON. Запускаю резервний non-stream endpoint…', 'warn');
    setProgress(96, 'Резервне завершення: формую JSON і записую в Notion…');
    const saved = await gmJson('POST', PROCESS_FALLBACK_URL, requestPayload);
    if (!saved?.item?.id) throw new Error('Резервний endpoint не повернув ID тайтлу.');
    state.existingItem = saved.item;
    const marked = await saveMarksForItem(saved.item.id);
    if (marked?.item) state.existingItem = marked.item;
    setProgress(100, saved.existing ? 'Готово: тайтл оновлено в Notion.' : 'Готово: тайтл додано в Notion.', 'ok');
    addLog(`100% · ${saved.existing ? 'Оновлено' : 'Додано'} резервним шляхом: ${saved.item.title || requestPayload.title}`, 'ok');
    notify('Anime → Notion', `${saved.existing ? 'Оновлено' : 'Додано'}: ${saved.item.title || requestPayload.title}`);
    await refreshContext();
    return saved;
  }

  async function createNew() {
    const title = cleanTitle(state.titleInput?.value || extractTitle());
    if (!title) return alert('Не вдалося визначити назву. Введи її вручну в полі панелі.');
    state.running = true;
    state.startButton.disabled = true;
    state.button.disabled = true;
    resetLogs();
    setProgress(1, 'Запускаю Python core…');
    const sourceUrl = isJutSu() ? jutSuCanonicalUrl() : location.href;
    addLog(`Джерело: ${sourceUrl}`);
    if (isJutSu()) {
      const original = extractJutSuOriginal();
      if (original) addLog(`Jut.su original: ${original}`, 'ok');
      if (sourceUrl !== location.href) addLog(`Jut.su canonical: ${sourceUrl}`, 'ok');
    }
    addLog(`Назва: ${title}`);
    const requestPayload = {
      title, url: sourceUrl,
      status: state.statusSelect?.value || '',
      group: state.groupSelect?.value || '',
      season: state.season,
      episode: state.episode,
      ...(state.viewed > 0 ? { viewed: state.viewed } : {}),
    };
    try {
      let result = null;
      try {
        result = await streamProcess(requestPayload, onProgressPacket);
      } catch (streamError) {
        if (String(streamError?.message || '').startsWith('CORE:')) throw streamError;
        addLog(`Проблема транспорту: ${streamError.message}`, 'warn');
        await runNonStreamFallback(requestPayload);
        return;
      }
      if (!result?.title) {
        await runNonStreamFallback(requestPayload);
        return;
      }
      setProgress(99, 'JSON готовий. Відправляю в Yoru / Notion…');
      const saved = await gmJson('POST', INGEST_URL, result);
      if (!saved?.item?.id) throw new Error('Yoru ingest не повернув ID тайтлу.');
      state.existingItem = saved.item;
      const marked = await saveMarksForItem(saved.item.id);
      if (marked?.item) state.existingItem = marked.item;
      setProgress(100, saved.existing ? 'Готово: тайтл оновлено в Notion.' : 'Готово: тайтл додано в Notion.', 'ok');
      addLog(`100% · ${saved.existing ? 'Оновлено' : 'Додано'}: ${saved.item.title || title}`, 'ok');
      notify('Anime → Notion', `${saved.existing ? 'Оновлено' : 'Додано'}: ${saved.item.title || title}`);
      await refreshContext();
    } catch (error) {
      console.error('[Anime -> Notion v2.7.0]', error);
      const msg = String(error?.message || error).replace(/^CORE:/, '');
      setProgress(Number(state.progressPercent?.textContent?.replace('%', '')) || 0, `Помилка: ${msg}`, 'error');
      addLog(msg, 'error');
      notify('Anime → Notion', `Помилка: ${msg}`);
    } finally {
      state.running = false;
      state.startButton.disabled = false;
      state.button.disabled = false;
    }
  }

  async function run() {
    if (state.running) return;
    if (state.existingItem) return updateExisting();
    return createNew();
  }

  async function resetPanel() {
    if (state.titleInput) state.titleInput.value = extractTitle();
    state.existingItem = null;
    resetLogs();
    setProgress(0, 'Готовий до запуску.');
    await refreshContext();
  }

  function buildUi() {
    GM_addStyle(`
      #an2n2-button{position:fixed;top:18px;right:18px;z-index:2147483646;border:1px solid rgba(255,255,255,.16);border-radius:13px;padding:11px 15px;background:#101522;color:#fff;font:700 13px system-ui;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      #an2n2-panel{position:fixed;top:70px;right:18px;z-index:2147483647;width:min(440px,calc(100vw - 36px));max-height:calc(100vh - 90px);overflow:auto;padding:16px;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(10,13,21,.97);color:#e8edf7;box-shadow:0 24px 80px rgba(0,0,0,.52);font:13px/1.45 system-ui;backdrop-filter:blur(18px)}
      #an2n2-panel[hidden]{display:none!important}.an2n2-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.an2n2-head strong{font-size:15px}.an2n2-close{border:0;background:rgba(255,255,255,.07);color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer}
      .an2n2-lookup{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:9px 10px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:rgba(255,255,255,.025)}.an2n2-lookup span{color:#a8b3c4;font-size:11px}.an2n2-lookup span[data-type=ok]{color:#8ee6b0}.an2n2-lookup span[data-type=new]{color:#ffd47e}.an2n2-lookup span[data-type=error]{color:#ff98a9}.an2n2-lookup button{flex:0 0 auto;border:1px solid rgba(112,201,255,.18);border-radius:9px;background:rgba(112,201,255,.07);color:#dff5ff;padding:7px 9px;cursor:pointer}
      .an2n2-field{display:grid;gap:6px;margin:10px 0}.an2n2-field span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8fa1b8;font-weight:800}.an2n2-field input,.an2n2-field select{box-sizing:border-box!important;width:100%!important;min-height:42px!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:11px!important;padding:0 34px 0 11px!important;background:#151a27!important;background-image:none!important;background-repeat:no-repeat!important;box-shadow:none!important;color:#fff!important;outline:none!important;font:600 13px/1.2 system-ui!important;text-shadow:none!important;filter:none!important}.an2n2-field select{-webkit-appearance:none!important;-moz-appearance:none!important;appearance:none!important;mask:none!important;-webkit-mask:none!important}.an2n2-field select option{background:#151a27!important;color:#fff!important}.an2n2-select-wrap{position:relative}.an2n2-select-wrap:after{content:'⌄';position:absolute;right:12px;top:50%;transform:translateY(-54%);pointer-events:none;color:#8fa1b8;font-size:15px;line-height:1}.an2n2-group-wrap:before{content:'';position:absolute;left:12px;top:50%;transform:translateY(-50%);width:9px;height:9px;border-radius:50%;background:var(--group-color,#a8b0bf);box-shadow:0 0 0 3px color-mix(in srgb,var(--group-color,#a8b0bf) 16%,transparent);pointer-events:none;z-index:2}.an2n2-group-wrap select{padding-left:34px!important;border-color:color-mix(in srgb,var(--group-color,#a8b0bf) 35%,rgba(255,255,255,.12))!important}.an2n2-marks{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:10px 0}.an2n2-viewed{width:100%;min-height:44px;margin:0 0 10px;border:1px solid rgba(126,232,181,.22);border-radius:11px;background:rgba(126,232,181,.07);color:#dff8ea;font:800 13px system-ui;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}.an2n2-viewed:hover{background:rgba(126,232,181,.12);border-color:rgba(126,232,181,.38)}.an2n2-viewed:disabled{opacity:.55;cursor:default}.an2n2-viewed strong{min-width:24px;padding:2px 7px;border-radius:999px;background:rgba(126,232,181,.12);color:#8ee6b0}.an2n2-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:0 11px;border:1px solid rgba(255,255,255,.11);border-radius:11px;background:#151a27;color:#dbe3ef;cursor:pointer;user-select:none}.an2n2-toggle>span{font-weight:750}.an2n2-toggle input{position:absolute;opacity:0;pointer-events:none}.an2n2-toggle-knob{position:relative;width:36px;height:20px;flex:0 0 36px;border-radius:999px;background:#2a3140;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);transition:.2s ease}.an2n2-toggle-knob:after{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;border-radius:50%;background:#edf2fa;transition:.2s ease}.an2n2-toggle.active{border-color:rgba(112,201,255,.28);background:rgba(112,201,255,.07)}.an2n2-toggle.active .an2n2-toggle-knob{background:#70c9ff}.an2n2-toggle.active .an2n2-toggle-knob:after{transform:translateX(16px);background:#08111a}
      .an2n2-watch-progress{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:10px 0}.an2n2-watch-progress[hidden]{display:none!important}.an2n2-watch-field{display:grid;gap:6px}.an2n2-watch-field>span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8fa1b8;font-weight:800}.an2n2-number-field{display:grid;grid-template-columns:38px 1fr 38px;min-height:42px;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:#151a27}.an2n2-number-field button{border:0;background:rgba(255,255,255,.025);color:#aeb8c8;font:800 20px/1 system-ui;cursor:pointer}.an2n2-number-field button:first-child{border-right:1px solid rgba(255,255,255,.08)}.an2n2-number-field button:last-child{border-left:1px solid rgba(255,255,255,.08)}.an2n2-number-field button:hover{background:rgba(112,201,255,.08);color:#fff}.an2n2-number-field input{box-sizing:border-box!important;width:100%!important;min-width:0!important;border:0!important;padding:0!important;background:transparent!important;color:#fff!important;text-align:center!important;outline:0!important;font:800 13px system-ui!important;-moz-appearance:textfield!important;appearance:textfield!important}.an2n2-number-field input::-webkit-inner-spin-button,.an2n2-number-field input::-webkit-outer-spin-button{-webkit-appearance:none!important;margin:0!important}
      .an2n2-actions{display:flex;gap:9px;margin-top:12px;flex-wrap:wrap}.an2n2-start,.an2n2-rename{min-height:42px;border-radius:11px;font-weight:800;cursor:pointer}.an2n2-start{flex:1;border:1px solid rgba(112,201,255,.3);background:rgba(112,201,255,.12);color:#dff5ff}.an2n2-rename{border:1px solid rgba(167,150,255,.28);background:rgba(167,150,255,.10);color:#e4dcff;padding:0 13px}.an2n2-start:disabled,.an2n2-rename:disabled{opacity:.5;cursor:default}
      .an2n2-track{height:7px;margin-top:15px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.08)}.an2n2-track>div{height:100%;width:0;background:linear-gradient(90deg,#70c9ff,#9b8cff);transition:width .3s ease}.an2n2-progress-meta{display:grid;grid-template-columns:46px 1fr;gap:8px;margin-top:8px;color:#9ea9ba}.an2n2-progress-meta b{color:#dff5ff}.an2n2-progress-meta span[data-type=error]{color:#ff98a9}.an2n2-progress-meta span[data-type=ok]{color:#8ee6b0}
      .an2n2-logbar{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}.an2n2-log-latest{min-width:0;padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.035);color:#aab5c5;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.an2n2-log-latest.ok{color:#8ee6b0}.an2n2-log-latest.warn{color:#ffd38a}.an2n2-log-latest.error{color:#ff98a9}.an2n2-copy-log{width:34px;height:32px;border:1px solid rgba(255,255,255,.11);border-radius:9px;background:rgba(255,255,255,.045);color:#dce5f2;cursor:pointer;font:800 15px system-ui}.an2n2-copy-log:hover{background:rgba(112,201,255,.09);border-color:rgba(112,201,255,.25)}
    `);

    const button = document.createElement('button');
    button.id = 'an2n2-button';
    button.textContent = '＋ Anime → Notion';
    (document.body || document.documentElement).appendChild(button);

    const panel = document.createElement('section');
    panel.id = 'an2n2-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="an2n2-head"><strong>Anime → Notion · v${VERSION}</strong><button class="an2n2-close" type="button">×</button></div>
      <div class="an2n2-lookup"><span class="an2n2-lookup-status">Очікую перевірку бази…</span><button class="an2n2-lookup-btn" type="button">Перевірити</button></div>
      <label class="an2n2-field"><span>Назва зі сторінки</span><input class="an2n2-title" type="text"></label>
      <label class="an2n2-field"><span>Статус</span><span class="an2n2-select-wrap"><select class="an2n2-status"></select></span></label>
      <label class="an2n2-field"><span>Група</span><span class="an2n2-select-wrap an2n2-group-wrap"><select class="an2n2-group"></select></span></label>
      <div class="an2n2-marks">
        <label class="an2n2-toggle"><span>Вибране</span><input class="an2n2-favorite" type="checkbox"><i class="an2n2-toggle-knob"></i></label>
        <label class="an2n2-toggle"><span>Улюблене</span><input class="an2n2-liked" type="checkbox"><i class="an2n2-toggle-knob"></i></label>
      </div>
      <button class="an2n2-viewed" type="button"><span>＋1 Переглянуто</span><strong data-viewed-count>0</strong></button>
      <div class="an2n2-watch-progress" hidden>
        <label class="an2n2-watch-field"><span>Сезон</span><span class="an2n2-number-field"><button type="button" data-watch-adjust="season" data-delta="-1">‹</button><input class="an2n2-season" type="number" min="0" step="1" inputmode="numeric" value="0"><button type="button" data-watch-adjust="season" data-delta="1">›</button></span></label>
        <label class="an2n2-watch-field"><span>Серія</span><span class="an2n2-number-field"><button type="button" data-watch-adjust="episode" data-delta="-1">‹</button><input class="an2n2-episode" type="number" min="0" step="1" inputmode="numeric" value="0"><button type="button" data-watch-adjust="episode" data-delta="1">›</button></span></label>
      </div>
      <div class="an2n2-actions"><button class="an2n2-start" type="button">Завантаження…</button><button class="an2n2-rename" type="button" hidden>Оновити назву</button></div>
      <div class="an2n2-track"><div></div></div>
      <div class="an2n2-progress-meta"><b>0%</b><span>Готовий до запуску.</span></div>
      <div class="an2n2-logbar"><div class="an2n2-log-latest">Лог сеансу порожній.</div><button class="an2n2-copy-log" type="button" title="Копіювати весь лог сеансу">⧉</button></div>`;
    (document.body || document.documentElement).appendChild(panel);

    state.button = button;
    state.panel = panel;
    state.titleInput = panel.querySelector('.an2n2-title');
    state.statusSelect = panel.querySelector('.an2n2-status');
    state.groupSelect = panel.querySelector('.an2n2-group');
    state.favoriteInput = panel.querySelector('.an2n2-favorite');
    state.likedInput = panel.querySelector('.an2n2-liked');
    state.viewedButton = panel.querySelector('.an2n2-viewed');
    state.watchProgress = panel.querySelector('.an2n2-watch-progress');
    state.seasonInput = panel.querySelector('.an2n2-season');
    state.episodeInput = panel.querySelector('.an2n2-episode');
    state.startButton = panel.querySelector('.an2n2-start');
    state.renameButton = panel.querySelector('.an2n2-rename');
    state.lookupButton = panel.querySelector('.an2n2-lookup-btn');
    state.lookupStatus = panel.querySelector('.an2n2-lookup-status');
    state.progressBar = panel.querySelector('.an2n2-track > div');
    state.progressPercent = panel.querySelector('.an2n2-progress-meta b');
    state.progressText = panel.querySelector('.an2n2-progress-meta span');
    state.log = panel.querySelector('.an2n2-log-latest');
    state.copyLogButton = panel.querySelector('.an2n2-copy-log');

    button.addEventListener('click', async () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !state.running) await resetPanel();
    });
    panel.querySelector('.an2n2-close').addEventListener('click', () => { if (!state.running) panel.hidden = true; });
    state.lookupButton.addEventListener('click', refreshContext);
    state.startButton.addEventListener('click', run);
    state.renameButton.addEventListener('click', renameExisting);
    state.viewedButton?.addEventListener('click', incrementViewed);
    state.copyLogButton?.addEventListener('click', copySessionLog);
    panel.querySelectorAll('[data-watch-adjust]').forEach(button => button.addEventListener('click', () => {
      const kind = button.dataset.watchAdjust === 'season' ? 'season' : 'episode';
      const delta = Number(button.dataset.delta || 0);
      persistWatchValue(kind, state[kind] + delta);
    }));
    state.seasonInput?.addEventListener('change', () => persistWatchValue('season', state.seasonInput.value));
    state.episodeInput?.addEventListener('change', () => persistWatchValue('episode', state.episodeInput.value));
    [state.seasonInput, state.episodeInput].forEach(input => input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') input.blur();
    }));
    state.titleInput.addEventListener('input', updateRenameButton);
    state.groupSelect?.addEventListener('change', applyGroupColor);
    state.statusSelect?.addEventListener('change', () => {
      if (String(state.statusSelect.value || '').trim() === 'Переглянув' && state.viewed < 1) setViewed(1);
      syncWatchProgressVisibility();
    });
    [state.favoriteInput, state.likedInput].forEach(input => input?.addEventListener('change', () => {
      input.closest('.an2n2-toggle')?.classList.toggle('active', input.checked);
    }));
  }

  GM_registerMenuCommand('Anime → Notion: відкрити панель', async () => {
    state.panel.hidden = false;
    if (!state.running) await resetPanel();
  });

  buildUi();
})();
