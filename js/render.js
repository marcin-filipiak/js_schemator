/* Renderer SVG: płótno, miniatury biblioteki, eksport */
import {
  CATEGORY_MAP,
  PORT_TYPES,
  categoryOf,
  docBounds,
  instanceBounds,
  isLabelBlock,
  isStretchable,
  mediumColor,
  portWorld,
  resolveDefinition,
  routeDocConnections,
  wirePath
} from './model.js';
import { escapeHtml, parseGraphic, scopeSvgIds } from './utils.js';

const graphicCache = new WeakMap();

function getGraphic(def) {
  let cached = graphicCache.get(def);
  const source = def?.graphic?.data || '';
  if (cached && cached.source === source && cached.width === def.width && cached.height === def.height) {
    return cached;
  }
  const parsed = parseGraphic(def?.graphic, def?.width, def?.height);
  cached = { ...parsed, source };
  graphicCache.set(def, cached);
  return cached;
}

export function clearGraphicCache() {
  /* WeakMap nie da się wyczyścić — nowe obiekty definicji i tak dostaną nowy wpis */
}

function portColor(type) {
  return PORT_TYPES[type]?.color || PORT_TYPES.other.color;
}

function instanceLabel(inst) {
  return String(inst.label ?? '').trim();
}

/** Ramka + treść bloku funkcjonalnego (tekst wpisany w środek pola). */
function labelBlockMarkup(def) {
  const w = def.width;
  const h = def.height;
  const fontSize = def.labelFontSize || 14;
  const lineHeight = def.labelLineHeight || 19;
  const lines = def.labelLines || [''];
  const firstY = h / 2 - ((lines.length - 1) * lineHeight) / 2;
  const text = lines
    .map((line, i) => line
      ? `<text x="${w / 2}" y="${firstY + i * lineHeight}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" font-weight="600" fill="#1e40af">` +
        `${escapeHtml(line)}</text>`
      : '')
    .join('');
  return `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" fill="#eff6ff" stroke="#2563eb" ` +
    `stroke-width="2" stroke-linejoin="round"/>${text}`;
}

/** Grot strzałki na końcu trasy (połączenia sygnałowe). */
function arrowHeadMarkup(geo, color, size = 10) {
  const points = geo?.points || [];
  if (points.length < 2) return '';
  const end = points[points.length - 1];
  let index = points.length - 2;
  while (index >= 0 && Math.hypot(end.x - points[index].x, end.y - points[index].y) < 0.01) index--;
  if (index < 0) return '';
  const prev = points[index];
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
  const back = size * 0.88;
  const half = size * 0.46;
  const bx = end.x - Math.cos(angle) * back;
  const by = end.y - Math.sin(angle) * back;
  const nx = Math.cos(angle + Math.PI / 2) * half;
  const ny = Math.sin(angle + Math.PI / 2) * half;
  const n = (v) => Math.round(v * 100) / 100;
  return `<path d="M${n(end.x)} ${n(end.y)}L${n(bx + nx)} ${n(by + ny)}L${n(bx - nx)} ${n(by - ny)}Z" ` +
    `fill="${color}" stroke="none"/>`;
}

export function renderCanvas(svg, { doc, camera, selection, settings, transient = {} }) {
  const k = camera.k || 1;
  const selectedInstances = new Set(selection.instances || []);
  const selectedConnections = new Set(selection.connections || []);
  const parts = [];

  parts.push(`<g class="world" transform="translate(${camera.x} ${camera.y}) scale(${k})">`);

  /* --- połączenia --- */
  const routes = routeDocConnections(doc);
  const signalArrows = [];
  for (const conn of doc.connections) {
    const geo = routes.get(conn.id);
    if (!geo) continue;
    const color = mediumColor(conn.medium);
    const selected = selectedConnections.has(conn.id);
    const d = wirePath(geo, 7 / k);
    if (conn.medium === 'signal') signalArrows.push(arrowHeadMarkup(geo, color, 13 / k));
    parts.push(
      `<g class="wire${selected ? ' is-selected' : ''}" data-connection="${escapeHtml(conn.id)}">` +
        (selected
          ? `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.18" stroke-width="${9 / k}" stroke-linecap="round" stroke-linejoin="round"/>`
          : '') +
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${(selected ? 3 : 2.2) / k}" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path class="wire-hit" d="${geo.d}" fill="none" stroke="transparent" stroke-width="${14 / k}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</g>`
    );
    if (conn.label) {
      parts.push(
        `<text x="${geo.mid.x}" y="${geo.mid.y - 7 / k}" text-anchor="middle" font-size="${10 / k}" ` +
        `font-family="Inter, system-ui, sans-serif" fill="${color}" pointer-events="none">${escapeHtml(conn.label)}</text>`
      );
    }
  }

  /* --- instancje --- */
  for (const inst of doc.instances) {
    const rawDef = doc.definitions[inst.type];
    if (!rawDef) {
      parts.push(
        `<g class="instance" data-instance="${escapeHtml(inst.id)}" transform="translate(${inst.x} ${inst.y})">` +
          `<rect width="90" height="46" fill="#fff1f2" stroke="#dc2626" stroke-dasharray="4 3"/>` +
          `<text x="45" y="27" text-anchor="middle" font-size="9" fill="#dc2626">brak definicji</text>` +
        `</g>`
      );
      continue;
    }

    const boxLabel = isLabelBlock(rawDef);
    const def = resolveDefinition(inst, rawDef);
    const graphic = boxLabel ? null : getGraphic(def);
    const inner = boxLabel ? labelBlockMarkup(def) : scopeSvgIds(graphic.inner, `${inst.id}`);
    const selected = selectedInstances.has(inst.id);
    const label = instanceLabel(inst);
    const cx = def.width / 2;
    const cy = def.height / 2;
    const rot = inst.rot || 0;

    const portMarkup = settings.showPorts
      ? def.ports.map((port) => {
          const color = portColor(port.type);
          const isTarget = transient.connectTarget &&
            transient.connectTarget.instanceId === inst.id &&
            transient.connectTarget.portId === port.id;
          return (
            `<g class="port" data-instance="${escapeHtml(inst.id)}" data-port="${escapeHtml(port.id)}" data-port-type="${escapeHtml(port.type)}">` +
              `<title>${escapeHtml(`${port.id} · ${PORT_TYPES[port.type]?.label || port.type} · ${port.dir}`)}</title>` +
              `<circle class="port-hit" cx="${port.x}" cy="${port.y}" r="${9 / k}" fill="transparent"/>` +
              (isTarget
                ? `<circle cx="${port.x}" cy="${port.y}" r="${8 / k}" fill="none" stroke="${color}" stroke-width="${2 / k}" stroke-opacity="0.5"/>`
                : '') +
              `<circle cx="${port.x}" cy="${port.y}" r="${4 / k}" fill="#ffffff" stroke="${color}" stroke-width="${1.6 / k}"/>` +
              (port.dir === 'in'
                ? `<circle cx="${port.x}" cy="${port.y}" r="${1.5 / k}" fill="${color}"/>`
                : port.dir === 'out'
                  ? `<circle cx="${port.x}" cy="${port.y}" r="${1.5 / k}" fill="none" stroke="${color}" stroke-width="${1.2 / k}"/>`
                  : `<path d="M${port.x - 2 / k} ${port.y}H${port.x + 2 / k}M${port.x} ${port.y - 2 / k}V${port.y + 2 / k}" stroke="${color}" stroke-width="${1.2 / k}"/>`) +
            `</g>`
          );
        }).join('')
      : '';

    /* Uchwyt zmiany wysokości dla symboli rozciąganych (np. rdzeń transformatora). */
    const resizeHandle = selected && isStretchable(rawDef)
      ? `<g class="resize-handle" data-resize="${escapeHtml(inst.id)}" style="cursor:ns-resize">` +
          `<rect x="${def.width / 2 - 6 / k}" y="${def.height - 6 / k}" width="${12 / k}" height="${12 / k}" ` +
          `rx="${2 / k}" fill="#ffffff" stroke="#2563eb" stroke-width="${1.5 / k}" pointer-events="all"/>` +
        `</g>`
      : '';

    parts.push(
      `<g class="instance${selected ? ' is-selected' : ''}" data-instance="${escapeHtml(inst.id)}" transform="translate(${inst.x} ${inst.y})">` +
        `<g transform="rotate(${rot} ${cx} ${cy})">` +
          `<rect class="instance-hit" x="0" y="0" width="${def.width}" height="${def.height}" fill="transparent" stroke="none" pointer-events="all"/>` +
          `<g class="instance-graphic">${inner}</g>` +
          (selected
            ? `<rect x="-3" y="-3" width="${def.width + 6}" height="${def.height + 6}" rx="3" fill="none" stroke="#2563eb" stroke-width="${1.5 / k}" stroke-dasharray="${6 / k} ${4 / k}" pointer-events="none"/>`
            : '') +
          portMarkup +
          resizeHandle +
        `</g>` +
        (label && !boxLabel
          ? `<text class="instance-label" x="${cx}" y="${def.height + 15 / k}" text-anchor="middle" font-size="${11 / k}" ` +
            `font-family="Inter, system-ui, sans-serif" fill="#334155" pointer-events="none">${escapeHtml(label)}</text>`
          : '') +
      `</g>`
    );
  }

  /* Groty sygnałowe rysowane nad portami, żeby były dobrze widoczne. */
  if (signalArrows.length) parts.push(...signalArrows);

  /* --- podgląd połączenia i ramka zaznaczania --- */
  const preview = transient.wirePreview;
  if (preview) {
    const a = portWorld(doc, preview.from.instanceId, preview.from.portId);
    if (a) {
      const target = preview.to || { x: a.x, y: a.y };
      const a1 = { x: a.x + a.normal.x * 16, y: a.y + a.normal.y * 16 };
      const points = [a, a1, target];
      const d = `M${a.x} ${a.y}L${a1.x} ${a1.y}L${target.x} ${target.y}`;
      const previewMedium = preview.medium || a.port.type;
      const previewColor = portColor(previewMedium);
      parts.push(
        `<path d="${d}" fill="none" stroke="${previewColor}" stroke-width="${2 / k}" ` +
        `stroke-dasharray="${6 / k} ${5 / k}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>` +
        (previewMedium === 'signal' ? arrowHeadMarkup({ points }, previewColor, 12 / k) : '')
      );
    }
  }

  const marquee = transient.marquee;
  if (marquee) {
    parts.push(
      `<rect x="${marquee.x}" y="${marquee.y}" width="${marquee.w}" height="${marquee.h}" fill="rgba(37,99,235,0.08)" ` +
      `stroke="#2563eb" stroke-width="${1.2 / k}" stroke-dasharray="${5 / k} ${4 / k}" pointer-events="none"/>`
    );
  }

  parts.push('</g>');
  svg.innerHTML = parts.join('');
}

export function updateGrid(el, camera, settings) {
  if (!settings.grid) {
    el.style.backgroundImage = 'none';
    return;
  }
  const k = camera.k || 1;
  let minorUnits = 10;
  while (minorUnits * k < 8) minorUnits *= 2;
  while (minorUnits * k > 40) minorUnits /= 2;
  const minor = minorUnits * k;
  const major = minorUnits * 5 * k;
  const minorColor = 'rgba(15,23,42,0.055)';
  const majorColor = 'rgba(15,23,42,0.10)';
  const images = [];
  const sizes = [];
  const positions = [];

  if (minor >= 9) {
    images.push(`linear-gradient(to right, ${minorColor} 1px, transparent 1px)`);
    images.push(`linear-gradient(to bottom, ${minorColor} 1px, transparent 1px)`);
    sizes.push(`${minor}px ${minor}px`, `${minor}px ${minor}px`);
    positions.push(`${camera.x}px ${camera.y}px`, `${camera.x}px ${camera.y}px`);
  }
  images.push(`linear-gradient(to right, ${majorColor} 1px, transparent 1px)`);
  images.push(`linear-gradient(to bottom, ${majorColor} 1px, transparent 1px)`);
  sizes.push(`${major}px ${major}px`, `${major}px ${major}px`);
  positions.push(`${camera.x}px ${camera.y}px`, `${camera.x}px ${camera.y}px`);
  el.style.backgroundImage = images.join(', ');
  el.style.backgroundSize = sizes.join(', ');
  el.style.backgroundPosition = positions.join(', ');
}

export function definitionThumbnail(def, key = 'thumb', boxW = 96, boxH = 58) {
  const pad = 5;
  const boxLabel = isLabelBlock(def);
  const effective = boxLabel ? resolveDefinition({ label: def.name }, def) : def;
  const inner = boxLabel
    ? labelBlockMarkup(effective)
    : scopeSvgIds(getGraphic(def).inner, key);
  const scale = Math.min((boxW - pad * 2) / effective.width, (boxH - pad * 2) / effective.height);
  const tx = (boxW - effective.width * scale) / 2;
  const ty = (boxH - effective.height * scale) / 2;
  return (
    `<svg viewBox="0 0 ${boxW} ${boxH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">` +
    inner +
    `</g></svg>`
  );
}

/** Zwraca pełny, samodzielny plik SVG ze schematem. */
export function buildExportSvg(doc) {
  const bounds = docBounds(doc);
  const routes = routeDocConnections(doc);
  const pad = 34;
  const x = bounds.x - pad;
  const y = bounds.y - pad;
  const w = bounds.w + pad * 2;
  const h = bounds.h + pad * 2;
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}">`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`
  );

  for (const conn of doc.connections) {
    const geo = routes.get(conn.id);
    if (!geo) continue;
    const color = mediumColor(conn.medium);
    parts.push(
      `<path d="${wirePath(geo, 7)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
      (conn.medium === 'signal' ? arrowHeadMarkup(geo, color, 10) : '')
    );
    if (conn.label) {
      parts.push(
        `<text x="${geo.mid.x}" y="${geo.mid.y - 7}" text-anchor="middle" font-size="10" font-family="Inter, Arial, sans-serif" fill="${color}">${escapeHtml(conn.label)}</text>`
      );
    }
  }

  for (const inst of doc.instances) {
    const rawDef = doc.definitions[inst.type];
    if (!rawDef) continue;
    const boxLabel = isLabelBlock(rawDef);
    const def = resolveDefinition(inst, rawDef);
    const inner = boxLabel
      ? labelBlockMarkup(def)
      : scopeSvgIds(getGraphic(def).inner, inst.id);
    const cx = def.width / 2;
    const cy = def.height / 2;
    const label = instanceLabel(inst);
    parts.push(
      `<g transform="translate(${inst.x} ${inst.y})">` +
        `<g transform="rotate(${inst.rot || 0} ${cx} ${cy})">${inner}</g>` +
        (label && !boxLabel
          ? `<text x="${cx}" y="${def.height + 15}" text-anchor="middle" font-size="11" font-family="Inter, Arial, sans-serif" fill="#334155">${escapeHtml(label)}</text>`
          : '') +
      `</g>`
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export function definitionMetaLine(def) {
  const cat = categoryOf(def);
  const bits = [cat.label];
  if (def.manufacturer) bits.push(def.manufacturer);
  return bits.join(' · ');
}

export function instanceTypeBadge(def) {
  if (!def) return 'Nieznany';
  const cat = CATEGORY_MAP[def.category] || CATEGORY_MAP.other;
  return def.name;
}
