/* Panele: biblioteka, inspektor, pasek narzędzi, skróty klawiszowe */
import { getAnyDefinition, listLibraryDefinitions } from './libraryStore.js';
import {
  CATEGORIES,
  CATEGORY_MAP,
  PORT_TYPES,
  categoryOf,
  instanceBounds,
  instanceHeight,
  isLabelBlock,
  isStretchable,
  normalizeRotation,
  parseEndpoint,
  resolveDefinition
} from './model.js';
import { definitionMetaLine, definitionThumbnail } from './render.js';
import { escapeHtml, isEditableTarget, num } from './utils.js';
import { toast } from './ui.js';

const LIB_NS = 'application/x-schematic-def';

export function initUI({ store, actions }) {
  const $ = (id) => document.getElementById(id);
  const libraryList = $('library-list');
  const librarySearch = $('library-search');
  const inspector = $('inspector');
  /* Domyślnie wszystkie sekcje biblioteki są zwinięte. */
  const collapsed = new Set(['__custom', ...CATEGORIES.map((cat) => cat.id)]);
  let draggingKey = null;

  /* ---------------- biblioteka ---------------- */
  function cardMarkup(entry) {
    const { key, def, source } = entry;
    let thumb = '';
    try {
      thumb = definitionThumbnail(def, key);
    } catch {
      thumb = '';
    }
    const sub = def.manufacturer || categoryOf(def).label || '';
    return (
      `<div class="lib-card" draggable="true" data-key="${escapeHtml(key)}" data-source="${source}" title="${escapeHtml(def.name)}">` +
        (source === 'custom' ? '<span class="lib-badge">Moje</span>' : '') +
        `<div class="lib-thumb">${thumb}</div>` +
        `<div class="lib-meta"><div class="lib-name">${escapeHtml(def.name)}</div><div class="lib-sub">${escapeHtml(sub)}</div></div>` +
        (source === 'custom'
          ? `<div class="lib-actions">` +
            `<button class="icon-btn" data-edit="${escapeHtml(key)}" title="Edytuj element"><svg class="icon"><use href="#i-pencil"/></svg></button>` +
            `<button class="icon-btn" data-delete="${escapeHtml(key)}" title="Usuń z mojej biblioteki"><svg class="icon"><use href="#i-trash"/></svg></button>` +
            `</div>`
          : '') +
      `</div>`
    );
  }

  function sectionMarkup(id, title, color, entries, searching = false) {
    if (!entries.length) return '';
    /* Podczas wyszukiwania rozwija sekcje, żeby wyniki były od razu widoczne. */
    const isCollapsed = !searching && collapsed.has(id);
    return (
      `<div class="lib-section${isCollapsed ? ' collapsed' : ''}" data-section="${id}">` +
        `<button class="lib-section-head" data-toggle="${id}">` +
          `<svg class="icon"><use href="#i-chevron"/></svg>` +
          (color ? `<span class="lib-dot" style="background:${color}"></span>` : '') +
          `<span>${escapeHtml(title)}</span><span class="lib-count">${entries.length}</span>` +
        `</button>` +
        `<div class="lib-grid">${entries.map(cardMarkup).join('')}</div>` +
      `</div>`
    );
  }

  function renderLibrary() {
    if (!libraryList) return;
    const query = (librarySearch?.value || '').trim().toLowerCase();
    const { custom, builtin } = listLibraryDefinitions();
    const matches = (entry) => {
      if (!query) return true;
      const d = entry.def;
      return [d.name, d.manufacturer, d.partNumber, categoryOf(d).label, entry.key]
        .join(' ').toLowerCase().includes(query);
    };

    const customMatches = custom.filter(matches);
    const builtinMatches = builtin.filter(matches);
    const searching = query.length > 0;
    let html = '';
    if (customMatches.length) {
      html += sectionMarkup('__custom', 'Moje elementy', '#0ea5e9', customMatches, searching);
    }
    for (const cat of CATEGORIES) {
      if (cat.id === 'other') continue;
      const entries = builtinMatches.filter((e) => e.def.category === cat.id);
      html += sectionMarkup(cat.id, cat.label, cat.color, entries, searching);
    }
    const other = builtinMatches.filter((e) => e.def.category === 'other');
    if (other.length) html += sectionMarkup('other', 'Inne', '#64748b', other, searching);

    if (!html) {
      html = `<div class="lib-empty">Brak elementów spełniających kryteria.<br>Spróbuj innej frazy lub narysuj nowy element.</div>`;
    }
    libraryList.innerHTML = html;
  }

  libraryList?.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-edit],[data-delete]');
    if (actionBtn) {
      event.stopPropagation();
      if (actionBtn.dataset.edit) actions.editDefinition(actionBtn.dataset.edit);
      if (actionBtn.dataset.delete) actions.deleteDefinition(actionBtn.dataset.delete);
      return;
    }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      renderLibrary();
      return;
    }
    const card = event.target.closest('.lib-card');
    if (card) actions.addDefinition(card.dataset.key);
  });

  libraryList?.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.lib-card');
    if (!card) return;
    draggingKey = card.dataset.key;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(LIB_NS, draggingKey);
    event.dataTransfer.setData('text/plain', draggingKey);
  });
  libraryList?.addEventListener('dragend', () => { draggingKey = null; });

  librarySearch?.addEventListener('input', renderLibrary);

  /* ---------------- inspektor ---------------- */
  function shortId() {
    const ids = store.selection.instances;
    if (ids.length <= 3) return ids.join(', ');
    return `${ids.slice(0, 3).join(', ')} +${ids.length - 3}`;
  }

  function renderInspector() {
    if (!inspector) return;
    const sel = store.selection;
    if (sel.connections.length === 1 && sel.instances.length === 0) {
      inspector.innerHTML = connectionInspector(sel.connections[0]);
      return;
    }
    if (sel.instances.length === 1) {
      inspector.innerHTML = instanceInspector(sel.instances[0]);
      return;
    }
    if (sel.instances.length > 1) {
      inspector.innerHTML = multiInspector();
      return;
    }
    inspector.innerHTML = emptyInspector();
  }

  function instanceInspector(id) {
    const inst = store.instanceById(id);
    if (!inst) return emptyInspector();
    const rawDef = store.doc.definitions[inst.type];
    if (!rawDef) return `<div class="insp-empty"><h2>Brak definicji</h2><p class="insp-sub">Element ${escapeHtml(id)} odwołuje się do nieistniejącej definicji.</p></div>`;
    const boxLabel = isLabelBlock(rawDef);
    const def = resolveDefinition(inst, rawDef);
    const cat = categoryOf(def);
    const custom = getAnyDefinition(inst.type)?.source === 'custom';
    const portCount = def.ports.length;
    return (
      `<div class="insp-section">` +
        `<div class="sel-type"><span class="lib-dot" style="background:${cat.color}"></span>${escapeHtml(cat.label)}</div>` +
        `<h2 class="insp-title" style="margin-top:8px">${escapeHtml(def.name)}</h2>` +
        `<p class="insp-sub">${escapeHtml(def.manufacturer || 'Brak producenta')}${def.partNumber ? ` · ${escapeHtml(def.partNumber)}` : ''}</p>` +
      `</div>` +
      `<div class="insp-section">` +
        `<h3>Właściwości</h3>` +
        `<div class="field"><label for="field-label">${boxLabel ? 'Treść bloku' : 'Etykieta'}</label><input id="field-label" class="input" data-field="label" value="${escapeHtml(inst.label)}" placeholder="${escapeHtml(boxLabel ? 'Tekst wewnątrz bloku' : def.name)}"></div>` +
        `<div class="field-row">` +
          `<div class="field"><label for="field-x">X</label><input id="field-x" class="input" type="number" step="1" data-field="x" value="${Math.round(inst.x * 100) / 100}"></div>` +
          `<div class="field"><label for="field-y">Y</label><input id="field-y" class="input" type="number" step="1" data-field="y" value="${Math.round(inst.y * 100) / 100}"></div>` +
        `</div>` +
        `<div class="field"><label for="field-rot">Obrót</label>` +
          `<select id="field-rot" class="select" data-field="rot">` +
            [0, 90, 180, 270].map((r) => `<option value="${r}"${normalizeRotation(inst.rot) === r ? ' selected' : ''}>${r}°</option>`).join('') +
          `</select>` +
        `</div>` +
        (isStretchable(rawDef)
          ? `<div class="field"><label for="field-h">Wysokość</label>` +
              `<input id="field-h" class="input" type="number" step="10" min="${rawDef.stretch.min}" max="${rawDef.stretch.max}" ` +
              `data-field="h" value="${Math.round(instanceHeight(inst, rawDef))}">` +
            `</div>`
          : '') +
      `</div>` +
      `<div class="insp-section">` +
        `<h3>Element</h3>` +
        `<dl class="kv">` +
          `<dt>Identyfikator</dt><dd>${escapeHtml(inst.id)}</dd>` +
          `<dt>Definicja</dt><dd title="${escapeHtml(inst.type)}">${escapeHtml(inst.type)}</dd>` +
          `<dt>Porty</dt><dd>${portCount}</dd>` +
          `<dt>Rozmiar</dt><dd>${def.width} × ${def.height}</dd>` +
        `</dl>` +
        (custom ? `<div class="insp-actions"><button class="btn btn-ghost btn-small" data-act="edit-def"><svg class="icon"><use href="#i-pencil"/></svg>Edytuj grafikę</button></div>` : '') +
      `</div>` +
      `<div class="insp-actions">` +
        `<button class="btn btn-small" data-act="rotate"><svg class="icon"><use href="#i-rotate"/></svg>Obróć</button>` +
        `<button class="btn btn-small" data-act="duplicate"><svg class="icon"><use href="#i-copy"/></svg>Duplikuj</button>` +
        `<button class="btn btn-small btn-danger" data-act="delete"><svg class="icon"><use href="#i-trash"/></svg>Usuń</button>` +
      `</div>`
    );
  }

  function multiInspector() {
    return (
      `<div class="insp-section">` +
        `<h2 class="insp-title">Zaznaczono ${store.selection.instances.length} elementów</h2>` +
        `<p class="insp-sub">${escapeHtml(shortId())}</p>` +
      `</div>` +
      `<div class="insp-actions">` +
        `<button class="btn btn-small" data-act="rotate"><svg class="icon"><use href="#i-rotate"/></svg>Obróć</button>` +
        `<button class="btn btn-small" data-act="duplicate"><svg class="icon"><use href="#i-copy"/></svg>Duplikuj</button>` +
        `<button class="btn btn-small btn-danger" data-act="delete"><svg class="icon"><use href="#i-trash"/></svg>Usuń</button>` +
      `</div>`
    );
  }

  function connectionInspector(id) {
    const conn = store.doc.connections.find((c) => c.id === id);
    if (!conn) return emptyInspector();
    return (
      `<div class="insp-section">` +
        `<div class="sel-type"><span class="legend-chip" style="color:${PORT_TYPES[conn.medium]?.color || '#64748b'}"></span>Połączenie</div>` +
        `<h2 class="insp-title" style="margin-top:8px">${escapeHtml(conn.from)} → ${escapeHtml(conn.to)}</h2>` +
        `<p class="insp-sub">Przeciągnij porty, aby zmienić trasę. Zmień medium lub dodaj opis.</p>` +
      `</div>` +
      `<div class="insp-section">` +
        `<h3>Właściwości</h3>` +
        `<div class="field"><label for="conn-medium">Medium</label>` +
          `<select id="conn-medium" class="select" data-field="medium">` +
            Object.entries(PORT_TYPES).map(([key, value]) =>
              `<option value="${key}"${conn.medium === key ? ' selected' : ''}>${escapeHtml(value.label)}</option>`
            ).join('') +
          `</select>` +
        `</div>` +
        `<div class="field"><label for="conn-label">Opis</label><input id="conn-label" class="input" data-field="label" value="${escapeHtml(conn.label || '')}" placeholder="np. zasilanie A"></div>` +
        `<div class="field"><label>Od</label><input class="input input-mono" readonly value="${escapeHtml(conn.from)}"></div>` +
        `<div class="field"><label>Do</label><input class="input input-mono" readonly value="${escapeHtml(conn.to)}"></div>` +
      `</div>` +
      `<div class="insp-actions">` +
        `<button class="btn btn-small btn-danger" data-act="delete"><svg class="icon"><use href="#i-trash"/></svg>Usuń połączenie</button>` +
      `</div>`
    );
  }

  function emptyInspector() {
    const counts = store.counts();
    const usedCategories = CATEGORIES.filter((c) => counts.categories[c.id]);
    return (
      `<div class="insp-section">` +
        `<h2 class="insp-title">Właściwości</h2>` +
        `<p class="insp-sub">Zaznacz element lub połączenie, aby je edytować. Przeciągnij z portu na port, aby połączyć.</p>` +
        `<dl class="kv">` +
          `<dt>Elementy</dt><dd>${counts.instances}</dd>` +
          `<dt>Połączenia</dt><dd>${counts.connections}</dd>` +
          `<dt>Definicje</dt><dd>${counts.definitions}</dd>` +
        `</dl>` +
      `</div>` +
      (usedCategories.length
        ? `<div class="insp-section"><h3>Kategorie</h3><div class="legend">` +
          usedCategories.map((c) =>
            `<div class="legend-row"><span class="legend-chip" style="color:${c.color}"></span>${escapeHtml(c.label)}<span style="margin-left:auto">${counts.categories[c.id]}</span></div>`
          ).join('') +
          `</div></div>`
        : '') +
      `<div class="insp-section"><h3>Legenda mediów</h3><div class="legend">` +
        ['pneumatic', 'electric', 'hydraulic', 'signal', 'mechanical'].map((key) => {
          const t = PORT_TYPES[key];
          return `<div class="legend-row"><span class="legend-line" style="color:${t.color}"></span>${t.label}</div>`;
        }).join('') +
      `</div></div>` +
      `<div class="insp-section"><h3>Skróty</h3><div class="shortcuts">` +
        `<kbd>R</kbd><span>Obróć zaznaczenie</span>` +
        `<kbd>Ctrl D</kbd><span>Duplikuj</span>` +
        `<kbd>Del</kbd><span>Usuń zaznaczenie</span>` +
        `<kbd>Ctrl Z</kbd><span>Cofnij</span>` +
        `<kbd>Ctrl S</kbd><span>Zapisz JSON</span>` +
        `<kbd>Spacja</kbd><span>Przesuń widok</span>` +
        `<kbd>V</kbd><span>Narzędzie: zaznaczanie</span>` +
        `<kbd>H</kbd><span>Narzędzie: przesuwanie</span>` +
        `<kbd>0</kbd><span>Dopasuj widok</span>` +
      `</div></div>`
    );
  }

  /* ---------------- akcje inspektora ---------------- */
  /* Podgląd na żywo: blok funkcjonalny rośnie razem z wpisywanym tekstem. */
  inspector?.addEventListener('input', (event) => {
    if (event.target.dataset.field !== 'label') return;
    if (store.selection.instances.length !== 1) return;
    const inst = store.instanceById(store.selection.instances[0]);
    if (!inst) return;
    store.beginTransaction();
    inst.label = event.target.value;
    store.emit('doc-live');
  });

  inspector?.addEventListener('change', (event) => {
    const field = event.target.dataset.field;
    if (!field) return;
    if (store.selection.connections.length === 1) {
      const id = store.selection.connections[0];
      const value = event.target.value;
      store.change('Zmieniono połączenie', (doc) => {
        const conn = doc.connections.find((c) => c.id === id);
        if (!conn) return;
        if (field === 'medium') conn.medium = value;
        if (field === 'label') conn.label = value;
      });
      return;
    }
    const id = store.selection.instances[0];
    if (!id) return;
    const inst = store.instanceById(id);
    if (!inst) return;
    const value = event.target.value;
    store.change('Zmieniono właściwości', () => {
      if (field === 'label') inst.label = value;
      if (field === 'x') inst.x = num(value, inst.x);
      if (field === 'y') inst.y = num(value, inst.y);
      if (field === 'rot') inst.rot = normalizeRotation(value);
      if (field === 'h') {
        const rawDef = store.doc.definitions[inst.type];
        if (isStretchable(rawDef)) {
          inst.h = Math.min(rawDef.stretch.max,
            Math.max(rawDef.stretch.min, num(value, instanceHeight(inst, rawDef))));
        }
      }
    });
  });

  inspector?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'edit-def') {
      const id = store.selection.instances[0];
      const inst = store.instanceById(id);
      if (inst) actions.editDefinition(inst.type);
      return;
    }
    if (act === 'delete') {
      actions.deleteSelection();
      return;
    }
    if (act === 'rotate') {
      actions.rotateSelection();
      return;
    }
    if (act === 'duplicate') {
      actions.duplicateSelection();
    }
  });

  /* ---------------- toolbar / header ---------------- */
  const bind = (id, fn) => $(id)?.addEventListener('click', fn);
  bind('btn-undo', () => store.undo());
  bind('btn-redo', () => store.redo());
  bind('btn-new', () => actions.newDoc());
  bind('btn-open', () => actions.openDialog());
  bind('btn-save', () => actions.saveJson());
  bind('btn-export', () => actions.exportSvg());
  bind('btn-theme', () => {
    const next = store.settings.theme === 'dark' ? 'light' : 'dark';
    store.setTheme(next);
  });
  bind('btn-new-component', () => actions.newComponent());
  bind('btn-load-demo', () => actions.loadDemo());
  bind('btn-zoom-in', () => store.zoomBy(1.2));
  bind('btn-zoom-out', () => store.zoomBy(1 / 1.2));
  bind('btn-fit', () => store.fitView());
  bind('btn-zoom-fit', () => store.fitView());
  bind('btn-grid', () => store.toggleSetting('grid'));
  bind('btn-snap', () => store.toggleSetting('snap'));
  bind('btn-ports', () => store.toggleSetting('showPorts'));
  bind('btn-tool-select', () => store.setTool('select'));
  bind('btn-tool-pan', () => store.setTool('pan'));

  const fileInput = $('file-open');
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) actions.openFile(file);
    fileInput.value = '';
  });

  const titleInput = $('doc-title');
  titleInput?.addEventListener('input', () => {
    store.doc.meta.title = titleInput.value;
    store.markModified();
    store.scheduleAutosave();
  });

  /* ---------------- stan paska ---------------- */
  function renderToolbarState() {
    const undoBtn = $('btn-undo');
    const redoBtn = $('btn-redo');
    if (undoBtn) undoBtn.disabled = store.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = store.redoStack.length === 0;
    const zoom = $('btn-zoom-fit');
    if (zoom) zoom.textContent = `${Math.round(store.camera.k * 100)}%`;
    $('btn-grid')?.classList.toggle('is-active', store.settings.grid);
    $('btn-snap')?.classList.toggle('is-active', store.settings.snap);
    $('btn-ports')?.classList.toggle('is-active', store.settings.showPorts);
    const tool = store.settings.tool === 'pan' ? 'pan' : 'select';
    $('btn-tool-select')?.classList.toggle('is-active', tool === 'select');
    $('btn-tool-pan')?.classList.toggle('is-active', tool === 'pan');
    const themeBtn = $('btn-theme');
    if (themeBtn) {
      themeBtn.innerHTML = `<svg class="icon"><use href="#${store.settings.theme === 'dark' ? 'i-sun' : 'i-moon'}"/></svg>`;
    }
    const title = $('doc-title');
    if (title && document.activeElement !== title && title.value !== store.doc.meta.title) {
      title.value = store.doc.meta.title;
    }
    const cat = $('btn-new');
    if (cat) cat.title = 'Nowy schemat';
  }

  /* ---------------- skróty ---------------- */
  document.addEventListener('keydown', (event) => {
    if (document.getElementById('modal-root')?.children.length) return;
    if (isEditableTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === 's') { event.preventDefault(); actions.saveJson(); return; }
    if (mod && key === 'o') { event.preventDefault(); actions.openDialog(); return; }
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) store.redo(); else store.undo();
      return;
    }
    if (mod && key === 'y') { event.preventDefault(); store.redo(); return; }
    if (mod && key === 'd') { event.preventDefault(); actions.duplicateSelection(); return; }
    if (mod && key === 'a') { event.preventDefault(); store.selectAll(); return; }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      actions.deleteSelection();
      return;
    }
    if (key === 'escape') {
      store.transient = {};
      store.clearSelection();
      store.emit('transient');
      return;
    }
    if (key === 'r' && !mod) {
      actions.rotateSelection();
      return;
    }
    if (!mod && key === 'v') { store.setTool('select'); return; }
    if (!mod && key === 'h') { store.setTool('pan'); return; }
    if (key === '0') {
      store.fitView();
      return;
    }
    if (key === '+' || key === '=') { store.zoomBy(1.2); return; }
    if (key === '-') { store.zoomBy(1 / 1.2); return; }
    if (event.key.startsWith('Arrow') && store.selection.instances.length) {
      event.preventDefault();
      const step = event.shiftKey ? 1 : 10;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      store.change('Przesunięto zaznaczenie', () => {
        for (const id of store.selection.instances) {
          const inst = store.instanceById(id);
          if (inst) { inst.x += dx; inst.y += dy; }
        }
      });
    }
  });

  /* ---------------- reakcje na stan ---------------- */
  store.on((reason) => {
    if (reason === 'library') renderLibrary();
    if (reason === 'selection' || reason === 'doc' || reason === 'saved') {
      if (reason !== 'saved') renderInspector();
      renderToolbarState();
    }
    if (reason === 'camera' || reason === 'settings') {
      renderToolbarState();
    }
    if (reason === 'focus-label') {
      renderInspector();
      const input = document.getElementById('field-label');
      if (input) {
        input.focus();
        input.select();
      }
    }
  });

  renderLibrary();
  renderInspector();
  renderToolbarState();

  return {
    renderLibrary,
    renderInspector,
    renderToolbarState
  };
}
