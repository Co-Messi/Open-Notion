import { useRef, useSyncExternalStore } from 'react';
import type { Block, Doc, Page, Settings, Workspace } from './types';
import { createSeed } from './seed';

const DOC_KEY = 'on:doc:v2';
const SETTINGS_KEY = 'on:settings:v1';

export interface FocusHint {
  blockId: string;
  offset?: number;
}

export interface UiState {
  route: Route;
  searchOpen: boolean;
  settingsOpen: boolean;
  settingsTab: string;
  trashOpen: boolean;
  /** Blocks selected in block-selection mode (blue highlight). */
  selectedBlocks: string[];
  toast: string | null;
  peekRowId: string | null;
  sidebarHover: boolean;
}

export type Route =
  | { name: 'home' }
  | { name: 'page'; pageId: string }
  | { name: 'chat' }
  | { name: 'meetings' }
  | { name: 'library' };

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Doc;
      if (d && d.pages && d.blocks && d.workspace) return d;
    }
  } catch {
    /* fall through to seed */
  }
  return createSeed();
}

function loadSettings(): Settings {
  const def: Settings = { theme: 'system', sidebarWidth: 300, sidebarOpen: true, startPage: 'last' };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return def;
}

let doc: Doc = loadDoc();
let settings: Settings = loadSettings();
let ui: UiState = {
  route: { name: 'home' },
  searchOpen: false,
  settingsOpen: false,
  settingsTab: 'preferences',
  trashOpen: false,
  selectedBlocks: [],
  toast: null,
  peekRowId: null,
  sidebarHover: false,
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach(l => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getDoc = () => doc;
export const getUi = () => ui;
export const getSettings = () => settings;

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

let saveTimer: number | undefined;
let lastSaveError = false;
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(doc));
      lastSaveError = false;
    } catch {
      if (!lastSaveError) showToast('Could not save: browser storage is full');
      lastSaveError = true;
    }
  }, 300);
}
window.addEventListener('beforeunload', () => {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch {
    /* ignore */
  }
});

/* ------------------------------------------------------------------ */
/* Transactions + history                                              */
/* ------------------------------------------------------------------ */

const EDIT_KEYS = new Set(['title', 'icon', 'cover', 'content', 'props', 'schema', 'views', 'rows']);

export class Tx {
  pages: Record<string, Page>;
  blocks: Record<string, Block>;
  workspace: Workspace;
  recent: Doc['recent'];
  touched = new Set<string>();
  constructor(d: Doc) {
    this.pages = { ...d.pages };
    this.blocks = { ...d.blocks };
    this.workspace = d.workspace;
    this.recent = d.recent;
  }
  page(id: string): Page {
    return this.pages[id];
  }
  block(id: string): Block {
    return this.blocks[id];
  }
  setPage(id: string, patch: Partial<Page>) {
    const p = this.pages[id];
    if (!p) return;
    this.pages[id] = { ...p, ...patch };
    for (const k of Object.keys(patch)) {
      if (EDIT_KEYS.has(k)) {
        this.touched.add(id);
        break;
      }
    }
  }
  setBlock(id: string, patch: Partial<Block>) {
    const b = this.blocks[id];
    if (!b) return;
    this.blocks[id] = { ...b, ...patch };
    this.touched.add(this.pageOfBlock(id));
  }
  setWorkspace(patch: Partial<Workspace>) {
    this.workspace = { ...this.workspace, ...patch };
  }
  /** Returns the page that (transitively) owns a block. */
  pageOfBlock(id: string): string {
    let cur = this.blocks[id];
    let guard = 0;
    while (cur && guard++ < 1000) {
      if (this.pages[cur.parent]) return cur.parent;
      cur = this.blocks[cur.parent];
    }
    return '';
  }
  /** The ordered list a block lives in. */
  siblings(id: string): string[] {
    const b = this.blocks[id];
    if (!b) return [];
    if (this.pages[b.parent]) return this.pages[b.parent].content;
    return this.blocks[b.parent]?.children || [];
  }
  setSiblings(parent: string, list: string[]) {
    if (this.pages[parent]) this.setPage(parent, { content: list });
    else if (this.blocks[parent]) this.blocks[parent] = { ...this.blocks[parent], children: list };
  }
  childList(parent: string): string[] {
    if (this.pages[parent]) return this.pages[parent].content;
    return this.blocks[parent]?.children || [];
  }
  snapshot(): Doc {
    return { version: 1, pages: this.pages, blocks: this.blocks, workspace: this.workspace, recent: this.recent };
  }
}

interface HistoryEntry {
  doc: Doc;
  focus?: FocusHint | null;
}
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
let lastKey: string | null = null;
let lastTime = 0;

export type HistoryMode = 'push' | 'none' | { key: string };

let focusProvider: () => FocusHint | null = () => null;
export function setFocusProvider(fn: () => FocusHint | null) {
  focusProvider = fn;
}

export function transact(fn: (tx: Tx) => void, history: HistoryMode = 'push') {
  const before = doc;
  const tx = new Tx(doc);
  fn(tx);
  const now = Date.now();
  tx.touched.forEach(pid => {
    if (pid && tx.pages[pid]) tx.pages[pid] = { ...tx.pages[pid], updatedAt: now };
  });
  doc = tx.snapshot();
  if (history !== 'none') {
    const key = typeof history === 'object' ? history.key : null;
    const coalesce = key !== null && key === lastKey && now - lastTime < 1500;
    if (!coalesce) {
      undoStack.push({ doc: before, focus: focusProvider() });
      if (undoStack.length > 300) undoStack.shift();
    }
    redoStack.length = 0;
    lastKey = key;
    lastTime = now;
  }
  scheduleSave();
  emit();
}

/** Breaks typing coalescing so the next edit starts a new undo step. */
export function breakCoalescing() {
  lastKey = null;
}

let restoreFocus: (f: FocusHint | null | undefined) => void = () => {};
export function setRestoreFocus(fn: (f: FocusHint | null | undefined) => void) {
  restoreFocus = fn;
}

export function undo() {
  const e = undoStack.pop();
  if (!e) return;
  redoStack.push({ doc, focus: focusProvider() });
  doc = e.doc;
  lastKey = null;
  scheduleSave();
  emit();
  restoreFocus(e.focus);
}

export function redo() {
  const e = redoStack.pop();
  if (!e) return;
  undoStack.push({ doc, focus: focusProvider() });
  doc = e.doc;
  lastKey = null;
  scheduleSave();
  emit();
  restoreFocus(e.focus);
}

export function replaceDoc(d: Doc) {
  undoStack.push({ doc });
  doc = d;
  scheduleSave();
  emit();
}

export function setUi(patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) {
  const p = typeof patch === 'function' ? patch(ui) : patch;
  ui = { ...ui, ...p };
  emit();
}

export function setSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  emit();
}

let toastTimer: number | undefined;
export function showToast(msg: string) {
  window.clearTimeout(toastTimer);
  setUi({ toast: msg });
  toastTimer = window.setTimeout(() => setUi({ toast: null }), 2600);
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.is(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function useSelector<S, T>(get: () => S, sel: (s: S) => T, eq: (a: T, b: T) => boolean): T {
  // Cache by (source, selector): a new selector each render (props changed) must recompute,
  // but repeated getSnapshot calls within one render must return the same value.
  const cache = useRef<{ src: S; sel: (s: S) => T; val: T } | null>(null);
  const getSnap = () => {
    const src = get();
    const c = cache.current;
    if (c && c.src === src && c.sel === sel) return c.val;
    const val = sel(src);
    if (c && eq(c.val, val)) {
      cache.current = { src, sel, val: c.val };
      return c.val;
    }
    cache.current = { src, sel, val };
    return val;
  };
  return useSyncExternalStore(subscribe, getSnap, getSnap);
}

export function useDoc<T>(sel: (d: Doc) => T, eq: (a: T, b: T) => boolean = shallowEqual): T {
  return useSelector(getDoc, sel, eq);
}
export function useUi<T>(sel: (u: UiState) => T, eq: (a: T, b: T) => boolean = shallowEqual): T {
  return useSelector(getUi, sel, eq);
}
export function useSettings<T>(sel: (s: Settings) => T, eq: (a: T, b: T) => boolean = shallowEqual): T {
  return useSelector(getSettings, sel, eq);
}
export const usePage = (id: string | null | undefined) => useDoc(d => (id ? d.pages[id] : undefined), Object.is);
export const useBlock = (id: string) => useDoc(d => d.blocks[id], Object.is);
