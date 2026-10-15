import { useSyncExternalStore } from 'react';

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

function load(): TabsState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as TabsState | null;
    if (s && s.tabs?.length && s.tabs.some(t => t.id === s.active)) return s;
  } catch {
    /* ignore */
  }
  const t = { id: newId(), stack: [location.hash || '#/home'], idx: 0 };
  return { tabs: [t], active: t.id };
}

let state: TabsState = load();
const ls = new Set<() => void>();
function set(s: TabsState) {
  state = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
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
  const hash = location.hash || '#/home';
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
