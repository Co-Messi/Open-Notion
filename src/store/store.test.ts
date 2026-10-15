import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../test/fixtures/doc-v2-current.json';

const DOC_KEY = 'on:doc:v2';
const RECENT_KEY = 'on:recent:v1';
const PAGE = 'x64uwgofpnh3';
const BLOCK = 'glyi39xdpnh3';
/** The fixture without inline images, so the image migration does not write during a test. */
const plain = JSON.parse(JSON.stringify(fixture));
plain.blocks['3zg4avl4pnh3'].url = 'https://example.com/tiny.png';
plain.pages[PAGE].icon = '🧪';
const FIXTURE = JSON.stringify(plain);

const disposers: (() => void)[] = [];

/** A fresh store module graph, like a newly opened tab. */
async function tab(opts: { start?: boolean } = {}) {
  vi.resetModules();
  const store = await import('./store');
  const saveState = await import('./saveState');
  const actions = await import('./actions');
  const persist = await import('./persist');
  if (opts.start !== false) disposers.push(store.startPersistence());
  return { store, saveState, actions, persist };
}

const edit = (t: Awaited<ReturnType<typeof tab>>, html: string) =>
  t.store.transact(tx => tx.setBlock(BLOCK, { html }), 'push');

/** What the other tab's browser would deliver after a write to localStorage. */
function storageEvent() {
  window.dispatchEvent(new StorageEvent('storage', { key: DOC_KEY, newValue: localStorage.getItem(DOC_KEY), storageArea: localStorage }));
}

function unload() {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

const quota = () => new DOMException('full', 'QuotaExceededError');

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  while (disposers.length) disposers.pop()!();
  vi.useRealTimers();
});

describe('store core', () => {
  it('commits nothing when the transaction throws', async () => {
    const t = await tab();
    const before = t.store.getDoc();
    expect(() =>
      t.store.transact(tx => {
        tx.setBlock(BLOCK, { html: 'half done' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(t.store.getDoc()).toBe(before);
    t.store.undo();
    expect(t.store.getDoc()).toBe(before);
  });

  it('undoes and redoes edits', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    edit(t, 'one');
    edit(t, 'two');
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('two');
    t.store.undo();
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('one');
    t.store.undo();
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('Callout');
    t.store.redo();
    t.store.redo();
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('two');
  });

  it('coalesces edits with the same key into one undo step', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    for (const h of ['a', 'ab', 'abc']) t.store.transact(tx => tx.setBlock(BLOCK, { html: h }), { key: 'typing' });
    t.store.breakCoalescing();
    t.store.transact(tx => tx.setBlock(BLOCK, { html: 'abcd' }), { key: 'typing' });
    t.store.undo();
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('abc');
    t.store.undo();
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('Callout');
  });

  it('clears redo on replaceDoc and keeps the old doc one undo away', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    edit(t, 'changed');
    t.store.undo();
    const { createSeed } = await import('./seed');
    expect(t.store.replaceDoc(createSeed())).toBe(true);
    const replaced = t.store.getDoc();
    t.store.redo();
    expect(t.store.getDoc()).toBe(replaced);
    t.store.undo();
    expect(t.store.getDoc().pages[PAGE]).toBeDefined();
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('Callout');
  });
});

describe('settings', () => {
  it('keeps settings keys this build does not know about, but never prototype keys', async () => {
    localStorage.setItem('on:settings:v1', '{"theme":"dark","futureFlag":true,"__proto__":{"polluted":1},"startPage":"bogus"}');
    const t = await tab({ start: false });
    const s = t.store.getSettings() as unknown as Record<string, unknown>;
    expect(s).toMatchObject({ theme: 'dark', futureFlag: true, startPage: 'last' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    t.store.setSettings({ sidebarOpen: false });
    expect(JSON.parse(localStorage.getItem('on:settings:v1')!)).toMatchObject({ futureFlag: true, sidebarOpen: false });
  });
});

describe('loading', () => {
  it('loads the current stored shape with zero loss', async () => {
    const raw = JSON.stringify(fixture);
    localStorage.setItem(DOC_KEY, raw);
    const t = await tab({ start: false });
    // The only intended difference before the image migration: the version number.
    expect(t.store.getDoc()).toStrictEqual({ ...fixture, version: 2 });
    // The visit history moves to its own key.
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)).toEqual(fixture.recent);
    expect(localStorage.getItem(DOC_KEY)).toBe(raw);
  });

  it('writes the seed once on a first launch so its ids stay stable', async () => {
    const a = await tab();
    const stored = localStorage.getItem(DOC_KEY)!;
    expect(a.persist.readRev(stored)).not.toBeNull();
    const b = await tab();
    expect(Object.keys(b.store.getDoc().pages)).toEqual(Object.keys(a.store.getDoc().pages));
  });

  it('keeps unreadable data, shows recovery and never auto saves', async () => {
    vi.useFakeTimers();
    const raw = '{"pages": {"a": tru';
    localStorage.setItem(DOC_KEY, raw);
    const t = await tab();
    expect(t.saveState.getSaveState()).toMatchObject({ status: 'readonly', readonlyReason: 'recovery' });
    const info = t.store.getRecoveryInfo()!;
    expect(info.preservedKey).toMatch(/^on:doc:corrupt:\d+$/);
    expect(localStorage.getItem(info.preservedKey!)).toBe(raw);
    t.store.transact(tx => tx.setWorkspace({ name: 'x' }));
    t.actions.visitPage(Object.keys(t.store.getDoc().pages)[0]);
    vi.advanceTimersByTime(5000);
    expect(unload()).toBe(false);
    expect(localStorage.getItem(DOC_KEY)).toBe(raw);
    // A second load of the same data does not pile up copies.
    await tab();
    expect(Object.keys(localStorage).filter(k => k.startsWith('on:doc:corrupt:'))).toHaveLength(1);
  });

  it('treats a value that is not a workspace as unreadable', async () => {
    localStorage.setItem(DOC_KEY, '[1,2,3]');
    const t = await tab();
    expect(t.saveState.getSaveState().readonlyReason).toBe('recovery');
    expect(localStorage.getItem(DOC_KEY)).toBe('[1,2,3]');
  });

  it('leaves recovery only when asked, keeping the raw copy', async () => {
    localStorage.setItem(DOC_KEY, 'garbage');
    const t = await tab();
    const key = t.store.getRecoveryInfo()!.preservedKey!;
    const { createSeed } = await import('./seed');
    expect(t.store.leaveRecovery(createSeed())).toBe(true);
    expect(t.saveState.getSaveState().status).toBe('saved');
    expect(t.persist.readRev(localStorage.getItem(DOC_KEY))).not.toBeNull();
    expect(localStorage.getItem(key)).toBe('garbage');
  });

  it('opens data from a newer version read only', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify({ ...plain, version: 99 }));
    const t = await tab();
    expect(t.saveState.getSaveState()).toMatchObject({ status: 'readonly', readonlyReason: 'newer-version' });
    edit(t, 'nope');
    expect(t.store.getDoc().blocks[BLOCK].html).toBe('Callout');
    expect(t.store.isDirty()).toBe(false);
    expect(unload()).toBe(false);
    expect(JSON.parse(localStorage.getItem(DOC_KEY)!).version).toBe(99);
  });
});

describe('saving', () => {
  it('never writes the doc on navigation alone', async () => {
    vi.useFakeTimers();
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    const set = vi.spyOn(Storage.prototype, 'setItem');
    for (const id of ['p1agex8', 'p23xcxb', PAGE]) t.actions.visitPage(id);
    vi.advanceTimersByTime(5000);
    expect(unload()).toBe(false);
    expect(set.mock.calls.some(c => c[0] === DOC_KEY)).toBe(false);
    expect(localStorage.getItem(DOC_KEY)).toBe(FIXTURE);
    expect(t.store.getDoc().recent[0].id).toBe(PAGE);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)[0].id).toBe(PAGE);
    expect(t.store.isDirty()).toBe(false);
  });

  it('saves after the debounce and keeps a recent copy in the stored doc', async () => {
    vi.useFakeTimers();
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    edit(t, 'saved text');
    expect(t.saveState.getSaveState().status).toBe('pending');
    vi.advanceTimersByTime(400);
    expect(t.saveState.getSaveState().status).toBe('saved');
    const stored = JSON.parse(localStorage.getItem(DOC_KEY)!);
    expect(stored.blocks[BLOCK].html).toBe('saved text');
    expect(stored.version).toBe(2);
    expect(stored.recent).toEqual(plain.recent);
    expect(unload()).toBe(false);
  });

  it('shows a persistent failure and guards unload when storage is full', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota();
    });
    edit(t, 'unsaved');
    expect(t.store.flushSave()).toBe(false);
    expect(t.saveState.getSaveState()).toMatchObject({ status: 'failed', failure: 'quota' });
    expect(t.store.getUi().toast).toBe('Could not save: browser storage is full');
    // Later edits keep the failed state (the banner) instead of flipping back to pending.
    edit(t, 'still unsaved');
    expect(t.saveState.getSaveState().status).toBe('failed');
    expect(unload()).toBe(true);
    expect(localStorage.getItem(DOC_KEY)).toBe(FIXTURE);
    // Once storage works again, Retry saves and the guard goes away.
    vi.restoreAllMocks();
    expect(t.store.retrySave()).toBe(true);
    expect(t.saveState.getSaveState()).toMatchObject({ status: 'saved', failure: null });
    expect(unload()).toBe(false);
  });

  it('says when storage is blocked rather than full', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    edit(t, 'x');
    t.store.flushSave();
    expect(t.store.getUi().toast).toBe('Could not save: this browser is blocking site storage');
  });

  it('asks the browser to keep the data once, after the first successful save (H9)', async () => {
    let asked = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persist: () => {
          asked++;
          return Promise.resolve(true);
        },
      },
    });
    try {
      localStorage.setItem(DOC_KEY, FIXTURE);
      const t = await tab();
      // Loading alone never asks.
      expect(asked).toBe(0);
      // A save that fails does not count as having something worth keeping.
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw quota();
      });
      edit(t, 'first');
      expect(t.store.flushSave()).toBe(false);
      expect(asked).toBe(0);
      spy.mockRestore();
      expect(t.store.retrySave()).toBe(true);
      expect(asked).toBe(1);
      edit(t, 'second');
      expect(t.store.flushSave()).toBe(true);
      expect(asked).toBe(1);
    } finally {
      delete (navigator as unknown as { storage?: unknown }).storage;
    }
    expect('storage' in navigator).toBe(false);
  });

  it('asks on a first launch too, once the starter content is saved', async () => {
    let asked = 0;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: () => (asked++, Promise.resolve(false)) } });
    try {
      await tab();
      expect(localStorage.getItem(DOC_KEY)).not.toBeNull();
      expect(asked).toBe(1);
    } finally {
      delete (navigator as unknown as { storage?: unknown }).storage;
    }
  });

  it('drops the rolling safety copies before failing a save for quota', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const t = await tab();
    expect(t.store.backupCurrentDoc('test').ok).toBe(true);
    const orig = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === DOC_KEY && this.getItem('on:doc:backup') !== null) throw quota();
      return orig.call(this, k, v);
    });
    edit(t, 'needs room');
    expect(t.store.flushSave()).toBe(true);
    expect(localStorage.getItem('on:doc:backup')).toBeNull();
  });
});

describe('two tabs', () => {
  it('a clean tab reloads what another tab saved', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const a = await tab();
    const b = await tab();
    edit(b, 'stale undo entry');
    b.store.flushSave();
    storageEvent();
    expect(a.store.getDoc().blocks[BLOCK].html).toBe('stale undo entry');
    edit(a, 'from A');
    expect(a.store.flushSave()).toBe(true);
    storageEvent();
    expect(b.store.getDoc().blocks[BLOCK].html).toBe('from A');
    expect(b.saveState.getSaveState().status).toBe('saved');
    // History from before the reload is gone, so undo cannot resurrect old content.
    b.store.undo();
    expect(b.store.getDoc().blocks[BLOCK].html).toBe('from A');
  });

  it('a tab with unsaved edits goes read only and never overwrites newer data', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const a = await tab();
    const b = await tab();
    edit(b, 'B draft');
    edit(a, 'A saved');
    a.store.flushSave();
    const newer = localStorage.getItem(DOC_KEY);
    storageEvent();
    expect(b.saveState.getSaveState()).toMatchObject({ status: 'readonly', readonlyReason: 'other-tab' });
    expect(b.store.flushSave()).toBe(false);
    // The stale tab's unload prompts (its edits are lost) but never writes.
    expect(unload()).toBe(true);
    expect(localStorage.getItem(DOC_KEY)).toBe(newer);
    edit(b, 'more');
    expect(b.store.getDoc().blocks[BLOCK].html).toBe('B draft');
    // Reload adopts the newer data and makes the tab writable again.
    expect(b.store.reloadFromStorage()).toBe(true);
    expect(b.store.getDoc().blocks[BLOCK].html).toBe('A saved');
    expect(b.store.canEdit()).toBe(true);
  });

  it('refuses a write even when the notification never arrived', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const a = await tab();
    const b = await tab();
    edit(a, 'A first');
    a.store.flushSave();
    const newer = localStorage.getItem(DOC_KEY);
    edit(b, 'B late');
    expect(b.store.flushSave()).toBe(false);
    expect(localStorage.getItem(DOC_KEY)).toBe(newer);
    expect(b.saveState.getSaveState().readonlyReason).toBe('other-tab');
  });

  it('treats a write without a revision (an older build) as another tab', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const a = await tab();
    // Data from an older build has no revision: the first save still works.
    edit(a, 'first save');
    expect(a.store.flushSave()).toBe(true);
    // An old build in another tab writes its own doc, without a revision.
    const old = JSON.stringify({ ...plain, workspace: { ...plain.workspace, name: 'Old build' } });
    localStorage.setItem(DOC_KEY, old);
    edit(a, 'second save');
    expect(a.store.flushSave()).toBe(false);
    expect(localStorage.getItem(DOC_KEY)).toBe(old);
    expect(a.saveState.getSaveState().readonlyReason).toBe('other-tab');
  });

  it('notices an older build writing over data that never had a revision', async () => {
    localStorage.setItem(DOC_KEY, FIXTURE);
    const a = await tab();
    const old = JSON.stringify({ ...plain, workspace: { ...plain.workspace, name: 'Old build' } });
    localStorage.setItem(DOC_KEY, old);
    edit(a, 'x');
    expect(a.store.flushSave()).toBe(false);
    expect(localStorage.getItem(DOC_KEY)).toBe(old);
  });

  it('hears other tabs over BroadcastChannel', async () => {
    if (typeof BroadcastChannel === 'undefined') return;
    localStorage.setItem(DOC_KEY, FIXTURE);
    const a = await tab();
    const b = await tab();
    edit(a, 'over the channel');
    a.store.flushSave();
    await vi.waitFor(() => expect(b.store.getDoc().blocks[BLOCK].html).toBe('over the channel'));
  });
});
