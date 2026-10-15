import type { ColorName, DbView, Filter, Page, Property, PropType, SelectOption } from '../store/types';

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

const ABBR: Record<string, string> = {
  gray: 'gra', brown: 'bro', orange: 'ora', yellow: 'yel', green: 'gre', blue: 'blu', purple: 'pur', pink: 'pin', red: 'red',
};

export function optionStyle(color: ColorName | undefined): { background: string; color: string } {
  const a = color && ABBR[color];
  if (!a) return { background: 'var(--on-gray-background-secondary-translucent)', color: 'var(--text-primary)' };
  return { background: `var(--on-${color}-background-tertiary)`, color: `var(--on-${color}-text-primary)` };
}

export function dotColor(color: ColorName | undefined): string {
  const a = color && ABBR[color];
  return a ? `var(--on-${color}-icon-secondary)` : 'var(--on-gray-icon-secondary)';
}

export function columnTint(color: ColorName | undefined): string {
  const a = color && ABBR[color];
  return a ? `var(--on-${color}-background-primary)` : 'var(--on-gray-background-primary)';
}

export const COLOR_LABEL: Record<ColorName, string> = {
  default: 'Default', gray: 'Gray', brown: 'Brown', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue',
  purple: 'Purple', pink: 'Pink', red: 'Red',
};

/* ------------------------------------------------------------------ */
/* Dates (always local, never toISOString)                             */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function todayYmd(): string {
  return ymd(new Date());
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDate(s: string | undefined): string {
  const d = parseYmd(s ? s.slice(0, 10) : s);
  if (!d) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/* Date values may carry a time: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
export const dayOf = (s?: string | null): string => (s ? s.slice(0, 10) : '');
export const timeOf = (s?: string | null): string => (s && s.length > 10 ? s.slice(11, 16) : '');
export const withTime = (day: string, time: string): string => (time ? `${day}T${time}` : day);

export function addDays(day: string, n: number): string {
  const d = parseYmd(day) || new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** Moves a date string by n days, keeping its time part. */
export function shiftDate(s: string, n: number): string {
  return withTime(addDays(dayOf(s), n), timeOf(s));
}

export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return `${h % 12 || 12}:${pad(m || 0)} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Compact time for calendar chips: "10 AM", "10:30 AM". */
export function fmtTimeShort(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return `${h % 12 || 12}${m ? ':' + pad(m) : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortMonth = (m: number) => SHORT_MONTHS[m];

export function fmtDateValue(v: any): string {
  if (!v || !v.start) return '';
  const s: string = v.start;
  const e: string | undefined = v.end;
  const full = (x: string) => fmtDate(dayOf(x)) + (timeOf(x) ? ' ' + fmtTime(timeOf(x)) : '');
  if (!e || e === s) return full(s);
  if (dayOf(s) === dayOf(e)) {
    return timeOf(e) ? `${full(s)} → ${fmtTime(timeOf(e))}` : full(s);
  }
  const ds = parseYmd(s)!;
  const de = parseYmd(e)!;
  const sameYear = ds.getFullYear() === de.getFullYear();
  const a = `${SHORT_MONTHS[ds.getMonth()]} ${ds.getDate()}${sameYear ? '' : ', ' + ds.getFullYear()}${timeOf(s) ? ' ' + fmtTime(timeOf(s)) : ''}`;
  const b = `${SHORT_MONTHS[de.getMonth()]} ${de.getDate()}, ${de.getFullYear()}${timeOf(e) ? ' ' + fmtTime(timeOf(e)) : ''}`;
  return `${a} → ${b}`;
}

export function fmtTimestamp(t: number): string {
  const d = new Date(t);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${pad(d.getMinutes())} ${ap}`;
}

export function monthLabel(y: number, m: number): string {
  return `${MONTHS[m]} ${y}`;
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

export function rawValue(row: Page, prop: Property): any {
  if (prop.type === 'title') return row.title || '';
  if (prop.type === 'created_time') return row.createdAt;
  if (prop.type === 'last_edited_time') return row.updatedAt;
  return row.props?.[prop.id];
}

export function optionById(prop: Property, id: any): SelectOption | undefined {
  return (prop.options || []).find(o => o.id === id);
}

export function isEmptyValue(row: Page, prop: Property): boolean {
  const v = rawValue(row, prop);
  switch (prop.type) {
    case 'checkbox':
      return !v;
    case 'multi_select':
    case 'person':
      return !Array.isArray(v) || v.length === 0;
    case 'select':
    case 'status':
      return !v || !optionById(prop, v);
    case 'date':
      return !v || !v.start;
    case 'number':
      return v === undefined || v === null || v === '' || Number.isNaN(Number(v));
    case 'created_time':
    case 'last_edited_time':
      return false;
    default:
      return v === undefined || v === null || String(v).trim() === '';
  }
}

export function fmtNumber(v: any, format: Property['numberFormat']): string {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return '';
  switch (format) {
    case 'percent':
      return `${+(n * 100).toFixed(4)}%`;
    case 'dollar':
      return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'euro':
      return '€' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default:
      return String(n);
  }
}

/** Plain text of a value, used for search and sorting. */
export function textValue(row: Page, prop: Property, userName = 'Me'): string {
  const v = rawValue(row, prop);
  switch (prop.type) {
    case 'select':
    case 'status':
      return optionById(prop, v)?.name || '';
    case 'multi_select':
      return (Array.isArray(v) ? v : []).map(id => optionById(prop, id)?.name || '').join(', ');
    case 'person':
      return (Array.isArray(v) ? v : []).map(p => (p === 'me' ? userName : p)).join(', ');
    case 'date':
      return fmtDateValue(v);
    case 'checkbox':
      return v ? 'Checked' : '';
    case 'created_time':
    case 'last_edited_time':
      return fmtTimestamp(v);
    case 'number':
      return fmtNumber(v, prop.numberFormat);
    default:
      return v == null ? '' : String(v);
  }
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export interface OpDef {
  id: string;
  label: string;
  /** Short label used inside the filter pill. */
  short?: string;
  noValue?: boolean;
}

const TEXT_OPS: OpDef[] = [
  { id: 'contains', label: 'Contains' },
  { id: 'not_contains', label: 'Does not contain', short: 'does not contain' },
  { id: 'is', label: 'Is', short: 'is' },
  { id: 'is_not', label: 'Is not', short: 'is not' },
  { id: 'empty', label: 'Is empty', noValue: true },
  { id: 'not_empty', label: 'Is not empty', noValue: true },
];
const NUMBER_OPS: OpDef[] = [
  { id: 'eq', label: '=', short: '=' },
  { id: 'neq', label: '≠', short: '≠' },
  { id: 'gt', label: '>', short: '>' },
  { id: 'lt', label: '<', short: '<' },
  { id: 'gte', label: '≥', short: '≥' },
  { id: 'lte', label: '≤', short: '≤' },
  { id: 'empty', label: 'Is empty', noValue: true },
  { id: 'not_empty', label: 'Is not empty', noValue: true },
];
const SELECT_OPS: OpDef[] = [
  { id: 'is', label: 'Is' },
  { id: 'is_not', label: 'Is not', short: 'is not' },
  { id: 'empty', label: 'Is empty', noValue: true },
  { id: 'not_empty', label: 'Is not empty', noValue: true },
];
const MULTI_OPS: OpDef[] = [
  { id: 'contains', label: 'Contains' },
  { id: 'not_contains', label: 'Does not contain', short: 'does not contain' },
  { id: 'empty', label: 'Is empty', noValue: true },
  { id: 'not_empty', label: 'Is not empty', noValue: true },
];
const CHECK_OPS: OpDef[] = [
  { id: 'checked', label: 'Is checked', noValue: true },
  { id: 'unchecked', label: 'Is not checked', noValue: true },
];
const DATE_OPS: OpDef[] = [
  { id: 'is', label: 'Is' },
  { id: 'before', label: 'Is before', short: 'before' },
  { id: 'after', label: 'Is after', short: 'after' },
  { id: 'empty', label: 'Is empty', noValue: true },
  { id: 'not_empty', label: 'Is not empty', noValue: true },
];

export function opsFor(type: PropType): OpDef[] {
  switch (type) {
    case 'number':
      return NUMBER_OPS;
    case 'select':
    case 'status':
      return SELECT_OPS;
    case 'multi_select':
    case 'person':
      return MULTI_OPS;
    case 'checkbox':
      return CHECK_OPS;
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return DATE_OPS;
    default:
      return TEXT_OPS;
  }
}

export function defaultOp(type: PropType): string {
  return opsFor(type)[0].id;
}

export function opDef(type: PropType, op: string): OpDef {
  return opsFor(type).find(o => o.id === op) || opsFor(type)[0];
}

/** A filter is "active" (blue) when it actually constrains rows. */
export function filterActive(prop: Property | undefined, f: Filter): boolean {
  if (!prop) return false;
  const def = opDef(prop.type, f.op);
  if (def.noValue) return true;
  if (Array.isArray(f.value)) return f.value.length > 0;
  return f.value !== undefined && f.value !== null && f.value !== '';
}

function dateKeyOf(row: Page, prop: Property): string | null {
  const v = rawValue(row, prop);
  if (prop.type === 'created_time' || prop.type === 'last_edited_time') return ymd(new Date(v));
  return v?.start ? dayOf(v.start) : null;
}

export function matchFilter(row: Page, prop: Property, f: Filter): boolean {
  if (!filterActive(prop, f)) return true;
  const op = f.op;
  if (op === 'empty') return isEmptyValue(row, prop);
  if (op === 'not_empty') return !isEmptyValue(row, prop);
  const v = rawValue(row, prop);
  switch (prop.type) {
    case 'checkbox':
      return op === 'checked' ? !!v : !v;
    case 'number': {
      if (isEmptyValue(row, prop)) return op === 'neq';
      const n = Number(v);
      const t = Number(f.value);
      if (op === 'eq') return n === t;
      if (op === 'neq') return n !== t;
      if (op === 'gt') return n > t;
      if (op === 'lt') return n < t;
      if (op === 'gte') return n >= t;
      if (op === 'lte') return n <= t;
      return true;
    }
    case 'select':
    case 'status': {
      const vals: string[] = Array.isArray(f.value) ? f.value : [f.value];
      const hit = vals.includes(v);
      return op === 'is_not' ? !hit : hit;
    }
    case 'multi_select':
    case 'person': {
      const vals: string[] = Array.isArray(f.value) ? f.value : [f.value];
      const have: string[] = Array.isArray(v) ? v : [];
      const hit = vals.some(x => have.includes(x));
      return op === 'not_contains' ? !hit : hit;
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const k = dateKeyOf(row, prop);
      if (!k) return false;
      const t = String(f.value);
      if (op === 'is') return k === t;
      if (op === 'before') return k < t;
      if (op === 'after') return k > t;
      return true;
    }
    default: {
      const s = String(v ?? '').toLowerCase();
      const t = String(f.value ?? '').toLowerCase();
      if (op === 'contains') return s.includes(t);
      if (op === 'not_contains') return !s.includes(t);
      if (op === 'is') return s === t;
      if (op === 'is_not') return s !== t;
      return true;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

function sortKey(row: Page, prop: Property): number | string | null {
  if (isEmptyValue(row, prop) && prop.type !== 'checkbox') return null;
  const v = rawValue(row, prop);
  switch (prop.type) {
    case 'number':
    case 'created_time':
    case 'last_edited_time':
      return Number(v);
    case 'checkbox':
      return v ? 1 : 0;
    case 'select':
    case 'status': {
      const i = (prop.options || []).findIndex(o => o.id === v);
      return i < 0 ? null : i;
    }
    case 'date':
      return v.start;
    default:
      return textValue(row, prop).toLowerCase();
  }
}

export function applyView(rows: Page[], schema: Property[], view: DbView, query: string): Page[] {
  let out = rows;
  const q = query.trim().toLowerCase();
  if (q) out = out.filter(r => (r.title || '').toLowerCase().includes(q));
  for (const f of view.filters || []) {
    const prop = schema.find(p => p.id === f.propId);
    if (!prop) continue;
    out = out.filter(r => matchFilter(r, prop, f));
  }
  const sorts = (view.sorts || []).filter(s => schema.some(p => p.id === s.propId));
  if (sorts.length) {
    out = [...out].sort((a, b) => {
      for (const s of sorts) {
        const prop = schema.find(p => p.id === s.propId)!;
        const ka = sortKey(a, prop);
        const kb = sortKey(b, prop);
        if (ka === kb) continue;
        // Empty values always sort last.
        if (ka === null) return 1;
        if (kb === null) return -1;
        let c = 0;
        if (typeof ka === 'number' && typeof kb === 'number') c = ka - kb;
        else c = String(ka).localeCompare(String(kb), undefined, { numeric: true });
        if (c !== 0) return s.dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Properties shown in a view                                          */
/* ------------------------------------------------------------------ */

/** Schema in view order (title first). */
export function orderedProps(schema: Property[], view: DbView): Property[] {
  if (!view.order || !view.order.length) return schema;
  const idx = (id: string) => {
    const i = view.order!.indexOf(id);
    return i < 0 ? 9999 + schema.findIndex(p => p.id === id) : i;
  };
  const rest = schema.filter(p => p.type !== 'title').sort((a, b) => idx(a.id) - idx(b.id));
  const title = schema.find(p => p.type === 'title');
  return title ? [title, ...rest] : rest;
}

export function visibleProps(schema: Property[], view: DbView): Property[] {
  return orderedProps(schema, view).filter(p => p.type === 'title' || !(view.hidden || []).includes(p.id));
}

export const TYPE_LABEL: Record<PropType, string> = {
  title: 'Title', text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', status: 'Status',
  date: 'Date', person: 'Person', checkbox: 'Checkbox', url: 'URL', email: 'Email', phone: 'Phone',
  created_time: 'Created time', last_edited_time: 'Last edited time',
};

export const ADDABLE_TYPES: PropType[] = [
  'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone', 'created_time', 'last_edited_time',
];

/** Strips tags from block html for content previews. */
export function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** CSS background value for a page cover. */
export function coverBackground(cover: string): string {
  if (/^(data:|https?:)/.test(cover)) return `url("${cover}") center / cover no-repeat`;
  if (/^url\(/.test(cover)) return `${cover} center / cover no-repeat`;
  return cover;
}

/** Per-view local preference stored in localStorage (guarded). */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
