// ==UserScript==
// @name         Anime Core Client
// @namespace    myster.anime.core
// @version      2.0.0
// @description  Minimal client: title settings -> JSON -> Python core.
// @author       Myster
//
// @match        *://jut-su.net/*
// @match        *://*.jut-su.net/*
// @match        *://ru.yummyani.me/*
// @match        *://*.ru.yummyani.me/*
// @match        *://crunchyroll.com/*
// @match        *://*.crunchyroll.com/*
// @match        *://shikimori.io/*
// @match        *://*.shikimori.io/*
// @match        *://shikimori.one/*
// @match        *://*.shikimori.one/*
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
// @match        *://myanimelist.net/*
// @match        *://*.myanimelist.net/*
// @match        *://anilist.co/*
// @match        *://*.anilist.co/*
//
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '2.0.0';
  const STORAGE = {
    coreUrl: 'anime_core_url_v2',
    apiKey: 'anime_core_api_key_v2',
    groups: 'anime_core_groups_v2',
    lastStatus: 'anime_core_last_status_v2',
    lastGroup: 'anime_core_last_group_v2',
  };

  const STATUSES = [
    'Буду дивитись',
    'Дивлюсь',
    'Переглянув',
    'Відкладено',
    'Кинуто',
  ];

  const DEFAULT_CORE_URL = 'http://127.0.0.1:8000/api/process';

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cleanTitle(value) {
    return cleanText(value)
      .replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, '')
      .replace(/\s*[|–—-]\s*(?:смотреть|дивитися|watch|anime|аниме|аніме).*$/i, '')
      .replace(/\s*[|–—-]\s*(?:jut\.?su|animego|shikimori|crunchyroll|anilibria|uaserials|myanimelist|anilist).*$/i, '')
      .trim();
  }

  function getMeta(selector) {
    return cleanText(document.querySelector(selector)?.getAttribute('content'));
  }

  function extractTitle() {
    const candidates = [
      document.querySelector('h1[itemprop="name"]')?.textContent,
      document.querySelector('[itemprop="name"] h1')?.textContent,
      document.querySelector('main h1')?.textContent,
      document.querySelector('article h1')?.textContent,
      document.querySelector('h1')?.textContent,
      getMeta('meta[property="og:title"]'),
      getMeta('meta[name="twitter:title"]'),
      document.title,
    ].map(cleanTitle).filter(Boolean);

    return candidates[0] || '';
  }

  function loadGroups() {
    const value = GM_getValue(STORAGE.groups, []);
    return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
  }

  function saveGroups(groups) {
    const unique = [...new Set(groups.map(cleanText).filter(Boolean))];
    GM_setValue(STORAGE.groups, unique);
    return unique;
  }

  function configureCore() {
    const current = String(GM_getValue(STORAGE.coreUrl, DEFAULT_CORE_URL) || DEFAULT_CORE_URL);
    const url = prompt('URL Python-ядра:', current);
    if (url === null) return;
    GM_setValue(STORAGE.coreUrl, url.trim() || DEFAULT_CORE_URL);

    const currentKey = String(GM_getValue(STORAGE.apiKey, '') || '');
    const key = prompt('X-API-Key (залиш порожнім, якщо ще не використовується):', currentKey);
    if (key !== null) GM_setValue(STORAGE.apiKey, key.trim());

    notify('Налаштування підключення збережені.');
  }

  function notify(text) {
    try {
      GM_notification({ title: 'Anime Core Client', text, timeout: 3500 });
    } catch {
      console.log('[Anime Core Client]', text);
    }
  }

  function postJson(payload) {
    const url = String(GM_getValue(STORAGE.coreUrl, DEFAULT_CORE_URL) || DEFAULT_CORE_URL).trim();
    const apiKey = String(GM_getValue(STORAGE.apiKey, '') || '').trim();

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
        data: JSON.stringify(payload),
        onload: response => {
          let body = null;
          try { body = JSON.parse(response.responseText || '{}'); } catch {}
          if (response.status >= 200 && response.status < 300) resolve(body);
          else reject(new Error(body?.detail || body?.error || `HTTP ${response.status}`));
        },
        onerror: () => reject(new Error('Не вдалося підключитися до Python-ядра.')),
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function openSettings() {
    const title = extractTitle();
    if (!title) {
      alert('Не вдалося визначити назву тайтлу на сторінці.');
      return;
    }

    document.getElementById('anime-core-modal')?.remove();

    let groups = loadGroups();
    const lastStatus = String(GM_getValue(STORAGE.lastStatus, STATUSES[0]) || STATUSES[0]);
    const lastGroup = String(GM_getValue(STORAGE.lastGroup, '') || '');

    const overlay = document.createElement('div');
    overlay.id = 'anime-core-modal';
    overlay.innerHTML = `
      <div class="ac-card">
        <div class="ac-head">
          <div>
            <div class="ac-title">Налаштування тайтлу</div>
            <div class="ac-subtitle">${escapeHtml(title)}</div>
          </div>
          <button class="ac-close" type="button">×</button>
        </div>

        <label class="ac-label">Статус</label>
        <select class="ac-select" id="ac-status">
          ${STATUSES.map(item => `<option value="${escapeHtml(item)}" ${item === lastStatus ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
        </select>

        <label class="ac-label">Група</label>
        <div class="ac-group-row">
          <select class="ac-select" id="ac-group"></select>
          <button class="ac-add-group" type="button">＋ Додати групу</button>
        </div>

        <div class="ac-actions">
          <button class="ac-cancel" type="button">Скасувати</button>
          <button class="ac-send" type="button">Підтвердити та відправити</button>
        </div>
        <div class="ac-state" hidden></div>
      </div>
    `;

    const groupSelect = overlay.querySelector('#ac-group');
    const renderGroups = (preferred = '') => {
      const selected = preferred || groupSelect.value || lastGroup;
      groupSelect.innerHTML = `<option value="">Без групи</option>` + groups
        .map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
        .join('');
      if ([...groupSelect.options].some(option => option.value === selected)) groupSelect.value = selected;
    };
    renderGroups();

    overlay.querySelector('.ac-add-group').addEventListener('click', () => {
      const value = cleanText(prompt('Назва нової групи:') || '');
      if (!value) return;
      groups = saveGroups([...groups, value]);
      renderGroups(value);
    });

    const close = () => overlay.remove();
    overlay.querySelector('.ac-close').addEventListener('click', close);
    overlay.querySelector('.ac-cancel').addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });

    overlay.querySelector('.ac-send').addEventListener('click', async () => {
      const button = overlay.querySelector('.ac-send');
      const state = overlay.querySelector('.ac-state');
      const status = overlay.querySelector('#ac-status').value;
      const group = overlay.querySelector('#ac-group').value;

      const payload = {
        title,
        url: location.href,
        status: status || '',
        group: group || '',
      };

      GM_setValue(STORAGE.lastStatus, status || '');
      GM_setValue(STORAGE.lastGroup, group || '');

      button.disabled = true;
      button.textContent = 'Відправляю…';
      state.hidden = false;
      state.className = 'ac-state';
      state.textContent = 'JSON передано ядру. Очікую завершення пошуку…';

      try {
        const result = await postJson(payload);
        state.classList.add('ac-ok');
        state.textContent = `Готово. Оригінальна назва: ${result?.title?.original || 'не визначена'}`;
        button.textContent = 'Готово';
        notify(`Оброблено: ${result?.title?.ukrainian || result?.title?.original || title}`);
      } catch (error) {
        state.classList.add('ac-error');
        state.textContent = error.message || String(error);
        button.disabled = false;
        button.textContent = 'Повторити';
      }
    });

    document.documentElement.appendChild(overlay);
  }

  GM_addStyle(`
    #anime-core-button {
      position: fixed; top: 18px; right: 18px; z-index: 2147483646;
      border: 0; border-radius: 12px; padding: 11px 15px;
      background: #111827; color: #fff; cursor: pointer;
      font: 700 13px/1.2 system-ui, sans-serif;
      box-shadow: 0 8px 28px rgba(0,0,0,.28);
    }
    #anime-core-modal {
      position: fixed; inset: 0; z-index: 2147483647;
      display: grid; place-items: center; padding: 18px;
      background: rgba(0,0,0,.62); backdrop-filter: blur(5px);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #anime-core-modal .ac-card {
      width: min(520px, 100%); box-sizing: border-box;
      border-radius: 18px; padding: 18px;
      color: #f9fafb; background: #111827;
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: 0 24px 80px rgba(0,0,0,.48);
    }
    .ac-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
    .ac-title { font-size:18px; font-weight:800; }
    .ac-subtitle { margin-top:4px; font-size:13px; color:#9ca3af; line-height:1.35; }
    .ac-close { border:0; background:transparent; color:#d1d5db; font-size:24px; cursor:pointer; }
    .ac-label { display:block; margin:13px 0 6px; font-size:12px; font-weight:700; color:#d1d5db; }
    .ac-select {
      width:100%; min-height:42px; box-sizing:border-box; border-radius:10px;
      border:1px solid #374151; padding:8px 10px; background:#1f2937; color:#f9fafb;
    }
    .ac-group-row { display:grid; grid-template-columns:1fr auto; gap:8px; }
    .ac-add-group, .ac-cancel, .ac-send {
      border:0; border-radius:10px; padding:10px 13px; cursor:pointer; font-weight:700;
    }
    .ac-add-group, .ac-cancel { background:#374151; color:#f9fafb; }
    .ac-send { background:#2563eb; color:white; }
    .ac-send:disabled { opacity:.65; cursor:wait; }
    .ac-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; }
    .ac-state { margin-top:12px; padding:10px 12px; border-radius:10px; background:#1f2937; color:#d1d5db; font-size:13px; }
    .ac-ok { color:#86efac; }
    .ac-error { color:#fca5a5; }
    @media (max-width:560px) { .ac-group-row { grid-template-columns:1fr; } }
  `);

  const button = document.createElement('button');
  button.id = 'anime-core-button';
  button.type = 'button';
  button.textContent = '＋ Anime → Core';
  button.title = `Anime Core Client v${VERSION}`;
  button.addEventListener('click', openSettings);
  document.documentElement.appendChild(button);

  GM_registerMenuCommand('Anime Core: налаштувати URL/API key', configureCore);
})();
