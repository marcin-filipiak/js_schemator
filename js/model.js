/* Model dokumentu: definicje, instancje, połączenia, geometria */
import { parseGraphic, num, uid, clamp } from './utils.js';

export const CATEGORIES = [
  { id: 'pneumatic', label: 'Pneumatyka', short: 'PNEU', color: '#2563eb', prefix: 'P' },
  { id: 'electronic', label: 'Elektronika', short: 'ELN', color: '#db2777', prefix: 'E' },
  { id: 'electrical', label: 'Elektryka', short: 'ELE', color: '#dc2626', prefix: 'K' },
  { id: 'hydraulic', label: 'Hydraulika', short: 'HYD', color: '#059669', prefix: 'H' },
  { id: 'block', label: 'Schemat blokowy', short: 'BLK', color: '#7c3aed', prefix: 'B' },
  { id: 'other', label: 'Inne', short: 'INN', color: '#64748b', prefix: 'X' }
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const PORT_TYPES = {
  pneumatic: { label: 'Pneumatyczne', short: 'PNEU', color: '#2563eb' },
  electric: { label: 'Elektryczne', short: 'ELE', color: '#dc2626' },
  hydraulic: { label: 'Hydrauliczne', short: 'HYD', color: '#059669' },
  signal: { label: 'Sygnałowe', short: 'SIG', color: '#7c3aed' },
  mechanical: { label: 'Mechaniczne', short: 'MEC', color: '#64748b' },
  other: { label: 'Inne', short: 'INN', color: '#64748b' }
};

export const DIRECTIONS = {
  in: 'Wejście',
  out: 'Wyjście',
  bi: 'Dwukierunkowy'
};

export const GRID = 10;
export const WIRE_STUB = 16;

/* Blok funkcjonalny: etykieta jest treścią, a rozmiar i porty wynikają z tekstu. */
export const LABEL_BLOCK_LAYOUT = 'label-box';
export const LABEL_BLOCK_FONT = 14;
export const LABEL_BLOCK_LINE = 19;
const LABEL_BLOCK_MIN_W = 140;
const LABEL_BLOCK_MIN_H = 80;
const LABEL_BLOCK_MAX_TEXT_W = 220;
const LABEL_BLOCK_PAD_X = 22;
const LABEL_BLOCK_PAD_Y = 18;
const LABEL_BLOCK_PORTS_PER_SIDE = 4;

const DIRECTIONS_ALLOWED = new Set(Object.keys(DIRECTIONS));

export function mediumColor(medium) {
  return PORT_TYPES[medium]?.color || PORT_TYPES.other.color;
}

export function mediumLabel(medium) {
  return PORT_TYPES[medium]?.label || PORT_TYPES.other.label;
}

export function categoryOf(def) {
  return CATEGORY_MAP[def?.category] || CATEGORY_MAP.other;
}

export function emptyDoc(title = 'Nowy schemat') {
  return {
    meta: { title, version: 1, created: new Date().toISOString(), modified: new Date().toISOString() },
    definitions: {},
    instances: [],
    connections: []
  };
}

/** Klucze definicji faktycznie potrzebnych przez instancje na schemacie. */
export function usedDefinitionKeys(doc) {
  const keys = new Set();
  for (const inst of doc?.instances || []) {
    if (inst?.type) keys.add(inst.type);
  }
  return keys;
}

/** Usuwa z dokumentu definicje, do których nie odwołuje się żadna instancja. */
export function pruneUnusedDefinitions(doc) {
  if (!doc?.definitions) return doc;
  const used = usedDefinitionKeys(doc);
  for (const key of Object.keys(doc.definitions)) {
    if (!used.has(key)) delete doc.definitions[key];
  }
  return doc;
}

/**
 * Kopia dokumentu do zapisu (plik JSON / autozapis).
 * Zawiera wyłącznie definicje używane przez instancje — bez całej biblioteki.
 */
export function docForSerialization(doc) {
  const used = usedDefinitionKeys(doc);
  const definitions = {};
  for (const key of used) {
    const def = doc.definitions?.[key];
    if (def) definitions[key] = def;
  }
  return { ...doc, definitions };
}

export function normalizeDefinition(key, raw) {
  const graphicRaw = raw?.graphic || {};
  const parsed = parseGraphic(
    { ...graphicRaw, width: graphicRaw.width, height: graphicRaw.height },
    num(graphicRaw.width, 80),
    num(graphicRaw.height, 60)
  );
  const width = Math.max(4, num(graphicRaw.width, parsed.width) || parsed.width || 80);
  const height = Math.max(4, num(graphicRaw.height, parsed.height) || parsed.height || 60);
  const rawPorts = Array.isArray(raw?.ports) ? raw.ports : [];
  const usedIds = new Set();
  const ports = rawPorts.map((p, i) => {
    let id = String(p?.id ?? `p${i + 1}`).trim() || `p${i + 1}`;
    id = id.replace(/\s+/g, '_');
    let candidate = id;
    let n = 2;
    while (usedIds.has(candidate)) candidate = `${id}_${n++}`;
    usedIds.add(candidate);
    return {
      id: candidate,
      type: PORT_TYPES[p?.type] ? p.type : 'other',
      dir: DIRECTIONS_ALLOWED.has(p?.dir) ? p.dir : 'bi',
      x: clamp(num(p?.x), 0, width),
      y: clamp(num(p?.y), 0, height)
    };
  });

  const graphic = {
    format: 'svg',
    data: typeof graphicRaw.data === 'string' ? graphicRaw.data : '',
    width,
    height
  };
  if (graphicRaw.model && Array.isArray(graphicRaw.model.shapes)) {
    graphic.model = graphicRaw.model;
  }

  let stretch = null;
  if (raw?.stretch && raw.stretch.axis === 'y') {
    const min = clamp(num(raw.stretch.min, 40), 20, 2000);
    const max = clamp(num(raw.stretch.max, 600), min, 2000);
    stretch = { axis: 'y', min, max };
  }

  return {
    name: String(raw?.name || key || 'Element'),
    category: CATEGORY_MAP[raw?.category] ? raw.category : 'other',
    manufacturer: String(raw?.manufacturer || ''),
    partNumber: String(raw?.partNumber || ''),
    layout: raw?.layout === LABEL_BLOCK_LAYOUT ? LABEL_BLOCK_LAYOUT : '',
    ...(stretch ? { stretch } : {}),
    width,
    height,
    graphic,
    ports
  };
}

export function normalizeRotation(value) {
  const n = Math.round(num(value) / 90) * 90;
  return ((n % 360) + 360) % 360;
}

/* ------------------------------------------------------------------ */
/* Blok funkcjonalny: tekst jako zawartość, automatyczny rozmiar        */
/* ------------------------------------------------------------------ */

export function isLabelBlock(def) {
  return def?.layout === LABEL_BLOCK_LAYOUT;
}

/** Przybliżona szerokość znaku — wystarczająco dokładna dla układu bloku. */
function labelCharWidth(ch, fontSize) {
  if (ch === ' ') return 0.3;
  if (/[iljI.,;:'’!|]/.test(ch)) return 0.3;
  if (/[MWmw@%ĄĆĘŁŃÓŚŹŻ]/.test(ch)) return 0.82;
  return 0.57;
}

function labelTextWidth(text, fontSize) {
  let width = 0;
  for (const ch of String(text)) width += labelCharWidth(ch, fontSize) * fontSize;
  return width;
}

/** Łamie tekst na linie; obsługuje też ręczne znaki nowej linii. */
function wrapLabelText(text, maxWidth, fontSize) {
  const paragraphs = String(text ?? '').replace(/\r/g, '').split('\n');
  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    const pushLongWord = (word) => {
      let chunk = '';
      for (const ch of word) {
        if (chunk && labelTextWidth(chunk + ch, fontSize) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    };

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || labelTextWidth(candidate, fontSize) <= maxWidth) {
        line = candidate;
        if (labelTextWidth(line, fontSize) > maxWidth) pushLongWord(line);
      } else {
        lines.push(line);
        line = '';
        pushLongWord(word);
      }
    }
    if (line) lines.push(line);
  }

  return lines.length ? lines : [''];
}

const layoutCache = new Map();
const LAYOUT_CACHE_LIMIT = 300;

/** Układ bloku z treścią: rozmiar, zawinięte linie i cztery porty na bok. */
export function labelBlockLayout(label) {
  const key = String(label ?? '');
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const fontSize = LABEL_BLOCK_FONT;
  const lines = wrapLabelText(key, LABEL_BLOCK_MAX_TEXT_W, fontSize);
  const textWidth = Math.max(0, ...lines.map((line) => labelTextWidth(line, fontSize)));
  const width = Math.max(LABEL_BLOCK_MIN_W,
    Math.ceil((textWidth + LABEL_BLOCK_PAD_X * 2) / 10) * 10);
  const height = Math.max(LABEL_BLOCK_MIN_H,
    Math.ceil((lines.length * LABEL_BLOCK_LINE + LABEL_BLOCK_PAD_Y * 2) / 10) * 10);

  const ports = [];
  for (let i = 0; i < LABEL_BLOCK_PORTS_PER_SIDE; i++) {
    const t = (i + 0.5) / LABEL_BLOCK_PORTS_PER_SIDE;
    const n = i + 1;
    ports.push(
      { id: `l${n}`, type: 'signal', dir: 'bi', x: 0, y: Math.round(height * t) },
      { id: `r${n}`, type: 'signal', dir: 'bi', x: width, y: Math.round(height * t) },
      { id: `t${n}`, type: 'signal', dir: 'bi', x: Math.round(width * t), y: 0 },
      { id: `b${n}`, type: 'signal', dir: 'bi', x: Math.round(width * t), y: height }
    );
  }

  const layout = {
    width,
    height,
    lines,
    fontSize,
    lineHeight: LABEL_BLOCK_LINE,
    ports
  };
  if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}

/**
 * Definicja dopasowana do konkretnej instancji.
 * Dla zwykłych symboli zwraca oryginał; dla bloku funkcjonalnego — rozmiar
 * i porty wynikające z aktualnej etykiety (treści bloku), a dla symboli
 * rozciąganych w pionie — wysokość zapisaną w instancji.
 */
export function resolveDefinition(instance, def) {
  if (isLabelBlock(def)) {
    const layout = labelBlockLayout(instance?.label ?? '');
    return {
      ...def,
      width: layout.width,
      height: layout.height,
      ports: layout.ports,
      labelLines: layout.lines,
      labelFontSize: layout.fontSize,
      labelLineHeight: layout.lineHeight
    };
  }
  if (isStretchable(def)) return stretchedDefinition(def, instanceHeight(instance, def));
  return def;
}

export function isStretchable(def) {
  return def?.stretch?.axis === 'y';
}

/** Wysokość instancji symbolu rozciąganego, ograniczona do zakresu definicji. */
export function instanceHeight(instance, def) {
  if (!isStretchable(def)) return num(def?.height, 0);
  const min = num(def.stretch.min, 20);
  const max = Math.max(min, num(def.stretch.max, 600));
  return clamp(num(instance?.h, def.height), min, max);
}

const stretchCache = new WeakMap();

function stretchGraphic(def, height) {
  const baseHeight = num(def.height, height) || height || 1;
  const scale = height / baseHeight;
  const data = def.graphic?.data || '';
  const open = data.indexOf('>');
  const close = data.lastIndexOf('</svg>');
  if (open < 0 || close <= open) return data;
  const inner = data.slice(open + 1, close);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${def.width}" height="${height}" ` +
    `viewBox="0 0 ${def.width} ${height}">` +
    `<g transform="scale(1 ${scale.toFixed(4)})">${inner}</g></svg>`;
}

/** Wariant definicji o innej wysokości (cache per definicja i wysokość). */
function stretchedDefinition(def, height) {
  if (height === def.height) return def;
  let byHeight = stretchCache.get(def);
  if (!byHeight) {
    byHeight = new Map();
    stretchCache.set(def, byHeight);
  }
  const cached = byHeight.get(height);
  if (cached) return cached;
  const variant = {
    ...def,
    height,
    graphic: { ...def.graphic, width: def.width, height, data: stretchGraphic(def, height) }
  };
  byHeight.set(height, variant);
  return variant;
}

export function parseEndpoint(value) {
  const str = String(value ?? '');
  const dot = str.lastIndexOf('.');
  if (dot <= 0) return null;
  return { instanceId: str.slice(0, dot), portId: str.slice(dot + 1) };
}

export function endpointString(instanceId, portId) {
  return `${instanceId}.${portId}`;
}

export function instancePrefix(doc, type) {
  const def = doc.definitions[type];
  return categoryOf(def).prefix || 'X';
}

export function nextInstanceId(doc, type) {
  const prefix = instancePrefix(doc, type);
  let n = 1;
  const ids = new Set(doc.instances.map((i) => i.id));
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function uniqueInstanceId(doc, type) {
  return nextInstanceId(doc, type);
}

/**
 * Normalizuje dokument z JSON. Zwraca { doc, warnings }.
 * Niepoprawne referencje są pomijane, ale reszta dokumentu zostaje wczytana.
 */
export function normalizeDoc(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Plik nie zawiera poprawnego obiektu JSON.');
  }
  const doc = emptyDoc();
  if (raw.meta && typeof raw.meta === 'object') {
    doc.meta = {
      title: String(raw.meta.title || doc.meta.title),
      version: num(raw.meta.version, 1),
      created: raw.meta.created || doc.meta.created,
      modified: raw.meta.modified || doc.meta.modified
    };
  }

  const defs = raw.definitions && typeof raw.definitions === 'object' ? raw.definitions : {};
  if (!raw.definitions || typeof raw.definitions !== 'object') {
    warnings.push('Brak sekcji "definitions" — dokument może być niekompletny.');
  }
  for (const [key, def] of Object.entries(defs)) {
    if (!def || typeof def !== 'object') continue;
    if (!def.graphic || !def.graphic.data) {
      warnings.push(`Definicja "${key}" nie ma grafiki — pominięto.`);
      continue;
    }
    doc.definitions[key] = normalizeDefinition(key, def);
  }

  const rawInstances = Array.isArray(raw.instances) ? raw.instances : [];
  const ids = new Set();
  for (const inst of rawInstances) {
    if (!inst || typeof inst !== 'object' || !inst.type) continue;
    if (!doc.definitions[inst.type]) {
      warnings.push(`Instancja "${inst.id || '?'}" używa nieistniejącej definicji "${inst.type}" — pominięto.`);
      continue;
    }
    let id = String(inst.id ?? '').trim();
    if (!id || ids.has(id)) {
      const created = nextInstanceId(doc, inst.type);
      warnings.push(`Poprawiono brakujący/duplikowany identyfikator instancji na "${created}".`);
      id = created;
    }
    ids.add(id);
    const typeDef = doc.definitions[inst.type];
    doc.instances.push({
      id,
      type: inst.type,
      x: num(inst.x),
      y: num(inst.y),
      rot: normalizeRotation(inst.rot),
      ...(isStretchable(typeDef) ? { h: instanceHeight(inst, typeDef) } : {}),
      label: inst.label != null ? String(inst.label) : ''
    });
  }

  const rawConnections = Array.isArray(raw.connections) ? raw.connections : [];
  const connIds = new Set();
  const instanceMap = new Map(doc.instances.map((i) => [i.id, i]));
  for (const conn of rawConnections) {
    if (!conn || typeof conn !== 'object' || !conn.from || !conn.to) continue;
    const from = parseEndpoint(conn.from);
    const to = parseEndpoint(conn.to);
    if (!from || !to) {
      warnings.push(`Połączenie "${conn.from}" → "${conn.to}" ma niepoprawny format — pominięto.`);
      continue;
    }
    const fromInst = instanceMap.get(from.instanceId);
    const toInst = instanceMap.get(to.instanceId);
    const fromDef = fromInst && doc.definitions[fromInst.type];
    const toDef = toInst && doc.definitions[toInst.type];
    const fromPort = fromDef && resolveDefinition(fromInst, fromDef).ports.find((p) => p.id === from.portId);
    const toPort = toDef && resolveDefinition(toInst, toDef).ports.find((p) => p.id === to.portId);
    if (!fromPort || !toPort) {
      warnings.push(`Połączenie "${conn.from}" → "${conn.to}" wskazuje nieistniejący port — pominięto.`);
      continue;
    }
    let id = String(conn.id || '').trim();
    if (!id || connIds.has(id)) id = uid('c');
    connIds.add(id);
    const medium = PORT_TYPES[conn.medium] ? conn.medium : fromPort.type;
    doc.connections.push({
      id,
      from: conn.from,
      to: conn.to,
      medium,
      label: conn.label != null ? String(conn.label) : ''
    });
  }

  return { doc, warnings };
}

/** Zwraca instancję, definicję i port dla zapisu "V1.out_2". */
export function resolveEndpoint(doc, endpoint) {
  const parsed = typeof endpoint === 'string' ? parseEndpoint(endpoint) : endpoint;
  if (!parsed) return null;
  const instance = doc.instances.find((i) => i.id === parsed.instanceId);
  if (!instance) return null;
  const def = doc.definitions[instance.type];
  if (!def) return null;
  const resolved = resolveDefinition(instance, def);
  const port = resolved.ports.find((p) => p.id === parsed.portId);
  if (!port) return null;
  return { instance, def: resolved, port, instanceId: instance.id, portId: port.id };
}

/** Punkt w układzie świata dla punktu w układzie lokalnym definicji. */
export function transformPoint(instance, def, x, y) {
  const w = def.width;
  const h = def.height;
  const cx = w / 2;
  const cy = h / 2;
  const a = (normalizeRotation(instance.rot) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: instance.x + cx + dx * cos - dy * sin,
    y: instance.y + cy + dx * sin + dy * cos
  };
}

const SIDE_NORMALS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 }
};

export function portSide(def, port) {
  const candidates = [
    { side: 'left', d: port.x },
    { side: 'right', d: def.width - port.x },
    { side: 'top', d: port.y },
    { side: 'bottom', d: def.height - port.y }
  ];
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0].side;
}

export function portNormal(instance, def, port) {
  const side = portSide(def, port);
  const n = SIDE_NORMALS[side];
  const a = (normalizeRotation(instance.rot) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: n.x * cos - n.y * sin, y: n.x * sin + n.y * cos };
}

/** Pełna geometria portu w układzie świata. */
export function portWorld(doc, instanceId, portId) {
  const instance = doc.instances.find((i) => i.id === instanceId);
  if (!instance) return null;
  const def = doc.definitions[instance.type];
  if (!def) return null;
  const resolved = resolveDefinition(instance, def);
  const port = resolved.ports.find((p) => p.id === portId);
  if (!port) return null;
  const point = transformPoint(instance, resolved, port.x, port.y);
  const normal = portNormal(instance, resolved, port);
  return { ...point, normal, instance, def: resolved, port };
}

function midPointOf(points) {
  if (!points.length) return null;
  let total = 0;
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0.01) {
      segs.push({ a, b, len });
      total += len;
    }
  }
  if (!segs.length) return { x: points[0].x, y: points[0].y };
  let rest = total / 2;
  for (const seg of segs) {
    if (rest <= seg.len) {
      const t = rest / seg.len;
      return { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
    }
    rest -= seg.len;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

const r = (v) => Math.round(v * 100) / 100;

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  }
  return out;
}

/** Usuwa punkty leżące na środku prostego odcinka (mniej zbędnych kolan). */
function simplifyPoints(points) {
  const out = dedupePoints(points);
  for (let i = 1; i < out.length - 1;) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < ROUTE_EPS && dot > -ROUTE_EPS) out.splice(i, 1);
    else i++;
  }
  return out;
}

/** Trasa ortogonalna: port → odcinek → kolano → odcinek → port. */
export function buildRoute(a, a1, b1, b) {
  const fromHorizontal = Math.abs(a.normal.x) > 0.5;
  const toHorizontal = Math.abs(b.normal.x) > 0.5;
  const points = [a, a1];

  if (fromHorizontal && toHorizontal) {
    if (Math.abs(a1.y - b1.y) > 0.5) {
      const mx = (a1.x + b1.x) / 2;
      points.push({ x: mx, y: a1.y }, { x: mx, y: b1.y });
    }
  } else if (!fromHorizontal && !toHorizontal) {
    if (Math.abs(a1.x - b1.x) > 0.5) {
      const my = (a1.y + b1.y) / 2;
      points.push({ x: a1.x, y: my }, { x: b1.x, y: my });
    }
  } else if (fromHorizontal) {
    points.push({ x: b1.x, y: a1.y });
  } else {
    points.push({ x: a1.x, y: b1.y });
  }

  points.push(b1, b);
  return dedupePoints(points);
}

/* ------------------------------------------------------------------ */
/* Routing przewodów: omijanie elementów, unikanie krzyżowań, pętelki   */
/* ------------------------------------------------------------------ */

const ROUTE_MARGIN = 8;          // odstęp trasy od obrysu elementu
const ROUTE_PADDING = 80;        // zapas obszaru routingu poza skrajnymi punktami
const ROUTE_BEND_PENALTY = 18;   // preferuj prostsze trasy
const ROUTE_CROSS_PENALTY = 160; // kara za przecięcie innego przewodu
const ROUTE_OVERLAP_PENALTY = 2400; // kara za pokrycie się z innym przewodem
const ROUTE_EPS = 0.01;

const DIR_VECTORS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];
const OPPOSITE_DIR = [1, 0, 3, 2];

function directionOf(x, y) {
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? 0 : 1;
  return y >= 0 ? 2 : 3;
}

function obstacleRects(doc) {
  const out = [];
  for (const inst of doc.instances) {
    const def = doc.definitions[inst.type];
    if (!def) continue;
    const b = instanceBounds(inst, def);
    out.push({
      instanceId: inst.id,
      left: b.x - ROUTE_MARGIN,
      top: b.y - ROUTE_MARGIN,
      right: b.x + b.w + ROUTE_MARGIN,
      bottom: b.y + b.h + ROUTE_MARGIN
    });
  }
  return out;
}

function edgeBlocked(x1, y1, x2, y2, obstacles) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const horizontal = Math.abs(y2 - y1) < ROUTE_EPS;

  for (const o of obstacles) {
    if (horizontal) {
      if (y1 > o.top + ROUTE_EPS && y1 < o.bottom - ROUTE_EPS && maxX > o.left + ROUTE_EPS && minX < o.right - ROUTE_EPS) {
        return true;
      }
    } else if (x1 > o.left + ROUTE_EPS && x1 < o.right - ROUTE_EPS && maxY > o.top + ROUTE_EPS && minY < o.bottom - ROUTE_EPS) {
      return true;
    }
  }
  return false;
}

function edgePenalty(x1, y1, x2, y2, wires) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const horizontal = Math.abs(y2 - y1) < ROUTE_EPS;
  let penalty = 0;

  for (const s of wires) {
    const wireHorizontal = Math.abs(s.y1 - s.y2) < ROUTE_EPS;
    if (horizontal && wireHorizontal) {
      if (Math.abs(y1 - s.y1) < ROUTE_EPS) {
        const overlap = Math.min(maxX, Math.max(s.x1, s.x2)) - Math.max(minX, Math.min(s.x1, s.x2));
        if (overlap > ROUTE_EPS) penalty += ROUTE_OVERLAP_PENALTY;
      }
    } else if (!horizontal && !wireHorizontal) {
      if (Math.abs(x1 - s.x1) < ROUTE_EPS) {
        const overlap = Math.min(maxY, Math.max(s.y1, s.y2)) - Math.max(minY, Math.min(s.y1, s.y2));
        if (overlap > ROUTE_EPS) penalty += ROUTE_OVERLAP_PENALTY;
      }
    } else if (horizontal) {
      const x = s.x1;
      const y = y1;
      if (x > minX + ROUTE_EPS && x < maxX - ROUTE_EPS &&
          y > Math.min(s.y1, s.y2) + ROUTE_EPS && y < Math.max(s.y1, s.y2) - ROUTE_EPS) {
        penalty += ROUTE_CROSS_PENALTY;
      }
    } else {
      const x = x1;
      const y = s.y1;
      if (y > minY + ROUTE_EPS && y < maxY - ROUTE_EPS &&
          x > Math.min(s.x1, s.x2) + ROUTE_EPS && x < Math.max(s.x1, s.x2) - ROUTE_EPS) {
        penalty += ROUTE_CROSS_PENALTY;
      }
    }
  }
  return penalty;
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(cost, state) {
    const a = this.items;
    a.push({ cost, state });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let min = i;
        if (l < a.length && a[l].cost < a[min].cost) min = l;
        if (r < a.length && a[r].cost < a[min].cost) min = r;
        if (min === i) break;
        [a[i], a[min]] = [a[min], a[i]];
        i = min;
      }
    }
    return top;
  }
}

function uniqueSorted(values) {
  const sorted = values.map((v) => r(v)).sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    if (!out.length || Math.abs(v - out[out.length - 1]) > 0.001) out.push(v);
  }
  return out;
}

function pointIndex(map, value) {
  return map.get(r(value));
}

/** Ortogonalna trasa między punktami z pominięciem przeszkód i karą za krzyżowanie. */
function gridRoute(start, end, startDir, blockedGoalDir, obstacles, wires) {
  if (Math.abs(start.x - end.x) < ROUTE_EPS && Math.abs(start.y - end.y) < ROUTE_EPS) {
    return [{ x: start.x, y: start.y }];
  }

  const xs = [start.x, end.x];
  const ys = [start.y, end.y];
  for (const o of obstacles) {
    xs.push(o.left, o.right);
    ys.push(o.top, o.bottom);
  }
  for (const s of wires) {
    xs.push(s.x1, s.x2);
    ys.push(s.y1, s.y2);
    if (Math.abs(s.y1 - s.y2) < ROUTE_EPS) {
      ys.push(s.y1 - ROUTE_MARGIN, s.y1 + ROUTE_MARGIN);
    } else {
      xs.push(s.x1 - ROUTE_MARGIN, s.x1 + ROUTE_MARGIN);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of xs) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  for (const y of ys) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  xs.push(minX - ROUTE_PADDING, maxX + ROUTE_PADDING);
  ys.push(minY - ROUTE_PADDING, maxY + ROUTE_PADDING);

  const xList = uniqueSorted(xs);
  const yList = uniqueSorted(ys);
  const nx = xList.length;
  const ny = yList.length;
  if (nx * ny > 60000) return null;

  const xMap = new Map(xList.map((v, i) => [v, i]));
  const yMap = new Map(yList.map((v, i) => [v, i]));
  const sxi = pointIndex(xMap, start.x);
  const syi = pointIndex(yMap, start.y);
  const exi = pointIndex(xMap, end.x);
  const eyi = pointIndex(yMap, end.y);
  if (sxi == null || syi == null || exi == null || eyi == null) return null;

  const startNode = syi * nx + sxi;
  const goalNode = eyi * nx + exi;
  const stateCount = nx * ny * 4;
  const dist = new Float64Array(stateCount);
  dist.fill(Infinity);
  const prev = new Int32Array(stateCount);
  prev.fill(-1);
  const heap = new MinHeap();
  const edgeCache = new Map();

  const startState = startNode * 4 + startDir;
  dist[startState] = 0;
  heap.push(0, startState);
  let goalState = -1;

  while (heap.size) {
    const current = heap.pop();
    if (!current || current.cost > dist[current.state] + 0.0001) continue;
    const state = current.state;
    const node = Math.floor(state / 4);
    const dir = state % 4;
    const xi = node % nx;
    const yi = Math.floor(node / nx);

    if (node === goalNode && dir !== blockedGoalDir) {
      goalState = state;
      break;
    }

    const neighbors = [];
    if (xi > 0) neighbors.push({ xi: xi - 1, yi, dir: 1 });
    if (xi < nx - 1) neighbors.push({ xi: xi + 1, yi, dir: 0 });
    if (yi > 0) neighbors.push({ xi, yi: yi - 1, dir: 3 });
    if (yi < ny - 1) neighbors.push({ xi, yi: yi + 1, dir: 2 });

    for (const n of neighbors) {
      if (node === startNode && n.dir === OPPOSITE_DIR[startDir]) continue;
      const nNode = n.yi * nx + n.xi;
      const x1 = xList[xi];
      const y1 = yList[yi];
      const x2 = xList[n.xi];
      const y2 = yList[n.yi];
      const edgeKey = node < nNode ? node * 100000 + nNode : nNode * 100000 + node;
      let edgeInfo = edgeCache.get(edgeKey);
      if (!edgeInfo) {
        const blocked = edgeBlocked(x1, y1, x2, y2, obstacles);
        edgeInfo = { blocked, penalty: blocked ? 0 : edgePenalty(x1, y1, x2, y2, wires) };
        edgeCache.set(edgeKey, edgeInfo);
      }
      if (edgeInfo.blocked) continue;

      const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
      const bend = n.dir === dir ? 0 : ROUTE_BEND_PENALTY;
      const nextCost = current.cost + length + bend + edgeInfo.penalty;
      const nState = nNode * 4 + n.dir;
      if (nextCost + 0.0001 < dist[nState]) {
        dist[nState] = nextCost;
        prev[nState] = state;
        heap.push(nextCost, nState);
      }
    }
  }

  if (goalState < 0) return null;

  const states = [];
  for (let s = goalState; s >= 0; s = prev[s]) states.push(s);
  states.reverse();
  const points = states.map((s) => {
    const node = Math.floor(s / 4);
    return { x: xList[node % nx], y: yList[Math.floor(node / nx)] };
  });
  points[0] = { x: start.x, y: start.y };
  points[points.length - 1] = { x: end.x, y: end.y };
  return simplifyPoints(points);
}

/**
 * Trasa ortogonalna z awaryjnym uproszczeniem siatki.
 * Gdy siatka z trasami wcześniejszych przewodów jest zbyt duża, powtarza
 * obliczenia bez ich współrzędnych (chodzi wtedy tylko o ominięcie elementów).
 */
function routeOrthogonal(start, end, startDir, blockedGoalDir, obstacles, wires) {
  const points = gridRoute(start, end, startDir, blockedGoalDir, obstacles, wires);
  if (points || !wires.length) return points;
  return gridRoute(start, end, startDir, blockedGoalDir, obstacles, []);
}

function containsPoint(rect, point) {
  return point.x > rect.left + ROUTE_EPS && point.x < rect.right - ROUTE_EPS &&
    point.y > rect.top + ROUTE_EPS && point.y < rect.bottom - ROUTE_EPS;
}

function connectionEndpoints(doc, connection, obstacles) {
  const a = portWorld(doc, ...splitConn(connection.from));
  const b = portWorld(doc, ...splitConn(connection.to));
  if (!a || !b) return null;

  /* Punkt startowy routingu musi leżeć POZA obrysem elementu źródłowego,
     a docelowy — poza obrysem elementu docelowego. Gdy port jest na krawędzi
     obrysu (np. x=10, a prostokąt zaczyna się od x=10), stały WIRE_STUB
     wchodziłby do środka elementu. Dlatego stub jest wydłużany dynamicznie
     tak, aż wyprowadzenie wyjdzie poza przeszkodę + margines. */
  const a1 = outsideStub(a, obstacles);
  const b1 = outsideStub(b, obstacles);
  return { a, b, a1, b1, fromId: a.instance.id, toId: b.instance.id };
}

/** Wyprowadzenie portu poza obrys elementu (min. WIRE_STUB, więcej gdy trzeba).
  Sprawdzamy WSZYSTKIE przeszkody — też własny element, gdy port leży w jego
  wnętrzu zamiast na krawędzi. */
function outsideStub(port, obstacles) {
  let stub = WIRE_STUB;
  for (let step = 0; step < 8; step++) {
    const p = { x: port.x + port.normal.x * stub, y: port.y + port.normal.y * stub };
    const inside = obstacles.some((o) => containsPoint(o, p));
    if (!inside) return { x: p.x, y: p.y };
    stub += ROUTE_MARGIN;
  }
  return { x: port.x + port.normal.x * stub, y: port.y + port.normal.y * stub };
}

/** Czy odcinek (a,b) przecina interior prostokąta przeszkody. */
function segmentHitsRect(a, b, rect) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const horizontal = Math.abs(a.y - b.y) < ROUTE_EPS;
  if (horizontal) {
    return a.y > rect.top + ROUTE_EPS && a.y < rect.bottom - ROUTE_EPS &&
      maxX > rect.left + ROUTE_EPS && minX < rect.right - ROUTE_EPS;
  }
  return a.x > rect.left + ROUTE_EPS && a.x < rect.right - ROUTE_EPS &&
    maxY > rect.top + ROUTE_EPS && minY < rect.bottom - ROUTE_EPS;
}

/** Weryfikacja trasy: żaden odcinek (poza wyprowadzeniami portów) nie może
  wchodzić w obszar elementu. Zwraca listę naruszeń. */
function validateRoute(points, obstacles, fromId, toId) {
  const violations = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    for (const o of obstacles) {
      if (o.instanceId === fromId || o.instanceId === toId) continue;
      if (segmentHitsRect(a, b, o)) {
        violations.push({ instanceId: o.instanceId, segment: [a, b] });
        break;
      }
    }
  }
  return violations;
}

function segmentsOf(points) {
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (Math.abs(a.x - b.x) > ROUTE_EPS || Math.abs(a.y - b.y) > ROUTE_EPS) {
      segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  return segments;
}

function polylinePath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)} ${r(p.y)}`).join(' ');
}

/** Ścieżka z pętelkami (mostkami) w miejscach skrzyżowań przewodów. */
export function wirePath(geo, hopRadius = 7) {
  const points = geo?.points || [];
  if (!points.length) return '';
  const hops = geo?.hops || [];
  if (!hops.length || hopRadius < 0.5) return geo.d || polylinePath(points);

  let d = `M${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const horizontal = Math.abs(p1.y - p0.y) < ROUTE_EPS;
    const dx = p1.x - p0.x;
    if (!horizontal || Math.abs(dx) < ROUTE_EPS) {
      d += ` L${r(p1.x)} ${r(p1.y)}`;
      continue;
    }

    const dir = dx > 0 ? 1 : -1;
    const onSegment = hops
      .filter((h) => Math.abs(h.y - p0.y) < ROUTE_EPS && h.x > Math.min(p0.x, p1.x) + ROUTE_EPS && h.x < Math.max(p0.x, p1.x) - ROUTE_EPS)
      .sort((a, b) => (dir > 0 ? a.x - b.x : b.x - a.x));

    if (!onSegment.length) {
      d += ` L${r(p1.x)} ${r(p1.y)}`;
      continue;
    }

    let cursor = p0.x;
    for (const hop of onSegment) {
      const before = hop.x - dir * hopRadius;
      const after = hop.x + dir * hopRadius;
      if (dir > 0 ? before <= cursor + 0.1 || after >= p1.x - 0.1 : before >= cursor - 0.1 || after <= p1.x + 0.1) continue;
      d += ` L${r(before)} ${r(hop.y)}`;
      d += ` A${r(hopRadius)} ${r(hopRadius)} 0 0 ${dir > 0 ? 1 : 0} ${r(after)} ${r(hop.y)}`;
      cursor = after;
    }
    if (Math.abs(cursor - p1.x) > 0.01) d += ` L${r(p1.x)} ${r(p1.y)}`;
  }
  return d;
}

function routeConnectionPoints(doc, connection, obstacles, wires) {
  const base = connectionEndpoints(doc, connection, obstacles);
  if (!base) return null;

  const startDir = directionOf(base.a.normal.x, base.a.normal.y);
  const goalOutDir = directionOf(base.b.normal.x, base.b.normal.y);

  /* Kolejne, coraz łagodniejsze zestawy przeszkód. Dzięki temu, gdy port
     leży wewnątrz innego elementu (np. elementy na siebie nachodzą), trasa
     i tak wychodzi z portu, zamiast zamieniać się w linię prostą przez wszystko. */
  const attempts = [
    obstacles,
    obstacles.filter((o) => o.instanceId !== base.fromId && o.instanceId !== base.toId),
    obstacles.filter((o) => o.instanceId !== base.fromId && o.instanceId !== base.toId &&
      !containsPoint(o, base.a1) && !containsPoint(o, base.b1))
  ];

  const tried = new Set();
  for (const set of attempts) {
    const key = set.length + ':' + set.map((o) => o.instanceId).join(',');
    if (tried.has(key)) continue;
    tried.add(key);

    let middle = null;
    try {
      middle = routeOrthogonal(base.a1, base.b1, startDir, goalOutDir, set, wires);
    } catch {
      middle = null;
    }
    if (middle) return simplifyPoints([base.a, ...middle, base.b]);
  }

  return simplifyPoints(buildRoute(base.a, base.a1, base.b1, base.b));
}

function addHop(geo, x, y) {
  if (geo.hops.some((h) => Math.hypot(h.x - x, h.y - y) < 1)) return;
  geo.hops.push({ x, y });
}

function assignHops(entries) {
  for (const entry of entries) entry.geo.hops = [];
  for (let i = 0; i < entries.length; i++) {
    const segsA = segmentsOf(entries[i].geo.points);
    for (let j = i + 1; j < entries.length; j++) {
      const segsB = segmentsOf(entries[j].geo.points);
      for (const sa of segsA) {
        const aHorizontal = Math.abs(sa.y1 - sa.y2) < ROUTE_EPS;
        for (const sb of segsB) {
          const bHorizontal = Math.abs(sb.y1 - sb.y2) < ROUTE_EPS;
          if (aHorizontal === bHorizontal) continue;
          const horizontal = aHorizontal ? sa : sb;
          const vertical = aHorizontal ? sb : sa;
          const x = vertical.x1;
          const y = horizontal.y1;
          const hMin = Math.min(horizontal.x1, horizontal.x2);
          const hMax = Math.max(horizontal.x1, horizontal.x2);
          const vMin = Math.min(vertical.y1, vertical.y2);
          const vMax = Math.max(vertical.y1, vertical.y2);
          if (x > hMin + 0.75 && x < hMax - 0.75 && y > vMin + 0.75 && y < vMax - 0.75) {
            addHop(aHorizontal ? entries[i].geo : entries[j].geo, x, y);
          }
        }
      }
    }
  }
}

/** Wyznacza trasy wszystkich połączeń, kolejno omijając wcześniejsze przewody. */
export function routeDocConnections(doc) {
  const signature = routeSignature(doc);
  if (routeCache.doc === doc && routeCache.signature === signature) return routeCache.routes;

  const routes = new Map();
  const entries = [];
  const obstacles = obstacleRects(doc);
  const wires = [];

  for (const connection of doc.connections) {
    let points = routeConnectionPoints(doc, connection, obstacles, wires);
    if (!points) continue;

    /* Bezwzględna weryfikacja: trasa nie może wchodzić w obszar żądnego
       elementu. Sprawdzamy tylko trasę między wyprowadzeniami portów —
       same stuby portów (a→a1, b1→b) są wyprowadzeniami i muszą istnieć.
       Jeśli mimo wszystko wchodzi, powtarzamy routing z większym
       marginesem przeszkód. Rysujemy najlepszą uzyskaną trasę — brak
       trasy byłby gorszy niż trasa w ekstremalnie zagęszczonym układzie. */
    const base = connectionEndpoints(doc, connection, obstacles);
    let violations = base ? validateRoute(points.slice(1, -1), obstacles, base.fromId, base.toId) : [];
    if (violations.length) {
      const inflated = obstacles.map((o) => ({
        ...o,
        left: o.left - ROUTE_MARGIN,
        top: o.top - ROUTE_MARGIN,
        right: o.right + ROUTE_MARGIN,
        bottom: o.bottom + ROUTE_MARGIN
      }));
      const inflatedPoints = routeConnectionPoints(doc, connection, inflated, wires);
      const inflatedBase = connectionEndpoints(doc, connection, inflated);
      const inflatedViolations = inflatedBase ? validateRoute(inflatedPoints.slice(1, -1), inflated, inflatedBase.fromId, inflatedBase.toId) : [];
      if (inflatedPoints && inflatedViolations.length < violations.length) {
        points = inflatedPoints;
        violations = inflatedViolations;
      }
    }

    const geo = {
      d: polylinePath(points),
      points,
      start: base ? { x: base.a.x, y: base.a.y } : points[0],
      end: base ? { x: base.b.x, y: base.b.y } : points[points.length - 1],
      mid: midPointOf(points),
      hops: []
    };
    routes.set(connection.id, geo);
    entries.push({ connection, geo });
    wires.push(...segmentsOf(points));
  }

  assignHops(entries);
  routeCache = { doc, signature, routes };
  return routes;
}

let routeCache = { doc: null, signature: '', routes: null };

function routeSignature(doc) {
  const parts = [];
  for (const inst of doc.instances) {
    const def = doc.definitions[inst.type];
    const resolved = def ? resolveDefinition(inst, def) : null;
    parts.push(`${inst.id}|${inst.type}|${r(inst.x)}|${r(inst.y)}|${inst.rot || 0}` +
      `|${resolved ? r(resolved.width) : 0}|${resolved ? r(resolved.height) : 0}` +
      `|${isLabelBlock(def) ? String(inst.label ?? '') : ''}`);
  }
  parts.push('--');
  for (const conn of doc.connections) {
    parts.push(`${conn.id}|${conn.from}|${conn.to}`);
  }
  parts.push('--');
  const usedTypes = new Set(doc.instances.map((inst) => inst.type));
  for (const type of usedTypes) {
    const def = doc.definitions[type];
    if (!def) continue;
    parts.push(`${type}|${r(def.width)}|${r(def.height)}|` +
      (def.ports || []).map((p) => `${p.id},${r(p.x)},${r(p.y)},${p.type}`).join(';'));
  }
  return parts.join('/');
}

/** Ścieżka SVG pojedynczego połączenia (bez pętelek — dla zgodności). */
export function connectionGeometry(doc, connection) {
  const obstacles = obstacleRects(doc);
  const points = routeConnectionPoints(doc, connection, obstacles, []);
  if (!points) return null;
  const base = connectionEndpoints(doc, connection, obstacles);
  return {
    d: polylinePath(points),
    points,
    start: base ? { x: base.a.x, y: base.a.y } : points[0],
    end: base ? { x: base.b.x, y: base.b.y } : points[points.length - 1],
    mid: midPointOf(points),
    hops: []
  };
}

function splitConn(endpoint) {
  const parsed = parseEndpoint(endpoint) || { instanceId: '', portId: '' };
  return [parsed.instanceId, parsed.portId];
}

export function instanceBounds(instance, def) {
  const resolved = resolveDefinition(instance, def);
  const corners = [
    transformPoint(instance, resolved, 0, 0),
    transformPoint(instance, resolved, resolved.width, 0),
    transformPoint(instance, resolved, resolved.width, resolved.height),
    transformPoint(instance, resolved, 0, resolved.height)
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys)
  };
}

export function docBounds(doc) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const inst of doc.instances) {
    const def = doc.definitions[inst.type];
    if (!def) continue;
    const b = instanceBounds(inst, def);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const geo of routeDocConnections(doc).values()) {
    for (const p of geo.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    for (const hop of geo.hops) {
      minX = Math.min(minX, hop.x - 8);
      minY = Math.min(minY, hop.y - 8);
      maxX = Math.max(maxX, hop.x + 8);
      maxY = Math.max(maxY, hop.y + 8);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 800, h: 500 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function snapValue(value, enabled = true, grid = GRID) {
  return enabled ? Math.round(value / grid) * grid : value;
}

export function connectionExists(doc, from, to) {
  return doc.connections.some((c) =>
    (c.from === from && c.to === to) || (c.from === to && c.to === from)
  );
}

export function findDefinitionKeyForInstance(doc, instanceId) {
  const inst = doc.instances.find((i) => i.id === instanceId);
  return inst?.type || null;
}
