import { transact, getDoc } from '../store/store';
import { uid, txAddRow, defaultStatusOptions, randomOptionColor } from '../store/actions';
import { shiftDate, orderRange } from './logic';
import { planTypeChange, fixViewsForTypeChange, fixFiltersForDeletedOption, stashKey, type ConvertCtx } from './convert';
import type { DbView, Property, PropType, SelectOption, ColorName } from '../store/types';

/** Moves `rowId` so it sits before `beforeId` (or at the end when null) in db.rows. */
function reorder(rows: string[], rowId: string, beforeId: string | null, afterId?: string | null): string[] {
  const out = rows.filter(r => r !== rowId);
  if (afterId) {
    const i = out.indexOf(afterId);
    out.splice(i < 0 ? out.length : i + 1, 0, rowId);
    return out;
  }
  const i = beforeId ? out.indexOf(beforeId) : -1;
  out.splice(i < 0 ? out.length : i, 0, rowId);
  return out;
}

export function moveRow(dbId: string, rowId: string, target: { before?: string | null; after?: string | null }) {
  transact(tx => {
    const db = tx.pages[dbId];
    tx.setPage(dbId, { rows: reorder(db.rows || [], rowId, target.before ?? null, target.after) });
  });
}

/** Board drop: set the group value and reorder in a single undo step. */
export function moveRowToGroup(dbId: string, rowId: string, propId: string, value: any, target: { before?: string | null; after?: string | null }) {
  transact(tx => {
    const db = tx.pages[dbId];
    const r = tx.pages[rowId];
    if (!r) return;
    const prop = (db.schema || []).find(p => p.id === propId);
    if (prop) {
      const cur = r.props?.[propId];
      let next: any = value;
      if (prop.type === 'multi_select') {
        // Moving between multi-select groups swaps the grouped option.
        next = value ? [value] : [];
        if (Array.isArray(cur) && value && cur.includes(value)) next = cur;
      }
      tx.setPage(rowId, { props: { ...(r.props || {}), [propId]: next } });
    }
    tx.setPage(dbId, { rows: reorder(db.rows || [], rowId, target.before ?? null, target.after) });
  });
}

/** Writes a date range; an end equal to the start collapses to a single date. */
export function setRowRange(rowId: string, propId: string, start: string, end?: string) {
  transact(tx => {
    const r = tx.pages[rowId];
    if (!r) return;
    const [s, e] = orderRange(start, end);
    const next = e && e !== s ? { start: s, end: e } : { start: s };
    tx.setPage(rowId, { props: { ...(r.props || {}), [propId]: next } });
  });
}

/** Moves a row's date (and its end) by n days, keeping times and duration. */
export function shiftRowDate(rowId: string, propId: string, n: number) {
  if (!n) return;
  const v = getDoc().pages[rowId]?.props?.[propId];
  if (!v?.start) return;
  setRowRange(rowId, propId, shiftDate(v.start, n), v.end ? shiftDate(v.end, n) : undefined);
}

export function addRowAt(dbId: string, props: Record<string, any>, opts: { after?: string; before?: string } = {}): string {
  let id = '';
  transact(tx => {
    const rows = tx.pages[dbId].rows || [];
    let index: number | undefined;
    if (opts.after && rows.includes(opts.after)) index = rows.indexOf(opts.after) + 1;
    if (opts.before && rows.includes(opts.before)) index = rows.indexOf(opts.before);
    id = txAddRow(tx, dbId, props, index);
  });
  return id;
}

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

function patchProp(dbId: string, propId: string, fn: (p: Property) => Property, history: 'push' | { key: string } = 'push') {
  transact(tx => {
    const db = tx.pages[dbId];
    tx.setPage(dbId, { schema: (db.schema || []).map(p => (p.id === propId ? fn(p) : p)) });
  }, history);
}

export function renameProperty(dbId: string, propId: string, name: string) {
  patchProp(dbId, propId, p => ({ ...p, name }), { key: 'prop-name:' + propId });
}

export function setPropertyWidth(dbId: string, propId: string, width: number) {
  patchProp(dbId, propId, p => ({ ...p, width }), { key: 'prop-width:' + propId });
}

export function setNumberFormat(dbId: string, propId: string, numberFormat: Property['numberFormat']) {
  patchProp(dbId, propId, p => ({ ...p, numberFormat }));
}

function convertCtx(): ConvertCtx {
  return { userName: getDoc().workspace.userName || 'Me', newId: uid, newColor: randomOptionColor, statusDefaults: defaultStatusOptions };
}

/**
 * How many values a type change cannot represent (0 means nothing is lost). Those values are
 * kept under a hidden key so changing back restores them, but the UI still asks first.
 */
export function previewPropertyTypeChange(dbId: string, propId: string, type: PropType): { lost: number } {
  const d = getDoc();
  const db = d.pages[dbId];
  const prop = db?.schema?.find(p => p.id === propId);
  if (!db || !prop || prop.type === type || prop.type === 'title') return { lost: 0 };
  const rows = (db.rows || []).map(id => d.pages[id]).filter(Boolean);
  return { lost: planTypeChange(prop, type, rows, convertCtx()).lost };
}

/** Converts a property to another type, converting existing values as losslessly as possible. */
export function changePropertyType(dbId: string, propId: string, type: PropType) {
  transact(tx => {
    const db = tx.pages[dbId];
    const prop = (db.schema || []).find(p => p.id === propId);
    if (!prop || prop.type === type || prop.type === 'title') return;
    const rows = (db.rows || []).map(id => tx.pages[id]).filter(Boolean);
    const plan = planTypeChange(prop, type, rows, convertCtx());
    for (const c of plan.changes) {
      tx.setPage(c.rowId, { props: c.props });
      // A schema change is not an edit of the row: keep its Last edited time.
      tx.touched.delete(c.rowId);
    }
    tx.setPage(dbId, {
      schema: (db.schema || []).map(p => (p.id === propId ? { ...p, type, options: plan.options ?? p.options } : p)),
      views: fixViewsForTypeChange(db.views || [], propId, prop.type, type),
    });
  });
}

export function duplicateProperty(dbId: string, propId: string): string {
  const nid = uid();
  transact(tx => {
    const db = tx.pages[dbId];
    const schema = db.schema || [];
    const src = schema.find(p => p.id === propId);
    if (!src || src.type === 'title') return;
    const copy: Property = { ...src, id: nid, name: src.name + ' (1)', options: src.options?.map(o => ({ ...o })) };
    const i = schema.indexOf(src);
    const next = [...schema];
    next.splice(i + 1, 0, copy);
    tx.setPage(dbId, { schema: next });
    for (const rid of db.rows || []) {
      const r = tx.pages[rid];
      if (r?.props && r.props[propId] !== undefined) {
        const extra = r.props[stashKey(propId)] !== undefined ? { [stashKey(nid)]: r.props[stashKey(propId)] } : {};
        tx.setPage(rid, { props: { ...r.props, [nid]: r.props[propId], ...extra } });
      }
    }
    // Keep the copy next to the original in ordered views.
    tx.setPage(dbId, {
      views: (tx.pages[dbId].views || []).map(v => {
        if (!v.order) return v;
        const o = [...v.order];
        const k = o.indexOf(propId);
        o.splice(k < 0 ? o.length : k + 1, 0, nid);
        return { ...v, order: o, hidden: v.hidden.includes(propId) ? [...v.hidden, nid] : v.hidden };
      }),
    });
  });
  return nid;
}

export function deleteProperty(dbId: string, propId: string) {
  transact(tx => {
    const db = tx.pages[dbId];
    // Drop the hidden previous values kept by type changes.
    for (const rid of db.rows || []) {
      const r = tx.pages[rid];
      if (r?.props && stashKey(propId) in r.props) {
        const { [stashKey(propId)]: _gone, ...rest } = r.props;
        tx.setPage(rid, { props: rest });
      }
    }
    tx.setPage(dbId, {
      schema: (db.schema || []).filter(p => p.id !== propId || p.type === 'title'),
      views: (db.views || []).map(v => ({
        ...v,
        hidden: v.hidden.filter(h => h !== propId),
        order: v.order?.filter(h => h !== propId),
        filters: v.filters.filter(f => f.propId !== propId),
        sorts: v.sorts.filter(s => s.propId !== propId),
        groupBy: v.groupBy === propId ? undefined : v.groupBy,
        dateProp: v.dateProp === propId ? undefined : v.dateProp,
      })),
    });
  });
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export function createOption(dbId: string, propId: string, name: string, group?: SelectOption['group']): SelectOption {
  const o: SelectOption = { id: uid(), name, color: randomOptionColor() };
  if (group) o.group = group;
  patchProp(dbId, propId, p => ({ ...p, options: [...(p.options || []), o] }));
  return o;
}

export function updateOption(dbId: string, propId: string, optId: string, patch: Partial<SelectOption>) {
  patchProp(dbId, propId, p => ({ ...p, options: (p.options || []).map(o => (o.id === optId ? { ...o, ...patch } : o)) }), patch.name !== undefined ? { key: 'opt-name:' + optId } : 'push');
}

export function setOptionColor(dbId: string, propId: string, optId: string, color: ColorName) {
  updateOption(dbId, propId, optId, { color });
}

export function deleteOption(dbId: string, propId: string, optId: string) {
  transact(tx => {
    const db = tx.pages[dbId];
    tx.setPage(dbId, {
      schema: (db.schema || []).map(p => (p.id === propId ? { ...p, options: (p.options || []).filter(o => o.id !== optId) } : p)),
      // Filters that pointed at the option would hide rows behind a pill with no label.
      views: fixFiltersForDeletedOption(db.views || [], propId, optId),
    });
    for (const rid of db.rows || []) {
      const r = tx.pages[rid];
      const v = r?.props?.[propId];
      if (v === optId) tx.setPage(rid, { props: { ...r.props, [propId]: undefined } });
      else if (Array.isArray(v) && v.includes(optId)) tx.setPage(rid, { props: { ...r.props, [propId]: v.filter((x: string) => x !== optId) } });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export function duplicateView(dbId: string, viewId: string): string {
  const nid = uid();
  transact(tx => {
    const db = tx.pages[dbId];
    const views = db.views || [];
    const src = views.find(v => v.id === viewId);
    if (!src) return;
    const copy: DbView = JSON.parse(JSON.stringify(src));
    copy.id = nid;
    copy.name = src.name + ' (1)';
    const next = [...views];
    next.splice(views.indexOf(src) + 1, 0, copy);
    tx.setPage(dbId, { views: next });
  });
  return nid;
}

export function setDbTitle(dbId: string, title: string) {
  transact(tx => tx.setPage(dbId, { title }), { key: 'db-title:' + dbId });
}

/** Hide/show a property in a view. */
export function togglePropHidden(dbId: string, viewId: string, propId: string, hidden: boolean) {
  transact(tx => {
    const db = tx.pages[dbId];
    tx.setPage(dbId, {
      views: (db.views || []).map(v => {
        if (v.id !== viewId) return v;
        const h = v.hidden.filter(x => x !== propId);
        return { ...v, hidden: hidden ? [...h, propId] : h };
      }),
    });
  });
}

export function setAllHidden(dbId: string, viewId: string, hidden: boolean) {
  transact(tx => {
    const db = tx.pages[dbId];
    const ids = (db.schema || []).filter(p => p.type !== 'title').map(p => p.id);
    tx.setPage(dbId, { views: (db.views || []).map(v => (v.id === viewId ? { ...v, hidden: hidden ? ids : [] } : v)) });
  });
}

export function getDb(dbId: string) {
  return getDoc().pages[dbId];
}
