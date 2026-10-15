import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import fixture from '../test/fixtures/doc-v2-current.json';
import { htmlProblems } from '../test/invariants';

const DOC_KEY = 'on:doc:v2';
const PAGE = 'x64uwgofpnh3';
const ANCHOR = 'glyi39xdpnh3';
const SUBPAGE_BLOCK = 'fqn7qoggpnh3';
const SUBPAGE = 'r3kfrgrhpnh3';
const MIME = 'application/x-nc-blocks';
const disposers: (() => void)[] = [];

async function setup() {
  vi.resetModules();
  const store = await import('../store/store');
  const clip = await import('./clipboard');
  const selection = await import('./selection');
  const controller = await import('./controller');
  disposers.push(store.startPersistence());
  return { store, clip, selection, controller };
}

/** A paste event as the browser would deliver it. */
function pasteEvent(data: Record<string, string>, files: File[] = []) {
  return {
    clipboardData: { files, getData: (t: string) => data[t] ?? '' },
    preventDefault: vi.fn(),
  } as unknown as React.ClipboardEvent<HTMLElement>;
}

const block = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'text', html: '', children: [], parent: 'x', createdAt: 1, ...extra });
const hostile = (nonce?: string) =>
  JSON.stringify({
    ...(nonce ? { nonce } : {}),
    roots: ['a', 't'],
    blocks: {
      a: block('a', { html: '<img src=x onerror="window.__pwned=1">' }),
      t: block('t', { type: 'table', rows: [['<img src=x onerror="window.__pwned=1">']] }),
    },
  });

function allHtml(d: { blocks: Record<string, { html: string; rows?: string[][]; type: string }> }) {
  return Object.values(d.blocks).flatMap(b => [...(b.type === 'code' ? [] : [b.html]), ...(b.rows || []).flat()]);
}

beforeEach(() => {
  localStorage.clear();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const plain = JSON.parse(JSON.stringify(fixture));
  plain.blocks['3zg4avl4pnh3'].url = 'https://example.com/tiny.png';
  plain.pages[PAGE].icon = '🧪';
  localStorage.setItem(DOC_KEY, JSON.stringify(plain));
  (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
});
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

describe('clipboard payloads', () => {
  it('uses one random nonce per install', async () => {
    const t = await setup();
    const n = t.clip.clipboardNonce();
    expect(n).toMatch(/^[a-f0-9]{32}$/);
    expect(t.clip.clipboardNonce()).toBe(n);
    expect(localStorage.getItem('on:clip-nonce')).toBe(n);
  });

  it('treats payloads without the nonce, or malformed ones, as plain text', async () => {
    const t = await setup();
    expect(t.clip.decodeClipboard(hostile())).toBeNull();
    expect(t.clip.decodeClipboard(hostile('0'.repeat(32)))).toBeNull();
    expect(t.clip.decodeClipboard('{not json')).toBeNull();
    expect(t.clip.decodeClipboard('null')).toBeNull();
    expect(t.clip.decodeClipboard('x'.repeat(9 * 1024 * 1024))).toBeNull();
    const proto = `{"nonce":"${t.clip.clipboardNonce()}","roots":["__proto__"],"blocks":{"__proto__":{"id":"__proto__","type":"text","html":"x","children":[],"parent":"p","createdAt":1}}}`;
    expect(t.clip.decodeClipboard(proto)).toBeNull();
  });

  it('normalizes payloads that do carry the nonce', async () => {
    const t = await setup();
    const d = t.clip.decodeClipboard(hostile(t.clip.clipboardNonce()))!;
    expect(d.roots).toEqual(['a', 't']);
    for (const h of allHtml(d)) expect(htmlProblems(h)).toEqual([]);
  });

  it('pastes a hostile payload without the nonce as escaped text only', async () => {
    const t = await setup();
    const before = Object.keys(t.store.getDoc().blocks).length;
    const el = document.createElement('div');
    const e = pasteEvent({ [MIME]: hostile(), 'text/plain': 'just text' });
    t.clip.handlePaste(e, ANCHOR, el, () => {});
    expect(Object.keys(t.store.getDoc().blocks).length).toBe(before);
    expect(document.execCommand).toHaveBeenCalledWith('insertHTML', false, 'just text');
    for (const h of allHtml(t.store.getDoc())) expect(htmlProblems(h)).toEqual([]);
  });

  it('round trips copy and paste inside the app, sanitized', async () => {
    const t = await setup();
    const stored: Record<string, string> = {};
    const copyEvent = { clipboardData: { setData: (k: string, v: string) => (stored[k] = v) }, preventDefault: vi.fn() };
    t.clip.copyBlocks([ANCHOR, '2p2wer0dpnh3'], copyEvent as unknown as ClipboardEvent);
    expect(JSON.parse(stored[MIME]).nonce).toBe(t.clip.clipboardNonce());
    const before = Object.keys(t.store.getDoc().blocks).length;
    t.clip.handlePaste(pasteEvent(stored), ANCHOR, document.createElement('div'), () => {});
    const d = t.store.getDoc();
    expect(Object.keys(d.blocks).length).toBe(before + 2);
    const content = d.pages[PAGE].content;
    const at = content.indexOf(ANCHOR);
    expect(d.blocks[content[at + 1]].html).toBe('Callout');
    expect(d.blocks[content[at + 2]].rows).toEqual(d.blocks['2p2wer0dpnh3'].rows);
  });
});

describe('cut and paste of sub pages (M2)', () => {
  it('moves the page instead of leaving a dead link, and a second paste links', async () => {
    const t = await setup();
    const stored: Record<string, string> = {};
    const ev = { clipboardData: { setData: (k: string, v: string) => (stored[k] = v) }, preventDefault: vi.fn() };
    t.clip.copyBlocks([SUBPAGE_BLOCK], ev as unknown as ClipboardEvent, { cut: true });
    const { deleteBlocks } = await import('../store/actions');
    deleteBlocks([SUBPAGE_BLOCK]);
    expect(t.store.getDoc().pages[SUBPAGE].trashed).toBe(true);

    // Paste into another page: the page comes back from Trash, owned by the new block.
    const target = 'p1cba5';
    const anchor = t.store.getDoc().pages[target].content[0];
    t.clip.handlePaste(pasteEvent(stored), anchor, document.createElement('div'), () => {});
    let d = t.store.getDoc();
    const pasted = d.pages[target].content[1];
    expect(d.blocks[pasted]).toMatchObject({ type: 'page', pageId: SUBPAGE });
    expect(d.blocks[pasted].isLink).toBeUndefined();
    expect(d.pages[SUBPAGE].trashed).toBe(false);
    expect(d.pages[SUBPAGE].parentId).toBe(target);

    // Pasting the same payload again cannot share the page: it becomes a link.
    t.clip.handlePaste(pasteEvent(stored), anchor, document.createElement('div'), () => {});
    d = t.store.getDoc();
    const again = d.pages[target].content[1];
    expect(again).not.toBe(pasted);
    expect(d.blocks[again]).toMatchObject({ pageId: SUBPAGE, isLink: true });
  });

  it('leaves the page in Trash (recoverable) when nothing is pasted', async () => {
    const t = await setup();
    const ev = { clipboardData: { setData: () => {} }, preventDefault: vi.fn() };
    t.clip.copyBlocks([SUBPAGE_BLOCK], ev as unknown as ClipboardEvent, { cut: true });
    const { deleteBlocks, restorePage } = await import('../store/actions');
    deleteBlocks([SUBPAGE_BLOCK]);
    expect(t.store.getDoc().pages[SUBPAGE].trashed).toBe(true);
    restorePage(SUBPAGE);
    expect(t.store.getDoc().pages[SUBPAGE].trashed).toBe(false);
  });

  it('a plain copy pastes a link, never a second owner', async () => {
    const t = await setup();
    const stored: Record<string, string> = {};
    const ev = { clipboardData: { setData: (k: string, v: string) => (stored[k] = v) }, preventDefault: vi.fn() };
    t.clip.copyBlocks([SUBPAGE_BLOCK], ev as unknown as ClipboardEvent);
    t.clip.handlePaste(pasteEvent(stored), ANCHOR, document.createElement('div'), () => {});
    const d = t.store.getDoc();
    const owners = Object.values(d.blocks).filter(b => b.pageId === SUBPAGE && !b.isLink);
    expect(owners).toHaveLength(1);
  });
});

describe('block selection paste (selection.ts)', () => {
  it('ignores malformed and foreign payloads without throwing', async () => {
    const t = await setup();
    t.selection.installSelectionKeys();
    document.body.innerHTML = `<div data-editor-scope><div class="block" data-block-id="${ANCHOR}"></div></div>`;
    t.store.setUi({ selectedBlocks: [ANCHOR] });
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onErr);
    const before = t.store.getDoc();
    for (const payload of ['{bad json', hostile(), hostile('f'.repeat(32))]) {
      const ev = new Event('paste', { cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: { getData: (k: string) => (k === MIME ? payload : '') } });
      document.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    window.removeEventListener('error', onErr);
    expect(errors).toEqual([]);
    expect(t.store.getDoc()).toBe(before);
  });
});

describe('image paste (L9)', () => {
  it('stores a pasted image as a reference instead of refusing large files', async () => {
    const t = await setup();
    const png = Uint8Array.from(atob(fixture.blocks['3zg4avl4pnh3'].url.split(',')[1]), c => c.charCodeAt(0));
    const file = new File([png], 'paste.png', { type: 'image/png' });
    t.clip.handlePaste(pasteEvent({}, [file]), ANCHOR, document.createElement('div'), () => {});
    await vi.waitFor(() => {
      const d = t.store.getDoc();
      const next = d.blocks[d.pages[PAGE].content[d.pages[PAGE].content.indexOf(ANCHOR) + 1]];
      expect(next.type).toBe('image');
      expect(next.url).toMatch(/^on-img:/);
    });
  });
});
