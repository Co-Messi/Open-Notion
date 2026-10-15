import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import fixture from '../test/fixtures/doc-v2-current.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DOC_KEY = 'on:doc:v2';
const COPY = 'on:doc:corrupt:1700000000000';
const disposers: (() => void)[] = [];
let root: Root | null = null;
let container: HTMLElement;

const plain = JSON.parse(JSON.stringify(fixture));
plain.blocks['3zg4avl4pnh3'].url = 'https://example.com/tiny.png';
plain.pages['x64uwgofpnh3'].icon = '🧪';

const buttons = (label: string) => Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.trim() === label);

/** Lets effects and the async diagnostics report settle until `ok` holds. */
async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) {
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
  }
  expect(ok()).toBe(true);
}

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

describe('Settings, Storage: kept copies of unreadable data', () => {
  it('offers Delete next to Download and deletes only after the user confirms', async () => {
    localStorage.setItem(DOC_KEY, JSON.stringify(plain));
    localStorage.setItem(COPY, '{"this is not": a workspace');
    const store = await import('../store/store');
    disposers.push(store.startPersistence());
    const { SettingsModal } = await import('./SettingsModal');
    const { DialogHost } = await import('./ConfirmDialog');
    store.setUi({ settingsOpen: true, settingsTab: 'storage' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <>
          <SettingsModal />
          <DialogHost />
        </>,
      ),
    );
    await until(() => buttons('Delete').length === 1);
    expect(container.textContent).toContain('Unreadable data kept');
    expect(buttons('Delete')[0].getAttribute('aria-label')).toMatch(/^Delete the copy kept /);
    expect(container.textContent).toMatch(/Download \(/);

    // Cancelling keeps the copy.
    await act(async () => buttons('Delete')[0].click());
    expect(container.textContent).toContain('Delete this copy?');
    expect(container.textContent).toContain('gone for good');
    await act(async () => buttons('Cancel')[0].click());
    expect(localStorage.getItem(COPY)).not.toBeNull();

    // Confirming frees the space, and the row goes away.
    await act(async () => buttons('Delete')[0].click());
    await act(async () => buttons('Delete copy')[0].click());
    expect(localStorage.getItem(COPY)).toBeNull();
    await until(() => !container.textContent!.includes('Unreadable data kept'));
  });
});
