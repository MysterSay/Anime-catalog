const root = document.getElementById('mergeRoot');
const toast = document.getElementById('toast');
const params = new URLSearchParams(location.search);
const rightId = params.get('right') || '';
const leftId = params.get('left') || '';
const FALLBACK_IMAGE = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 700 1000%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%23171b27%22/%3E%3Cstop offset=%221%22 stop-color=%22%23282d42%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22700%22 height=%221000%22 fill=%22url(%23g)%22/%3E%3Ctext x=%22350%22 y=%22520%22 text-anchor=%22middle%22 fill=%22%23798094%22 font-family=%22Arial%22 font-size=%2270%22%3EYORU%3C/text%3E%3C/svg%3E';

let rightItem = null;
let leftItem = null;
let busy = false;
const choices = { title: 'right', poster: 'right', marks: 'right', banner: 'right', description: 'right' };

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}

function hasField(item, field) {
  if (!item) return false;
  if (field === 'poster') return Boolean(item.hasPoster && item.poster);
  if (field === 'banner') return Boolean(item.hasBanner && item.banner);
  if (field === 'description') return Boolean(String(item.description || '').trim());
  return true;
}

function sideForAvailable(field) {
  const rightHas = hasField(rightItem, field);
  const leftHas = hasField(leftItem, field);
  if (rightHas && !leftHas) return 'right';
  if (leftHas && !rightHas) return 'left';
  return choices[field] || 'right';
}

function normalizeChoices() {
  for (const field of Object.keys(choices)) choices[field] = sideForAvailable(field);
}

function snippet(text, max = 260) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Немає даних';
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
}

function sideFavorite(item) {
  return Boolean(item?.favorite);
}

function sideLiked(item) {
  return Boolean(item?.liked);
}

function sideCard(field, side, item) {
  const selected = choices[field] === side;
  const available = hasField(item, field);
  const cls = `merge-data-card merge-side-${side} ${selected ? 'selected' : 'unselected'} ${available ? '' : 'unavailable'}`;
  let content = '';
  if (field === 'title') {
    content = `<div class="merge-title-value"><strong>${escapeHtml(item.title)}</strong>${item.originalTitle ? `<small>${escapeHtml(item.originalTitle)}</small>` : ''}</div>`;
  } else if (field === 'poster') {
    content = available ? `<img class="merge-poster-value" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)}" />` : '<div class="merge-empty-value">Постера немає</div>';
  } else if (field === 'banner') {
    content = available ? `<img class="merge-banner-value" src="${escapeHtml(item.banner)}" alt="" />` : '<div class="merge-empty-value">Банера немає</div>';
  } else if (field === 'description') {
    content = `<p class="merge-description-value">${escapeHtml(snippet(item.description))}</p>`;
  } else if (field === 'marks') {
    content = `<div class="merge-marks-value">
      <span>${escapeHtml(item.status || 'Без статусу')}</span>
      <span>${escapeHtml(item.group || 'Без групи')}</span>
      <span class="${sideFavorite(item) ? 'on' : ''}">🔖 ${sideFavorite(item) ? 'Вибране' : 'Не вибране'}</span>
      <span class="${sideLiked(item) ? 'on' : ''}">♡ ${sideLiked(item) ? 'Улюблене' : 'Не улюблене'}</span>
    </div>`;
  }
  return `<button class="${cls}" type="button" data-select-field="${field}" data-select-side="${side}" ${available ? '' : 'disabled'}>${content}</button>`;
}

function switchControl(field) {
  const rightHas = hasField(rightItem, field);
  const leftHas = hasField(leftItem, field);
  const locked = rightHas !== leftHas || (!rightHas && !leftHas);
  return `<button class="merge-choice-switch ${choices[field]} ${locked ? 'locked' : ''}" type="button" data-switch-field="${field}" ${locked ? 'disabled' : ''} aria-label="Вибрати сторону">
    <span class="merge-choice-track"><i></i></span>
  </button>`;
}

function row(field, label) {
  return `<section class="merge-field-row" data-field-row="${field}">
    <div class="merge-field-heading"><span>${escapeHtml(label)}</span></div>
    <div class="merge-field-grid">
      ${sideCard(field, 'left', leftItem)}
      <div class="merge-field-switch">${switchControl(field)}</div>
      ${sideCard(field, 'right', rightItem)}
    </div>
  </section>`;
}

function sourceHeader(item, side) {
  return `<article class="merge-source-summary merge-side-${side}">
    <img src="${escapeHtml(item.poster || FALLBACK_IMAGE)}" alt="${escapeHtml(item.title)}" />
    <div><span>${side === 'right' ? 'ПЕРШИЙ ТАЙТЛ · ЗАЛИШИТЬСЯ В БАЗІ' : 'ДРУГИЙ ТАЙТЛ · БУДЕ ВИДАЛЕНО'}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.status || 'Без статусу')} · ${escapeHtml(item.group || 'Без групи')}</p></div>
  </article>`;
}

function render() {
  normalizeChoices();
  document.title = `Об’єднання: ${rightItem.title} + ${leftItem.title} — Yoru`;
  const allLinks = [...(rightItem.links || []), ...(leftItem.links || [])];
  const uniqueLinks = new Set(allLinks.map(x => String(x.url || '').replace(/#.*$/, '').replace(/\/$/, '')).filter(Boolean));
  root.innerHTML = `
    <header class="merge-topbar">
      <a class="merge-back" href="index.html?merge=${encodeURIComponent(rightItem.id)}">← Назад до вибору</a>
      <div class="merge-top-copy"><span>ОБ’ЄДНАННЯ ТАЙТЛІВ</span><strong>Один запис із двох</strong></div>
      <button class="merge-submit" type="button" data-merge-submit>Об’єднати</button>
    </header>

    <section class="merge-hero-head">
      ${sourceHeader(leftItem, 'left')}
      <div class="merge-center-label"><span>ВИБИРАЙ ДАНІ</span><b>⇄</b><small>За замовчуванням обрано правий тайтл</small></div>
      ${sourceHeader(rightItem, 'right')}
    </section>

    <section class="merge-fields">
      ${row('title', 'Назва')}
      ${row('poster', 'Постер')}
      ${row('marks', 'Позначення')}
      ${row('banner', 'Банер')}
      ${row('description', 'Опис')}
      <section class="merge-links-row">
        <div><span>ПОСИЛАННЯ</span><strong>${uniqueLinks.size} унікальних</strong></div>
        <p>Посилання об’єднаються автоматично. Повні дублікати будуть проігноровані.</p>
      </section>
    </section>

    <footer class="merge-footer">
      <div><strong>Залишиться:</strong> ${escapeHtml(rightItem.title)}<small>Другий запис буде прибрано з бази після успішного об’єднання.</small></div>
      <button class="merge-submit merge-submit-bottom" type="button" data-merge-submit>Об’єднати</button>
    </footer>`;
}

function selectSide(field, side) {
  if (!hasField(side === 'left' ? leftItem : rightItem, field)) return;
  choices[field] = side;
  render();
}


async function submitMerge() {
  if (busy) return;
  busy = true;
  document.querySelectorAll('[data-merge-submit]').forEach(btn => { btn.disabled = true; btn.textContent = 'Об’єдную…'; });
  try {
    const response = await fetch('/api/anime/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ rightId: rightItem.id, leftId: leftItem.id, choices }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    location.href = `title.html?id=${encodeURIComponent(payload.keptId || rightItem.id)}`;
  } catch (error) {
    busy = false;
    document.querySelectorAll('[data-merge-submit]').forEach(btn => { btn.disabled = false; btn.textContent = 'Об’єднати'; });
    showToast(error.message || 'Не вдалося об’єднати тайтли.');
  }
}

root.addEventListener('click', event => {
  const side = event.target.closest('[data-select-side]');
  if (side) {
    selectSide(side.dataset.selectField, side.dataset.selectSide);
    return;
  }
  const toggle = event.target.closest('[data-switch-field]');
  if (toggle) {
    const field = toggle.dataset.switchField;
    choices[field] = choices[field] === 'right' ? 'left' : 'right';
    render();
    return;
  }
  if (event.target.closest('[data-merge-submit]')) submitMerge();
});

async function load() {
  if (!rightId || !leftId || rightId === leftId) {
    root.innerHTML = '<div class="merge-loading"><h1>Некоректна пара тайтлів</h1><a href="index.html">Повернутися в каталог</a></div>';
    return;
  }
  try {
    const [rightResponse, leftResponse] = await Promise.all([
      fetch(`/api/anime?id=${encodeURIComponent(rightId)}`, { cache: 'no-store' }),
      fetch(`/api/anime?id=${encodeURIComponent(leftId)}`, { cache: 'no-store' }),
    ]);
    const [rightPayload, leftPayload] = await Promise.all([rightResponse.json(), leftResponse.json()]);
    if (!rightResponse.ok) throw new Error(rightPayload.error || 'Не вдалося завантажити перший тайтл.');
    if (!leftResponse.ok) throw new Error(leftPayload.error || 'Не вдалося завантажити другий тайтл.');
    rightItem = rightPayload.item;
    leftItem = leftPayload.item;
    render();
  } catch (error) {
    root.innerHTML = `<div class="merge-loading"><h1>Не вдалося відкрити об’єднання</h1><p>${escapeHtml(error.message || 'Невідома помилка')}</p><a href="index.html">Повернутися в каталог</a></div>`;
  }
}

load();
