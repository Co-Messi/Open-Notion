import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import fixture from '../test/fixtures/doc-v2-current.json';

/**
 * Exit and close animations: the measured Notion motion keeps a closing layer on screen for its
 * animation, so these check that it stays in the document for that time, then goes, and that
 * reduced motion skips the wait. jsdom fires no transitionend or animationend, so the timeout
 * fallbacks are what end each phase here.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DOC_KEY = 'on:doc:v2';

let root: Root | null = null;
let container: HTMLElement;

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const wait = (ms: number) => act(() => new Promise<void>(r => setTimeout(r, ms)));

/** jsdom has no matchMedia; each test states the motion preference it runs under. */
function motion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }),
  });
}

beforeEach(() => {
  localStorage.clear();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.resetModules();
});
afterEach(() => {
  // Unmount under reduced motion so no exit copy outlives this test and leaks into the next one.
  motion(true);
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.unstubAllGlobals();
  location.hash = '';
});

async function popoverHarness() {
  const { Popover } = await import('./ui');
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button id="opener" onClick={() => setOpen(true)}>
          open
        </button>
        {open && (
          <Popover anchor={{ x: 10, y: 10 }} onClose={() => setOpen(false)} label="Test menu">
            <div id="inside" tabIndex={0}>
              item
            </div>
          </Popover>
        )}
      </div>
    );
  }
  const c = render(<Harness />);
  const opener = c.querySelector('#opener') as HTMLButtonElement;
  opener.focus();
  act(() => opener.click());
  (document.querySelector('#inside') as HTMLElement).focus();
  return opener;
}

describe('popover exit animation', () => {
  it('keeps an inert copy on screen while it animates out, then removes it', async () => {
    motion(false);
    const opener = await popoverHarness();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      document.body.dispatchEvent(escape);
    });
    // The live popover is gone at once: Escape handling and focus return do not wait.
    expect(document.querySelector('.popover:not(.is-exiting)')).toBeNull();
    const copy = document.querySelector('.popover.is-exiting') as HTMLElement;
    expect(copy).not.toBeNull();
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.querySelector('[id]')).toBeNull();
    await wait(5);
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector('.popover.is-exiting')).not.toBeNull();
    await wait(300);
    expect(document.querySelector('.popover')).toBeNull();
  });

  it('closes at once under reduced motion', async () => {
    motion(true);
    const opener = await popoverHarness();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.popover')).toBeNull();
    await wait(5);
    expect(document.activeElement).toBe(opener);
  });

  it('places the transform origin at the corner nearest the anchor', async () => {
    motion(false);
    const { Popover } = await import('./ui');
    // jsdom has no layout, so give the popover a size to place.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
    const anchor = new DOMRect(400, 40, 28, 28);
    render(
      <>
        <Popover anchor={anchor} onClose={() => {}} placement="bottom-end" className="end">
          <div>end</div>
        </Popover>
        <Popover anchor={anchor} onClose={() => {}} placement="bottom-start" className="start">
          <div>start</div>
        </Popover>
      </>,
    );
    expect((document.querySelector('.popover.end') as HTMLElement).style.transformOrigin).toBe('100% 0%');
    expect((document.querySelector('.popover.start') as HTMLElement).style.transformOrigin).toBe('0% 0%');
  });
});

/** Loads the recorded workspace and renders the main view with nothing but an empty frame in it. */
async function mainView() {
  localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
  const store = await import('../store/store');
  const { MainView } = await import('../App');
  render(
    <MainView>
      <button id="row-opener">row</button>
      <div className="frame" />
    </MainView>,
  );
  const db = Object.values(store.getDoc().pages).find(p => p.isDatabase && (p.rows || []).length > 1)!;
  const main = container.querySelector('main.main') as HTMLElement;
  return { store, rows: db.rows!, main, panel: () => container.querySelector('.side-peek') as HTMLElement | null };
}

describe('side peek', () => {
  it('pushes the main view, stays mounted while it slides out, then unmounts', async () => {
    motion(false);
    const { store, rows, main, panel } = await mainView();
    act(() => store.setUi({ peekRowId: rows[0] }));
    expect(panel()?.classList.contains('open')).toBe(true);
    expect(main.style.getPropertyValue('--peek-push')).toBe('560px');

    act(() => store.setUi({ peekRowId: null }));
    expect(panel()).not.toBeNull();
    expect(panel()!.classList.contains('open')).toBe(false);
    expect(panel()!.getAttribute('aria-hidden')).toBe('true');
    expect(main.style.getPropertyValue('--peek-push')).toBe('0px');
    await wait(150);
    expect(panel()).not.toBeNull();
    await wait(150);
    expect(panel()).toBeNull();
  });

  it('unmounts on the panel transform transitionend, ignoring transitions of its children', async () => {
    motion(false);
    const { store, rows, panel } = await mainView();
    act(() => store.setUi({ peekRowId: rows[0] }));
    act(() => store.setUi({ peekRowId: null }));
    const end = (target: Element, propertyName: string) => {
      const e = new Event('transitionend', { bubbles: true });
      Object.defineProperty(e, 'propertyName', { value: propertyName });
      act(() => {
        target.dispatchEvent(e);
      });
    };
    end(panel()!.querySelector('.icon-btn')!, 'background-color');
    expect(panel()).not.toBeNull();
    end(panel()!, 'transform');
    expect(panel()).toBeNull();
  });

  it('switches rows in place and reopens without leaving the DOM', async () => {
    motion(false);
    const { store, rows, panel } = await mainView();
    act(() => store.setUi({ peekRowId: rows[0] }));
    const first = panel();
    act(() => store.setUi({ peekRowId: rows[1] }));
    expect(panel()).toBe(first);
    expect(panel()!.classList.contains('open')).toBe(true);
    act(() => store.setUi({ peekRowId: null }));
    act(() => store.setUi({ peekRowId: rows[0] }));
    expect(panel()).toBe(first);
    expect(panel()!.classList.contains('open')).toBe(true);
    await wait(300);
    expect(panel()).not.toBeNull();
  });

  it('returns focus to the opener as soon as the close starts', async () => {
    motion(false);
    const { store, rows, panel } = await mainView();
    const opener = container.querySelector('#row-opener') as HTMLButtonElement;
    opener.focus();
    act(() => store.setUi({ peekRowId: rows[0] }));
    const close = panel()!.querySelector('[aria-label="Close"]') as HTMLElement;
    act(() => close.focus());
    act(() => close.click());
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('slides out by twice its width before opening the row as a full page', async () => {
    motion(false);
    const { store, rows, panel } = await mainView();
    act(() => store.setUi({ peekRowId: rows[0] }));
    act(() => (panel()!.querySelector('[aria-label="Open as full page"]') as HTMLElement).click());
    expect(panel()!.classList.contains('expanding')).toBe(true);
    expect(location.hash).not.toBe('#/p/' + rows[0]);
    await wait(300);
    expect(location.hash).toBe('#/p/' + rows[0]);
    expect(store.getUi().peekRowId).toBeNull();
    expect(panel()).toBeNull();
  });

  it('closes and opens as a full page at once under reduced motion', async () => {
    motion(true);
    const { store, rows, panel } = await mainView();
    act(() => store.setUi({ peekRowId: rows[0] }));
    expect(panel()?.classList.contains('open')).toBe(true);
    act(() => store.setUi({ peekRowId: null }));
    expect(panel()).toBeNull();
    act(() => store.setUi({ peekRowId: rows[0] }));
    act(() => (panel()!.querySelector('[aria-label="Open as full page"]') as HTMLElement).click());
    expect(location.hash).toBe('#/p/' + rows[0]);
  });
});

describe('sidebar collapse', () => {
  async function sidebar() {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const store = await import('../store/store');
    const { Sidebar } = await import('./Sidebar');
    render(<Sidebar />);
    const box = container.querySelector('.sidebar-container') as HTMLElement;
    const nav = container.querySelector('nav.sidebar') as HTMLElement;
    return { store, box, nav };
  }

  it('animates the container width and keeps the panel docked until the width reaches 0', async () => {
    motion(false);
    const { store, box, nav } = await sidebar();
    expect(box.style.width).toBe('300px');
    act(() => store.setSettings({ sidebarOpen: false }));
    expect(box.style.width).toBe('0px');
    expect(box.classList.contains('animating')).toBe(true);
    expect(nav.classList.contains('collapsed')).toBe(false);
    await wait(300);
    expect(box.classList.contains('animating')).toBe(false);
    expect(nav.classList.contains('collapsed')).toBe(true);
    act(() => store.setSettings({ sidebarOpen: true }));
    expect(box.style.width).toBe('300px');
    expect(nav.classList.contains('collapsed')).toBe(false);
    expect(box.classList.contains('animating')).toBe(true);
  });

  it('docks the hover peek panel without animating the width', async () => {
    motion(false);
    const { store, box, nav } = await sidebar();
    act(() => store.setSettings({ sidebarOpen: false }));
    await wait(300);
    act(() => store.setUi({ sidebarHover: true }));
    expect(nav.classList.contains('peek')).toBe(true);
    act(() => {
      store.setSettings({ sidebarOpen: true });
      store.setUi({ sidebarHover: false });
    });
    expect(nav.classList.contains('collapsed')).toBe(false);
    expect(box.classList.contains('animating')).toBe(false);
    expect(box.classList.contains('resizing')).toBe(false);
  });

  it('collapses at once under reduced motion', async () => {
    motion(true);
    const { store, box, nav } = await sidebar();
    act(() => store.setSettings({ sidebarOpen: false }));
    expect(box.classList.contains('animating')).toBe(false);
    expect(nav.classList.contains('collapsed')).toBe(true);
  });
});
