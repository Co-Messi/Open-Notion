import type { ColorName, DbView, Filter, Page, Property, PropType, SelectOption } from '../store/types';

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

/** Colors that have their own theme tokens; anything else falls back to gray. */
const KNOWN_COLORS = new Set<string>(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);

export function optionStyle(color: ColorName | undefined): { background: string; color: string } {
  const a = !!color && KNOWN_COLORS.has(color);
  if (!a) return { background: 'var(--theme-gray-tint-2)', color: 'var(--text-primary)' };
  return { background: `var(--theme-${color}-wash-3)`, color: `var(--theme-${color}-ink-strong)` };
}

export function dotColor(color: ColorName | undefined): string {
  const a = !!color && KNOWN_COLORS.has(color);
  return a ? `var(--theme-${color}-glyph)` : 'var(--theme-gray-glyph)';
}

export function columnTint(color: ColorName | undefined): string {
  const a = !!color && KNOWN_COLORS.has(color);
  return a ? `var(--theme-${color}-wash-1)` : 'var(--theme-gray-wash-1)';
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

/* Locale aware formatting. UI strings stay English; dates, times and numbers follow the
   user's locale (navigator.language). Wall clock values ("2024-01-05T10:00") are formatted
   through a UTC clock so they never shift with the zone or fall into a DST gap. */

let localeOverride: string | undefined;
const dtfCache = new Map<string, Intl.DateTimeFormat>();
const nfCache = new Map<string, Intl.NumberFormat>();

/** Overrides the locale (tests and future settings). Pass undefined to follow the browser. */
export function setLocale(locale?: string) {
  localeOverride = locale;
  dtfCache.clear();
  nfCache.clear();
}

export function getLocale(): string | undefined {
  if (localeOverride) return localeOverride;
  try {
    return typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined;
  } catch {
    return undefined;
  }
}

function utcDtf(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const loc = getLocale();
  const key = (loc || '') + JSON.stringify(opts);
  let f = dtfCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(loc, { ...opts, timeZone: 'UTC' });
    } catch {
      f = new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' });
    }
    dtfCache.set(key, f);
  }
  return f;
}

function wall(y: number, m: number, d: number, h = 0, mi = 0): Date {
  const dt = new Date(Date.UTC(2000, m, d, h, mi));
  dt.setUTCFullYear(y);
  return dt;
}

function numberFmt(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const loc = getLocale();
  const key = (loc || '') + JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(loc, opts);
    } catch {
      f = new Intl.NumberFormat(undefined, opts);
    }
    nfCache.set(key, f);
  }
  return f;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function fmtDate(s: string | undefined): string {
  const m = s ? YMD_RE.exec(s.slice(0, 10)) : null;
  if (!m) return '';
  return utcDtf({ year: 'numeric', month: 'long', day: 'numeric' }).format(wall(+m[1], +m[2] - 1, +m[3]));
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

/**
 * Orders a range by actual instants. A date without a time covers its whole day: it is the
 * start of the day as a start and the end of the day as an end, so "10:00" to a bare same
 * day end is a valid range and is not swapped.
 */
export function orderRange(start: string, end?: string): [string, string | undefined] {
  if (!end) return [start, undefined];
  const at = (s: string, edge: 'start' | 'end'): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
    if (!m) return null;
    if (m[4] !== undefined) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    return edge === 'start' ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime();
  };
  const ts = at(start, 'start');
  const te = at(end, 'end');
  if (ts !== null && te !== null && te < ts) return [end, start];
  return [start, end];
}

export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return utcDtf({ hour: 'numeric', minute: '2-digit' }).format(wall(2000, 0, 1, h, m || 0));
}

/** Compact time for calendar chips: "10 AM", "10:30 AM" (or "10:30" on a 24 hour locale). */
export function fmtTimeShort(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return utcDtf(m ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' }).format(wall(2000, 0, 1, h, m || 0));
}

export const monthName = (m: number): string => utcDtf({ month: 'long' }).format(wall(2000, m, 1));
export const shortMonth = (m: number): string => utcDtf({ month: 'short' }).format(wall(2000, m, 1));

/** Weekday name for 0 = Sunday .. 6 = Saturday. */
export function weekdayName(day: number, style: 'long' | 'short' | 'narrow' = 'short'): string {
  return utcDtf({ weekday: style }).format(wall(2024, 0, 7 + day));
}

/** Short date without a year, for chips: "Oct 5". */
export function fmtMonthDay(y: number, m: number, d: number): string {
  return utcDtf({ month: 'short', day: 'numeric' }).format(wall(y, m, d));
}

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
  const short = (d: Date, withYear: boolean) =>
    utcDtf(withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }).format(wall(d.getFullYear(), d.getMonth(), d.getDate()));
  const sameYear = ds.getFullYear() === de.getFullYear();
  const a = `${short(ds, !sameYear)}${timeOf(s) ? ' ' + fmtTime(timeOf(s)) : ''}`;
  const b = `${short(de, true)}${timeOf(e) ? ' ' + fmtTime(timeOf(e)) : ''}`;
  return `${a} → ${b}`;
}

/** A real instant (created and edited times), shown in the viewer's zone. */
export function fmtTimestamp(t: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const loc = getLocale();
  let date: string;
  let time: string;
  try {
    date = d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' });
    time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  } catch {
    date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return `${date} ${time}`;
}

export function monthLabel(y: number, m: number): string {
  return utcDtf({ month: 'long', year: 'numeric' }).format(wall(y, m, 1));
}

/** "Oct 2026", for the compact date picker header. */
export function shortMonthLabel(y: number, m: number): string {
  return utcDtf({ month: 'short', year: 'numeric' }).format(wall(y, m, 1));
}

/** The order of day, month and year in numeric dates for the current locale. */
function numericDateOrder(): Array<'day' | 'month' | 'year'> {
  const parts = utcDtf({ year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(wall(2001, 1, 3));
  const order = parts.map(p => p.type).filter((t): t is 'day' | 'month' | 'year' => t === 'day' || t === 'month' || t === 'year');
  return order.length === 3 ? order : ['month', 'day', 'year'];
}

function monthLookup(): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string, i: number) => out.set(name.toLowerCase().replace(/\.$/, ''), i);
  for (let i = 0; i < 12; i++) {
    add(monthName(i), i);
    add(shortMonth(i), i);
    add(new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(wall(2000, i, 1)), i);
    add(new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(wall(2000, i, 1)), i);
  }
  return out;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1 || y > 9999) return null;
  const dt = new Date(y, m, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
  return ymd(dt);
}

/**
 * Parses a typed or stored date: ISO ("2024-01-05"), a month name in the user's locale or in
 * English ("5 Jan 2024", "January 5, 2024"), or numeric parts in the locale's order. Returns
 * 'YYYY-MM-DD' or null.
 */
export function parseLooseDate(input: string, now: Date = new Date()): string | null {
  const t = input.trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return validYmd(+iso[1], +iso[2] - 1, +iso[3]);
  const tokens = t.match(/\p{L}+\.?|\d+/gu) || [];
  const words = tokens.filter(x => /^\p{L}/u.test(x));
  const nums = tokens.filter(x => /^\d/.test(x));
  const year = (x: string) => (x.length <= 2 ? 2000 + +x : +x);
  if (words.length) {
    const months = monthLookup();
    let mi = -1;
    for (const w of words) {
      const k = months.get(w.toLowerCase().replace(/\.$/, ''));
      if (k !== undefined) {
        mi = k;
        break;
      }
    }
    if (mi >= 0) {
      const yr = nums.find(n => n.length >= 3 || +n > 31);
      const dy = nums.find(n => n !== yr && +n >= 1 && +n <= 31);
      if (!dy) return null;
      return validYmd(yr ? year(yr) : now.getFullYear(), mi, +dy);
    }
  }
  if (nums.length >= 2 && nums.length <= 3 && words.length === 0) {
    const order = numericDateOrder();
    const md = order.filter(o => o !== 'year');
    let y = now.getFullYear();
    let rest = nums;
    const yi = nums.findIndex(n => n.length >= 3);
    if (nums.length === 3) {
      if (yi >= 0) {
        y = +nums[yi];
        rest = nums.filter((_, i) => i !== yi);
      } else {
        const pos = order.indexOf('year');
        y = year(nums[pos]);
        rest = nums.filter((_, i) => i !== pos);
      }
    } else if (yi >= 0) {
      return null;
    }
    const v: Record<string, number> = {};
    md.forEach((k, i) => (v[k] = +rest[i]));
    return validYmd(y, v.month - 1, v.day);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : ymd(d);
}

/**
 * Parses text into a date value, with an optional time ("10:30", "10:30 PM", "T10:30") and an
 * optional range ("a → b", "a to b"). Returns null when the date part cannot be read.
 */
export function parseDateValue(input: string, now: Date = new Date()): { start: string; end?: string } | null {
  const parts = input.split(/\s+(?:→|to|\u2013|\u2014)\s+/).map(x => x.trim());
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return null;
  const one = (x: string): string | null => {
    let time = '';
    let rest = x;
    const tm = /(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(x);
    if (tm) {
      let h = +tm[1];
      const ap = tm[3]?.toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (h > 23 || +tm[2] > 59) return null;
      time = `${pad(h)}:${tm[2]}`;
      rest = x.slice(0, tm.index);
    }
    const day = parseLooseDate(rest, now);
    return day ? withTime(day, time) : null;
  };
  const s = one(parts[0]);
  if (!s) return null;
  if (parts.length === 1) return { start: s };
  const e = one(parts[1]);
  if (!e) return null;
  const [a, b] = orderRange(s, e);
  return b && b !== a ? { start: a, end: b } : { start: a };
}

/** First day of the week: 0 = Sunday .. 6 = Saturday. The user's setting wins, else the locale. */
export function weekStartDay(): number {
  const pref = readPref('on:week-monday');
  if (pref === '1') return 1;
  if (pref === '0') return 0;
  try {
    const loc: any = new Intl.Locale(getLocale() || 'en-US');
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    if (info && typeof info.firstDay === 'number') return info.firstDay % 7;
  } catch {
    /* fall through */
  }
  return 0;
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

/** Currency codes behind the money formats. Names are the stored ids, codes are ISO 4217. */
export const CURRENCY_CODES: Record<string, string> = {
  dollar: 'USD', euro: 'EUR', pound: 'GBP', yen: 'JPY', yuan: 'CNY', rupee: 'INR', won: 'KRW', franc: 'CHF',
  canadian_dollar: 'CAD', australian_dollar: 'AUD',
};

export const NUMBER_FORMAT_LABEL: Record<string, string> = {
  number: 'Number', percent: 'Percent', dollar: 'US dollar', euro: 'Euro', pound: 'Pound', yen: 'Yen', yuan: 'Yuan',
  rupee: 'Rupee', won: 'Won', franc: 'Swiss franc', canadian_dollar: 'Canadian dollar', australian_dollar: 'Australian dollar',
};

export function fmtNumber(v: any, format?: Property['numberFormat']): string {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return '';
  if (format === 'percent') return numberFmt({ style: 'percent', maximumFractionDigits: 4 }).format(n);
  const code = format ? CURRENCY_CODES[format] : undefined;
  if (code) return numberFmt({ style: 'currency', currency: code }).format(n);
  return numberFmt({ useGrouping: false, maximumFractionDigits: 20 }).format(n);
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
