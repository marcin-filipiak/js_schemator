/* Stan aplikacji: dokument, historia, zaznaczenie, kamera, ustawienia */
import { emptyDoc, docBounds, docForSerialization } from './model.js';
import { deepClone, clamp, num } from './utils.js';

const DOC_KEY = 'schemator.doc.v1';
const SETTINGS_KEY = 'schemator.settings.v1';

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

class Store {
  constructor() {
    this.doc = emptyDoc();
    this.camera = { x: 0, y: 0, k: 1 };
    this.viewport = { w: 900, h: 600 };
    this.selection = { instances: [], connections: [] };
    this.transient = {};
    this.settings = { grid: true, snap: true, showPorts: true, theme: 'light' };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.transactionSnapshot = null;
    this.saveTimer = 0;
    this.lastSaved = null;
    this.saveError = null;
    this.loadSettings();
  }

  /* ---------- zdarzenia ---------- */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason = 'change') {
    for (const fn of this.listeners) {
      try { fn(reason); } catch (error) { console.error(error); }
    }
  }

  /* ---------- dokument ---------- */
  setDoc(doc, { resetHistory = true, emit = true } = {}) {
    this.doc = doc;
    this.selection = { instances: [], connections: [] };
    this.transient = {};
    if (resetHistory) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.scheduleAutosave();
    if (emit) this.emit('doc');
  }

  beginTransaction() {
    if (this.transactionSnapshot) return;
    this.transactionSnapshot = deepClone(this.doc);
  }

  commitTransaction(label = 'Zmiana') {
    if (!this.transactionSnapshot) return;
    const before = this.transactionSnapshot;
    this.transactionSnapshot = null;
    const changed = JSON.stringify(before) !== JSON.stringify(this.doc);
    if (!changed) return;
    this.undoStack.push({ doc: before, label });
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.markModified();
    this.scheduleAutosave();
    this.emit('doc');
  }

  cancelTransaction() {
    this.transactionSnapshot = null;
  }

  /** Wygodna zmiana dokumentu z wpisem do historii. */
  change(label, mutator) {
    this.beginTransaction();
    mutator(this.doc);
    this.commitTransaction(label);
  }

  markModified() {
    this.doc.meta.modified = new Date().toISOString();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ doc: deepClone(this.doc), label: entry.label });
    this.doc = entry.doc;
    this.selection = { instances: [], connections: [] };
    this.transient = {};
    this.markModified();
    this.scheduleAutosave();
    this.emit('doc');
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ doc: deepClone(this.doc), label: entry.label });
    this.doc = entry.doc;
    this.selection = { instances: [], connections: [] };
    this.transient = {};
    this.markModified();
    this.scheduleAutosave();
    this.emit('doc');
  }

  scheduleAutosave() {
    clearTimeout(this.saveTimer);
    this.emit('saving');
    this.saveTimer = setTimeout(() => {
      try {
        const payload = JSON.stringify(docForSerialization(this.doc));
        if (!writeStorage(DOC_KEY, payload)) throw new Error('Brak miejsca w localStorage');
        this.lastSaved = new Date();
        this.saveError = null;
        this.emit('saved');
      } catch (error) {
        this.saveError = error;
        this.emit('saved');
      }
    }, 400);
  }

  loadAutosaved() {
    const raw = readStorage(DOC_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /* ---------- zaznaczenie ---------- */
  selectInstances(ids, { additive = false } = {}) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!additive) {
      this.selection = { instances: unique, connections: [] };
    } else {
      const merged = new Set([...this.selection.instances, ...unique]);
      this.selection = { instances: [...merged], connections: this.selection.connections };
    }
    this.emit('selection');
  }

  toggleInstance(id) {
    const set = new Set(this.selection.instances);
    if (set.has(id)) set.delete(id); else set.add(id);
    this.selection = { instances: [...set], connections: this.selection.connections };
    this.emit('selection');
  }

  selectConnection(id, { additive = false } = {}) {
    if (!additive) {
      this.selection = { instances: [], connections: [id] };
    } else {
      const set = new Set([...this.selection.connections, id]);
      this.selection = { instances: this.selection.instances, connections: [...set] };
    }
    this.emit('selection');
  }

  clearSelection() {
    if (!this.selection.instances.length && !this.selection.connections.length) return;
    this.selection = { instances: [], connections: [] };
    this.emit('selection');
  }

  selectAll() {
    this.selection = {
      instances: this.doc.instances.map((i) => i.id),
      connections: this.doc.connections.map((c) => c.id)
    };
    this.emit('selection');
  }

  /* ---------- ustawienia ---------- */
  loadSettings() {
    const raw = readStorage(SETTINGS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      this.settings = { ...this.settings, ...parsed };
    } catch { /* ignore */ }
  }

  saveSettings() {
    writeStorage(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  toggleSetting(key) {
    if (!(key in this.settings) || key === 'theme') return;
    this.settings[key] = !this.settings[key];
    this.saveSettings();
    this.emit('settings');
  }

  setTheme(theme) {
    this.settings.theme = theme;
    this.saveSettings();
    this.emit('settings');
  }

  /* ---------- kamera ---------- */
  setViewport(w, h) {
    this.viewport = { w: Math.max(1, w), h: Math.max(1, h) };
  }

  centerWorld() {
    return {
      x: (this.viewport.w / 2 - this.camera.x) / this.camera.k,
      y: (this.viewport.h / 2 - this.camera.y) / this.camera.k
    };
  }

  zoomAt(screenX, screenY, factor) {
    const k = clamp(this.camera.k * factor, 0.12, 5);
    if (Math.abs(k - this.camera.k) < 0.0001) return;
    const wx = (screenX - this.camera.x) / this.camera.k;
    const wy = (screenY - this.camera.y) / this.camera.k;
    this.camera = { k, x: screenX - wx * k, y: screenY - wy * k };
    this.emit('camera');
  }

  zoomBy(factor) {
    this.zoomAt(this.viewport.w / 2, this.viewport.h / 2, factor);
  }

  fitView(padding = 80) {
    const b = docBounds(this.doc);
    const availW = Math.max(100, this.viewport.w - padding * 2);
    const availH = Math.max(100, this.viewport.h - padding * 2);
    const k = clamp(Math.min(availW / b.w, availH / b.h), 0.12, 2.5);
    this.camera = {
      k,
      x: this.viewport.w / 2 - (b.x + b.w / 2) * k,
      y: this.viewport.h / 2 - (b.y + b.h / 2) * k
    };
    this.emit('camera');
  }

  /* ---------- pomocnicze ---------- */
  instanceById(id) {
    return this.doc.instances.find((i) => i.id === id) || null;
  }

  definitionFor(instance) {
    return instance ? this.doc.definitions[instance.type] || null : null;
  }

  isSelected(id) {
    return this.selection.instances.includes(id);
  }

  counts() {
    const categories = {};
    for (const def of Object.values(this.doc.definitions)) {
      categories[def.category] = (categories[def.category] || 0) + 1;
    }
    return {
      definitions: Object.keys(this.doc.definitions).length,
      instances: this.doc.instances.length,
      connections: this.doc.connections.length,
      categories
    };
  }
}

export const store = new Store();
export { DOC_KEY, SETTINGS_KEY };
