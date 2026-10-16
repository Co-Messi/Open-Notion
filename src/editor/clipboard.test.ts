import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import fixture from '../test/fixtures/doc-v2-current.json';
import { htmlProblems } from '../test/docInvariants';
import { checkInvariants } from '../test/invariants';

const DOC_KEY = 'on:doc:v2';
const PAGE = 'x64uwgofpnh3';
const ANCHOR = 'glyi39xdpnh3';
const SUBPAGE_BLOCK = 'fqn7qoggpnh3';
const SUBPAGE = 'r3kfrgrhpnh3';
const MIME = 'application/x-nc-blocks';
const disposers: (() => void)[] = [];
const stores: { setUi: (patch: { selectedBlocks: string[] }) => void }[] = [];

async function setup() {
  vi.resetModules();
  const store = await import('../store/store');
  const clip = await import('./clipboard');
  const selection = await import('./selection');
  const controller = await import('./controller');
  disposers.push(store.startPersistence());
  stores.push(store);
  return { store, clip, selection, controller };
}
type T = Awaited<ReturnType<typeof setup>>;

/** Shows blocks as selected the way the editor renders them, so the document handlers see them. */
function showSelection(t: T, ids: string[]) {
  document.body.innerHTML = `<div data-editor-scope>${ids.map(id => `<div class="block" data-block-id="${id}"></div>`).join('')}</div>`;
  t.store.setUi({ selectedBlocks: ids });
}

/** A document level clipboard event whose data lives in `data`. */
function clipboardEvent(type: 'cut' | 'paste', data: Record<string, string>) {
  const ev = new Event(type, { cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? '' } });
  return ev;
}

/** Selects blocks and fires the real cut handler (installSelectionKeys). Returns the clipboard. */
function cutSelection(t: T, ids: string[]): Record<string, string> {
  t.selection.installSelectionKeys();
  showSelection(t, ids);
  const data: Record<string, string> = {};
  const ev = clipboardEvent('cut', data);
  document.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(t.store.getUi().selectedBlocks).toEqual([]);
  return data;
}

/** Pastes with a block selected (block selection mode), through the real paste handler. */
function pasteOnSelection(t: T, afterId: string, data: Record<string, string>) {
  t.selection.installSelectionKeys();
  showSelection(t, [afterId]);
  const ev = clipboardEvent('paste', data);
  document.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
}

/** An editable element with text, so a paste never replaces the anchor block. */
const editable = () => Object.assign(document.createElement('div'), { textContent: 'x' });

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
  // Listeners from installSelectionKeys outlive vi.resetModules: leave none with a selection.
  while (stores.length) stores.pop()!.setUi({ selectedBlocks: [] });
  document.body.innerHTML = '';
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

  it('keeps list nesting when multi line text is pasted', async () => {
    const t = await setup();
    const text = ['- top one', '  - child', '    - grandchild', '- top two'].join('\n');
    t.clip.handlePaste(pasteEvent({ 'text/plain': text }), ANCHOR, editable(), () => {});
    const d = t.store.getDoc();
    const find = (s: string) => Object.values(d.blocks).find(b => b.html === s)!;
    const top = find('top one');
    const child = find('child');
    const grandchild = find('grandchild');
    const two = find('top two');
    expect(child.parent).toBe(top.id);
    expect(grandchild.parent).toBe(child.id);
    expect(two.parent).toBe(top.parent);
    expect(top.children).toEqual([child.id]);
    expect('depth' in top).toBe(false);
    expect(checkInvariants(d)).toEqual([]);
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

describe('cut and paste of sub pages (M2, H6)', () => {
  it('moves the page instead of leaving a dead link, and a second paste links', async () => {
    const t = await setup();
    const stored = cutSelection(t, [SUBPAGE_BLOCK]);
    expect(t.store.getDoc().blocks[SUBPAGE_BLOCK]).toBeUndefined();
    expect(t.store.getDoc().pages[SUBPAGE].trashed).toBe(true);

    // Paste into another page: the page comes back from Trash, owned by the new block.
    const target = 'p1cba5';
    const anchor = t.store.getDoc().pages[target].content[0];
    t.clip.handlePaste(pasteEvent(stored), anchor, editable(), () => {});
    let d = t.store.getDoc();
    const pasted = d.pages[target].content[1];
    expect(d.blocks[pasted]).toMatchObject({ type: 'page', pageId: SUBPAGE });
    expect(d.blocks[pasted].isLink).toBeUndefined();
    expect(d.pages[SUBPAGE].trashed).toBe(false);
    expect(d.pages[SUBPAGE].parentId).toBe(target);
    expect(checkInvariants(d)).toEqual([]);

    // Pasting the same payload again cannot share the page: it becomes a link.
    t.clip.handlePaste(pasteEvent(stored), anchor, editable(), () => {});
    d = t.store.getDoc();
    const again = d.pages[target].content[1];
    expect(again).not.toBe(pasted);
    expect(d.blocks[again]).toMatchObject({ pageId: SUBPAGE, isLink: true });
    expect(checkInvariants(d)).toEqual([]);
  });

  it('pastes a link and keeps the page in Trash when pasted inside the cut page itself', async () => {
    const t = await setup();
    const P = 'p2p1fc';
    const stored = cutSelection(t, ['bud4ce']);
    expect(t.store.getDoc().pages[P].trashed).toBe(true);
    // Trashed pages stay editable: open P from the Trash and paste inside it.
    const inside = t.store.getDoc().pages[P].content[0];
    t.clip.handlePaste(pasteEvent(stored), inside, editable(), () => {});
    let d = t.store.getDoc();
    expect(d.blocks[d.pages[P].content[1]]).toMatchObject({ type: 'page', pageId: P, isLink: true });
    expect(d.pages[P]).toMatchObject({ trashed: true, parentId: 'p1cba5' });
    expect(checkInvariants(d)).toEqual([]);

    // The same payload still moves the page once the target is a valid place.
    const anchor = d.pages.pyepmw.content[0];
    t.clip.handlePaste(pasteEvent(stored), anchor, editable(), () => {});
    d = t.store.getDoc();
    expect(d.pages[P]).toMatchObject({ trashed: false, parentId: 'pyepmw' });
    expect(d.blocks[d.pages.pyepmw.content[1]]).toMatchObject({ pageId: P });
    expect(d.blocks[d.pages.pyepmw.content[1]].isLink).toBeUndefined();
    expect(checkInvariants(d)).toEqual([]);
  });

  it('pastes a link when the target is a descendant of the cut page (block selection paste)', async () => {
    const t = await setup();
    const P = 'p4wvk1j';
    const child = 'p4xdgkc';
    const stored = cutSelection(t, ['b70dswl']);
    expect(t.store.getDoc().pages[P].trashed).toBe(true);
    const inside = t.store.getDoc().pages[child].content[0];
    pasteOnSelection(t, inside, stored);
    const d = t.store.getDoc();
    expect(d.blocks[d.pages[child].content[1]]).toMatchObject({ type: 'page', pageId: P, isLink: true });
    expect(d.pages[P].trashed).toBe(true);
    expect(d.pages[child].parentId).toBe(P);
    expect(checkInvariants(d)).toEqual([]);
  });

  it('pastes a link when the target page is in the Trash', async () => {
    const t = await setup();
    const stored = cutSelection(t, [SUBPAGE_BLOCK]);
    const { trashPage } = await import('../store/actions');
    trashPage('pyepmw');
    const anchor = t.store.getDoc().pages.pyepmw.content[0];
    t.clip.handlePaste(pasteEvent(stored), anchor, editable(), () => {});
    const d = t.store.getDoc();
    expect(d.blocks[d.pages.pyepmw.content[1]]).toMatchObject({ pageId: SUBPAGE, isLink: true });
    expect(d.pages[SUBPAGE]).toMatchObject({ trashed: true, parentId: PAGE });
    expect(checkInvariants(d)).toEqual([]);
  });

  it('moves a cut page with a block selection paste too', async () => {
    const t = await setup();
    const stored = cutSelection(t, [SUBPAGE_BLOCK]);
    const anchor = t.store.getDoc().pages.pyepmw.content[0];
    pasteOnSelection(t, anchor, stored);
    const d = t.store.getDoc();
    expect(d.pages[SUBPAGE]).toMatchObject({ trashed: false, parentId: 'pyepmw' });
    expect(t.store.getUi().selectedBlocks).toEqual([d.pages.pyepmw.content[1]]);
    expect(checkInvariants(d)).toEqual([]);
  });

  it('leaves the page in Trash (recoverable) when nothing is pasted', async () => {
    const t = await setup();
    cutSelection(t, [SUBPAGE_BLOCK]);
    const { restorePage } = await import('../store/actions');
    expect(t.store.getDoc().pages[SUBPAGE].trashed).toBe(true);
    restorePage(SUBPAGE);
    expect(t.store.getDoc().pages[SUBPAGE].trashed).toBe(false);
    expect(checkInvariants(t.store.getDoc())).toEqual([]);
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
    expect(checkInvariants(d)).toEqual([]);
  });

  it('never pastes into a column list itself', async () => {
    const t = await setup();
    const stored: Record<string, string> = {};
    const ev = { clipboardData: { setData: (k: string, v: string) => (stored[k] = v) }, preventDefault: vi.fn() };
    t.clip.copyBlocks([ANCHOR], ev as unknown as ClipboardEvent);
    const data = t.clip.decodeClipboard(stored[MIME])!;
    const created = t.clip.insertSerialized(data, { parent: 'b6xs7hh', index: 1 });
    const d = t.store.getDoc();
    expect(created).toHaveLength(1);
    expect(d.blocks[created[0]].parent).toBe(d.blocks.b6xs7hh.parent);
    expect(checkInvariants(d)).toEqual([]);
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
