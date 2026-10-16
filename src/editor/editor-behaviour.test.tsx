import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getDoc, replaceDoc } from '../store/store';
import { makeBlock, makePage } from '../store/actions';
import type { Block, BlockType, Doc, Page } from '../store/types';
import { PageView } from './PageView';
import { SlashMenu } from './SlashMenu';
import { handleBackspaceAtStart, handleEnter, tryMarkdown } from './ops';
import { setCaret, caretOffset } from './caret';
import { slashState } from './controller';
import { checkInvariants } from '../test/invariants';

/** Behaviour of the editor in a rendered page: links, table cells, CJK shortcuts, columns. */

type Spec = [id: string, type: BlockType, html?: string, kids?: Spec[], extra?: Partial<Block>];

let root: Root | null = null;
let host: HTMLDivElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout: give ranges a caret box so the slash menu can be positioned.
  Range.prototype.getClientRects = () => [new DOMRect(40, 40, 1, 18)] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(40, 40, 1, 18);
});
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  slashState.set(null);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
  location.hash = '';
});

function load(blocks: Spec[], page: Partial<Page> = {}, extraPages: Page[] = []): string {
  const p = makePage({ title: 'Page', ...page });
  const doc: Doc = {
    version: 1,
    pages: { [p.id]: p, ...Object.fromEntries(extraPages.map(x => [x.id, x])) },
    blocks: {},
    workspace: { name: 'W', icon: 'W', userName: 'Me', userEmail: 'me@example.com', privatePages: [p.id, ...extraPages.map(x => x.id)], favorites: [], teamspaces: [] },
    recent: [],
  };
  const add = (parent: string, specs: Spec[]): string[] =>
    specs.map(([id, type, html = '', kids = [], extra = {}]) => {
      doc.blocks[id] = { ...makeBlock({ parent, type, html, ...extra }), id, children: add(id, kids) };
      return id;
    });
  doc.pages[p.id] = { ...p, content: add(p.id, blocks) };
  replaceDoc(doc);
  root = createRoot(host);
  act(() =>
    root!.render(
      <>
        <PageView pageId={p.id} />
        <SlashMenu />
      </>,
    ),
  );
  return p.id;
}

const editable = (id: string) => host.querySelector(`[data-editable-id="${id}"]`) as HTMLElement;
/** Clicks and reports whether the app prevented the default; jsdom's own link navigation is then stopped. */
const click = (el: Element, init: MouseEventInit = {}) => {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  let defaultPrevented: boolean | null = null;
  const after = (e: Event) => {
    defaultPrevented = e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener('click', after);
  act(() => {
    el.dispatchEvent(ev);
  });
  document.removeEventListener('click', after);
  return { defaultPrevented };
};

/* ------------------------------------------------------------------ */
/* M4: links                                                           */
/* ------------------------------------------------------------------ */

describe('M4: inline links', () => {
  const html = 'see <a href="https://example.com/x">out</a> and <a href="#/p/abc">in</a>';

  it('a plain click in an editable block only places the caret', () => {
    load([['t', 'text', html]]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const ev = click(editable('t').querySelector('a')!);
    expect(open).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Cmd or Ctrl click opens outbound links in a new tab with noopener', () => {
    load([['t', 'text', html]]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const ev = click(editable('t').querySelector('a')!, { metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
    click(editable('t').querySelector('a')!, { ctrlKey: true });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('Cmd click on an in app link navigates inside the app', () => {
    load([['t', 'text', html]]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    click(editable('t').querySelectorAll('a')[1], { metaKey: true });
    expect(location.hash).toBe('#/p/abc');
    expect(open).not.toHaveBeenCalled();
  });

  it('a plain click on a locked page never navigates the app tab', () => {
    load([['t', 'text', html]], { locked: true });
    expect(editable('t').getAttribute('contenteditable')).toBe('false');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const ev = click(editable('t').querySelector('a')!);
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
  });

  it('a locked table cell link is intercepted too', () => {
    load([['tb', 'table', '', [], { rows: [[html]] }]], { locked: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const ev = click(host.querySelector('td a')!);
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* M11: table cells                                                    */
/* ------------------------------------------------------------------ */

describe('M11: table cells', () => {
  it('commits on input without rewriting the cell (the caret stays put)', () => {
    load([['tb', 'table', '', [], { rows: [['a', 'b']] }]]);
    const td = host.querySelector('td') as HTMLElement;
    td.focus();
    td.textContent = 'hello';
    setCaret(td, 3);
    act(() => {
      td.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'o' }));
    });
    expect(getDoc().blocks.tb.rows).toEqual([['hello', 'b']]);
    expect(host.querySelector('td')).toBe(td);
    expect(caretOffset(td)).toBe(3);
  });

  it('adds rows to an empty table and to malformed rows', () => {
    load([
      ['e', 'table', '', [], { rows: [] }],
      ['m', 'table', '', [], { rows: 'oops' as unknown as string[][] }],
    ]);
    const tables = host.querySelectorAll('.simple-table-wrap');
    expect(tables[0].querySelectorAll('td')).toHaveLength(1);
    expect(tables[1].querySelectorAll('td')).toHaveLength(1);
    click(tables[0].querySelector('.table-add button')!);
    click(tables[1].querySelector('.table-add button')!);
    expect(getDoc().blocks.e.rows).toEqual([[''], ['']]);
    expect(getDoc().blocks.m.rows).toEqual([[''], ['']]);
  });
});

/* ------------------------------------------------------------------ */
/* CJK input: full width shortcuts and IME composition                 */
/* ------------------------------------------------------------------ */

function typeText(el: HTMLElement, text: string) {
  el.focus();
  el.textContent = text;
  setCaret(el, 'end');
}

describe('full width shortcuts', () => {
  const cases: [string, BlockType][] = [
    ['＃', 'h1'],
    ['＃＃', 'h2'],
    ['＃＃＃', 'h3'],
    ['＞', 'toggle'],
    ['－', 'bulleted'],
    ['＊', 'bulleted'],
    ['１．', 'numbered'],
    ['［］', 'todo'],
    ['「', 'quote'],
  ];
  /** What the browser does for one inserted piece of text: update the DOM, then fire input. */
  const insert = (el: HTMLElement, text: string, data: string) => {
    typeText(el, text);
    act(() => {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data }));
    });
  };
  const space = String.fromCharCode(0x3000);

  for (const [prefix, type] of cases) {
    it(`${prefix} plus a full width space makes ${type}`, () => {
      load([['t', 'text', '']]);
      const el = editable('t');
      insert(el, prefix, prefix.slice(-1));
      insert(el, prefix + space, space);
      expect(getDoc().blocks.t.type).toBe(type);
      expect(getDoc().blocks.t.html).toBe('');
      // The typed shortcut also disappears from the page, not only from the store.
      expect(editable('t').textContent).toBe('');
    });
  }

  it('full width inline marks work like their ASCII forms', () => {
    // jsdom has no execCommand; install a recording stub for this test only.
    const doc = document as unknown as { execCommand?: unknown };
    const saved = doc.execCommand;
    const exec = vi.fn(() => true);
    doc.execCommand = exec;
    try {
      load([['t', 'text', '']]);
      const el = editable('t');
      const star = String.fromCharCode(0xff0a);
      typeText(el, star + star + 'bold' + star + star);
      tryMarkdown(el, 't', star);
      expect(exec).toHaveBeenCalledWith('insertHTML', false, '<b>bold</b>');
      const tick = String.fromCharCode(0xff40);
      typeText(el, tick + 'code' + tick);
      tryMarkdown(el, 't', tick);
      expect(exec).toHaveBeenCalledWith('insertHTML', false, '<code>code</code>');
    } finally {
      if (saved === undefined) delete doc.execCommand;
      else doc.execCommand = saved;
    }
  });

  it('tryMarkdown reads the full width prefix before the caret', () => {
    load([['t', 'text', '']]);
    const el = editable('t');
    typeText(el, '＃＃' + space);
    act(() => {
      expect(tryMarkdown(el, 't', space)).toBe(true);
    });
    expect(getDoc().blocks.t.type).toBe('h2');
  });

  it('a shortcut typed in a single IME composition is applied and cleared from the page', () => {
    load([['t', 'text', '']]);
    const el = editable('t');
    const composed = '＞' + String.fromCharCode(0x3000);
    act(() => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    });
    typeText(el, composed);
    act(() => {
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: composed }));
    });
    expect(getDoc().blocks.t.type).toBe('toggle');
    expect(editable('t').textContent).toBe('');
  });

  it('an ASCII prefix with a full width space works too, and ASCII shortcuts still work', () => {
    load([['t', 'text', ''], ['u', 'text', '']]);
    insert(editable('t'), '##', '#');
    insert(editable('t'), '##' + space, space);
    expect(getDoc().blocks.t.type).toBe('h2');
    insert(editable('u'), '-', '-');
    insert(editable('u'), '- ', ' ');
    expect(getDoc().blocks.u.type).toBe('bulleted');
    expect(editable('u').textContent).toBe('');
  });

  it('a full width slash committed by an IME opens the slash menu', () => {
    load([['t', 'text', '']]);
    const el = editable('t');
    act(() => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    });
    typeText(el, '／');
    act(() => {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '／', isComposing: true }));
    });
    expect(slashState.get()).toBeNull();
    act(() => {
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '／' }));
    });
    expect(slashState.get()).toMatchObject({ blockId: 't', start: 0 });
    expect(document.querySelector('.popover .menu')).not.toBeNull();
    // The query after a full width slash is read like an ASCII one.
    typeText(el, '／ｈｅａｄ');
    act(() => {
      window.dispatchEvent(new Event('on:slash-input'));
    });
    expect(document.querySelector('.popover .menu-item.active')?.textContent).toContain('Heading');
  });
});

/* ------------------------------------------------------------------ */
/* H8 through the real keyboard handlers and DOM order                 */
/* ------------------------------------------------------------------ */

describe('H8: keyboard handlers in a two column layout', () => {
  const layout: Spec[] = [
    ['cl', 'columns', '', [['ca', 'column', '', [['a1', 'text', 'alpha'], ['a2', 'text', 'beta']]], ['cb', 'column', '', [['b1', 'text', 'gamma'], ['b2', 'bulleted', '']]]]],
  ];
  const intact = () => {
    expect(getDoc().blocks.cl.children).toEqual(['ca', 'cb']);
    expect(checkInvariants(getDoc())).toEqual([]);
  };

  it('Backspace at the start of a column keeps text in place and creates no column', () => {
    load(layout);
    for (const id of ['b1', 'a1']) {
      const el = editable(id);
      el.focus();
      setCaret(el, 0);
      act(() => {
        handleBackspaceAtStart(el, id);
      });
    }
    expect(getDoc().blocks.b1).toMatchObject({ parent: 'cb', html: 'gamma' });
    expect(getDoc().blocks.a1).toMatchObject({ parent: 'ca', html: 'alpha' });
    expect(getDoc().blocks.a2.html).toBe('beta');
    expect(editable('b1').textContent).toBe('gamma');
    intact();
  });

  it('Backspace inside one column merges with the block above it', () => {
    load(layout);
    const el = editable('a2');
    el.focus();
    setCaret(el, 0);
    act(() => {
      handleBackspaceAtStart(el, 'a2');
    });
    expect(getDoc().blocks.a1.html).toBe('alphabeta');
    expect(getDoc().blocks.a2).toBeUndefined();
    intact();
  });

  it('Enter on an empty bullet in a column turns it into text', () => {
    load(layout);
    const el = editable('b2');
    el.focus();
    setCaret(el, 0);
    act(() => {
      handleEnter(el, 'b2');
    });
    expect(getDoc().blocks.b2).toMatchObject({ type: 'text', parent: 'cb' });
    intact();
  });
});
