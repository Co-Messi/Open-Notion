import { useSyncExternalStore } from 'react';
import { isSafeId } from '../lib/own';
import { storageGetJson, storageSet } from '../lib/storage';
import { parseHash } from './route';

/** App-level tabs, like the desktop app's tab strip. Each tab keeps its own back/forward stack. */
export interface Tab {
  id: string;
  stack: string[];
  idx: number;
}
interface TabsState {
  tabs: Tab[];
  active: string;
}

const KEY = 'on:tabs:v1';
const newId = () => Math.random().toString(36).slice(2, 9);

/** Only hashes the router understands are kept; anything else becomes Home. */
function cleanHash(h: unknown): string {
  if (typeof h !== 'string' || h.length > 300) return '#/home';
  const r = parseHash(h);
  if (r.name === 'page') return h.startsWith('#/p/') ? h : '#/home';
  return r.name === 'home' ? '#/home' : '#/' + r.name;
}

/** Validates persisted tabs; malformed entries are dropped instead of crashing the tab strip. */
export function sanitizeTabs(raw: unknown): TabsState | null {
  const s = raw as Partial<TabsState> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.tabs)) return null;
  const tabs: Tab[] = [];
  for (const t of s.tabs.slice(0, 50)) {
    if (!t || typeof t !== 'object' || !isSafeId(t.id) || !Array.isArray(t.stack) || !t.stack.length) continue;
    const stack = t.stack.slice(-50).map(cleanHash);
    const idx = Number.isInteger(t.idx) ? Math.max(0, Math.min(t.idx, stack.length - 1)) : stack.length - 1;
    if (!tabs.some(x => x.id === t.id)) tabs.push({ id: t.id, stack, idx });
  }
  if (!tabs.length) return null;
  const active = tabs.some(t => t.id === s.active) ? (s.active as string) : tabs[0].id;
  return { tabs, active };
}

function load(): TabsState {
  const s = sanitizeTabs(storageGetJson<unknown>(KEY, null));
  if (s) return s;
  const t = { id: newId(), stack: [cleanHash(location.hash || '#/home')], idx: 0 };
  return { tabs: [t], active: t.id };
}

let state: TabsState = load();
const ls = new Set<() => void>();
function set(s: TabsState) {
  state = s;
  storageSet(KEY, JSON.stringify(state));
  ls.forEach(l => l());
}
export const getTabs = () => state;
export function useTabs() {
  return useSyncExternalStore(
    l => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => state,
  );
}

export const currentHash = (t: Tab) => t.stack[t.idx] || '#/home';
const activeTab = () => state.tabs.find(t => t.id === state.active)!;

/** Programmatic hash changes we cause ourselves should not be pushed onto the stack. */
let navigatingInternally = false;
function go(hash: string) {
  if (location.hash === hash) return;
  navigatingInternally = true;
  location.hash = hash;
}

/** Called on every hashchange. */
export function onHashChange() {
  const hash = cleanHash(location.hash || '#/home');
  const t = activeTab();
  if (navigatingInternally) {
    navigatingInternally = false;
    return;
  }
  if (currentHash(t) === hash) return;
  const stack = [...t.stack.slice(0, t.idx + 1), hash].slice(-50);
  set({ ...state, tabs: state.tabs.map(x => (x.id === t.id ? { ...x, stack, idx: stack.length - 1 } : x)) });
}

export function switchTab(id: string) {
  const t = state.tabs.find(x => x.id === id);
  if (!t) return;
  set({ ...state, active: id });
  go(currentHash(t));
}

export function newTab(hash = '#/home') {
  const t: Tab = { id: newId(), stack: [hash], idx: 0 };
  const i = state.tabs.findIndex(x => x.id === state.active);
  const tabs = [...state.tabs];
  tabs.splice(i + 1, 0, t);
  set({ tabs, active: t.id });
  go(hash);
}

export function closeTab(id: string) {
  if (state.tabs.length === 1) {
    // Closing the last tab resets it to Home, like the desktop app.
    const t = { id: newId(), stack: ['#/home'], idx: 0 };
    set({ tabs: [t], active: t.id });
    go('#/home');
    return;
  }
  const i = state.tabs.findIndex(x => x.id === id);
  const tabs = state.tabs.filter(x => x.id !== id);
  let active = state.active;
  if (active === id) active = (tabs[i] || tabs[i - 1]).id;
  set({ tabs, active });
  go(currentHash(tabs.find(x => x.id === active)!));
}

export function moveTab(id: string, to: number) {
  const tabs = state.tabs.filter(x => x.id !== id);
  const t = state.tabs.find(x => x.id === id)!;
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t);
  set({ ...state, tabs });
}

export function canBack() {
  return activeTab().idx > 0;
}
export function canForward() {
  const t = activeTab();
  return t.idx < t.stack.length - 1;
}
export function back() {
  const t = activeTab();
  if (t.idx === 0) return;
  set({ ...state, tabs: state.tabs.map(x => (x.id === t.id ? { ...x, idx: x.idx - 1 } : x)) });
  go(t.stack[t.idx - 1]);
}
export function forward() {
  const t = activeTab();
  if (t.idx >= t.stack.length - 1) return;
  set({ ...state, tabs: state.tabs.map(x => (x.id === t.id ? { ...x, idx: x.idx + 1 } : x)) });
  go(t.stack[t.idx + 1]);
}

/** Opens a page in a new in-app tab. */
export function openInNewTab(pageId: string) {
  newTab(`#/p/${pageId}`);
}
