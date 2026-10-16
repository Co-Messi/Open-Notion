import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { Menu, Popover, pressable, useDialog } from './ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement;

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

/** Layer cleanup and focus return run on a zero delay timer. */
const settle = () => act(() => new Promise<void>(r => setTimeout(r, 5)));

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
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('pressable', () => {
  it('makes a div focusable and activates it on Enter and Space', () => {
    const onClick = vi.fn();
    const c = render(<div id="t" {...pressable()} onClick={onClick} />);
    const el = c.querySelector('#t') as HTMLElement;
    expect(el.getAttribute('role')).toBe('button');
    expect(el.tabIndex).toBe(0);
    const enter = key(el, 'Enter');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
    key(el, ' ');
    expect(onClick).toHaveBeenCalledTimes(2);
    key(el, 'a');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('ignores keys that come from a child control and honours a custom role and handler', () => {
    const onActivate = vi.fn();
    const c = render(
      <div id="t" {...pressable(onActivate, 'checkbox')}>
        <input id="inner" />
      </div>,
    );
    expect(c.querySelector('#t')!.getAttribute('role')).toBe('checkbox');
    key(c.querySelector('#inner')!, 'Enter');
    expect(onActivate).not.toHaveBeenCalled();
    key(c.querySelector('#t')!, 'Enter');
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button id="opener" onClick={() => setOpen(true)}>
        open
      </button>
      <button id="behind">behind</button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </div>
  );
}
function Dialog({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label="Test dialog">
      <button id="first">first</button>
      <button id="last">last</button>
    </div>
  );
}

describe('modal focus handling', () => {
  it('moves focus in, traps Tab, closes on Escape and returns focus to the opener', async () => {
    const c = render(<Harness />);
    const opener = c.querySelector('#opener') as HTMLButtonElement;
    opener.focus();
    act(() => opener.click());
    expect(document.activeElement?.id).toBe('first');

    const last = c.querySelector('#last') as HTMLButtonElement;
    last.focus();
    const tab = key(last, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('first');
    const back = key(document.activeElement!, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');

    // Focus that sits behind the dialog is pulled back in.
    (c.querySelector('#behind') as HTMLElement).focus();
    key(document.body, 'Tab');
    expect(document.activeElement?.id).toBe('first');

    key(document.body, 'Escape');
    await settle();
    expect(c.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement?.id).toBe('opener');
  });
});

describe('Escape with stacked layers', () => {
  it('needs one Escape per popover and closes the topmost first', () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Popover anchor={{ x: 0, y: 0 }} onClose={closeBottom}>
          <div>bottom</div>
        </Popover>
        <Popover anchor={{ x: 10, y: 10 }} onClose={closeTop}>
          <div>top</div>
        </Popover>
      </>,
    );
    const first = key(document.body, 'Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });

  it('closes the lower layer on the next Escape once the upper one is gone', async () => {
    const closeBottom = vi.fn();
    function Stack() {
      const [top, setTop] = useState(true);
      return (
        <>
          <Popover anchor={{ x: 0, y: 0 }} onClose={closeBottom}>
            <div>bottom</div>
          </Popover>
          {top && (
            <Popover anchor={{ x: 10, y: 10 }} onClose={() => setTop(false)}>
              <div>top</div>
            </Popover>
          )}
        </>
      );
    }
    render(<Stack />);
    key(document.body, 'Escape');
    await settle();
    expect(document.body.textContent).not.toContain('top');
    expect(closeBottom).not.toHaveBeenCalled();
    key(document.body, 'Escape');
    expect(closeBottom).toHaveBeenCalledTimes(1);
  });
});

describe('menu semantics', () => {
  it('exposes menu and menuitem roles and tracks the highlighted item', () => {
    const onSelect = vi.fn();
    render(
      <Popover anchor={{ x: 0, y: 0 }} onClose={() => {}}>
        <Menu
          onClose={() => {}}
          items={[
            { id: 'a', label: 'Alpha', onSelect },
            { id: 'b', label: 'Beta', onSelect: () => {} },
            { id: 'c', label: 'Gamma', disabled: true },
          ]}
        />
      </Popover>,
    );
    const menu = document.body.querySelector('[role=menu]') as HTMLElement;
    expect(menu).toBeTruthy();
    const items = Array.from(document.body.querySelectorAll('[role=menuitem]'));
    expect(items.map(i => i.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(items[2].getAttribute('aria-disabled')).toBe('true');
    expect(menu.getAttribute('aria-activedescendant')).toBe(items[0].id);
    key(window.document.body, 'ArrowDown');
    expect(menu.getAttribute('aria-activedescendant')).toBe(items[1].id);
    key(window.document.body, 'ArrowUp');
    key(window.document.body, 'Enter');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('toast', () => {
  it('is announced through a polite status live region', async () => {
    const { Toast } = await import('../App');
    const store = await import('../store/store');
    const c = render(<Toast />);
    const live = c.querySelector('[role=status]') as HTMLElement;
    expect(live).toBeTruthy();
    expect(live.getAttribute('aria-live')).toBe('polite');
    act(() => store.showToast('Saved'));
    expect(c.querySelector('[role=status]')!.textContent).toBe('Saved');
  });
});
