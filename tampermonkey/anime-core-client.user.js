// ==UserScript==
// @name         Anime -> Notion Collector
// @namespace    myster.anime.notion
// @version      2.0.0
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
//
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '2.0.0';
  const STREAM_URL = 'https://myster-anime.pages.dev/api/process-title-stream';
  const INGEST_URL = 'https://myster-anime.pages.dev/api/ingest';
  const STATUS_OPTIONS = ['', 'Буду дивитись', 'Дивлюсь', 'Переглянув', 'Відкладено', 'Кинуто'];

  const state = {
    running: false,
    panel: null,
    button: null,
    titleInput: null,
    statusSelect: null,
    groupInput: null,
    startButton: null,
    progressBar: null,
    progressPercent: null,
    progressText: null,
    log: null,
  };

  function cleanTitle(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, '')
      .replace(/\s*[|–—-]\s*(?:смотреть|дивитися|watch|anime|аниме|аніме).*$/i, '')
      .replace(/\s*[|–—-]\s*(?:jut\.?su|animego|shikimori|crunchyroll|anilibria|uaserials|myanimelist|anilist).*$/i, '')
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

  function extractTitle() {
    const candidates = [
      firstText([
        'h1[itemprop="name"]', '[itemprop="name"] h1', '.anime-title h1',
        '.release-title h1', '.post-title h1', '.entry-title', 'main h1', 'article h1', 'h1',
      ]),
      metaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]']),
      cleanTitle(document.title),
    ].filter(Boolean);
    return candidates.sort((a, b) => a.length - b.length)[0] || '';
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
    if (!state.log || !message) return;
    const row = document.createElement('div');
    row.className = `an2n2-log ${type}`.trim();
    row.textContent = message;
    state.log.appendChild(row);
    state.log.scrollTop = state.log.scrollHeight;
  }

  function resetPanel() {
    if (state.titleInput) state.titleInput.value = extractTitle();
    if (state.statusSelect) state.statusSelect.value = '';
    if (state.groupInput) state.groupInput.value = '';
    if (state.log) state.log.innerHTML = '';
    setProgress(0, 'Готовий до запуску.');
  }

  async function parseReadableStream(stream, onPacket) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;
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
        if (packet.type === 'error') throw new Error(packet.message || 'Python core завершився з помилкою.');
        if (packet.type === 'result' && packet.result) finalResult = packet.result;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      try {
        const packet = JSON.parse(buffer);
        onPacket(packet);
        if (packet.type === 'error') throw new Error(packet.message || 'Python core завершився з помилкою.');
        if (packet.type === 'result' && packet.result) finalResult = packet.result;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return finalResult;
  }

  async function streamWithFetch(payload, onPacket) {
    const response = await fetch(STREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Stream HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!response.body) throw new Error('Streaming body відсутній.');
    return parseReadableStream(response.body, onPacket);
  }

  function streamWithGM(payload, onPacket) {
    return new Promise((resolve, reject) => {
      let streamStarted = false;
      let settled = false;
      GM_xmlhttpRequest({
        method: 'POST',
        url: STREAM_URL,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        data: JSON.stringify(payload),
        responseType: 'stream',
        onloadstart: response => {
          const stream = response?.response;
          if (!stream?.getReader) return;
          streamStarted = true;
          parseReadableStream(stream, onPacket).then(result => {
            settled = true;
            resolve(result);
          }).catch(error => {
            settled = true;
            reject(error);
          });
        },
        onload: response => {
          if (settled || streamStarted) return;
          if (response.status < 200 || response.status >= 400) {
            reject(new Error(`Stream HTTP ${response.status}: ${String(response.responseText || '').slice(0, 500)}`));
            return;
          }
          let result = null;
          for (const line of String(response.responseText || '').split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const packet = JSON.parse(line);
              onPacket(packet);
              if (packet.type === 'error') throw new Error(packet.message || 'Python core error');
              if (packet.type === 'result') result = packet.result;
            } catch (error) {
              if (!(error instanceof SyntaxError)) { reject(error); return; }
            }
          }
          resolve(result);
        },
        onerror: error => reject(new Error(`Network error: ${error?.error || 'GM_xmlhttpRequest'}`)),
      });
    });
  }

  async function streamProcess(payload, onPacket) {
    try {
      return await streamWithFetch(payload, onPacket);
    } catch (error) {
      addLog(`Native stream недоступний, використовую Tampermonkey stream: ${error.message}`, 'warn');
      return streamWithGM(payload, onPacket);
    }
  }

  function postJson(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        data: JSON.stringify(payload),
        onload: response => {
          let data = {};
          try { data = JSON.parse(response.responseText || '{}'); } catch {}
          if (response.status >= 200 && response.status < 400) resolve(data);
          else reject(new Error(data.error || `HTTP ${response.status}: ${String(response.responseText || '').slice(0, 400)}`));
        },
        onerror: error => reject(new Error(`Network error: ${error?.error || 'unknown'}`)),
      });
    });
  }

  function onProgressPacket(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.type === 'heartbeat') {
      setProgress(packet.percent, packet.message || 'Python core працює…');
      return;
    }
    if (packet.type === 'progress') {
      const domain = packet.domain ? ` · ${packet.domain}` : '';
      setProgress(packet.percent, `${packet.message || packet.stage}${domain}`);
      if (packet.domain || ['identity', 'catalogs_done', 'finalize'].includes(packet.stage)) {
        addLog(`${packet.percent}% · ${packet.message || packet.stage}${domain}`, packet.error ? 'warn' : '');
      }
    }
  }

  async function run() {
    if (state.running) return;
    const title = cleanTitle(state.titleInput?.value || extractTitle());
    if (!title) {
      alert('Не вдалося визначити назву. Введи її вручну в полі панелі.');
      return;
    }
    state.running = true;
    state.startButton.disabled = true;
    state.button.disabled = true;
    if (state.log) state.log.innerHTML = '';
    setProgress(1, 'Запускаю Python core…');
    addLog(`Джерело: ${location.href}`);
    addLog(`Назва: ${title}`);

    try {
      const result = await streamProcess({
        title,
        url: location.href,
        status: state.statusSelect?.value || '',
        group: cleanTitle(state.groupInput?.value || ''),
      }, onProgressPacket);

      if (!result?.title) throw new Error('Stream завершився без schema-v2 JSON.');
      setProgress(99, 'JSON готовий. Відправляю в Yoru / Notion…');
      addLog('99% · Фінальний JSON отримано.', 'ok');
      const saved = await postJson(INGEST_URL, result);
      if (!saved?.item?.id) throw new Error('Yoru ingest не повернув ID тайтлу.');

      setProgress(100, saved.existing ? 'Готово: тайтл оновлено в Notion.' : 'Готово: тайтл додано в Notion.', 'ok');
      addLog(`100% · ${saved.existing ? 'Оновлено' : 'Додано'}: ${saved.item.title || title}`, 'ok');
      notify('Anime → Notion', `${saved.existing ? 'Оновлено' : 'Додано'}: ${saved.item.title || title}`);
    } catch (error) {
      console.error('[Anime -> Notion v2]', error);
      setProgress(Number(state.progressPercent?.textContent?.replace('%', '')) || 0, `Помилка: ${error.message}`, 'error');
      addLog(error.message || String(error), 'error');
      notify('Anime → Notion', `Помилка: ${error.message || error}`);
    } finally {
      state.running = false;
      state.startButton.disabled = false;
      state.button.disabled = false;
    }
  }

  function buildUi() {
    GM_addStyle(`
      #an2n2-button{position:fixed;top:18px;right:18px;z-index:2147483646;border:1px solid rgba(255,255,255,.16);border-radius:13px;padding:11px 15px;background:#101522;color:#fff;font:700 13px system-ui;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      #an2n2-panel{position:fixed;top:70px;right:18px;z-index:2147483647;width:min(420px,calc(100vw - 36px));max-height:calc(100vh - 90px);overflow:auto;padding:16px;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(10,13,21,.97);color:#e8edf7;box-shadow:0 24px 80px rgba(0,0,0,.52);font:13px/1.45 system-ui;backdrop-filter:blur(18px)}
      #an2n2-panel[hidden]{display:none!important}.an2n2-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.an2n2-head strong{font-size:15px}.an2n2-close{border:0;background:rgba(255,255,255,.07);color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer}
      .an2n2-field{display:grid;gap:6px;margin:10px 0}.an2n2-field span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8fa1b8;font-weight:800}.an2n2-field input,.an2n2-field select{min-height:42px;border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:0 11px;background:#151a27;color:#fff;outline:none}.an2n2-actions{display:flex;gap:9px;margin-top:12px}.an2n2-start{flex:1;min-height:42px;border:1px solid rgba(112,201,255,.3);border-radius:11px;background:rgba(112,201,255,.12);color:#dff5ff;font-weight:800;cursor:pointer}.an2n2-start:disabled{opacity:.5;cursor:default}
      .an2n2-track{height:7px;margin-top:15px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.08)}.an2n2-track>div{height:100%;width:0;background:linear-gradient(90deg,#70c9ff,#9b8cff);transition:width .3s ease}.an2n2-progress-meta{display:grid;grid-template-columns:46px 1fr;gap:8px;margin-top:8px;color:#9ea9ba}.an2n2-progress-meta b{color:#dff5ff}.an2n2-progress-meta span[data-type=error]{color:#ff98a9}.an2n2-progress-meta span[data-type=ok]{color:#8ee6b0}
      .an2n2-logs{display:grid;gap:6px;max-height:220px;overflow:auto;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}.an2n2-log{padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.035);color:#aab5c5;font-size:11px}.an2n2-log.ok{color:#8ee6b0}.an2n2-log.warn{color:#ffd38a}.an2n2-log.error{color:#ff98a9}
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
      <label class="an2n2-field"><span>Назва зі сторінки</span><input class="an2n2-title" type="text"></label>
      <label class="an2n2-field"><span>Статус</span><select class="an2n2-status">${STATUS_OPTIONS.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x || 'Без статусу')}</option>`).join('')}</select></label>
      <label class="an2n2-field"><span>Група</span><input class="an2n2-group" type="text" placeholder="Необов'язково"></label>
      <div class="an2n2-actions"><button class="an2n2-start" type="button">Запустити повний пошук</button></div>
      <div class="an2n2-track"><div></div></div>
      <div class="an2n2-progress-meta"><b>0%</b><span>Готовий до запуску.</span></div>
      <div class="an2n2-logs"></div>`;
    (document.body || document.documentElement).appendChild(panel);

    state.button = button;
    state.panel = panel;
    state.titleInput = panel.querySelector('.an2n2-title');
    state.statusSelect = panel.querySelector('.an2n2-status');
    state.groupInput = panel.querySelector('.an2n2-group');
    state.startButton = panel.querySelector('.an2n2-start');
    state.progressBar = panel.querySelector('.an2n2-track > div');
    state.progressPercent = panel.querySelector('.an2n2-progress-meta b');
    state.progressText = panel.querySelector('.an2n2-progress-meta span');
    state.log = panel.querySelector('.an2n2-logs');

    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !state.running) resetPanel();
    });
    panel.querySelector('.an2n2-close').addEventListener('click', () => {
      if (!state.running) panel.hidden = true;
    });
    state.startButton.addEventListener('click', run);
  }

  GM_registerMenuCommand('Anime → Notion: відкрити панель', () => {
    state.panel.hidden = false;
    if (!state.running) resetPanel();
  });

  buildUi();
})();
