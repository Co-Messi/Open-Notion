import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getDoc, replaceDoc } from '../store/store';
import { turnInto, makeBlock, makePage } from '../store/actions';
import type { Block, Doc, Page } from '../store/types';
import { turnIntoPage, blocksText } from './BlockMenu';
import { PageView } from './PageView';
import { TableBlock } from './TableBlock';
import { escapeHtml } from '../lib/html';

/**
 * Render level sink tests: content that looks like markup ('<img src=x onerror=...>') must stay
 * text through Turn into, Comment and rendering of imported data. jsdom does not load images,
 * so instead of waiting for onerror the innerHTML setter is wrapped: any parse into an element
 * of the live document whose result carries an on* attribute is recorded.
 */

declare global {
  interface Window {
    __pwned?: number;
  }
}

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
const liveParses: string[] = [];
const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;

const hasHandler = (el: Element) => Array.from(el.attributes).some(a => /^on/i.test(a.name));
function handlersIn(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('*')).filter(hasHandler);
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    get() {
      return innerHTML.get!.call(this);
    },
    set(v: string) {
      innerHTML.set!.call(this, v);
      // A template parses into an inert document; everything else creates live elements.
      if (this.ownerDocument === document && !(this instanceof HTMLTemplateElement)) {
        if (hasHandler(this) || handlersIn(this).length) liveParses.push(String(v));
      }
    },
  });
});
afterAll(() => {
  Object.defineProperty(Element.prototype, 'innerHTML', innerHTML);
});

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  liveParses.length = 0;
  delete window.__pwned;
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

function render(node: React.ReactNode) {
  root = createRoot(host);
  act(() => root!.render(node));
}

/** A one page document; `blocks` become the page content in order. */
function load(blocks: Partial<Block>[], page: Partial<Page> = {}): { pageId: string; ids: string[] } {
  const p = makePage({ title: 'Sinks', ...page });
  const doc: Doc = {
    version: 1,
    pages: { [p.id]: p },
    blocks: {},
    workspace: { name: 'W', icon: 'W', userName: 'Me', userEmail: 'me@example.com', privatePages: [p.id], favorites: [], teamspaces: [] },
    recent: [],
  };
  const ids = blocks.map(b => {
    const blk = makeBlock({ parent: p.id, ...b });
    doc.blocks[blk.id] = blk;
    return blk.id;
  });
  doc.pages[p.id] = { ...p, content: ids };
  replaceDoc(doc);
  return { pageId: p.id, ids };
}

function expectNothingRan() {
  expect(liveParses).toEqual([]);
  expect(handlersIn(document)).toEqual([]);
  expect(window.__pwned).toBeUndefined();
}

describe('code that looks like html stays text', () => {
  it('Turn into page keeps the code as the page title, as text', () => {
    const { ids } = load([{ type: 'code', html: PAYLOAD, language: 'html' }]);
    turnIntoPage(ids[0]);
    const pid = getDoc().blocks[ids[0]].pageId!;
    expect(getDoc().pages[pid].title).toBe(PAYLOAD);
    expectNothingRan();
  });

  it('Turn into code on a code block changes nothing', () => {
    const { ids } = load([{ type: 'code', html: PAYLOAD }]);
    turnInto(ids, 'code');
    expect(getDoc().blocks[ids[0]].html).toBe(PAYLOAD);
    expectNothingRan();
  });

  it('Turn into code on text whose visible text is a tag keeps that text as source', () => {
    const { ids } = load([{ type: 'text', html: escapeHtml(PAYLOAD) }]);
    turnInto(ids, 'code');
    expect(getDoc().blocks[ids[0]].html).toBe(PAYLOAD);
    turnInto(ids, 'text');
    expect(getDoc().blocks[ids[0]].html).toBe(escapeHtml(PAYLOAD).replace(/&quot;/g, '"'));
    expectNothingRan();
  });

  it('rendering a code block escapes the highlighted source', () => {
    const { pageId } = load([{ type: 'code', html: PAYLOAD, language: 'html' }]);
    render(<PageView pageId={pageId} />);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('textarea')?.value).toBe(PAYLOAD);
    expectNothingRan();
  });
});

describe('comments quote plain text', () => {
  it('quotes a text block whose visible text is a tag, and renders the quote as text', () => {
    const { pageId, ids } = load([{ type: 'text', html: escapeHtml(PAYLOAD) }, { type: 'code', html: PAYLOAD }]);
    expect(blocksText([ids[0]])).toBe(PAYLOAD);
    expect(blocksText([ids[1]])).toBe(PAYLOAD);
    render(<PageView pageId={pageId} />);
    act(() => {
      window.dispatchEvent(new CustomEvent('on:add-comment', { detail: { quote: blocksText([ids[0]]) } }));
    });
    const input = host.querySelector('.comment-input input') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Looks odd');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const comments = getDoc().pages[pageId].comments || [];
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ text: 'Looks odd', quote: PAYLOAD });
    expect(comments[0].html).toBeUndefined();
    expect(host.querySelector('.page-comments')?.textContent).toContain(PAYLOAD);
    expect(host.querySelector('.page-comments img')).toBeNull();
    expectNothingRan();
  });

  it('renders an imported legacy html comment without handlers', () => {
    const { pageId } = load([], {
      comments: [{ id: 'c1', html: `hi ${PAYLOAD}<a href="javascript:alert(1)" onclick="window.__pwned=1">x</a>`, createdAt: 1, author: 'Eve' }],
    });
    render(<PageView pageId={pageId} />);
    const box = host.querySelector('.page-comments')!;
    expect(box.textContent).toContain('hi');
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('a')?.getAttribute('href')).toBeNull();
    expectNothingRan();
  });
});

describe('imported rich text renders without handlers', () => {
  it('a table cell holding raw html is sanitized at render', () => {
    const { ids } = load([{ type: 'table', rows: [[PAYLOAD, 'ok <b>bold</b>'], ['<svg onload="window.__pwned=1"></svg>', '']] }]);
    render(<TableBlock block={getDoc().blocks[ids[0]]} />);
    expect(host.querySelectorAll('td')).toHaveLength(4);
    expect(host.querySelector('td b')?.textContent).toBe('bold');
    expect(host.querySelector('img, svg')).toBeNull();
    expectNothingRan();
  });

  it('a text block holding unsanitized html is sanitized before it reaches the editable', () => {
    const { pageId } = load([{ type: 'text', html: `before ${PAYLOAD} after` }]);
    render(<PageView pageId={pageId} />);
    const ed = host.querySelector('[data-editable-id]')!;
    expect(ed.textContent).toBe('before  after');
    expectNothingRan();
  });
});
