import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { hostileDocJson } from '../test/hostile';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const disposers: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (window as unknown as { __pwned?: number }).__pwned = undefined;
  if (!('ResizeObserver' in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  vi.resetModules();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  while (disposers.length) disposers.pop()!();
});

/** Every element and attribute in the rendered DOM, including inside table cells and comments. */
function handlers(el: Element): string[] {
  const out: string[] = [];
  for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
    for (const a of Array.from(node.attributes)) if (/^on/i.test(a.name)) out.push(`${node.tagName.toLowerCase()}[${a.name}]`);
    if (/^(SCRIPT|IFRAME|OBJECT|EMBED)$/.test(node.tagName)) out.push(node.tagName);
  }
  return out;
}

describe('rendering a hostile stored workspace', () => {
  it('produces no element with an event handler attribute', async () => {
    // Stored as is: the load path is what must make it safe.
    localStorage.setItem('on:doc:v2', hostileDocJson());
    const store = await import('../store/store');
    disposers.push(store.startPersistence());
    const { PageView } = await import('./PageView');
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    for (const id of ['pg', 'sub', 'db', 'r1']) {
      await act(async () => root!.render(<PageView pageId={id} />));
      expect(container.innerHTML.length, id).toBeGreaterThan(0);
      expect(handlers(container), id).toEqual([]);
    }
    // Table cells and comments were rendered from stored html.
    await act(async () => root!.render(<PageView pageId="pg" />));
    expect(container.querySelectorAll('.simple-table td').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.comment').length).toBeGreaterThan(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
