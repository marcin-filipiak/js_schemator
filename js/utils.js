/* Drobne funkcje pomocnicze */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function round(v, digits = 2) {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fallback */ }
  }
  return JSON.parse(JSON.stringify(value));
}

export function debounce(fn, ms = 300) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Usuwa niebezpieczne elementy/atrybuty z węzła SVG (in-place). */
export function sanitizeSvgNode(root) {
  const banned = new Set(['script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set']);
  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (banned.has(tag)) { child.remove(); continue; }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on')) child.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'xlink:href') && /^\s*(javascript|data:text\/html)/i.test(value)) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(root);
  return root;
}

function sanitizeMarkup(markup) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    'image/svg+xml'
  );
  if (doc.querySelector('parsererror')) return '';
  const svg = doc.querySelector('svg');
  sanitizeSvgNode(svg);
  return svg.innerHTML;
}

/**
 * Zamienia zapis grafiki (pełny <svg> lub sam markup) na wewnętrzny markup
 * + wymiary. Wynik jest bezpieczny do wstrzyknięcia przez innerHTML.
 */
export function parseGraphic(graphic, fallbackW = 80, fallbackH = 60) {
  const source = typeof graphic === 'string' ? graphic : (graphic?.data || '');
  let width = num(graphic?.width, fallbackW) || fallbackW;
  let height = num(graphic?.height, fallbackH) || fallbackH;
  let inner = '';
  const trimmed = String(source).trim();

  if (!trimmed) return { width, height, inner };

  if (/^<svg[\s>]/i.test(trimmed)) {
    const doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg || doc.querySelector('parsererror')) return { width, height, inner: '' };

    const wAttr = parseFloat(svg.getAttribute('width'));
    const hAttr = parseFloat(svg.getAttribute('height'));
    if (Number.isFinite(wAttr) && wAttr > 0) width = wAttr;
    if (Number.isFinite(hAttr) && hAttr > 0) height = hAttr;

    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
      if (!Number.isFinite(wAttr)) width = vb[2];
      if (!Number.isFinite(hAttr)) height = vb[3];
      if (vb[0] !== 0 || vb[1] !== 0) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const content = doc.createElementNS(SVG_NS, 'g');
        content.setAttribute('transform', `translate(${-vb[0]} ${-vb[1]})`);
        while (svg.firstChild) content.appendChild(svg.firstChild);
        svg.appendChild(content);
      }
    }
    sanitizeSvgNode(svg);
    inner = svg.innerHTML;
  } else {
    inner = sanitizeMarkup(trimmed);
  }

  return { width, height, inner };
}

/** Nadaje unikalny prefiks identyfikatorom wewnątrz markupu SVG. */
export function scopeSvgIds(markup, suffix) {
  if (!markup || !suffix) return markup;
  const safe = String(suffix).replace(/[^a-zA-Z0-9_-]/g, '_');
  return markup
    .replace(/id="([^"]+)"/g, (_, id) => `id="${id}--${safe}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${id}--${safe})`)
    .replace(/((?:xlink:)?href)="#([^"]+)"/g, (_, attr, id) => `${attr}="#${id}--${safe}"`);
}

export function downloadFile(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slugify(text) {
  const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z' };
  return String(text || '')
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => map[c] || c)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 40) || 'ELEMENT';
}

export function formatPercent(k) {
  return `${Math.round(k * 100)}%`;
}

export function isEditableTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
