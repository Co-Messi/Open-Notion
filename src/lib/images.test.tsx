import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import fixture from '../test/fixtures/doc-v2-current.json';

const DOC_KEY = 'on:doc:v2';
const PAGE = 'x64uwgofpnh3';
const IMG_BLOCK = '3zg4avl4pnh3';
const TINY = fixture.blocks[IMG_BLOCK].url;
const disposers: (() => void)[] = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function tab() {
  vi.resetModules();
  const store = await import('../store/store');
  const images = await import('./images');
  const blobs = await import('../store/blobs');
  const exporter = await import('./exporter');
  disposers.push(store.startPersistence());
  return { store, images, blobs, exporter };
}

function bytesOf(dataUrl: string) {
  const bin = atob(dataUrl.split(',')[1]);
  return Array.from(bin, c => c.charCodeAt(0));
}

beforeEach(() => {
  localStorage.clear();
  (globalThis as { indexedDB: IDBFactory | undefined }).indexedDB = new IDBFactory();
});
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

describe('inline image migration', () => {
  it('moves data URLs to IndexedDB first, then rewrites the doc to refs', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const t = await tab();
    await t.store.imageMigrationIdle();
    const d = t.store.getDoc();
    const ref = d.blocks[IMG_BLOCK].url!;
    expect(ref).toMatch(/^on-img:h[a-z0-9]+$/);
    // The page icon was the same picture, so it shares the blob.
    expect(d.pages[PAGE].icon).toBe(ref);
    // Nothing else changed: exactly these two fields and the version differ from the fixture.
    const expected = JSON.parse(JSON.stringify(fixture));
    expected.version = 2;
    expected.blocks[IMG_BLOCK].url = ref;
    expected.pages[PAGE].icon = ref;
    expect(d).toStrictEqual(expected);
    const rec = await t.blobs.getImage(ref.slice('on-img:'.length));
    expect(rec?.type).toBe('image/png');
    expect(Array.from(new Uint8Array(rec!.bytes))).toEqual(bytesOf(TINY));
    // The rewrite is saved like any other change, with no inline images left.
    expect(t.store.flushSave()).toBe(true);
    const stored = localStorage.getItem(DOC_KEY)!;
    expect(stored).not.toContain('data:image/');
    expect(JSON.parse(stored).blocks[IMG_BLOCK].url).toBe(ref);
  });

  it('keeps the doc untouched when the blobs cannot be committed', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const t = await tab();
    await t.store.imageMigrationIdle();
    expect(t.store.getDoc().blocks[IMG_BLOCK].url).toBe(TINY);
    expect(t.store.isDirty()).toBe(false);
    expect(localStorage.getItem(DOC_KEY)).toContain(TINY);
  });

  it('leaves images inline when IndexedDB is unavailable', async () => {
    (globalThis as { indexedDB: IDBFactory | undefined }).indexedDB = undefined;
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const t = await tab();
    await t.store.imageMigrationIdle();
    expect(t.store.getDoc().blocks[IMG_BLOCK].url).toBe(TINY);
    expect(t.store.getDoc().pages[PAGE].icon).toBe(TINY);
  });

  it('is idempotent across reloads (content ids reuse the same blob)', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const a = await tab();
    await a.store.imageMigrationIdle();
    const ref = a.store.getDoc().blocks[IMG_BLOCK].url;
    expect(a.images.contentId(TINY)).toBe(ref!.slice('on-img:'.length));
    expect((await a.blobs.imageStats())!.count).toBe(1);
  });
});

describe('backups', () => {
  it('export embeds stored images and import restores them', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const a = await tab();
    await a.store.imageMigrationIdle();
    const ref = a.store.getDoc().blocks[IMG_BLOCK].url!;
    const id = ref.slice('on-img:'.length);
    const { json, images, missing } = await a.exporter.buildWorkspaceBackup();
    expect(images).toBe(1);
    expect(missing).toBe(0);
    const backup = JSON.parse(json);
    expect(backup.format).toBe('opennotion-backup');
    expect(backup.images[id]).toBe(TINY);
    expect(backup.doc.recent).toEqual([]);
    const expected = JSON.parse(JSON.stringify(a.store.getDoc()));
    expected.recent = [];

    // A different browser: empty IndexedDB, empty storage.
    (globalThis as { indexedDB: IDBFactory | undefined }).indexedDB = new IDBFactory();
    localStorage.clear();
    const b = await tab();
    const restored = await b.exporter.parseWorkspaceBackup(json);
    expect(restored.blocks[IMG_BLOCK].url).toBe(ref);
    const rec = await b.blobs.getImage(id);
    expect(Array.from(new Uint8Array(rec!.bytes))).toEqual(bytesOf(TINY));
    expect(restored).toStrictEqual(expected);
  });

  it('imports an old plain doc export and migrates its inline images', async () => {
    const b = await tab();
    const doc = await b.exporter.parseWorkspaceBackup(JSON.stringify(fixture));
    expect(doc.blocks[IMG_BLOCK].url).toBe(TINY);
    expect(b.store.replaceDoc(doc)).toBe(true);
    await b.store.imageMigrationIdle();
    expect(b.store.getDoc().blocks[IMG_BLOCK].url).toMatch(/^on-img:/);
  });

  it('falls back to inline images when the importing browser has no IndexedDB', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const a = await tab();
    await a.store.imageMigrationIdle();
    const { json } = await a.exporter.buildWorkspaceBackup();
    (globalThis as { indexedDB: IDBFactory | undefined }).indexedDB = undefined;
    const b = await tab();
    const restored = await b.exporter.parseWorkspaceBackup(json);
    expect(restored.blocks[IMG_BLOCK].url).toBe(TINY);
  });

  it('rejects files that are not backups, and backups from newer versions', async () => {
    const b = await tab();
    await expect(b.exporter.parseWorkspaceBackup('{nope')).rejects.toThrow('not valid JSON');
    await expect(b.exporter.parseWorkspaceBackup('[1]')).rejects.toThrow('not a workspace backup');
    await expect(b.exporter.parseWorkspaceBackup(JSON.stringify({ ...fixture, version: 50 }))).rejects.toThrow('newer version');
  });

  it('sanitizes a malicious backup before anything can render it', async () => {
    const b = await tab();
    const evil = JSON.parse(JSON.stringify(fixture));
    evil.blocks.glyi39xdpnh3.html = '<img src=x onerror="window.__pwned=1">';
    evil.pages[PAGE].comments[0].html = '<img src=x onerror="window.__pwned=1">';
    const doc = await b.exporter.parseWorkspaceBackup(JSON.stringify({ format: 'opennotion-backup', formatVersion: 1, doc: evil, images: { 'x"': 'data:text/html,<script>' } }));
    expect(doc.blocks.glyi39xdpnh3.html).toBe('');
    expect(doc.pages[PAGE].comments![0].html).toBe('');
  });
});

describe('ingest and render', () => {
  it('stores an uploaded image and returns a ref', async () => {
    const t = await tab();
    const file = new File([new Uint8Array(bytesOf(TINY))], 'a.png', { type: 'image/png' });
    const ref = await t.images.ingestImage(file);
    expect(ref).toMatch(/^on-img:u[a-z0-9]+$/);
    expect(await t.images.readImageAsDataUrl(ref)).toBe(TINY);
  });

  it('refuses non images and oversized originals', async () => {
    const t = await tab();
    await expect(t.images.ingestImage(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow('not an image');
    const huge = new File([new Uint8Array(t.images.MAX_ORIGINAL_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' });
    await expect(t.images.ingestImage(huge)).rejects.toThrow('too large');
  });

  it('resolves refs for rendering and reports missing blobs', async () => {
    const t = await tab();
    const ref = await t.images.ingestImage(new File([new Uint8Array(bytesOf(TINY))], 'a.png', { type: 'image/png' }));
    const seen: Record<string, string | null> = {};
    function Probe({ value }: { value: string }) {
      const r = t.images.useImageSrc(value);
      seen[value] = r.state + ':' + (r.src ? r.src.slice(0, 22) : '');
      return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <>
          <Probe value={ref} />
          <Probe value="on-img:doesnotexist" />
          <Probe value="javascript:alert(1)" />
        </>,
      );
    });
    // Let the IndexedDB reads finish inside act so React applies the updates.
    for (let i = 0; i < 10 && Object.values(seen).some(v => v?.startsWith('loading')); i++) await act(() => new Promise(r => setTimeout(r, 30)));
    expect(seen[ref]).toMatch(/^ready:(blob:|data:image\/png;base)/);
    expect(seen['on-img:doesnotexist']).toBe('missing:');
    expect(seen['javascript:alert(1)']).toBe('invalid:');
    act(() => root.unmount());
  });
});
