/* Kreator elementów: rysowanie grafiki i definiowanie portów */
import { CATEGORIES, PORT_TYPES, DIRECTIONS } from './model.js';
import { generateCustomKey, getAnyDefinition, saveCustomDefinition } from './libraryStore.js';
import { store } from './store.js';
import { escapeHtml, deepClone, downloadFile, num, uid } from './utils.js';
import { toast } from './ui.js';

const TOOLS = {
  select: { label: 'Zaznaczanie / przesuwanie', hint: 'Przeciągnij kształt, aby go przesunąć.' },
  line: { label: 'Linia', hint: 'Przeciągnij, aby narysować linię.' },
  rect: { label: 'Prostokąt', hint: 'Przeciągnij, aby narysować prostokąt.' },
  ellipse: { label: 'Elipsa', hint: 'Przeciągnij, aby narysować elipsę.' },
  pen: { label: 'Rysowanie odręczne', hint: 'Przytrzymaj i rysuj palcem lub myszą.' },
  text: { label: 'Tekst', hint: 'Kliknij na płótnie i wpisz treść.' },
  eraser: { label: 'Gumka', hint: 'Kliknij kształt, aby go usunąć.' },
  port: { label: 'Port', hint: 'Kliknij na płótnie, aby dodać port (przy krawędzi zostanie do niej przyciągnięty).' }
};

let activeEditor = null;

export function openComponentEditor({ key = null, onSaved = null } = {}) {
  if (activeEditor) return;
  const existing = key ? getAnyDefinition(key) : null;
  const isEditing = Boolean(existing && existing.source === 'custom');
  const baseDef = existing?.def || null;
  const modelShapes = baseDef?.graphic?.model?.shapes;

  const state = {
    editingKey: isEditing ? key : null,
    width: Math.max(20, num(baseDef?.width, 120)),
    height: Math.max(20, num(baseDef?.height, 80)),
    shapes: Array.isArray(modelShapes) ? deepClone(modelShapes) : [],
    ports: Array.isArray(baseDef?.ports) ? deepClone(baseDef.ports) : [],
    tool: 'select',
    stroke: '#111827',
    fill: '#ffffff',
    fillEnabled: true,
    strokeWidth: 2,
    portType: 'electric',
    activePort: -1,
    undo: [],
    draft: null,
    draftStart: null,
    dragShape: null,
    dragPort: null,
    pointerId: null
  };

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Kreator elementu">
        <div class="modal-head">
          <div>
            <h2>${isEditing ? 'Edycja elementu' : 'Nowy element'}</h2>
            <p>Narysuj symbol i zdefiniuj porty. Zapis trafi do „Moich elementów”.</p>
          </div>
          <button class="icon-btn" data-close title="Zamknij"><svg class="icon"><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-body">
          <div class="modal-col">
            <div class="field">
              <label for="ed-name">Nazwa elementu *</label>
              <input id="ed-name" class="input" value="${escapeHtml(baseDef?.name || '')}" placeholder="np. Zawór 3/2">
            </div>
            <div class="field">
              <label for="ed-category">Kategoria</label>
              <select id="ed-category" class="select">
                ${CATEGORIES.filter((c) => c.id !== 'other').map((c) =>
                  `<option value="${c.id}"${(baseDef?.category || 'pneumatic') === c.id ? ' selected' : ''}>${c.label}</option>`
                ).join('')}
              </select>
            </div>
            <div class="field-row">
              <div class="field"><label for="ed-manufacturer">Producent</label><input id="ed-manufacturer" class="input" value="${escapeHtml(baseDef?.manufacturer || '')}" placeholder="opcjonalnie"></div>
              <div class="field"><label for="ed-part">Numer części</label><input id="ed-part" class="input" value="${escapeHtml(baseDef?.partNumber || '')}" placeholder="opcjonalnie"></div>
            </div>
            <div class="field-row">
              <div class="field"><label for="ed-width">Szerokość</label><input id="ed-width" class="input" type="number" min="20" max="800" step="5" value="${state.width}"></div>
              <div class="field"><label for="ed-height">Wysokość</label><input id="ed-height" class="input" type="number" min="20" max="800" step="5" value="${state.height}"></div>
            </div>

            <div class="insp-section">
              <h3>Styl rysowania</h3>
              <div class="field"><label>Kolor linii</label><div class="color-field"><input id="ed-stroke" type="color" value="${state.stroke}"><input id="ed-stroke-text" class="input input-mono" value="${state.stroke}"></div></div>
              <div class="field"><label>Grubość linii</label><input id="ed-stroke-width" class="input" type="number" min="0.5" max="12" step="0.5" value="${state.strokeWidth}"></div>
              <div class="field"><label>Wypełnienie</label><div class="color-field"><input id="ed-fill" type="color" value="${state.fill}"><input id="ed-fill-text" class="input input-mono" value="${state.fill}"></div></div>
              <label class="legend-row" style="cursor:pointer"><input id="ed-fill-enabled" type="checkbox" ${state.fillEnabled ? 'checked' : ''}> Wypełniaj zamknięte kształty</label>
            </div>

            <div class="insp-section">
              <h3>Wskazówka</h3>
              <p class="insp-sub" style="margin:0">Porty dodawaj narzędziem <strong>Port</strong> i klikaj na krawędzi symbolu. Potem popraw identyfikator, typ i kierunek w liście po prawej.</p>
            </div>
          </div>

          <div class="modal-col modal-canvas-col">
            <div class="draw-toolbar">
              ${Object.entries(TOOLS).map(([tool, info]) =>
                `<button class="icon-btn" data-tool="${tool}" title="${info.label}"><svg class="icon"><use href="#${toolIcon(tool)}"/></svg></button>`
              ).join('')}
              <span class="tool-sep"></span>
              <button class="icon-btn" data-draw-act="undo" title="Cofnij (Ctrl+Z)"><svg class="icon"><use href="#i-undo"/></svg></button>
              <button class="icon-btn" data-draw-act="clear" title="Wyczyść rysunek"><svg class="icon"><use href="#i-trash"/></svg></button>
            </div>
            <div class="draw-stage">
              <svg id="draw-svg" class="draw-svg" xmlns="http://www.w3.org/2000/svg"></svg>
            </div>
            <div class="draw-hint">
              <span id="draw-mode"><strong>Tryb:</strong> ${TOOLS.select.label}</span>
              <span id="draw-tip">${TOOLS.select.hint}</span>
            </div>
          </div>

          <div class="modal-col modal-col-right">
            <div class="panel-head" style="padding:0 0 10px; align-items:center">
              <div><h2 style="font-size:12px">Porty</h2><p class="subtle">${state.ports.length} zdefiniowanych</p></div>
              <button class="btn btn-small" data-draw-act="add-port"><svg class="icon"><use href="#i-plus"/></svg>Dodaj</button>
            </div>
            <div class="field">
              <label for="ed-port-type">Typ nowego portu</label>
              <select id="ed-port-type" class="select">
                ${Object.entries(PORT_TYPES).map(([type, value]) =>
                  `<option value="${type}"${state.portType === type ? ' selected' : ''}>${value.label}</option>`
                ).join('')}
              </select>
            </div>
            <div class="port-list" id="port-list"></div>
            <div class="insp-section">
              <h3>Legenda portów</h3>
              <p class="insp-sub" style="margin:0">Kolor oznacza medium. Kółko pełne = wejście, puste = wyjście, krzyżyk = dwukierunkowy. Połączenia w schemacie wymagają zgodnych mediów.</p>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <span class="foot-note">Wymiary i porty są zapisywane w JSON razem z grafiką SVG.</span>
          <button class="btn" data-close>Anuluj</button>
          <button class="btn btn-primary" data-draw-act="save"><svg class="icon"><use href="#i-check"/></svg>Zapisz element</button>
        </div>
      </div>
    </div>`;

  const backdrop = root.querySelector('.modal-backdrop');
  const svg = root.querySelector('#draw-svg');
  const portList = root.querySelector('#port-list');
  const drawMode = root.querySelector('#draw-mode');
  const drawTip = root.querySelector('#draw-tip');

  const $ = (sel) => root.querySelector(sel);

  activeEditor = { close };

  /* ---------------- historia ---------------- */
  function pushUndo() {
    state.undo.push({ shapes: deepClone(state.shapes), ports: deepClone(state.ports) });
    if (state.undo.length > 60) state.undo.shift();
  }

  function undo() {
    const prev = state.undo.pop();
    if (!prev) return;
    state.shapes = prev.shapes;
    state.ports = prev.ports;
    state.activePort = -1;
    render();
  }

  function clearDrawing() {
    if (!state.shapes.length) return;
    if (!window.confirm('Usunąć cały rysunek? Porty pozostaną.')) return;
    pushUndo();
    state.shapes = [];
    render();
  }

  /* ---------------- render ---------------- */
  function portRadius() {
    return Math.max(1.4, state.width / 70);
  }

  function shapeVisibleMarkup(shape) {
    const stroke = shape.stroke || '#111827';
    const sw = num(shape.strokeWidth, 2);
    const fill = shape.type === 'text' ? 'none' : (shape.fill && shape.fill !== 'none' ? shape.fill : 'none');
    const common = `stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
    switch (shape.type) {
      case 'line':
        return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${common}/>`;
      case 'rect':
        return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${fill}" ${common}/>`;
      case 'ellipse':
        return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" fill="${fill}" ${common}/>`;
      case 'polyline':
        return `<polyline points="${shape.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" ${common}/>`;
      case 'text':
        return `<text x="${shape.x}" y="${shape.y}" font-size="${shape.size}" font-family="Inter, system-ui, sans-serif" fill="${stroke}">${escapeHtml(shape.text)}</text>`;
      default:
        return '';
    }
  }

  function shapeHitMarkup(shape) {
    const common = 'fill="none" stroke="transparent" vector-effect="non-scaling-stroke" pointer-events="stroke"';
    switch (shape.type) {
      case 'line':
        return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${common} stroke-width="16"/>`;
      case 'rect':
        return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="transparent" stroke="transparent" pointer-events="all"/>`;
      case 'ellipse':
        return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" fill="transparent" stroke="transparent" pointer-events="all"/>`;
      case 'polyline':
        return `<polyline points="${shape.points.map((p) => `${p.x},${p.y}`).join(' ')}" ${common} stroke-width="16"/>`;
      case 'text':
        return `<text x="${shape.x}" y="${shape.y}" font-size="${shape.size}" font-family="Inter, system-ui, sans-serif" fill="transparent" stroke="transparent" pointer-events="all">${escapeHtml(shape.text)}</text>`;
      default:
        return '';
    }
  }

  function render() {
    renderSvg();
    updateToolUi();
    renderPortList();
  }

  function renderSvg() {
    const pad = Math.max(8, Math.max(state.width, state.height) * 0.12);
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${state.width + pad * 2} ${state.height + pad * 2}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const gridStep = 10;
    const r = portRadius();
    const fontSize = Math.max(2, Math.min(7, state.width / 55));

    const shapesMarkup = state.shapes.map((shape, index) =>
      `<g data-shape-index="${index}">` +
        `<g pointer-events="none">${shapeVisibleMarkup(shape)}</g>` +
        shapeHitMarkup(shape) +
      `</g>`
    ).join('');

    const draftMarkup = state.draft
      ? `<g pointer-events="none" opacity="0.65">${shapeVisibleMarkup(state.draft)}</g>`
      : '';

    const portsMarkup = state.ports.map((port, index) => {
      const color = PORT_TYPES[port.type]?.color || '#64748b';
      const active = state.activePort === index;
      const labelLeft = port.x > state.width * 0.72;
      const labelBelow = port.y < r * 4;
      const labelX = port.x + (labelLeft ? -r * 1.8 : r * 1.8);
      const labelY = port.y + (labelBelow ? r * 2.8 : -r * 1.5);
      return (
        `<g data-port-index="${index}" style="cursor:grab">` +
          `<circle cx="${port.x}" cy="${port.y}" r="${r * 2.6}" fill="transparent"/>` +
          (active ? `<circle cx="${port.x}" cy="${port.y}" r="${r * 2}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.45" vector-effect="non-scaling-stroke"/>` : '') +
          `<circle cx="${port.x}" cy="${port.y}" r="${r}" fill="#fff" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
          `<text x="${labelX}" y="${labelY}" font-size="${fontSize}" text-anchor="${labelLeft ? 'end' : 'start'}" font-family="Inter, system-ui, sans-serif" fill="${color}" pointer-events="none">${escapeHtml(port.id)}</text>` +
        `</g>`
      );
    }).join('');

    svg.innerHTML =
      `<defs>` +
        `<pattern id="editor-grid" width="${gridStep}" height="${gridStep}" patternUnits="userSpaceOnUse">` +
          `<path d="M${gridStep} 0H0V${gridStep}" fill="none" stroke="#e2e8f0" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
        `</pattern>` +
      `</defs>` +
      `<rect width="${state.width}" height="${state.height}" fill="url(#editor-grid)" pointer-events="none"/>` +
      `<rect width="${state.width}" height="${state.height}" fill="none" stroke="#cbd5e1" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>` +
      shapesMarkup + draftMarkup + portsMarkup;
  }

  function updateToolUi() {
    root.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tool === state.tool);
    });
    drawMode.innerHTML = `<strong>Tryb:</strong> ${escapeHtml(TOOLS[state.tool].label)}`;
    drawTip.textContent = state.tool === 'port' ? 'Kliknij na płótnie, aby dodać port.' : TOOLS[state.tool].hint;
    svg.style.cursor = state.tool === 'select' ? 'default' : state.tool === 'eraser' ? 'not-allowed' : 'crosshair';
  }

  function renderPortList() {
    const title = root.querySelector('.modal-col-right .subtle');
    if (title) title.textContent = `${state.ports.length} zdefiniowanych`;
    if (!state.ports.length) {
      portList.innerHTML = `<div class="port-empty">Brak portów. Dodaj pierwszy port przyciskiem „Dodaj”, a następnie kliknij na krawędzi symbolu.</div>`;
      return;
    }
    portList.innerHTML = state.ports.map((port, index) => (
      `<div class="port-row${state.activePort === index ? ' is-active' : ''}" data-port-row="${index}">` +
        `<input class="input input-mono" data-port-field="id" value="${escapeHtml(port.id)}" title="Identyfikator portu" aria-label="Identyfikator portu ${index + 1}">` +
        `<select class="select" data-port-field="type" title="Medium" aria-label="Medium portu ${index + 1}">` +
          Object.entries(PORT_TYPES).map(([key, value]) =>
            `<option value="${key}"${port.type === key ? ' selected' : ''}>${value.short}</option>`
          ).join('') +
        `</select>` +
        `<select class="select" data-port-field="dir" title="Kierunek" aria-label="Kierunek portu ${index + 1}">` +
          Object.entries(DIRECTIONS).map(([key, label]) =>
            `<option value="${key}"${port.dir === key ? ' selected' : ''}>${key === 'in' ? 'Wej.' : key === 'out' ? 'Wyj.' : 'Dwuk.'}</option>`
          ).join('') +
        `</select>` +
        `<button class="icon-btn" data-port-delete="${index}" title="Usuń port"><svg class="icon"><use href="#i-trash"/></svg></button>` +
      `</div>`
    )).join('');
  }

  /* ---------------- współrzędne ---------------- */
  function pointFromEvent(event) {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return {
      x: Math.min(state.width, Math.max(0, p.x)),
      y: Math.min(state.height, Math.max(0, p.y))
    };
  }

  const snap5 = (v) => Math.round(v / 5) * 5;

  function baseShapeStyle() {
    return {
      stroke: state.stroke,
      strokeWidth: state.strokeWidth,
      fill: state.fillEnabled ? state.fill : 'none'
    };
  }

  function translateShape(shape, dx, dy) {
    switch (shape.type) {
      case 'line':
        shape.x1 += dx; shape.y1 += dy; shape.x2 += dx; shape.y2 += dy; break;
      case 'rect':
      case 'text':
        shape.x += dx; shape.y += dy; break;
      case 'ellipse':
        shape.cx += dx; shape.cy += dy; break;
      case 'polyline':
        shape.points = shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })); break;
      default: break;
    }
  }

  /* ---------------- zdarzenia rysowania ---------------- */
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const p = pointFromEvent(event);
    const portEl = event.target.closest?.('[data-port-index]');
    if (portEl) {
      event.preventDefault();
      try { svg.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      const index = Number(portEl.dataset.portIndex);
      state.activePort = index;
      state.dragPort = {
        index,
        start: p,
        origin: { x: state.ports[index].x, y: state.ports[index].y },
        moved: false
      };
      render();
      return;
    }

    const shapeEl = event.target.closest?.('[data-shape-index]');

    if (state.tool === 'port') {
      event.preventDefault();
      addPortAt(p);
      return;
    }

    if (state.tool === 'eraser') {
      if (shapeEl) {
        pushUndo();
        state.shapes.splice(Number(shapeEl.dataset.shapeIndex), 1);
        render();
      }
      return;
    }

    if (state.tool === 'select') {
      if (shapeEl) {
        event.preventDefault();
        try { svg.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        const index = Number(shapeEl.dataset.shapeIndex);
        state.dragShape = {
          index,
          start: p,
          original: deepClone(state.shapes[index]),
          moved: false
        };
        state.activePort = -1;
      } else {
        state.activePort = -1;
        render();
      }
      return;
    }

    if (state.tool === 'text') {
      const text = window.prompt('Treść tekstu:', '');
      if (text && text.trim()) {
        pushUndo();
        state.shapes.push({
          type: 'text',
          x: snap5(p.x),
          y: snap5(p.y),
          text: text.trim(),
          size: Math.max(6, Math.round(state.height / 7)),
          stroke: state.stroke,
          strokeWidth: 0,
          fill: 'none'
        });
        render();
      }
      return;
    }

    event.preventDefault();
    try { svg.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    state.pointerId = event.pointerId;
    const start = { x: snap5(p.x), y: snap5(p.y) };
    state.draftStart = start;
    const style = baseShapeStyle();
    if (state.tool === 'line') {
      state.draft = { type: 'line', x1: start.x, y1: start.y, x2: start.x, y2: start.y, ...style };
    } else if (state.tool === 'rect') {
      state.draft = { type: 'rect', x: start.x, y: start.y, w: 0, h: 0, ...style };
    } else if (state.tool === 'ellipse') {
      state.draft = { type: 'ellipse', cx: start.x, cy: start.y, rx: 0, ry: 0, ...style };
    } else if (state.tool === 'pen') {
      state.draft = { type: 'polyline', points: [{ x: start.x, y: start.y }], ...style, fill: 'none' };
    }
    render();
  });

  svg.addEventListener('pointermove', (event) => {
    if (state.dragPort) {
      const p = pointFromEvent(event);
      if (!state.dragPort.moved) pushUndo();
      const port = state.ports[state.dragPort.index];
      port.x = Math.min(state.width, Math.max(0, snap5(state.dragPort.origin.x + (p.x - state.dragPort.start.x))));
      port.y = Math.min(state.height, Math.max(0, snap5(state.dragPort.origin.y + (p.y - state.dragPort.start.y))));
      state.dragPort.moved = true;
      renderSvg();
      return;
    }
    if (state.dragShape) {
      const p = pointFromEvent(event);
      const shape = state.shapes[state.dragShape.index];
      if (!shape) return;
      const dx = p.x - state.dragShape.start.x;
      const dy = p.y - state.dragShape.start.y;
      if (!state.dragShape.moved && Math.hypot(dx, dy) > 1) {
        state.dragShape.moved = true;
        pushUndo();
      }
      state.shapes[state.dragShape.index] = deepClone(state.dragShape.original);
      translateShape(state.shapes[state.dragShape.index], dx, dy);
      renderSvg();
      return;
    }
    if (!state.draft) return;
    const p = pointFromEvent(event);
    const x = snap5(p.x);
    const y = snap5(p.y);
    const draft = state.draft;
    const start = state.draftStart || { x: draft.x ?? draft.cx ?? draft.x1, y: draft.y ?? draft.cy ?? draft.y1 };
    if (draft.type === 'line') {
      draft.x2 = x; draft.y2 = y;
    } else if (draft.type === 'rect') {
      draft.x = Math.min(start.x, x);
      draft.y = Math.min(start.y, y);
      draft.w = Math.abs(x - start.x);
      draft.h = Math.abs(y - start.y);
    } else if (draft.type === 'ellipse') {
      draft.cx = (start.x + x) / 2;
      draft.cy = (start.y + y) / 2;
      draft.rx = Math.abs(x - start.x) / 2;
      draft.ry = Math.abs(y - start.y) / 2;
    } else if (draft.type === 'polyline') {
      const last = draft.points[draft.points.length - 1];
      if (!last || Math.hypot(last.x - x, last.y - y) > 1.5) draft.points.push({ x, y });
    }
    renderSvg();
  });

  function finishPointer(event) {
    if (state.dragPort) {
      state.dragPort = null;
      render();
      return;
    }
    if (state.dragShape) {
      state.dragShape = null;
      return;
    }
    if (state.draft) {
      const shape = state.draft;
      const usable = shape.type === 'rect'
        ? shape.w > 1 && shape.h > 1
        : shape.type === 'ellipse'
          ? shape.rx > 1 && shape.ry > 1
          : shape.type === 'polyline'
            ? shape.points.length > 1
            : shape.type === 'line'
              ? Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > 1
              : false;
      if (usable) {
        pushUndo();
        state.shapes.push(shape);
      }
      state.draft = null;
      state.draftStart = null;
      render();
    }
    if (event) {
      try { svg.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    }
  }

  svg.addEventListener('pointerup', finishPointer);
  svg.addEventListener('pointercancel', () => {
    state.draft = null;
    state.draftStart = null;
    state.dragShape = null;
    state.dragPort = null;
    render();
  });

  /* ---------------- porty ---------------- */
  function addPort() {
    state.tool = 'port';
    state.activePort = -1;
    render();
    toast('Kliknij na płótnie, aby dodać port.', 'info', 2400);
  }

  function addPortAt(point) {
    const index = state.ports.length + 1;
    let id = `p${index}`;
    const ids = new Set(state.ports.map((p) => p.id));
    let n = index;
    while (ids.has(id)) id = `p${++n}`;

    let x = snap5(point.x);
    let y = snap5(point.y);
    const threshold = Math.max(6, Math.min(24, Math.max(state.width, state.height) * 0.1));
    const distances = [
      { side: 'left', d: x },
      { side: 'right', d: state.width - x },
      { side: 'top', d: y },
      { side: 'bottom', d: state.height - y }
    ].sort((a, b) => a.d - b.d);
    if (distances[0].d <= threshold) {
      if (distances[0].side === 'left') x = 0;
      if (distances[0].side === 'right') x = state.width;
      if (distances[0].side === 'top') y = 0;
      if (distances[0].side === 'bottom') y = state.height;
    }

    pushUndo();
    state.ports.push({
      id,
      type: state.portType,
      dir: 'bi',
      x,
      y
    });
    state.activePort = state.ports.length - 1;
    render();
    setTimeout(() => {
      const row = portList.querySelector(`[data-port-row="${state.ports.length - 1}"] input`);
      if (row) { row.focus(); row.select(); }
    }, 0);
  }

  portList.addEventListener('click', (event) => {
    const del = event.target.closest('[data-port-delete]');
    if (del) {
      pushUndo();
      const index = Number(del.dataset.portDelete);
      state.ports.splice(index, 1);
      state.activePort = -1;
      render();
      return;
    }
    const row = event.target.closest('[data-port-row]');
    if (row && !event.target.closest('input,select,button')) {
      state.activePort = Number(row.dataset.portRow);
      render();
    }
  });

  portList.addEventListener('change', (event) => {
    const field = event.target.dataset.portField;
    if (!field) return;
    const row = event.target.closest('[data-port-row]');
    if (!row) return;
    const index = Number(row.dataset.portRow);
    const port = state.ports[index];
    if (!port) return;
    pushUndo();
    if (field === 'id') {
      let id = String(event.target.value || '').trim().replace(/\s+/g, '_') || `p${index + 1}`;
      const used = new Set(state.ports.filter((_, i) => i !== index).map((p) => p.id));
      let base = id;
      let n = 2;
      while (used.has(id)) id = `${base}_${n++}`;
      port.id = id;
    } else if (field === 'type') {
      port.type = event.target.value;
    } else if (field === 'dir') {
      port.dir = event.target.value;
    }
    render();
  });

  /* ---------------- formularz / narzędzia ---------------- */
  root.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool;
      state.activePort = -1;
      render();
    });
  });

  /* Listener podpinamy do backdropu, który powstaje na nowo przy każdym otwarciu.
     Dzięki temu stare sesje kreatora nie zostawiają handlerów na trwałym #modal-root. */
  backdrop.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) { close(); return; }
    const act = event.target.closest('[data-draw-act]');
    if (!act) return;
    if (act.dataset.drawAct === 'undo') undo();
    if (act.dataset.drawAct === 'clear') clearDrawing();
    if (act.dataset.drawAct === 'add-port') addPort();
    if (act.dataset.drawAct === 'save') save();
  });

  const bindTextPair = (colorId, textId, key) => {
    const color = root.querySelector(colorId);
    const text = root.querySelector(textId);
    color.addEventListener('input', () => { state[key] = color.value; text.value = color.value; });
    text.addEventListener('change', () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) { state[key] = text.value; color.value = text.value; }
      else text.value = state[key];
    });
  };
  bindTextPair('#ed-stroke', '#ed-stroke-text', 'stroke');
  bindTextPair('#ed-fill', '#ed-fill-text', 'fill');
  root.querySelector('#ed-fill-enabled').addEventListener('change', (event) => {
    state.fillEnabled = event.target.checked;
  });
  root.querySelector('#ed-stroke-width').addEventListener('change', (event) => {
    state.strokeWidth = Math.max(0.5, num(event.target.value, 2));
    event.target.value = state.strokeWidth;
  });
  root.querySelector('#ed-port-type').addEventListener('change', (event) => {
    state.portType = event.target.value;
  });

  const resize = (field, min, max) => {
    const input = root.querySelector(field);
    input.addEventListener('change', () => {
      const fallback = field === '#ed-width' ? state.width : state.height;
      const value = Math.max(min, Math.min(max, Math.round(num(input.value, fallback))));
      input.value = value;
      if (field === '#ed-width') state.width = value; else state.height = value;
      state.ports.forEach((port) => {
        port.x = Math.min(port.x, state.width);
        port.y = Math.min(port.y, state.height);
      });
      render();
    });
  };
  resize('#ed-width', 20, 800);
  resize('#ed-height', 20, 800);

  /* ---------------- zapis ---------------- */
  function gatherDefinition() {
    const name = root.querySelector('#ed-name').value.trim();
    if (!name) {
      toast('Podaj nazwę elementu.', 'error');
      root.querySelector('#ed-name').focus();
      return null;
    }
    const category = root.querySelector('#ed-category').value || 'other';
    const manufacturer = root.querySelector('#ed-manufacturer').value.trim();
    const partNumber = root.querySelector('#ed-part').value.trim();
    const width = state.width;
    const height = state.height;
    const shapes = deepClone(state.shapes);
    const ports = state.ports.map((port, index) => {
      let id = String(port.id || '').trim().replace(/\s+/g, '_') || `p${index + 1}`;
      return {
        id,
        type: PORT_TYPES[port.type] ? port.type : 'other',
        dir: DIRECTIONS[port.dir] ? port.dir : 'bi',
        x: Math.max(0, Math.min(width, num(port.x))),
        y: Math.max(0, Math.min(height, num(port.y)))
      };
    });
    const used = new Set();
    for (const port of ports) {
      const base = port.id;
      let n = 2;
      while (used.has(port.id)) port.id = `${base}_${n++}`;
      used.add(port.id);
    }
    const inner = shapes.map(shapeVisibleMarkup).join('');
    const data = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${inner}</svg>`;
    return {
      name,
      category,
      manufacturer,
      partNumber,
      width,
      height,
      graphic: { format: 'svg', data, width, height, model: { shapes } },
      ports
    };
  }

  function save() {
    const definition = gatherDefinition();
    if (!definition) return;
    const key = state.editingKey || generateCustomKey(definition.name);

    if (state.editingKey) {
      const before = getAnyDefinition(key)?.def;
      const beforeIds = new Set((before?.ports || []).map((p) => p.id));
      const afterIds = new Set(definition.ports.map((p) => p.id));
      const removed = [...beforeIds].filter((id) => !afterIds.has(id));
      if (removed.length) {
        const used = store.doc.connections.some((conn) => {
          return [conn.from, conn.to].some((endpoint) => {
            const dot = endpoint.lastIndexOf('.');
            const instId = endpoint.slice(0, dot);
            const portId = endpoint.slice(dot + 1);
            const inst = store.instanceById(instId);
            return inst?.type === key && removed.includes(portId);
          });
        });
        if (used) {
          const ok = window.confirm('Usunięto porty używane przez połączenia. Te połączenia przestaną działać. Kontynuować?');
          if (!ok) return;
        }
      }
    }

    const saved = saveCustomDefinition(key, definition);
    if (!saved) toast('Nie udało się zapisać w pamięci przeglądarki.', 'error');

    if (store.doc.definitions[key]) {
      store.change('Zaktualizowano definicję elementu', (doc) => {
        doc.definitions[key] = deepClone(definition);
      });
    }

    toast(state.editingKey ? 'Zaktualizowano element w bibliotece.' : 'Dodano element do „Moich elementów”.', 'ok');
    close();
    onSaved?.(key);
  }

  function close() {
    root.innerHTML = '';
    activeEditor = null;
    document.removeEventListener('keydown', onEditorKey);
  }

  function onEditorKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      undo();
    }
  }
  document.addEventListener('keydown', onEditorKey);

  render();
  setTimeout(() => root.querySelector('#ed-name')?.focus(), 30);
}

function toolIcon(tool) {
  return {
    select: 'i-move',
    line: 'i-line',
    rect: 'i-rect',
    ellipse: 'i-ellipse',
    pen: 'i-pen',
    text: 'i-text',
    eraser: 'i-eraser',
    port: 'i-port'
  }[tool] || 'i-move';
}
