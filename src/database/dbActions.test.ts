import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../test/fixtures/doc-v2-current.json';
import type { Doc, Page } from '../store/types';

const DB = 'joiiy81zpnh4';

async function load() {
  vi.resetModules();
  const store = await import('../store/store');
  const actions = await import('./dbActions');
  const convert = await import('./convert');
  store.replaceDoc(JSON.parse(JSON.stringify(fixture)) as Doc);
  return { store, actions, convert };
}

const propOf = (doc: Doc, name: string) => doc.pages[DB].schema!.find(p => p.name === name)!;

describe('dbActions with a real store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('changePropertyType converts values, keeps updatedAt and undoes in one step', async () => {
    const { store, actions } = await load();
    const before = store.getDoc();
    const date = propOf(before, 'Date');
    const rows = before.pages[DB].rows!.map(id => before.pages[id]);
    const stamps = rows.map(r => r.updatedAt);
    actions.changePropertyType(DB, date.id, 'text');
    const after = store.getDoc();
    expect(propOf(after, 'Date').type).toBe('text');
    rows.forEach((r, i) => {
      const v = r.props?.[date.id];
      const next = after.pages[r.id].props?.[date.id];
      if (v?.start) expect(next).toContain(v.start);
      expect(after.pages[r.id].updatedAt).toBe(stamps[i]);
    });
    actions.changePropertyType(DB, date.id, 'date');
    rows.forEach(r => expect(store.getDoc().pages[r.id].props?.[date.id]).toEqual(r.props?.[date.id]));
    store.undo();
    store.undo();
    expect(propOf(store.getDoc(), 'Date').type).toBe('date');
    rows.forEach(r => expect(store.getDoc().pages[r.id].props?.[date.id]).toEqual(r.props?.[date.id]));
  });

  it('previews how many values a change cannot represent', async () => {
    const { store, actions } = await load();
    const doc = store.getDoc();
    const tags = propOf(doc, 'Multi-select');
    const date = propOf(doc, 'Date');
    expect(actions.previewPropertyTypeChange(DB, date.id, 'text').lost).toBe(0);
    expect(actions.previewPropertyTypeChange(DB, date.id, 'number').lost).toBeGreaterThanOrEqual(0);
    expect(actions.previewPropertyTypeChange(DB, tags.id, tags.type).lost).toBe(0);
    expect(actions.previewPropertyTypeChange(DB, 'nope', 'text').lost).toBe(0);
  });

  it('drops filters the new type cannot use and remaps select to multi select', async () => {
    const { store, actions } = await load();
    const sel = propOf(store.getDoc(), 'Select');
    const text = propOf(store.getDoc(), 'Text');
    store.transact(tx => {
      const db = tx.pages[DB];
      tx.setPage(DB, {
        views: db.views!.map((v, i) =>
          i === 0
            ? {
                ...v,
                filters: [
                  { id: 'f1', propId: sel.id, op: 'is', value: [sel.options![0].id] },
                  { id: 'f2', propId: text.id, op: 'contains', value: 'x' },
                ],
              }
            : v,
        ),
      });
    });
    actions.changePropertyType(DB, sel.id, 'multi_select');
    actions.changePropertyType(DB, text.id, 'number');
    const filters = store.getDoc().pages[DB].views![0].filters;
    expect(filters).toEqual([{ id: 'f1', propId: sel.id, op: 'contains', value: [sel.options![0].id] }]);
  });

  it('deleteOption also removes the option from filters', async () => {
    const { store, actions } = await load();
    actions.createOption(DB, propOf(store.getDoc(), 'Select').id, 'Extra one');
    actions.createOption(DB, propOf(store.getDoc(), 'Select').id, 'Extra two');
    const sel = propOf(store.getDoc(), 'Select');
    const [a, b] = sel.options!.slice(-2);
    store.transact(tx => {
      const db = tx.pages[DB];
      tx.setPage(DB, {
        views: db.views!.map((v, i) =>
          i === 0
            ? {
                ...v,
                filters: [
                  { id: 'f1', propId: sel.id, op: 'is', value: [a.id, b.id] },
                  { id: 'f2', propId: sel.id, op: 'is_not', value: [a.id] },
                ],
              }
            : v,
        ),
      });
    });
    actions.deleteOption(DB, sel.id, a.id);
    const doc = store.getDoc();
    expect(doc.pages[DB].views![0].filters).toEqual([{ id: 'f1', propId: sel.id, op: 'is', value: [b.id] }]);
    expect(propOf(doc, 'Select').options!.some(o => o.id === a.id)).toBe(false);
  });

  it('deleteProperty clears hidden previous values', async () => {
    const { store, actions, convert } = await load();
    const text = propOf(store.getDoc(), 'Text');
    store.transact(tx => {
      for (const id of tx.pages[DB].rows!) tx.setPage(id, { props: { ...tx.pages[id].props, [text.id]: 'abc' } });
    });
    actions.changePropertyType(DB, text.id, 'number');
    const rid = store.getDoc().pages[DB].rows![0];
    expect(store.getDoc().pages[rid].props![convert.stashKey(text.id)]).toBeTruthy();
    actions.deleteProperty(DB, text.id);
    expect(store.getDoc().pages[rid].props![convert.stashKey(text.id)]).toBeUndefined();
  });

  it('converts rows in the Trash too, so a restored row keeps a value of the right type (M1)', async () => {
    const { store, actions, convert } = await load();
    const { trashPage, restorePage } = await import('../store/actions');
    const row = 'efmzmfb7pnh4';
    const date = propOf(store.getDoc(), 'Date');
    const original = store.getDoc().pages[row].props![date.id];
    trashPage(row);
    expect(store.getDoc().pages[DB].rows).not.toContain(row);
    // The confirmation counts the trashed row's value as well.
    expect(actions.previewPropertyTypeChange(DB, date.id, 'checkbox').lost).toBe(2);
    // Date to checkbox cannot keep the date: the value is stashed, on the trashed row too.
    actions.changePropertyType(DB, date.id, 'checkbox');
    restorePage(row);
    let props = store.getDoc().pages[row].props!;
    expect(store.getDoc().pages[DB].rows).toContain(row);
    expect(props[date.id]).toBe(true);
    expect(props[convert.stashKey(date.id)]).toMatchObject({ type: 'date', value: original });
    actions.changePropertyType(DB, date.id, 'date');
    props = store.getDoc().pages[row].props!;
    expect(props[date.id]).toEqual(original);
    expect(props[convert.stashKey(date.id)]).toBeUndefined();

    // A lossless change on a trashed row converts it as well (date to text and back).
    trashPage(row);
    actions.changePropertyType(DB, date.id, 'text');
    expect(typeof store.getDoc().pages[row].props![date.id]).toBe('string');
    actions.changePropertyType(DB, date.id, 'date');
    expect(store.getDoc().pages[row].props![date.id]).toEqual(original);
  });

  it('deleteOption, deleteProperty and duplicateProperty reach rows in the Trash', async () => {
    const { store, actions, convert } = await load();
    const { restorePage } = await import('../store/actions');
    const FULL = 'x1c42prapnh5';
    const trashed = 'kbzorfrvpnh5';
    const status = '9w651ybjpnh5';
    const done = 'y748amlcpnh5';
    expect(store.getDoc().pages[trashed]).toMatchObject({ trashed: true, dbId: FULL });
    expect(store.getDoc().pages[trashed].props![status]).toBe(done);

    // Duplicating a property copies the trashed row's value.
    const copy = actions.duplicateProperty(FULL, status);
    expect(store.getDoc().pages[trashed].props![copy]).toBe(done);

    // Deleting an option clears it from the trashed row, so restoring shows no dead option.
    actions.deleteOption(FULL, status, done);
    expect(store.getDoc().pages[trashed].props![status]).toBeUndefined();

    // Deleting a property drops the hidden previous values of trashed rows too.
    store.transact(tx => tx.setPage(trashed, { props: { ...tx.pages[trashed].props, [convert.stashKey(copy)]: { type: 'text', value: 'x', produced: done } } }));
    actions.deleteProperty(FULL, copy);
    expect(store.getDoc().pages[trashed].props![convert.stashKey(copy)]).toBeUndefined();

    restorePage(trashed);
    expect(store.getDoc().pages[FULL].rows).toContain(trashed);
  });

  it('setRowRange compares instants, not strings', async () => {
    const { store, actions } = await load();
    const rid = store.getDoc().pages[DB].rows![0];
    const date = propOf(store.getDoc(), 'Date');
    const get = () => (store.getDoc().pages[rid] as Page).props![date.id];
    actions.setRowRange(rid, date.id, '2024-01-05T10:00', '2024-01-05');
    expect(get()).toEqual({ start: '2024-01-05T10:00', end: '2024-01-05' });
    actions.setRowRange(rid, date.id, '2024-01-05', '2024-01-05T10:00');
    expect(get()).toEqual({ start: '2024-01-05', end: '2024-01-05T10:00' });
    actions.setRowRange(rid, date.id, '2024-01-06', '2024-01-05T10:00');
    expect(get()).toEqual({ start: '2024-01-05T10:00', end: '2024-01-06' });
    actions.setRowRange(rid, date.id, '2024-01-05T10:00', '2024-01-05T10:00');
    expect(get()).toEqual({ start: '2024-01-05T10:00' });
    actions.setRowRange(rid, date.id, '2024-01-05T11:00', '2024-01-05T10:00');
    expect(get()).toEqual({ start: '2024-01-05T10:00', end: '2024-01-05T11:00' });
  });
});
