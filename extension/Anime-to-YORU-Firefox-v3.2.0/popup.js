'use strict';

const EXT = globalThis.chrome || globalThis.browser;
const DEFAULT_BASE = 'https://mrsay.pages.dev';
const SITE_STORAGE_KEY = 'yoru-site-base';

const input = document.getElementById('siteBase');
const saveButton = document.getElementById('saveSite');
const openPanelButton = document.getElementById('openPanel');
const openYoruButton = document.getElementById('openYoru');
const statusEl = document.getElementById('siteStatus');
const browserBadge = document.getElementById('browserBadge');

function normalizeSiteBase(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname) return '';
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`.trim();
}

function runtimeError() {
  try { return EXT.runtime?.lastError?.message || ''; } catch (_) { return ''; }
}

function getStorage(key, fallback) {
  return new Promise(resolve => {
    EXT.storage.local.get([key], result => {
      if (runtimeError()) return resolve(fallback);
      resolve(result && Object.prototype.hasOwnProperty.call(result, key) ? result[key] : fallback);
    });
  });
}

function setStorage(key, value) {
  return new Promise((resolve, reject) => {
    EXT.storage.local.set({ [key]: value }, () => {
      const error = runtimeError();
      if (error) reject(new Error(error));
      else resolve();
    });
  });
}

function activeTab() {
  return new Promise(resolve => {
    EXT.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs?.[0] || null));
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    EXT.tabs.sendMessage(tabId, message, response => {
      const error = runtimeError();
      if (error) reject(new Error(error));
      else resolve(response);
    });
  });
}

function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Vivaldi\//i.test(ua)) return 'Vivaldi';
  if (/Chrome\//i.test(ua)) return 'Chromium';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'WebExtension';
}

async function saveSite() {
  const normalized = normalizeSiteBase(input.value);
  if (!normalized) {
    setStatus('Некоректний домен або URL.', 'error');
    return;
  }
  saveButton.disabled = true;
  try {
    await setStorage(SITE_STORAGE_KEY, normalized);
    input.value = normalized;
    const tab = await activeTab();
    if (tab?.id != null) {
      try { await sendToTab(tab.id, { type: 'reloadSiteBase' }); } catch (_) {}
    }
    setStatus(`Збережено: ${new URL(normalized).host}`, 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    saveButton.disabled = false;
  }
}

async function openPanel() {
  openPanelButton.disabled = true;
  try {
    const tab = await activeTab();
    if (!tab?.id && tab?.id !== 0) throw new Error('Активну вкладку не знайдено.');
    await sendToTab(tab.id, { type: 'openPanel' });
    setStatus('Панель відкрита у вкладці.', 'ok');
    setTimeout(() => window.close(), 180);
  } catch (_) {
    setStatus('На цій сторінці Anime → YORU не активний.', 'warn');
  } finally {
    openPanelButton.disabled = false;
  }
}

async function openYoru() {
  const base = normalizeSiteBase(input.value) || DEFAULT_BASE;
  EXT.tabs.create({ url: base });
}

(async () => {
  browserBadge.textContent = detectBrowser();
  const saved = normalizeSiteBase(await getStorage(SITE_STORAGE_KEY, DEFAULT_BASE)) || DEFAULT_BASE;
  input.value = saved;
  setStatus(`Активний сайт: ${new URL(saved).host}`);
})();

saveButton.addEventListener('click', saveSite);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter') saveSite();
});
openPanelButton.addEventListener('click', openPanel);
openYoruButton.addEventListener('click', openYoru);
