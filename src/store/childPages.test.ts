import { describe, expect, it, vi } from 'vitest';
import fixture from '../test/fixtures/doc-v2-current.json';
import type { Doc } from '../store/types';

describe('childPagesOf', () => {
  it('is cached per snapshot and recomputed after a transaction', async () => {
    vi.resetModules();
    const store = await import('./store');
    const actions = await import('./actions');
    store.replaceDoc(JSON.parse(JSON.stringify(fixture)) as Doc);
    const d = store.getDoc();
    const withKids = Object.values(d.pages).find(p => !p.isDatabase && actions.childPagesOf(d, p.id).length > 0);
    expect(withKids).toBeTruthy();
    const first = actions.childPagesOf(d, withKids!.id);
    expect(actions.childPagesOf(d, withKids!.id)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    store.transact(tx => tx.setPage(withKids!.id, { title: 'Changed' }));
    const after = store.getDoc();
    const second = actions.childPagesOf(after, withKids!.id);
    expect(second).not.toBe(first);
    expect([...second]).toEqual([...first]);
  });

  it('follows trashing a child page', async () => {
    vi.resetModules();
    const store = await import('./store');
    const actions = await import('./actions');
    store.replaceDoc(JSON.parse(JSON.stringify(fixture)) as Doc);
    const d = store.getDoc();
    const parent = Object.values(d.pages).find(p => !p.isDatabase && actions.childPagesOf(d, p.id).length > 0)!;
    const kid = actions.childPagesOf(d, parent.id)[0];
    store.transact(tx => tx.setPage(kid, { trashed: true }));
    expect(actions.childPagesOf(store.getDoc(), parent.id)).not.toContain(kid);
  });
});
