import { useRef, useSyncExternalStore } from 'react';
import type { Block, Doc, Page, Settings, Workspace } from './types';
import { createSeed } from './seed';
import { DOC_VERSION } from './migrate';
import { normalizeDoc } from './normalize';
import {
  BACKUP_KEY, DOC_KEY, INSTALLED_KEY, REPAIRED_KEY, newRev, parseStoredDoc, preserveCorrupt, readRecent, readRev,
  serializeDoc, writeBackup, writeRecent,
} from './persist';
import { getSaveState, setSaveState } from './saveState';
import { describeStorageFailure, storageAvailable, storageGet, storageGetJson, storageRemove, storageSet, type StorageFailure } from '../lib/storage';
import { recordError } from '../lib/diagnostics';
import { own } from '../lib/own';
import { collectInlineImages, mapDocImages, storeInlineImages } from '../lib/images';

export { DOC_KEY } from './persist';
const SETTINGS_KEY = 'on:settings:v1';
const CHANNEL = 'opennotion:doc';
/** Debounce between the last edit and the write. */
const SAVE_DELAY_MS = 300;
/** Edits with the same history key within this window form one undo step. */
const COALESCE_MS = 1500;
const UNDO_LIMIT = 300;

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
/* Persistence state                                                   */
/* ------------------------------------------------------------------ */

/**
 * normal: reads and writes. readonly: another tab saved newer data, or the data comes from
 * a newer build; nothing is written. recovery: stored data could not be read; it is left
 * untouched until the user picks a way out on the recovery screen.
 */
type Mode = 'normal' | 'readonly' | 'recovery';
let mode: Mode = 'normal';

/**
 * What this tab believes is in storage. After our first write it is the revision we wrote.
 * Before that it is the exact string we loaded (null when nothing was stored), because data
 * written by older builds has no revision.
 */
type Baseline = { rev: string } | { raw: string | null };
let baseline: Baseline = { raw: null };

/** Something in memory is not in storage yet (user edits or the image migration). */
let dirty = false;
/** The user made edits that are not in storage yet. Only these block a reload or prompt on unload. */
let userDirty = false;
let firstRunWrite = false;

export interface RecoveryInfo {
  /** Why the stored data could not be read (no note content). */
  reason: string;
  /** Key holding a verbatim copy of the unreadable data, or null when it could not be copied. */
  preservedKey: string | null;
  rawChars: number;
}
let recovery: RecoveryInfo | null = null;

function matchesBaseline(stored: string | null): boolean {
  if ('rev' in baseline) return stored !== null && readRev(stored) === baseline.rev;
  return stored === baseline.raw;
}

function baselineFor(raw: string): Baseline {
  const rev = readRev(raw);
  return rev ? { rev } : { raw };
}

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

/** Attaches the visit history, which lives under its own key (migrated from the doc copy). */
function withRecent(d: Doc, persistMigration: boolean): Doc {
  const stored = readRecent(d.pages);
  if (stored) return { ...d, recent: stored };
  if (persistMigration && d.recent.length) writeRecent(d.recent);
  return d;
}

function enterRecovery(raw: string, err: unknown) {
  mode = 'recovery';
  baseline = { raw };
  const name = err instanceof Error ? err.name : 'Error';
  recovery = { reason: name === 'SyntaxError' ? 'The saved data is not valid JSON.' : name === 'NotADocError' ? 'The saved data is not a workspace.' : 'The saved data could not be read.', preservedKey: preserveCorrupt(raw), rawChars: raw.length };
  setSaveState({ status: 'readonly', readonlyReason: 'recovery' });
  recordError('load', `${name}: stored workspace unreadable (${raw.length} characters kept)`);
}

function boot(): Doc {
  if (!storageAvailable()) {
    setSaveState({ status: 'failed', failure: 'blocked' });
    recordError('storage', 'Site storage is blocked; nothing can be saved');
    return createSeed();
  }
  if (storageGet(INSTALLED_KEY) === null) storageSet(INSTALLED_KEY, String(Date.now()));
  const raw = storageGet(DOC_KEY);
  if (raw === null) {
    // First launch: the seed is written once so its ids stay stable for history and tabs.
    firstRunWrite = true;
    dirty = true;
    return withRecent(createSeed(), true);
  }
  try {
    const res = parseStoredDoc(raw);
    baseline = baselineFor(raw);
    if (res.future) {
      mode = 'readonly';
      setSaveState({ status: 'readonly', readonlyReason: 'newer-version' });
      recordError('load', `Workspace saved by a newer version (${res.from}); opened read only`);
      return withRecent(res.doc, false);
    }
    if (res.report.changes) {
      storageSet(REPAIRED_KEY, raw);
      recordError('load', `Repaired the stored workspace (${res.report.changes} fixes): ${res.report.notes.slice(0, 6).join('; ')}`);
    }
    setSaveState({ docChars: raw.length });
    return withRecent(res.doc, true);
  } catch (err) {
    enterRecovery(raw, err);
    return createSeed();
  }
}

function loadSettings(): Settings {
  const def: Settings = { theme: 'system', sidebarWidth: 300, sidebarOpen: true, startPage: 'last' };
  const raw = storageGetJson<unknown>(SETTINGS_KEY, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const r = raw as Partial<Settings>;
  // Unknown keys pass through so settings added elsewhere survive a load and the next save.
  const rest: Record<string, unknown> = {};
  for (const k of Object.keys(r)) if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') rest[k] = (r as Record<string, unknown>)[k];
  return {
    ...(rest as Partial<Settings>),
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'system' ? r.theme : def.theme,
    sidebarWidth: typeof r.sidebarWidth === 'number' && Number.isFinite(r.sidebarWidth) ? r.sidebarWidth : def.sidebarWidth,
    sidebarOpen: typeof r.sidebarOpen === 'boolean' ? r.sidebarOpen : def.sidebarOpen,
    startPage: r.startPage === 'home' || r.startPage === 'last' ? r.startPage : def.startPage,
  };
}

let doc: Doc = boot();
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
/* Save                                                                */
/* ------------------------------------------------------------------ */

let saveTimer: number | undefined;
let channel: BroadcastChannel | null = null;
let lastRecentWritten: Doc['recent'] | null = null;
let persistAsked = false;

function post(msg: { type: 'saved'; rev: string }) {
  try {
    channel?.postMessage(msg);
  } catch {
    /* a closed channel only means no other tab hears about it */
  }
}

function persistRecent() {
  if (doc.recent === lastRecentWritten) return;
  lastRecentWritten = doc.recent;
  writeRecent(doc.recent);
}

/** Asks the browser not to evict this site's storage, once there is something worth keeping. */
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const p = navigator.storage?.persist?.();
    p?.catch(e => recordError('storage', e));
  } catch (e) {
    recordError('storage', e);
  }
}

function fail(reason: StorageFailure, error?: unknown) {
  const was = getSaveState();
  setSaveState({ status: 'failed', failure: reason });
  if (was.status !== 'failed' || was.failure !== reason) {
    showToast('Could not save: ' + describeStorageFailure(reason));
    recordError('save', error ?? reason);
  }
}

function goStale() {
  if (mode !== 'normal') return;
  mode = 'readonly';
  window.clearTimeout(saveTimer);
  setSaveState({ status: 'readonly', readonlyReason: 'other-tab' });
  recordError('sync', 'Another tab saved newer changes; this tab is now read only');
}

/** The one place the doc is written. Refuses when storage no longer holds what we last saw. */
function writeDoc(): boolean {
  window.clearTimeout(saveTimer);
  if (mode !== 'normal') return false;
  const stored = storageGet(DOC_KEY);
  if (!matchesBaseline(stored)) {
    // With no user edits pending (only a migration rewrite), take the other tab's data instead.
    if (userDirty || stored === null || !adoptStored(stored)) goStale();
    return false;
  }
  const rev = newRev();
  let json: string;
  try {
    json = serializeDoc(doc, rev);
  } catch (e) {
    fail('unknown', e);
    return false;
  }
  let res = storageSet(DOC_KEY, json);
  if (!res.ok && res.reason === 'quota' && (storageGet(BACKUP_KEY) !== null || storageGet(REPAIRED_KEY) !== null)) {
    // Safety copies must never cost the live workspace its save.
    storageRemove(BACKUP_KEY);
    storageRemove(REPAIRED_KEY);
    recordError('save', 'Storage full: removed the rolling safety copies to save the workspace');
    res = storageSet(DOC_KEY, json);
  }
  if (!res.ok) {
    fail(res.reason, res.error);
    return false;
  }
  baseline = { rev };
  dirty = false;
  userDirty = false;
  firstRunWrite = false;
  setSaveState({ status: 'saved', failure: null, lastSavedAt: Date.now(), docChars: json.length });
  post({ type: 'saved', rev });
  persistRecent();
  askPersist();
  afterSave(json);
  return true;
}

function afterSave(json: string) {
  if (json.includes('"data:image/')) afterLoad();
}

function markDirty(byUser = true) {
  dirty = true;
  if (byUser) userDirty = true;
  if (getSaveState().status !== 'failed') setSaveState({ status: 'pending' });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(writeDoc, SAVE_DELAY_MS);
}

/** Writes pending edits now. Returns true when everything in memory is in storage. */
export function flushSave(): boolean {
  if (!dirty) return true;
  return writeDoc();
}

/** Retry after a failed save (the banner's Retry button). */
export const retrySave = flushSave;

/** True while anything in memory is not in storage. */
export function isDirty() {
  return dirty;
}

/** Applies a doc read from storage (another tab's save, or the read only banner's Reload). */
function adoptStored(stored: string): boolean {
  let parsed;
  try {
    parsed = parseStoredDoc(stored);
  } catch (e) {
    recordError('sync', e);
    return false;
  }
  if (parsed.future) return false;
  doc = withRecent(parsed.doc, false);
  baseline = baselineFor(stored);
  undoStack.length = 0;
  redoStack.length = 0;
  lastKey = null;
  dirty = false;
  userDirty = false;
  window.clearTimeout(saveTimer);
  setSaveState({ status: 'saved', failure: null, readonlyReason: null, docChars: stored.length });
  if (ui.route.name === 'page' && !own(doc.pages, ui.route.pageId)) {
    ui = { ...ui, route: { name: 'home' }, selectedBlocks: [], peekRowId: null };
    try {
      location.replace('#/home');
    } catch {
      /* not fatal */
    }
  }
  emit();
  afterLoad();
  return true;
}

/** Another tab wrote (storage event or BroadcastChannel). */
function onForeignWrite() {
  if (mode !== 'normal') return;
  const stored = storageGet(DOC_KEY);
  if (matchesBaseline(stored)) return;
  if (userDirty || stored === null || !adoptStored(stored)) goStale();
}

/** The read only banner's Reload: drop this tab's unsaved edits and load what is stored. */
export function reloadFromStorage(): boolean {
  if (mode === 'recovery') return false;
  const stored = storageGet(DOC_KEY);
  if (stored === null) return false;
  const prev = mode;
  mode = 'normal';
  if (adoptStored(stored)) return true;
  mode = prev;
  return false;
}

/* ------------------------------------------------------------------ */
/* Image migration                                                     */
/* ------------------------------------------------------------------ */

let imageMigration: Promise<void> | null = null;
let inlineImagesStay = false;

/**
 * Moves inline data URL images (older builds, old backups, legacy pastes) into IndexedDB:
 * the blobs are committed first, then the doc and its undo history are rewritten to refs.
 * Without IndexedDB the images stay inline.
 */
function afterLoad() {
  if (imageMigration || inlineImagesStay || mode !== 'normal') return;
  const urls = collectInlineImages(doc);
  if (!urls.length) return;
  imageMigration = storeInlineImages(urls)
    .then(map => {
      if (map === null) {
        inlineImagesStay = true;
        recordError('images', 'Image storage is unavailable; images stay inside the workspace');
        return;
      }
      if (map.size) rewriteDocValues(d => mapDocImages(d, v => map.get(v) ?? v));
    })
    .catch(e => recordError('images', e))
    .finally(() => {
      imageMigration = null;
    });
}

/** Resolves when no image migration is running (diagnostics and tests). */
export function imageMigrationIdle(): Promise<void> {
  return imageMigration ?? Promise.resolve();
}

let started = false;
/**
 * Installs the cross tab listeners and the unload guard, and writes the first launch seed.
 * Called once from main.tsx; returns a disposer (used by tests).
 */
export function startPersistence(): () => void {
  if (started) return () => {};
  started = true;
  const onStorage = (e: StorageEvent) => {
    if (e.key === DOC_KEY || e.key === null) onForeignWrite();
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    if (mode === 'normal' && dirty) writeDoc();
    if (userDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden' && mode === 'normal' && dirty) writeDoc();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('visibilitychange', onHidden);
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => onForeignWrite();
      (channel as unknown as { unref?: () => void }).unref?.();
    }
  } catch {
    channel = null;
  }
  if (firstRunWrite && mode === 'normal') writeDoc();
  afterLoad();
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('beforeunload', onUnload);
    document.removeEventListener('visibilitychange', onHidden);
    window.clearTimeout(saveTimer);
    channel?.close();
    channel = null;
    started = false;
  };
}

/* ------------------------------------------------------------------ */
/* Read only and recovery                                              */
/* ------------------------------------------------------------------ */

export function canEdit(): boolean {
  return mode === 'normal';
}

let lastReadOnlyToast = 0;
function notifyReadOnly() {
  const now = Date.now();
  if (now - lastReadOnlyToast < 3000) return;
  lastReadOnlyToast = now;
  const why = getSaveState().readonlyReason;
  showToast(why === 'newer-version' ? 'This workspace was saved by a newer version, so it is read only here.' : 'This tab is read only. Reload it to keep editing.');
}

export function getRecoveryInfo(): RecoveryInfo | null {
  return recovery;
}

/** Leaves the recovery screen with a new workspace (an imported backup or a fresh start). */
export function leaveRecovery(next: Doc): boolean {
  if (mode !== 'recovery') return false;
  mode = 'normal';
  recovery = null;
  doc = withRecent(normalizeDoc(next), false);
  undoStack.length = 0;
  redoStack.length = 0;
  lastKey = null;
  dirty = true;
  userDirty = true;
  setSaveState({ status: 'pending', readonlyReason: null, failure: null });
  writeDoc();
  emit();
  afterLoad();
  return true;
}

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
    return { version: DOC_VERSION, pages: this.pages, blocks: this.blocks, workspace: this.workspace, recent: this.recent };
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
  if (!canEdit()) {
    notifyReadOnly();
    return;
  }
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
    const coalesce = key !== null && key === lastKey && now - lastTime < COALESCE_MS;
    if (!coalesce) {
      undoStack.push({ doc: before, focus: focusProvider() });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    redoStack.length = 0;
    lastKey = key;
    lastTime = now;
  }
  markDirty();
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
  if (!canEdit()) return notifyReadOnly();
  const e = undoStack.pop();
  if (!e) return;
  redoStack.push({ doc, focus: focusProvider() });
  // The visit history is not part of undo.
  doc = { ...e.doc, recent: doc.recent };
  lastKey = null;
  markDirty();
  emit();
  restoreFocus(e.focus);
}

export function redo() {
  if (!canEdit()) return notifyReadOnly();
  const e = redoStack.pop();
  if (!e) return;
  undoStack.push({ doc, focus: focusProvider() });
  doc = { ...e.doc, recent: doc.recent };
  lastKey = null;
  markDirty();
  emit();
  restoreFocus(e.focus);
}

/**
 * Replaces the whole workspace (import, reset, restore). A plain replace: callers pass a doc
 * that already went through the normalizer (parseWorkspaceBackup, normalizeDoc, createSeed).
 * The previous doc stays one undo step away for this session and the redo stack is cleared.
 * Callers keep a safety copy first (backupCurrentDoc). Returns false when the tab is read only.
 */
export function replaceDoc(d: Doc): boolean {
  if (!canEdit()) {
    notifyReadOnly();
    return false;
  }
  undoStack.push({ doc });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  lastKey = null;
  doc = d;
  dirty = true;
  userDirty = true;
  writeDoc();
  emit();
  afterLoad();
  return true;
}

/** Keeps the current workspace in the rolling safety slot before a destructive replace. */
export function backupCurrentDoc(reason: string) {
  return writeBackup(doc, reason);
}

/**
 * Records a page visit. The history lives under its own key and never marks the doc dirty,
 * so navigating never rewrites the workspace.
 */
export function recordVisit(id: string) {
  if (mode === 'recovery' || !own(doc.pages, id)) return;
  const latest = readRecent(doc.pages) ?? doc.recent;
  const recent = [{ id, at: Date.now() }, ...latest.filter(r => r.id !== id)].slice(0, 30);
  doc = { ...doc, recent };
  lastRecentWritten = recent;
  writeRecent(recent);
  emit();
}

/**
 * Rewrites values in the current doc and in the undo history without creating an undo step
 * (used to swap inline images for stored references). Marks the doc dirty.
 */
export function rewriteDocValues(map: (d: Doc) => Doc) {
  if (!canEdit()) return;
  const next = map(doc);
  for (const list of [undoStack, redoStack]) for (const e of list) e.doc = map(e.doc);
  if (next === doc) return;
  doc = next;
  markDirty(false);
  emit();
}

export function setUi(patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) {
  const p = typeof patch === 'function' ? patch(ui) : patch;
  ui = { ...ui, ...p };
  emit();
}

export function setSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  storageSet(SETTINGS_KEY, JSON.stringify(settings));
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
