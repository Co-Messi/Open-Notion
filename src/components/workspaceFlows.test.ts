import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../test/fixtures/doc-v2-current.json';
import type { Doc } from '../store/types';

const h = vi.hoisted(() => ({ confirm: vi.fn(), choice: vi.fn(), exportJson: vi.fn() }));
vi.mock('./ConfirmDialog', () => ({ confirmDialog: h.confirm, askChoice: h.choice }));
vi.mock('../lib/exporter', async importOriginal => ({ ...(await importOriginal<typeof import('../lib/exporter')>()), exportWorkspaceJson: h.exportJson }));

const DOC_KEY = 'on:doc:v2';
const BACKUP_KEY = 'on:doc:backup';
const PAGE = 'x64uwgofpnh3';
const BLOCK = 'glyi39xdpnh3';
const SECRET = 'PLUMSECRET';
/** The fixture without inline images, with note content that must never reach diagnostics. */
const plain = JSON.parse(JSON.stringify(fixture));
plain.blocks['3zg4avl4pnh3'].url = 'https://example.com/tiny.png';
plain.pages[PAGE].icon = '🧪';
plain.pages[PAGE].title = `${SECRET} title`;
plain.blocks[BLOCK].html = `${SECRET} "quoted" body`;
const FIXTURE = JSON.stringify(plain);
const quota = () => new DOMException('full', 'QuotaExceededError');

const disposers: (() => void)[] = [];

/** A fresh tab: store, flows and persistence share one module graph. */
async function tab(raw = FIXTURE) {
  vi.resetModules();
  localStorage.setItem(DOC_KEY, raw);
  const store = await import('../store/store');
  const flows = await import('./workspaceFlows');
  const persist = await import('../store/persist');
  const diagnostics = await import('../lib/diagnostics');
  disposers.push(store.startPersistence());
  return { store, flows, persist, diagnostics };
}

const seedDoc = async (): Promise<Doc> => (await import('../store/seed')).createSeed();

/** Makes only the safety copy write fail, the way a full quota does. */
function failBackupWrite() {
  const orig = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    if (k === BACKUP_KEY) throw quota();
    return orig.call(this, k, v);
  });
}

beforeEach(() => {
  localStorage.clear();
  h.confirm.mockReset();
  h.choice.mockReset();
  h.exportJson.mockReset();
});
afterEach(() => {
  while (disposers.length) disposers.pop()!();
  vi.restoreAllMocks();
});

describe('replacing the workspace (Reset, Import, Restore)', () => {
  it('changes nothing when the confirmation is cancelled', async () => {
    const t = await tab();
    const before = t.store.getDoc();
    h.confirm.mockResolvedValue(false);
    expect(await t.flows.replaceWorkspace(await seedDoc(), 'reset')).toBe(false);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm.mock.calls[0][0]).toMatchObject({ title: 'Reset this workspace?', danger: true });
    expect(t.store.getDoc()).toBe(before);
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it('keeps a safety copy of the current workspace first, then replaces it (undo brings it back)', async () => {
    const t = await tab();
    const before = t.store.getDoc();
    h.confirm.mockResolvedValue(true);
    const next = await seedDoc();
    expect(await t.flows.replaceWorkspace(next, 'import')).toBe(true);
    expect(h.confirm.mock.calls[0][0].title).toBe('Replace this workspace with the backup?');
    expect(h.choice).not.toHaveBeenCalled();
    expect(t.store.getDoc()).toBe(next);
    // The copy holds what was there before, and its label says why it was kept.
    const copy = t.flows.readSafetyCopy()!;
    expect((copy.doc as Doc).pages[PAGE].title).toBe(before.pages[PAGE].title);
    expect(copy.meta.reason).toBe('Import');
    expect(JSON.parse(localStorage.getItem(DOC_KEY)!).pages[PAGE]).toBeUndefined();
    t.store.undo();
    expect(t.store.getDoc().pages[PAGE].title).toBe(before.pages[PAGE].title);
  });

  it('labels the safety copy by the action that replaced the workspace', async () => {
    const t = await tab();
    h.confirm.mockResolvedValue(true);
    await t.flows.replaceWorkspace(await seedDoc(), 'restore');
    expect(h.confirm.mock.calls[0][0].title).toBe('Restore the safety copy?');
    expect(t.flows.readSafetyCopy()!.meta.reason).toBe('Restore');
    await t.flows.replaceWorkspace(await seedDoc(), 'reset');
    expect(t.flows.readSafetyCopy()!.meta.reason).toBe('Reset');
  });

  it('asks before going on without a copy, and Cancel keeps the workspace', async () => {
    const t = await tab();
    const before = t.store.getDoc();
    h.confirm.mockResolvedValue(true);
    h.choice.mockResolvedValue('cancel');
    failBackupWrite();
    expect(await t.flows.replaceWorkspace(await seedDoc(), 'reset')).toBe(false);
    expect(h.choice).toHaveBeenCalledTimes(1);
    expect(h.choice.mock.calls[0][0].body).toContain('browser storage is full');
    expect(h.choice.mock.calls[0][0].choices.map((c: { id: string }) => c.id)).toEqual(['cancel', 'continue', 'download']);
    expect(t.store.getDoc()).toBe(before);
  });

  it('closing the choice without picking also keeps the workspace', async () => {
    const t = await tab();
    const before = t.store.getDoc();
    h.confirm.mockResolvedValue(true);
    h.choice.mockResolvedValue(null);
    failBackupWrite();
    expect(await t.flows.replaceWorkspace(await seedDoc(), 'import')).toBe(false);
    expect(t.store.getDoc()).toBe(before);
  });

  it('goes on without a copy only when the user says so', async () => {
    const t = await tab();
    h.confirm.mockResolvedValue(true);
    h.choice.mockResolvedValue('continue');
    failBackupWrite();
    const next = await seedDoc();
    expect(await t.flows.replaceWorkspace(next, 'reset')).toBe(true);
    expect(h.exportJson).not.toHaveBeenCalled();
    expect(t.store.getDoc()).toBe(next);
  });

  it('downloads a backup first when asked, and stops if the download fails', async () => {
    const t = await tab();
    const before = t.store.getDoc();
    h.confirm.mockResolvedValue(true);
    h.choice.mockResolvedValue('download');
    failBackupWrite();
    h.exportJson.mockResolvedValue(false);
    expect(await t.flows.replaceWorkspace(await seedDoc(), 'import')).toBe(false);
    expect(h.exportJson).toHaveBeenCalledTimes(1);
    expect(t.store.getDoc()).toBe(before);

    h.exportJson.mockResolvedValue(true);
    const next = await seedDoc();
    expect(await t.flows.replaceWorkspace(next, 'import')).toBe(true);
    expect(h.exportJson).toHaveBeenCalledTimes(2);
    expect(t.store.getDoc()).toBe(next);
  });

  it('refuses in a read only tab without asking anything', async () => {
    const t = await tab(JSON.stringify({ ...plain, version: 999 }));
    expect(t.store.canEdit()).toBe(false);
    const before = t.store.getDoc();
    expect(await t.flows.replaceWorkspace(await seedDoc(), 'reset')).toBe(false);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(t.store.getUi().toast).toBe('This tab is read only. Reload it first.');
    expect(t.store.getDoc()).toBe(before);
  });
});

describe('copies of unreadable data', () => {
  it('are deleted only by the user, after a confirmation that says the data will be gone', async () => {
    const t = await tab();
    const key = t.persist.preserveCorrupt('{not json');
    expect(key).toMatch(/^on:doc:corrupt:/);
    h.confirm.mockResolvedValue(false);
    expect(await t.flows.deleteKeptCopy(key!)).toBe(false);
    expect(localStorage.getItem(key!)).toBe('{not json');
    expect(h.confirm.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Delete copy', danger: true });
    expect(h.confirm.mock.calls[0][0].body).toContain('gone for good');

    h.confirm.mockResolvedValue(true);
    expect(await t.flows.deleteKeptCopy(key!)).toBe(true);
    expect(localStorage.getItem(key!)).toBeNull();
    expect(t.persist.corruptCopies()).toEqual([]);
  });

  it('are never rolled away automatically, and the same data is kept only once', async () => {
    const t = await tab();
    vi.useFakeTimers();
    try {
      const keys = ['{one', '{two', '{three', '{four'].map((raw, i) => {
        vi.setSystemTime(1_700_000_000_000 + i);
        return t.persist.preserveCorrupt(raw);
      });
      expect(new Set(keys).size).toBe(4);
      expect(t.persist.preserveCorrupt('{one')).toBe(keys[0]);
      expect(t.persist.corruptCopies().map(c => c.key)).toEqual(keys);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never deletes any other key', async () => {
    const t = await tab();
    h.confirm.mockResolvedValue(true);
    expect(await t.flows.deleteKeptCopy(DOC_KEY)).toBe(false);
    expect(await t.flows.deleteKeptCopy('on:doc:corrupt:missing')).toBe(false);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(localStorage.getItem(DOC_KEY)).not.toBeNull();
  });
});

describe('the diagnostics report', () => {
  it('never contains note content, even from errors that quote it', async () => {
    const t = await tab();
    // A real parse failure on stored text: engines quote the text they failed on.
    const stored = localStorage.getItem(DOC_KEY)!;
    try {
      JSON.parse(stored.slice(0, stored.indexOf(SECRET) + 40));
    } catch (e) {
      t.diagnostics.recordError('sync', e);
    }
    try {
      JSON.parse(`x${JSON.stringify({ t: `${SECRET} in a "nested" quote` })}`);
    } catch (e) {
      t.diagnostics.recordError('sync', e);
    }
    t.diagnostics.recordError('paste', `Unexpected token 'x', "x{"a":"${SECRET} WORDS"}" is not valid JSON`);
    t.diagnostics.recordError('render', `Cannot render \`${SECRET}\``);
    t.diagnostics.recordError('load', new Error(`unterminated "${SECRET} text`));
    const text = JSON.stringify(await t.flows.diagnosticsReport(), null, 2);
    expect(text).not.toContain(SECRET);
    // The report still says what happened, where and how big things are.
    const report = JSON.parse(text);
    expect(report.errors.map((e: { source: string }) => e.source)).toEqual(['sync', 'sync', 'paste', 'render', 'load']);
    expect(report.doc.pages).toBe(Object.keys(plain.pages).length);
    expect(report.keys.some((k: { key: string }) => k.key === DOC_KEY)).toBe(true);
  });
});
