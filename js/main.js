/* Punkt wejścia aplikacji */
import { store } from './store.js';
import { emptyDoc, normalizeDoc, nextInstanceId, snapValue, GRID, docForSerialization, pruneUnusedDefinitions } from './model.js';
import { createDemoDoc } from './library.js';
import { cloneForDoc, deleteCustomDefinition, getAnyDefinition } from './libraryStore.js';
import { renderCanvas, updateGrid, buildExportSvg } from './render.js';
import { initCanvas } from './canvas.js';
import { initUI } from './panels.js';
import { openComponentEditor } from './editor.js';
import { toast, setSaveStatus, formatTime } from './ui.js';
import { downloadFile, slugify, deepClone } from './utils.js';

const svg = document.getElementById('canvas');
const gridLayer = document.getElementById('grid-layer');
const canvasArea = document.getElementById('canvas-area');
const statusCoords = document.getElementById('status-coords');
const dropHint = document.getElementById('drop-hint');

/* ---------------- start dokumentu ---------------- */
/**
 * Czy zapisany dokument to pozostawiony przez starszą wersję przykład startowy?
 * Takiego dokumentu nie przywracamy — aplikacja ma startować z czystym płótnem.
 */
function isLeftoverDemo(doc) {
  const demo = normalizeDoc(createDemoDoc()).doc;
  if (doc.meta.title !== demo.meta.title) return false;
  const sameContent =
    JSON.stringify(doc.instances) === JSON.stringify(demo.instances) &&
    JSON.stringify(doc.connections) === JSON.stringify(demo.connections);
  if (sameContent) return true;
  /* Starsze wersje przykładu: dokument nietknięty (zapisany tuż po utworzeniu). */
  const created = Date.parse(doc.meta.created);
  const modified = Date.parse(doc.meta.modified);
  return Number.isFinite(created) && Number.isFinite(modified) && Math.abs(modified - created) < 5000;
}

function boot() {
  applyTheme();
  const saved = store.loadAutosaved();
  if (saved) {
    try {
      const { doc, warnings } = normalizeDoc(saved);
      if (!isLeftoverDemo(doc)) {
        store.setDoc(doc, { resetHistory: true, emit: false });
        if (warnings.length) notifyWarnings(warnings);
        return;
      }
    } catch {
      /* uszkodzony zapis — start od czystego dokumentu */
    }
  }
  store.setDoc(emptyDoc('Nowy schemat'), { resetHistory: true, emit: false });
}

function applyTheme() {
  document.documentElement.dataset.theme = store.settings.theme === 'dark' ? 'dark' : 'light';
}

/* ---------------- akcje ---------------- */
const actions = {
  addDefinition(key, world = null) {
    const container = world || store.centerWorld();
    const found = cloneForDoc(key);
    if (!found) {
      toast('Nie znaleziono definicji elementu.', 'error');
      return;
    }
    let newId = null;
    store.change('Dodano element', (doc) => {
      const def = doc.definitions[key] || found.def;
      if (!doc.definitions[key]) doc.definitions[key] = deepClone(found.def);
      const id = nextInstanceId(doc, key);
      const x = snapValue(container.x - def.width / 2, store.settings.snap, GRID);
      const y = snapValue(container.y - def.height / 2, store.settings.snap, GRID);
      doc.instances.push({
        id,
        type: key,
        x,
        y,
        rot: 0,
        label: def.name
      });
      newId = id;
    });
    if (newId) store.selectInstances([newId]);
  },

  newComponent() {
    openComponentEditor({
      onSaved: () => {
        /* biblioteka odświeża się przez zdarzenie store */
      }
    });
  },

  editDefinition(key) {
    const found = getAnyDefinition(key);
    if (!found) return;
    if (found.source !== 'custom') {
      toast('Elementy wbudowane nie są edytowalne. Utwórz własny element w kreatorze.', 'info', 4200);
      return;
    }
    openComponentEditor({ key });
  },

  deleteDefinition(key) {
    const found = getAnyDefinition(key);
    if (!found || found.source !== 'custom') return;
    const used = store.doc.instances.some((inst) => inst.type === key);
    const message = used
      ? `Element „${found.def.name}” jest używany na schemacie. Usunąć go tylko z biblioteki? Elementy na schemacie pozostaną.`
      : `Usunąć „${found.def.name}” z mojej biblioteki?`;
    if (!window.confirm(message)) return;
    deleteCustomDefinition(key);
    toast('Usunięto element z biblioteki.', 'ok');
  },

  deleteSelection() {
    const ids = new Set(store.selection.instances);
    const connIds = new Set(store.selection.connections);
    if (!ids.size && !connIds.size) return;
    store.change('Usunięto zaznaczenie', (doc) => {
      doc.instances = doc.instances.filter((inst) => !ids.has(inst.id));
      doc.connections = doc.connections.filter((conn) => {
        if (connIds.has(conn.id)) return false;
        const fromInst = conn.from.slice(0, conn.from.lastIndexOf('.'));
        const toInst = conn.to.slice(0, conn.to.lastIndexOf('.'));
        return !ids.has(fromInst) && !ids.has(toInst);
      });
      /* Definicja nieużywanego już typu nie jest potrzebna w dokumencie. */
      pruneUnusedDefinitions(doc);
    });
    store.clearSelection();
    toast('Usunięto zaznaczone elementy.', 'ok', 1800);
  },

  duplicateSelection() {
    const ids = [...store.selection.instances];
    if (!ids.length) return;
    const newIds = [];
    store.change('Zduplikowano elementy', (doc) => {
      for (const id of ids) {
        const source = doc.instances.find((inst) => inst.id === id);
        if (!source) continue;
        const newId = nextInstanceId(doc, source.type);
        doc.instances.push({
          ...source,
          id: newId,
          x: source.x + 20,
          y: source.y + 20,
          label: source.label ? `${source.label} (kopia)` : ''
        });
        newIds.push(newId);
      }
    });
    if (newIds.length) store.selectInstances(newIds);
  },

  rotateSelection() {
    const ids = [...store.selection.instances];
    if (!ids.length) return;
    store.change('Obrócono elementy', () => {
      for (const id of ids) {
        const inst = store.instanceById(id);
        if (inst) inst.rot = ((Number(inst.rot || 0) + 90) % 360 + 360) % 360;
      }
    });
  },

  newDoc() {
    if (store.doc.instances.length || store.doc.connections.length) {
      const ok = window.confirm('Utworzyć nowy, pusty schemat? Bieżący schemat zostanie zastąpiony (możesz go najpierw zapisać).');
      if (!ok) return;
    }
    store.setDoc(emptyDoc('Nowy schemat'));
    requestAnimationFrame(() => store.fitView());
    toast('Utworzono nowy schemat.', 'ok');
  },

  openDialog() {
    document.getElementById('file-open')?.click();
  },

  openFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        const { doc, warnings } = normalizeDoc(raw);
        if (!doc.instances.length && !Object.keys(doc.definitions).length) {
          toast('Plik nie zawiera elementów schematu.', 'error');
          return;
        }
        if (store.doc.instances.length || store.doc.connections.length) {
          const ok = window.confirm('Wczytać plik i zastąpić bieżący schemat?');
          if (!ok) return;
        }
        store.setDoc(doc);
        requestAnimationFrame(() => store.fitView());
        toast('Wczytano schemat z pliku JSON.', 'ok');
        if (warnings.length) notifyWarnings(warnings);
      } catch (error) {
        console.error(error);
        toast(`Nie udało się wczytać pliku: ${error.message}`, 'error', 5000);
      }
    };
    reader.onerror = () => toast('Nie udało się odczytać pliku.', 'error');
    reader.readAsText(file);
  },

  saveJson() {
    store.markModified();
    store.scheduleAutosave();
    const filename = `${slugify(store.doc.meta.title || 'schemat').toLowerCase()}.json`;
    /* Do pliku trafiają tylko definicje elementów użytych na schemacie. */
    downloadFile(filename, JSON.stringify(docForSerialization(store.doc), null, 2), 'application/json');
    toast('Zapisano plik JSON.', 'ok', 2000);
  },

  exportSvg() {
    if (!store.doc.instances.length) {
      toast('Schemat jest pusty — nie ma czego eksportować.', 'error');
      return;
    }
    const filename = `${slugify(store.doc.meta.title || 'schemat').toLowerCase()}.svg`;
    downloadFile(filename, buildExportSvg(store.doc), 'image/svg+xml');
    toast('Wyeksportowano schemat do SVG.', 'ok', 2000);
  }
};

/* ---------------- wersja plików / odświeżanie bez cache ---------------- */
function moduleVersion() {
  const tag = document.querySelector('script[type="module"][src]');
  const src = tag?.getAttribute('src') || '';
  const query = src.includes('?') ? src.slice(src.indexOf('?') + 1) : '';
  const hash = new URLSearchParams(query).get('v') || 'dev';
  const app = document.querySelector('meta[name="app-version"]')?.content || '';
  return app ? `${app} · ${hash}` : hash;
}

function hardReload() {
  const url = new URL(window.location.href);
  url.searchParams.set('v', String(Date.now()));
  window.location.replace(url.toString());
}

function setupVersionBadge() {
  const el = document.getElementById('status-version');
  if (!el) return;
  el.textContent = `wersja ${moduleVersion()}`;
  el.addEventListener('click', hardReload);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      hardReload();
    }
  });
}

/* ---------------- render ---------------- */
function renderAll(reason) {
  applyThemeIfNeeded(reason);
  renderCanvas(svg, {
    doc: store.doc,
    camera: store.camera,
    selection: store.selection,
    settings: store.settings,
    transient: store.transient
  });
  updateGrid(gridLayer, store.camera, store.settings);
  if (reason === 'saved') updateSaveStatus();
  if (reason === 'saving') setSaveStatus('Zapisywanie…', 'saving');
  document.title = `Schemator — ${store.doc.meta.title || 'schemat'}`;
}

let themeCache = null;
function applyThemeIfNeeded(reason) {
  if (themeCache !== store.settings.theme) {
    themeCache = store.settings.theme;
    applyTheme();
  }
}

function updateSaveStatus() {
  if (store.saveError) {
    setSaveStatus('Błąd zapisu lokalnego');
  } else if (store.lastSaved) {
    setSaveStatus(`Zapisano ${formatTime(store.lastSaved)}`);
  } else {
    setSaveStatus('Zapisano lokalnie');
  }
}

function notifyWarnings(warnings) {
  if (!warnings.length) return;
  const first = warnings[0];
  const rest = warnings.length > 1 ? ` (+${warnings.length - 1} więcej)` : '';
  toast(`${first}${rest}`, 'error', 5200);
}

/* ---------------- inicjalizacja ---------------- */
boot();

const ui = initUI({ store, actions });
setupVersionBadge();

const canvasApi = initCanvas({
  store,
  svg,
  wrap: canvasArea,
  statusCoords,
  toast,
  onDropDefinition(key, world) {
    actions.addDefinition(key, world);
  },
  onOpenFile(file) {
    actions.openFile(file);
  }
});

store.on((reason) => renderAll(reason));
renderAll('doc');
updateSaveStatus();

requestAnimationFrame(() => {
  store.fitView();
});
setTimeout(() => store.fitView(), 250);

window.addEventListener('beforeunload', () => {
  try { localStorage.setItem('schemator.doc.v1', JSON.stringify(docForSerialization(store.doc))); } catch { /* ignore */ }
});

/* Globalny dostęp do podglądu w konsoli (pomocniczo) */
window.schemator = { store, actions, ui, canvasApi, renderAll, hardReload };
