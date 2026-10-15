import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import fixture from '../test/fixtures/doc-v2-current.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DOC_KEY = 'on:doc:v2';
const disposers: (() => void)[] = [];
let root: Root | null = null;
let container: HTMLElement;

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === label);

beforeEach(() => {
  localStorage.clear();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  vi.resetModules();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  while (disposers.length) disposers.pop()!();
});

describe('root error boundary', () => {
  it('renders the recovery UI, records the error and recovers with Go Home', async () => {
    const { ErrorBoundary } = await import('./ErrorBoundary');
    const diagnostics = await import('../lib/diagnostics');
    let explode = true;
    function Bomb() {
      if (explode) throw new Error('render failed');
      return <p>workspace</p>;
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Something went wrong');
    expect(button('Download raw data')).toBeDefined();
    expect(button('Go Home')).toBeDefined();
    expect(diagnostics.getRecentErrors().some(e => e.source === 'render' && e.message.includes('render failed'))).toBe(true);
    explode = false;
    act(() => button('Go Home')!.click());
    expect(container.textContent).toBe('workspace');
    expect(location.hash).toBe('#/home');
  });

  it('downloads the raw stored data', async () => {
    localStorage.setItem(DOC_KEY, '{"raw":true}');
    const { downloadRawData } = await import('./workspaceFlows');
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadRawData();
    expect(click).toHaveBeenCalled();
    const text = await new Promise<string>(res => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsText(created[0]);
    });
    expect(text).toBe('{"raw":true}');
  });
});

describe('recovery screen', () => {
  it('offers download, import and start fresh, and starts fresh only after confirming', async () => {
    localStorage.setItem(DOC_KEY, 'not json at all');
    const store = await import('../store/store');
    disposers.push(store.startPersistence());
    const { RecoveryScreen } = await import('./RecoveryScreen');
    const { DialogHost } = await import('./ConfirmDialog');
    render(
      <>
        <RecoveryScreen />
        <DialogHost />
      </>,
    );
    expect(container.textContent).toContain('could not be opened');
    expect(button('Download saved data')).toBeDefined();
    expect(button('Import a backup')).toBeDefined();
    await act(async () => button('Start fresh')!.click());
    // A confirmation appears; cancelling changes nothing.
    expect(container.textContent).toContain('Start with a fresh workspace?');
    await act(async () => button('Cancel')!.click());
    expect(localStorage.getItem(DOC_KEY)).toBe('not json at all');
    await act(async () => button('Start fresh')!.click());
    const confirm = Array.from(container.querySelectorAll('.confirm-dialog button')).find(b => b.textContent === 'Start fresh') as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(store.canEdit()).toBe(true);
    expect(localStorage.getItem(DOC_KEY)).not.toBe('not json at all');
    expect(Object.keys(localStorage).some(k => k.startsWith('on:doc:corrupt:'))).toBe(true);
  });
});

describe('status banners', () => {
  it('shows a persistent Not saved banner with Export and Retry when saving fails', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const store = await import('../store/store');
    disposers.push(store.startPersistence());
    const { StatusBanners } = await import('./StatusBanners');
    render(<StatusBanners />);
    expect(container.querySelector('.status-banner')).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    act(() => {
      store.transact(tx => tx.setWorkspace({ name: 'Unsaved name' }));
      store.flushSave();
    });
    expect(container.textContent).toContain('Not saved.');
    expect(container.textContent).toContain('browser storage is full');
    expect(button('Export backup')).toBeDefined();
    expect(button('Retry')).toBeDefined();
    expect(document.body.classList.contains('has-status-banner')).toBe(true);
    vi.restoreAllMocks();
    act(() => button('Retry')!.click());
    expect(container.querySelector('.status-banner.error')).toBeNull();
  });

  it('shows the read only banner with Reload when another tab saved', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    const store = await import('../store/store');
    disposers.push(store.startPersistence());
    const { StatusBanners } = await import('./StatusBanners');
    render(<StatusBanners />);
    act(() => store.transact(tx => tx.setWorkspace({ name: 'Mine' })));
    localStorage.setItem(DOC_KEY, JSON.stringify({ ...fixture, workspace: { ...fixture.workspace, name: 'Theirs' } }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: DOC_KEY }));
    });
    expect(container.textContent).toContain('Read only.');
    expect(button('Reload')).toBeDefined();
    expect(button('Export this tab')).toBeDefined();
  });

  it('reminds about backups after a week, mentioning Safari to Safari users', async () => {
    localStorage.setItem('on:installed-at', String(Date.now() - 8 * 86_400_000));
    localStorage.setItem(DOC_KEY, JSON.stringify(fixture));
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15');
    const store = await import('../store/store');
    disposers.push(store.startPersistence());
    const { StatusBanners } = await import('./StatusBanners');
    render(<StatusBanners />);
    expect(container.textContent).toContain('Back up your notes.');
    expect(container.textContent).toContain('7 days');
    act(() => button('Later')!.click());
    expect(container.querySelector('.status-banner')).toBeNull();
  });
});
