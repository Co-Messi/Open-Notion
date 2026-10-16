/**
 * Property type conversion (pure, no store access).
 *
 * Goals, in order: keep every value that the new type can represent, keep the raw previous
 * value when it cannot, and never silently destroy data.
 *
 * - Options are never deleted when a property leaves a select type. They stay on the
 *   property so that changing back finds the same option ids.
 * - When a row's value changes in a way the new type cannot hold exactly, the original is
 *   kept under a hidden key in the row's props (`~prev:<propId>`) together with the value the
 *   conversion produced. Converting back to the original type restores the original as long
 *   as the produced value was not edited in between. Chains (A to B to C to A) carry the
 *   original along.
 * - `lost` counts the rows whose value could not be represented at all, or only partly. The
 *   UI asks for confirmation when it is above zero.
 */

import type { ColorName, DbView, Filter, Page, Property, PropType, SelectOption } from '../store/types';
import { opsFor, parseDateValue } from './logic';

export const STASH_PREFIX = '~prev:';
export const stashKey = (propId: string) => STASH_PREFIX + propId;

interface Stash {
  type: PropType;
  value: any;
  produced: any;
}

export interface ConvertCtx {
  /** Display name of the current user, the text form of the person id 'me'. */
  userName: string;
  newId: () => string;
  newColor: () => ColorName;
  statusDefaults: () => SelectOption[];
}

export interface RowChange {
  rowId: string;
  /** The complete next props object of the row. */
  props: Record<string, any>;
}

export interface ConversionPlan {
  /** Next options of the property (only set when the target type uses options). */
  options?: SelectOption[];
  changes: RowChange[];
  /** Rows whose value cannot be fully represented in the new type. */
  lost: number;
  /** Rows restored from a hidden previous value. */
  restored: number;
}

const isOptionType = (t: PropType) => t === 'select' || t === 'multi_select' || t === 'status';
const isTextType = (t: PropType) => t === 'text' || t === 'url' || t === 'email' || t === 'phone';
export const isDerivedType = (t: PropType) => t === 'created_time' || t === 'last_edited_time';

const pad = (n: number) => String(n).padStart(2, '0');

function isoLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function isEmptyValue(v: any, type: PropType): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (type === 'checkbox') return !v;
  if (type === 'date') return !v.start;
  if (type === 'number') return Number.isNaN(Number(v));
  return false;
}

/** Text forms of a value. Several entries for lists, one entry otherwise. */
function namesOf(v: any, type: PropType, options: SelectOption[], ctx: ConvertCtx): string[] {
  if (isEmptyValue(v, type)) return [];
  switch (type) {
    case 'select':
    case 'status': {
      const o = options.find(x => x.id === v);
      return o ? [o.name] : [];
    }
    case 'multi_select':
      return (Array.isArray(v) ? v : [v]).map((id: string) => options.find(x => x.id === id)?.name || '').filter(Boolean);
    case 'person':
      return (Array.isArray(v) ? v : [v]).map((p: string) => (p === 'me' ? ctx.userName : String(p))).filter(Boolean);
    case 'date':
      return [v.start + (v.end && v.end !== v.start ? ' → ' + v.end : '')];
    case 'checkbox':
      return ['Yes'];
    case 'created_time':
    case 'last_edited_time':
      return [isoLocal(Number(v))];
    default:
      return [String(v)];
  }
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function parseNumberText(raw: string): number | null {
  let s = raw.trim().replace(/^[$€£¥₹₩]\s*/, '');
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!NUM_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const TRUE_RE = /^(yes|true|1|checked|y|x|on|✓|✔)$/i;
const FALSE_RE = /^(no|false|0|unchecked|n|off)$/i;

interface OptState {
  list: SelectOption[];
}

interface Converted {
  value: any;
  lost: boolean;
}

function findOrCreate(state: OptState, name: string, to: PropType, ctx: ConvertCtx): SelectOption {
  const key = name.trim().toLowerCase();
  let o = state.list.find(x => x.name.trim().toLowerCase() === key);
  if (!o) {
    o = { id: ctx.newId(), name: name.trim(), color: ctx.newColor() };
    if (to === 'status') o.group = 'todo';
    state.list.push(o);
  }
  return o;
}

function convertValue(v: any, from: PropType, to: PropType, fromOptions: SelectOption[], state: OptState, ctx: ConvertCtx): Converted {
  const names = namesOf(v, from, fromOptions, ctx);
  const empty = isEmptyValue(v, from);
  if (empty) return { value: undefined, lost: false };

  if (isDerivedType(to)) return { value: undefined, lost: true };

  if (isTextType(to)) {
    if (isOptionType(from) || from === 'person') return { value: names.join(', ') || undefined, lost: false };
    return { value: names[0], lost: false };
  }

  if (to === 'number') {
    if (from === 'number') return { value: Number(v), lost: false };
    if (from === 'checkbox') return { value: v ? 1 : 0, lost: false };
    if (isDerivedType(from)) return { value: Number(v), lost: false };
    if (from === 'date') return { value: undefined, lost: true };
    if (names.length !== 1) return { value: undefined, lost: true };
    const n = parseNumberText(names[0]);
    return n === null ? { value: undefined, lost: true } : { value: n, lost: false };
  }

  if (to === 'date') {
    if (from === 'date') return { value: v, lost: false };
    if (isDerivedType(from)) return { value: { start: isoLocal(Number(v)) }, lost: false };
    if (from === 'number' || from === 'checkbox' || names.length !== 1) return { value: undefined, lost: true };
    const d = parseDateValue(names[0]);
    return d ? { value: d, lost: false } : { value: undefined, lost: true };
  }

  if (to === 'checkbox') {
    if (from === 'checkbox') return { value: !!v, lost: false };
    if (from === 'number') return { value: Number(v) !== 0, lost: Number(v) !== 0 && Number(v) !== 1 };
    if (from === 'date' || isDerivedType(from)) return { value: true, lost: true };
    const t = names.join(', ').trim();
    if (TRUE_RE.test(t)) return { value: true, lost: false };
    if (FALSE_RE.test(t)) return { value: false, lost: false };
    return { value: true, lost: true };
  }

  if (to === 'person') {
    if (from === 'person') return { value: Array.isArray(v) ? v : [v], lost: false };
    if (from === 'number' || from === 'checkbox' || from === 'date' || isDerivedType(from)) return { value: undefined, lost: true };
    const raw = isTextType(from) ? String(v).split(',') : names;
    const out: string[] = [];
    for (const n of raw.map(x => x.trim()).filter(Boolean)) {
      const id = n.toLowerCase() === 'me' || n.toLowerCase() === ctx.userName.trim().toLowerCase() ? 'me' : n;
      if (!out.includes(id)) out.push(id);
    }
    return { value: out.length ? out : undefined, lost: false };
  }

  if (isOptionType(to)) {
    // Option to option keeps the ids: the options are shared by all three types.
    if (isOptionType(from)) {
      const ids = (Array.isArray(v) ? v : [v]).filter((id: string) => state.list.some(o => o.id === id));
      if (!ids.length) return { value: undefined, lost: true };
      if (to === 'multi_select') return { value: ids, lost: false };
      return { value: ids[0], lost: ids.length > 1 };
    }
    let list: string[] = names;
    if (isTextType(from) && to === 'multi_select') list = String(v).split(',').map(x => x.trim()).filter(Boolean);
    list = list.map(x => x.trim()).filter(Boolean);
    if (!list.length) return { value: undefined, lost: false };
    const ids: string[] = [];
    for (const n of list) {
      const id = findOrCreate(state, n, to, ctx).id;
      if (!ids.includes(id)) ids.push(id);
    }
    if (to === 'multi_select') return { value: ids, lost: false };
    return { value: ids[0], lost: ids.length > 1 };
  }

  return { value: undefined, lost: true };
}

/** Starting options for the target type: stale options are reused, status gets its groups. */
function startingOptions(prop: Property, to: PropType, ctx: ConvertCtx): SelectOption[] {
  const base = (prop.options || []).map(o => ({ ...o }));
  if (to === 'status') {
    if (!base.length) return ctx.statusDefaults();
    return base.map((o, i) => ({ ...o, group: o.group || (i === 0 ? 'todo' : 'in_progress') }));
  }
  return base;
}

export function planTypeChange(prop: Property, to: PropType, rows: Page[], ctx: ConvertCtx): ConversionPlan {
  const from = prop.type;
  const sk = stashKey(prop.id);
  const state: OptState = { list: startingOptions(prop, to, ctx) };
  const fromOptions = prop.options || [];
  const changes: RowChange[] = [];
  let lost = 0;
  let restored = 0;

  for (const row of rows) {
    const props = row.props || {};
    const stash: Stash | undefined = props[sk];
    const current = props[prop.id];
    const derivedFrom = isDerivedType(from);
    const stored = derivedFrom ? (from === 'created_time' ? row.createdAt : row.updatedAt) : current;
    const stashLive = !!stash && same(current, stash.produced);

    // Back to the type the value came from: put the original value back.
    if (stash && stashLive && stash.type === to && !isDerivedType(to)) {
      const next = { ...props };
      if (stash.value === undefined) delete next[prop.id];
      else next[prop.id] = stash.value;
      delete next[sk];
      changes.push({ rowId: row.id, props: next });
      restored++;
      continue;
    }

    const next: Record<string, any> = { ...props };
    delete next[sk];
    const r = convertValue(stored, from, to, fromOptions, state, ctx);
    if (r.value === undefined) delete next[prop.id];
    else next[prop.id] = r.value;
    if (isDerivedType(to)) delete next[prop.id];

    const sourceEmpty = isEmptyValue(stored, from);
    if (r.lost) lost++;

    if (stashLive && stash) {
      // The current value came from an earlier conversion: keep carrying the true original.
      next[sk] = { type: stash.type, value: stash.value, produced: r.value } as Stash;
    } else if (!sourceEmpty && !derivedFrom) {
      const before = namesOf(stored, from, fromOptions, ctx).join('|');
      const after = isDerivedType(to) ? '' : namesOf(r.value, to, state.list, ctx).join('|');
      if (r.lost || before !== after) next[sk] = { type: from, value: stored, produced: r.value } as Stash;
    }
    if (!same(next, props)) changes.push({ rowId: row.id, props: next });
  }

  return { options: isOptionType(to) ? state.list : undefined, changes, lost, restored };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

type Group = 'text' | 'number' | 'option' | 'multi' | 'person' | 'date' | 'checkbox';

function groupOf(t: PropType): Group {
  if (isTextType(t) || t === 'title') return 'text';
  if (t === 'number') return 'number';
  if (t === 'select' || t === 'status') return 'option';
  if (t === 'multi_select') return 'multi';
  if (t === 'person') return 'person';
  if (t === 'checkbox') return 'checkbox';
  return 'date';
}

/** Maps a filter onto the new type, or returns null when it no longer makes sense. */
export function remapFilter(f: Filter, from: PropType, to: PropType): Filter | null {
  const ops = opsFor(to);
  const supports = (id: string) => ops.some(o => o.id === id);
  const old = opsFor(from).find(o => o.id === f.op);
  if (old?.noValue) return supports(f.op) ? f : null;
  const gf = groupOf(from);
  const gt = groupOf(to);
  if (gf === gt) return supports(f.op) ? f : null;
  if ((gf === 'option' && gt === 'multi') || (gf === 'multi' && gt === 'option')) {
    const map: Record<string, string> = gf === 'option' ? { is: 'contains', is_not: 'not_contains' } : { contains: 'is', not_contains: 'is_not' };
    const op = map[f.op];
    return op && supports(op) ? { ...f, op } : null;
  }
  return null;
}

/** Fixes filters, groupings and calculations that referenced the property's old type. */
export function fixViewsForTypeChange(views: DbView[], propId: string, from: PropType, to: PropType): DbView[] {
  return views.map(v => {
    const filters = (v.filters || []).flatMap(f => {
      if (f.propId !== propId) return [f];
      const r = remapFilter(f, from, to);
      return r ? [r] : [];
    });
    const next: DbView = { ...v, filters };
    if (v.groupBy === propId && !(to === 'select' || to === 'status' || to === 'multi_select')) next.groupBy = undefined;
    if (v.dateProp === propId && to !== 'date') next.dateProp = undefined;
    if (v.calcs && v.calcs[propId] && groupOf(from) !== groupOf(to)) {
      const calcs = { ...v.calcs };
      delete calcs[propId];
      next.calcs = calcs;
    }
    return next;
  });
}

/** Removes a deleted option from filters; drops filters that no longer select anything. */
export function fixFiltersForDeletedOption(views: DbView[], propId: string, optId: string): DbView[] {
  return views.map(v => ({
    ...v,
    filters: (v.filters || []).flatMap(f => {
      if (f.propId !== propId) return [f];
      if (Array.isArray(f.value)) {
        const value = f.value.filter((x: string) => x !== optId);
        return value.length ? [{ ...f, value }] : [];
      }
      return f.value === optId ? [] : [f];
    }),
  }));
}
