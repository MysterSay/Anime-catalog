// ==UserScript==
// @name         News List Title Parser -> JSON
// @namespace    yoru.anime.tools
// @version      1.0.0
// @description  Парсить тайтли з .news-list, збирає назву з alt і посилання з href та завантажує JSON.
// @author       Myster_Say
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'yoru-news-list-parser-btn';
  const TOAST_ID = 'yoru-news-list-parser-toast';

  function absoluteUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return href || '';
    }
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function findTitle(item, link) {
    // У першу чергу беремо alt безпосередньо з елемента всередині запису.
    const altNode = item.querySelector('img[alt], [alt]');
    const alt = cleanText(altNode?.getAttribute('alt'));
    if (alt) return alt;

    // Резервні варіанти, якщо структура сторінки трохи зміниться.
    const linkAlt = cleanText(link?.getAttribute('alt'));
    if (linkAlt) return linkAlt;

    const titleAttr = cleanText(link?.getAttribute('title'));
    if (titleAttr) return titleAttr;

    return cleanText(link?.textContent);
  }

  function parseNewsList() {
    const newsList = document.querySelector('.news-list');
    if (!newsList) {
      throw new Error('Не знайдено блок з class="news-list".');
    }

    // ai-* може змінюватись, тому достатньо стабільних класів utn + d-flex.
    const items = [...newsList.querySelectorAll('.utn.d-flex')];
    if (!items.length) {
      throw new Error('У .news-list не знайдено елементів .utn.d-flex.');
    }

    const results = [];
    const seen = new Set();

    for (const item of items) {
      const link = item.querySelector('a[href]');
      if (!link) continue;

      const url = absoluteUrl(link.getAttribute('href'));
      const title = findTitle(item, link);

      if (!url || !title) continue;

      const key = `${title}\n${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        title,
        url,
      });
    }

    return {
      schema_version: 1,
      source: location.href,
      page_title: document.title,
      parsed_at: new Date().toISOString(),
      count: results.length,
      items: results,
    };
  }

  function downloadJson(data) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const virtualUrl = URL.createObjectURL(blob);

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');

    const anchor = document.createElement('a');
    anchor.href = virtualUrl;
    anchor.download = `anime-titles-${stamp}.json`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(virtualUrl), 1500);
  }

  function showToast(message, type = 'ok') {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      Object.assign(toast.style, {
        position: 'fixed',
        right: '22px',
        bottom: '82px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '11px 14px',
        borderRadius: '12px',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '13px',
        lineHeight: '1.4',
        color: '#f5f7fb',
        background: 'rgba(15, 18, 28, .96)',
        border: '1px solid rgba(255,255,255,.12)',
        boxShadow: '0 18px 50px rgba(0,0,0,.38)',
        backdropFilter: 'blur(14px)',
        transition: 'opacity .2s ease, transform .2s ease',
      });
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.borderColor = type === 'error'
      ? 'rgba(255, 105, 125, .42)'
      : 'rgba(112, 201, 255, .34)';
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
    }, 2600);
  }

  function runParser() {
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.disabled = true;
      button.textContent = 'Парсинг…';
    }

    try {
      const data = parseNewsList();
      if (!data.items.length) {
        throw new Error('Тайтли з href + alt не знайдено.');
      }

      downloadJson(data);
      showToast(`Готово. Зібрано тайтлів: ${data.count}`);
      console.log('[YORU Parser] JSON:', data);
    } catch (error) {
      console.error('[YORU Parser]', error);
      showToast(error.message || 'Помилка парсингу.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Зібрати JSON';
      }
    }
  }

  function createButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Зібрати JSON';
    button.title = 'Зібрати назви та посилання з news-list';

    Object.assign(button.style, {
      position: 'fixed',
      right: '22px',
      bottom: '22px',
      zIndex: '2147483647',
      height: '46px',
      padding: '0 17px',
      borderRadius: '14px',
      border: '1px solid rgba(112, 201, 255, .34)',
      background: 'linear-gradient(180deg, rgba(26, 48, 65, .96), rgba(14, 25, 36, .96))',
      color: '#e9f7ff',
      boxShadow: '0 16px 45px rgba(0,0,0,.38), 0 0 24px rgba(112,201,255,.10)',
      backdropFilter: 'blur(14px)',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: '700',
      fontSize: '13px',
      cursor: 'pointer',
      transition: 'transform .18s ease, box-shadow .18s ease, opacity .18s ease',
    });

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 18px 52px rgba(0,0,0,.42), 0 0 30px rgba(112,201,255,.18)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 16px 45px rgba(0,0,0,.38), 0 0 24px rgba(112,201,255,.10)';
    });

    button.addEventListener('click', runParser);
    document.body.appendChild(button);
  }

  createButton();
})();
