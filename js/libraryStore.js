/* Biblioteka użytkownika — własnoręcznie rysowane elementy (localStorage) */
import { BUILTIN_DEFINITIONS } from './library.js';
import { normalizeDefinition } from './model.js';
import { store } from './store.js';
import { slugify } from './utils.js';

const LIB_KEY = 'schemator.library.v1';

let custom = load();

function load() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result = {};
    for (const [key, def] of Object.entries(parsed)) {
      if (!def || typeof def !== 'object' || !def.graphic) continue;
      result[key] = normalizeDefinition(key, def);
    }
    return result;
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(custom));
    return true;
  } catch {
    return false;
  }
}

export function getCustomDefinitions() {
  return custom;
}

export function getBuiltinDefinitions() {
  return BUILTIN_DEFINITIONS;
}

export function getAnyDefinition(key) {
  if (custom[key]) return { key, def: custom[key], source: 'custom' };
  if (BUILTIN_DEFINITIONS[key]) return { key, def: BUILTIN_DEFINITIONS[key], source: 'builtin' };
  return null;
}

export function cloneForDoc(key) {
  const found = getAnyDefinition(key);
  if (!found) return null;
  return { key: found.key, def: JSON.parse(JSON.stringify(found.def)), source: found.source };
}

export function saveCustomDefinition(key, definition) {
  custom[key] = definition;
  const ok = persist();
  store.emit('library');
  return ok;
}

export function deleteCustomDefinition(key) {
  if (!custom[key]) return;
  delete custom[key];
  persist();
  store.emit('library');
}

export function generateCustomKey(name, excludeKey = null) {
  const base = `MY_${slugify(name)}`;
  let key = base;
  let n = 2;
  while ((custom[key] || BUILTIN_DEFINITIONS[key]) && key !== excludeKey) {
    key = `${base}_${n++}`;
  }
  return key;
}

/** Wszystkie definicje do panelu biblioteki, pogrupowane. */
export function listLibraryDefinitions() {
  const customEntries = Object.entries(custom).map(([key, def]) => ({ key, def, source: 'custom' }));
  const builtinEntries = Object.entries(BUILTIN_DEFINITIONS).map(([key, def]) => ({ key, def, source: 'builtin' }));
  return { custom: customEntries, builtin: builtinEntries };
}
