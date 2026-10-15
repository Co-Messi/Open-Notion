import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addDays, applyView, diffDays, dotColor, fmtDate, fmtDateValue, fmtNumber, fmtTime, fmtTimeShort, fmtTimestamp, matchFilter,
  monthLabel, orderRange, parseDateValue, parseLooseDate, setLocale, shiftDate, shortMonth, todayYmd, weekdayName, weekStartDay, ymd,
} from './logic';
import type { DbView, Filter, Page, Property } from '../store/types';

/** ICU puts a narrow no break space before AM and PM; compare with a plain space. */
const plain = (s: string) => s.split(String.fromCharCode(0x202f)).join(' ').split(String.fromCharCode(0xa0)).join(' ');

const ZONES = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC'];
const originalTz = process.env.TZ;

function setZone(tz: string | undefined) {
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
}

afterEach(() => {
  setZone(originalTz);
  setLocale(undefined);
});

beforeEach(() => setLocale('en-US'));

describe.each(ZONES)('date helpers in %s', zone => {
  beforeEach(() => setZone(zone));

  it('reports the zone we asked for', () => {
    // Node may report the legacy alias (Asia/Calcutta) for the same zone.
    expect([zone, 'Asia/Calcutta']).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('adds days one at a time through two whole years, including every DST change', () => {
    let day = '2023-12-31';
    for (let i = 0; i < 731; i++) {
      const next = addDays(day, 1);
      expect(diffDays(day, next), `${day} -> ${next}`).toBe(1);
      expect(next > day, `${day} -> ${next}`).toBe(true);
      day = next;
    }
    expect(day).toBe('2025-12-31');
  });

  it('adds and subtracts across the spring and autumn changes', () => {
    for (const [d, n, expected] of [
      ['2024-03-09', 2, '2024-03-11'],
      ['2024-03-10', 1, '2024-03-11'],
      ['2024-03-31', 1, '2024-04-01'],
      ['2024-10-27', -1, '2024-10-26'],
      ['2024-11-03', 1, '2024-11-04'],
      ['2024-11-03', -3, '2024-10-31'],
      ['2024-09-29', 1, '2024-09-30'],
      ['2025-04-06', -1, '2025-04-05'],
      ['2024-02-28', 2, '2024-03-01'],
      ['2024-12-31', 1, '2025-01-01'],
    ] as const) {
      expect(addDays(d, n), `${d} + ${n}`).toBe(expected);
    }
  });

  it('counts whole days over a DST change', () => {
    expect(diffDays('2024-03-09', '2024-03-12')).toBe(3);
    expect(diffDays('2024-10-26', '2024-10-29')).toBe(3);
    expect(diffDays('2024-11-02', '2024-11-05')).toBe(3);
    expect(diffDays('2024-09-28', '2024-09-30')).toBe(2);
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366);
    expect(diffDays('2024-05-05', '2024-05-01')).toBe(-4);
  });

  it('keeps the time part when shifting', () => {
    expect(shiftDate('2024-03-09T02:30', 1)).toBe('2024-03-10T02:30');
    expect(shiftDate('2024-03-10T02:30', 1)).toBe('2024-03-11T02:30');
    expect(shiftDate('2024-11-03T01:30', -1)).toBe('2024-11-02T01:30');
    expect(shiftDate('2024-09-29', 1)).toBe('2024-09-30');
  });

  it('formats wall clock values without shifting them', () => {
    // 02:30 does not exist on 2024-03-10 in New York, but a stored value must read the same.
    expect(plain(fmtTime('02:30'))).toBe('2:30 AM');
    expect(plain(fmtDateValue({ start: '2024-03-10T02:30' }))).toBe('March 10, 2024 2:30 AM');
    expect(fmtDate('2024-11-03')).toBe('November 3, 2024');
    expect(fmtDate('2024-12-31T23:59')).toBe('December 31, 2024');
    expect(fmtDate('2024-01-01')).toBe('January 1, 2024');
  });

  it('formats a range with and without times', () => {
    expect(fmtDateValue({ start: '2024-03-09', end: '2024-03-12' })).toBe('Mar 9 → Mar 12, 2024');
    expect(fmtDateValue({ start: '2024-12-30', end: '2025-01-02' })).toBe('Dec 30, 2024 → Jan 2, 2025');
    expect(plain(fmtDateValue({ start: '2024-03-10T09:00', end: '2024-03-10T17:30' }))).toBe('March 10, 2024 9:00 AM → 5:30 PM');
  });

  it('round trips ymd through local dates', () => {
    for (const s of ['2024-03-10', '2024-11-03', '2024-10-27', '2024-09-29', '2025-04-06', '2024-02-29']) {
      expect(ymd(new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8)), 12))).toBe(s);
    }
    expect(todayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('orders ranges by instant, not by string', () => {
    expect(orderRange('2024-03-10T10:00', '2024-03-10')).toEqual(['2024-03-10T10:00', '2024-03-10']);
    expect(orderRange('2024-03-10', '2024-03-10T10:00')).toEqual(['2024-03-10', '2024-03-10T10:00']);
    expect(orderRange('2024-03-10T10:00', '2024-03-10T09:00')).toEqual(['2024-03-10T09:00', '2024-03-10T10:00']);
    expect(orderRange('2024-03-11', '2024-03-10T10:00')).toEqual(['2024-03-10T10:00', '2024-03-11']);
    expect(orderRange('2024-11-03T01:30', '2024-11-03T02:30')).toEqual(['2024-11-03T01:30', '2024-11-03T02:30']);
    expect(orderRange('2024-03-10')).toEqual(['2024-03-10', undefined]);
    expect(orderRange('2024-03-10', '2024-03-10')).toEqual(['2024-03-10', '2024-03-10']);
  });

  it('formats an instant in the viewer zone', () => {
    const t = new Date(2024, 2, 10, 15, 4).getTime();
    expect(plain(fmtTimestamp(t))).toBe('March 10, 2024 3:04 PM');
  });
});

describe('locale aware formatting', () => {
  it('follows the locale for dates, times and months', () => {
    setLocale('de-DE');
    expect(fmtDate('2024-03-10')).toBe('10. März 2024');
    expect(fmtTime('15:04')).toBe('15:04');
    expect(monthLabel(2024, 2)).toBe('März 2024');
    expect(weekdayName(1, 'short')).toMatch(/^Mo/);
    setLocale('en-GB');
    expect(fmtDate('2024-03-10')).toBe('10 March 2024');
    expect(fmtTimeShort('15:00')).toBe('15');
    setLocale('ja-JP');
    expect(fmtDate('2024-03-10')).toBe('2024年3月10日');
    expect(shortMonth(2)).toBe('3月');
  });

  it('keeps the English 12 hour clock for en-US', () => {
    expect(plain(fmtTime('00:05'))).toBe('12:05 AM');
    expect(plain(fmtTime('12:00'))).toBe('12:00 PM');
    expect(plain(fmtTime('23:59'))).toBe('11:59 PM');
    expect(plain(fmtTimeShort('10:00'))).toBe('10 AM');
    expect(plain(fmtTimeShort('10:30'))).toBe('10:30 AM');
    expect(fmtTime('nope')).toBe('');
  });

  it('falls back when the locale is invalid', () => {
    setLocale('not a locale');
    expect(fmtDate('2024-03-10')).toMatch(/2024/);
  });

  it('formats numbers and currencies with Intl', () => {
    expect(fmtNumber(1234.5, 'dollar')).toBe('$1,234.50');
    expect(fmtNumber(1234.5, 'euro')).toBe('€1,234.50');
    expect(fmtNumber(0.1234, 'percent')).toBe('12.34%');
    expect(fmtNumber(1234.5)).toBe('1234.5');
    expect(fmtNumber(1234.5, 'number')).toBe('1234.5');
    expect(fmtNumber(0, 'dollar')).toBe('$0.00');
    expect(fmtNumber('', 'dollar')).toBe('');
    expect(fmtNumber('abc')).toBe('');
    expect(fmtNumber(1234.5, 'pound')).toBe('£1,234.50');
    expect(fmtNumber(1234.5, 'yen')).toBe('¥1,235');
    setLocale('de-DE');
    expect(fmtNumber(1234.5)).toBe('1234,5');
    expect(plain(fmtNumber(1234.5, 'euro'))).toBe('1.234,50 €');
    expect(plain(fmtNumber(0.5, 'percent'))).toBe('50 %');
  });

  it('parses typed dates in the locale order and by month name', () => {
    const now = new Date(2024, 5, 15);
    expect(parseLooseDate('2024-01-05', now)).toBe('2024-01-05');
    expect(parseLooseDate('January 5, 2024', now)).toBe('2024-01-05');
    expect(parseLooseDate('5 Jan 2024', now)).toBe('2024-01-05');
    expect(parseLooseDate('Jan 5', now)).toBe('2024-01-05');
    expect(parseLooseDate('1/5/2024', now)).toBe('2024-01-05');
    expect(parseLooseDate('13/5/2024', now)).toBe(null);
    expect(parseLooseDate('2024-02-30', now)).toBe(null);
    expect(parseLooseDate('', now)).toBe(null);
    setLocale('en-GB');
    expect(parseLooseDate('1/5/2024', now)).toBe('2024-05-01');
    setLocale('de-DE');
    expect(parseLooseDate('5. März 2024', now)).toBe('2024-03-05');
    expect(parseLooseDate('5 March 2024', now)).toBe('2024-03-05');
    setLocale('ja-JP');
    expect(parseLooseDate('2024/3/5', now)).toBe('2024-03-05');
  });

  it('parses text into date values with times and ranges', () => {
    const now = new Date(2024, 5, 15);
    expect(parseDateValue('2024-01-05', now)).toEqual({ start: '2024-01-05' });
    expect(parseDateValue('2024-01-05T10:30', now)).toEqual({ start: '2024-01-05T10:30' });
    expect(parseDateValue('January 5, 2024 3:30 PM', now)).toEqual({ start: '2024-01-05T15:30' });
    expect(parseDateValue('2024-01-05 → 2024-01-07', now)).toEqual({ start: '2024-01-05', end: '2024-01-07' });
    expect(parseDateValue('2024-01-07 → 2024-01-05', now)).toEqual({ start: '2024-01-05', end: '2024-01-07' });
    expect(parseDateValue('2024-01-05T09:00 → 2024-01-05T10:00', now)).toEqual({ start: '2024-01-05T09:00', end: '2024-01-05T10:00' });
    expect(parseDateValue('hello', now)).toBe(null);
  });

  it('keeps the week start configurable and falls back to the locale', () => {
    localStorage.setItem('on:week-monday', '1');
    expect(weekStartDay()).toBe(1);
    localStorage.setItem('on:week-monday', '0');
    expect(weekStartDay()).toBe(0);
    localStorage.removeItem('on:week-monday');
    setLocale('en-US');
    expect(weekStartDay()).toBe(0);
    setLocale('de-DE');
    expect(weekStartDay()).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Filters and sorts                                                   */
/* ------------------------------------------------------------------ */

const opts = [
  { id: 'o1', name: 'Alpha', color: 'blue' as const },
  { id: 'o2', name: 'Beta', color: 'red' as const },
  { id: 'o3', name: 'Gamma', color: 'green' as const },
];
const props: Record<string, Property> = {
  title: { id: 'title', name: 'Name', type: 'title' },
  text: { id: 'text', name: 'Text', type: 'text' },
  num: { id: 'num', name: 'Num', type: 'number' },
  sel: { id: 'sel', name: 'Sel', type: 'select', options: opts },
  multi: { id: 'multi', name: 'Multi', type: 'multi_select', options: opts },
  chk: { id: 'chk', name: 'Chk', type: 'checkbox' },
  date: { id: 'date', name: 'Date', type: 'date' },
  person: { id: 'person', name: 'Person', type: 'person' },
  created: { id: 'created', name: 'Created', type: 'created_time' },
};
const schema = Object.values(props);

function row(id: string, title: string, p: Record<string, any> = {}, createdAt = 1000): Page {
  return { id, title, parentId: null, content: [], createdAt, updatedAt: createdAt, props: p, dbId: 'db' };
}
const f = (propId: string, op: string, value?: any): Filter => ({ id: 'f', propId, op, value });

const rows: Page[] = [
  row('r1', 'Charlie', { text: 'Hello World', num: 5, sel: 'o1', multi: ['o1', 'o2'], chk: true, date: { start: '2024-03-10' }, person: ['me'] }, new Date(2024, 2, 10).getTime()),
  row('r2', 'alice', { text: 'hello', num: 0, sel: 'o2', multi: ['o3'], chk: false, date: { start: '2024-03-09T10:00', end: '2024-03-12' }, person: ['Bob', 'me'] }, new Date(2024, 2, 9).getTime()),
  row('r3', 'Bob', { text: '', sel: 'o3', multi: [] }, new Date(2024, 2, 11).getTime()),
  row('r4', 'bob2', { num: 12, sel: 'missing', date: { start: '2024-03-12' } }, new Date(2024, 2, 8).getTime()),
  row('r5', 'Bob10', { num: -3.5 }, new Date(2024, 2, 7).getTime()),
];
const ids = (rs: Page[]) => rs.map(r => r.id);
const run = (...filters: Filter[]) => ids(applyView(rows, schema, { id: 'v', name: 'v', type: 'table', hidden: [], filters, sorts: [] } as DbView, ''));
const sortBy = (propId: string, dir: 'asc' | 'desc') =>
  ids(applyView(rows, schema, { id: 'v', name: 'v', type: 'table', hidden: [], filters: [], sorts: [{ id: 's', propId, dir }] } as DbView, ''));

describe('filter semantics', () => {
  it('text', () => {
    expect(run(f('text', 'contains', 'HELLO'))).toEqual(['r1', 'r2']);
    expect(run(f('text', 'not_contains', 'hello'))).toEqual(['r3', 'r4', 'r5']);
    expect(run(f('text', 'is', 'hello'))).toEqual(['r2']);
    expect(run(f('text', 'is_not', 'hello'))).toEqual(['r1', 'r3', 'r4', 'r5']);
    expect(run(f('text', 'empty'))).toEqual(['r3', 'r4', 'r5']);
    expect(run(f('text', 'not_empty'))).toEqual(['r1', 'r2']);
    expect(run(f('title', 'contains', 'bob'))).toEqual(['r3', 'r4', 'r5']);
  });

  it('an empty value filter does not constrain', () => {
    expect(run(f('text', 'contains', ''))).toHaveLength(5);
    expect(run(f('sel', 'is', []))).toHaveLength(5);
  });

  it('number keeps zero and negatives', () => {
    expect(run(f('num', 'eq', 0))).toEqual(['r2']);
    expect(run(f('num', 'gt', 0))).toEqual(['r1', 'r4']);
    expect(run(f('num', 'lte', 0))).toEqual(['r2', 'r5']);
    expect(run(f('num', 'neq', 5))).toEqual(['r2', 'r3', 'r4', 'r5']);
    expect(run(f('num', 'empty'))).toEqual(['r3']);
    expect(run(f('num', 'not_empty'))).toEqual(['r1', 'r2', 'r4', 'r5']);
  });

  it('select and multi select', () => {
    expect(run(f('sel', 'is', ['o1', 'o2']))).toEqual(['r1', 'r2']);
    expect(run(f('sel', 'is_not', ['o1']))).toEqual(['r2', 'r3', 'r4', 'r5']);
    expect(run(f('sel', 'empty'))).toEqual(['r4', 'r5']);
    expect(run(f('multi', 'contains', ['o2', 'o3']))).toEqual(['r1', 'r2']);
    expect(run(f('multi', 'not_contains', ['o1']))).toEqual(['r2', 'r3', 'r4', 'r5']);
    expect(run(f('multi', 'empty'))).toEqual(['r3', 'r4', 'r5']);
  });

  it('checkbox, person and dates', () => {
    expect(run(f('chk', 'checked'))).toEqual(['r1']);
    expect(run(f('chk', 'unchecked'))).toEqual(['r2', 'r3', 'r4', 'r5']);
    expect(run(f('person', 'contains', ['me']))).toEqual(['r1', 'r2']);
    expect(run(f('date', 'is', '2024-03-09'))).toEqual(['r2']);
    expect(run(f('date', 'before', '2024-03-10'))).toEqual(['r2']);
    expect(run(f('date', 'after', '2024-03-10'))).toEqual(['r4']);
    expect(run(f('date', 'empty'))).toEqual(['r3', 'r5']);
    expect(run(f('created', 'is', '2024-03-11'))).toEqual(['r3']);
    expect(run(f('created', 'before', '2024-03-09'))).toEqual(['r4', 'r5']);
  });

  it('several filters combine with and', () => {
    expect(run(f('num', 'gt', 0), f('sel', 'is', ['o1']))).toEqual(['r1']);
  });

  it('unknown properties are skipped', () => {
    expect(run(f('gone', 'is', 'x'))).toHaveLength(5);
  });
});

describe('sort semantics', () => {
  it('title is case insensitive and natural', () => {
    expect(sortBy('title', 'asc')).toEqual(['r2', 'r3', 'r4', 'r5', 'r1']);
  });

  it('numbers sort numerically with empties last in both directions', () => {
    expect(sortBy('num', 'asc')).toEqual(['r5', 'r2', 'r1', 'r4', 'r3']);
    expect(sortBy('num', 'desc')).toEqual(['r4', 'r1', 'r2', 'r5', 'r3']);
  });

  it('select sorts by option order and drops unknown ids last', () => {
    expect(sortBy('sel', 'asc').slice(0, 3)).toEqual(['r1', 'r2', 'r3']);
    expect(sortBy('sel', 'desc').slice(0, 3)).toEqual(['r3', 'r2', 'r1']);
  });

  it('dates sort by start', () => {
    expect(sortBy('date', 'asc').slice(0, 3)).toEqual(['r2', 'r1', 'r4']);
  });

  it('created time sorts by instant', () => {
    expect(sortBy('created', 'asc')).toEqual(['r5', 'r4', 'r2', 'r1', 'r3']);
  });

  it('is stable for equal keys and does not mutate the input', () => {
    const before = ids(rows);
    sortBy('chk', 'asc');
    expect(ids(rows)).toEqual(before);
    expect(sortBy('chk', 'desc')[0]).toBe('r1');
  });

  it('breaks ties with the next sort', () => {
    const v = { id: 'v', name: 'v', type: 'table', hidden: [], filters: [], sorts: [{ id: 's1', propId: 'chk', dir: 'asc' }, { id: 's2', propId: 'num', dir: 'desc' }] } as DbView;
    expect(ids(applyView(rows, schema, v, ''))).toEqual(['r4', 'r2', 'r5', 'r3', 'r1']);
  });

  it('colors fall back to gray', () => {
    expect(dotColor('blue')).toContain('blue');
    expect(dotColor(undefined)).toContain('gray');
  });

  it('matchFilter agrees with applyView for a single row', () => {
    expect(matchFilter(rows[0], props.num, f('num', 'eq', 5))).toBe(true);
    expect(matchFilter(rows[1], props.num, f('num', 'eq', 5))).toBe(false);
  });
});
