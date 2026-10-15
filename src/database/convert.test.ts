import { describe, expect, it } from 'vitest';
import type { DbView, Page, Property, PropType, SelectOption } from '../store/types';
import { fixFiltersForDeletedOption, fixViewsForTypeChange, parseNumberText, planTypeChange, remapFilter, stashKey, type ConvertCtx } from './convert';
import { opsFor } from './logic';

let counter = 0;
const ctx: ConvertCtx = {
  userName: 'Brayden',
  newId: () => 'n' + ++counter,
  newColor: () => 'purple',
  statusDefaults: () => [
    { id: 'd1', name: 'Not started', color: 'default', group: 'todo' },
    { id: 'd2', name: 'In progress', color: 'blue', group: 'in_progress' },
    { id: 'd3', name: 'Done', color: 'green', group: 'complete' },
  ],
};

const OPTIONS: SelectOption[] = [
  { id: 'o1', name: 'Alpha', color: 'blue', group: 'todo' },
  { id: 'o2', name: 'Beta', color: 'red', group: 'in_progress' },
  { id: 'o3', name: '0', color: 'green', group: 'complete' },
];

const ALL: PropType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone', 'created_time', 'last_edited_time'];
const STORED: PropType[] = ALL.filter(t => t !== 'created_time' && t !== 'last_edited_time');

const SAMPLES: Record<string, any[]> = {
  text: ['Hello, world', '5', '2024-01-05', 'yes', ' padded ', 'Alpha', 'Zeta'],
  url: ['https://example.com/x'],
  email: ['a@b.co'],
  phone: ['+1 555 0100'],
  number: [42.5, 0, -3, 1],
  select: ['o1', 'o3'],
  status: ['o2'],
  multi_select: [['o1', 'o2'], ['o2']],
  date: [{ start: '2024-03-09T10:00', end: '2024-03-12' }, { start: '2024-03-10' }],
  person: [['me', 'Bob'], ['Alice']],
  checkbox: [true],
};

function prop(type: PropType): Property {
  const withOptions = type === 'select' || type === 'multi_select' || type === 'status';
  return { id: 'p', name: 'P', type, options: withOptions ? OPTIONS.map(o => ({ ...o })) : undefined };
}

function row(id: string, value: any, extra: Record<string, any> = {}): Page {
  return { id, title: id, parentId: null, content: [], createdAt: Date.UTC(2024, 0, 2, 3, 4), updatedAt: Date.UTC(2024, 5, 6, 7, 8), props: value === undefined ? { ...extra } : { p: value, ...extra } };
}

function apply(p: Property, to: PropType, rows: Page[]) {
  const plan = planTypeChange(p, to, rows, ctx);
  const byId = new Map(plan.changes.map(c => [c.rowId, c.props]));
  const next = rows.map(r => ({ ...r, props: byId.get(r.id) ?? r.props }));
  const nextProp: Property = { ...p, type: to, options: plan.options ?? p.options };
  return { plan, rows: next, prop: nextProp };
}

function validFor(type: PropType, v: any, options: SelectOption[] | undefined): string | null {
  if (v === undefined) return null;
  const ids = (options || []).map(o => o.id);
  switch (type) {
    case 'text': case 'url': case 'email': case 'phone':
      return typeof v === 'string' && v !== '' ? null : `bad text ${JSON.stringify(v)}`;
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? null : `bad number ${JSON.stringify(v)}`;
    case 'select': case 'status':
      return typeof v === 'string' && ids.includes(v) ? null : `bad option ${JSON.stringify(v)}`;
    case 'multi_select':
      return Array.isArray(v) && v.length > 0 && v.every(x => ids.includes(x)) ? null : `bad multi ${JSON.stringify(v)}`;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v?.start) && (!v.end || /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v.end)) ? null : `bad date ${JSON.stringify(v)}`;
    case 'checkbox':
      return typeof v === 'boolean' ? null : `bad checkbox ${JSON.stringify(v)}`;
    case 'person':
      return Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x) ? null : `bad person ${JSON.stringify(v)}`;
    default:
      return `derived type stores ${JSON.stringify(v)}`;
  }
}

describe('changePropertyType matrix', () => {
  for (const from of STORED) {
    for (const to of ALL) {
      if (from === to) continue;
      it(`${from} to ${to}: valid values and an exact round trip back`, () => {
        const p = prop(from);
        const values = SAMPLES[from === 'text' ? 'text' : from];
        const rows = values.map((v, i) => row('r' + i, v));
        rows.push(row('empty', undefined));
        const first = apply(p, to, rows);
        for (const r of first.rows) {
          const bad = validFor(to, r.props?.p, first.prop.options);
          expect(bad, `${from} to ${to} on ${r.id}`).toBeNull();
        }
        // The empty row stays empty and gets no hidden value.
        expect(first.rows.find(r => r.id === 'empty')!.props).toEqual({});
        const back = apply(first.prop, from, first.rows);
        for (const r of rows) {
          // Leaving a created or edited time type fills every row with the page's own time.
          if (r.id === 'empty' && (to === 'created_time' || to === 'last_edited_time')) continue;
          const after = back.rows.find(x => x.id === r.id)!;
          expect(after.props?.p, `${from} to ${to} and back, row ${r.id}`).toEqual(r.props?.p);
          expect(Object.keys(after.props || {}).filter(k => k.startsWith('~prev:'))).toEqual([]);
        }
      });
    }
  }

  for (const from of ['created_time', 'last_edited_time'] as const) {
    for (const to of ALL) {
      if (from === to) continue;
      it(`${from} to ${to} yields valid stored values`, () => {
        const rows = [row('r1', undefined)];
        const out = apply(prop(from), to, rows);
        const v = out.rows[0].props?.p;
        expect(validFor(to, v, out.prop.options), `${from} to ${to}`).toBeNull();
        const back = apply(out.prop, from, out.rows);
        expect(back.rows[0].props?.p).toBeUndefined();
      });
    }
  }
});

describe('lossless conversions', () => {
  const one = (from: PropType, to: PropType, value: any) => {
    const out = apply(prop(from), to, [row('r', value)]);
    return { value: out.rows[0].props?.p, plan: out.plan, prop: out.prop, props: out.rows[0].props };
  };

  it('dates, booleans and persons become text', () => {
    expect(one('date', 'text', { start: '2024-03-09', end: '2024-03-12' }).value).toBe('2024-03-09 → 2024-03-12');
    expect(one('date', 'text', { start: '2024-03-09T10:00' }).value).toBe('2024-03-09T10:00');
    expect(one('checkbox', 'text', true).value).toBe('Yes');
    expect(one('person', 'text', ['me', 'Bob']).value).toBe('Brayden, Bob');
    expect(one('multi_select', 'text', ['o1', 'o2']).value).toBe('Alpha, Beta');
    expect(one('select', 'text', 'o1').value).toBe('Alpha');
    expect(one('number', 'text', 42.5).value).toBe('42.5');
  });

  it('none of those lose anything', () => {
    for (const [from, v] of [['date', { start: '2024-03-09' }], ['checkbox', true], ['person', ['me']], ['select', 'o1'], ['number', 3]] as const) {
      expect(one(from, 'text', v).plan.lost, from).toBe(0);
    }
  });

  it('text parses into dates and numbers when it can', () => {
    expect(one('text', 'date', '2024-03-09').value).toEqual({ start: '2024-03-09' });
    expect(one('text', 'date', '2024-03-09T10:00 → 2024-03-09T11:30').value).toEqual({ start: '2024-03-09T10:00', end: '2024-03-09T11:30' });
    expect(one('text', 'date', 'March 9, 2024').value).toEqual({ start: '2024-03-09' });
    expect(one('text', 'number', '42.5').value).toBe(42.5);
    expect(one('text', 'number', '1,234.5').value).toBe(1234.5);
    expect(one('text', 'number', '$12').value).toBe(12);
    expect(one('text', 'checkbox', 'Yes').value).toBe(true);
    expect(one('text', 'checkbox', 'no').value).toBe(false);
    expect(one('text', 'person', 'Bob, Brayden, me').value).toEqual(['Bob', 'me']);
  });

  it('select to number keeps zero', () => {
    const out = one('select', 'number', 'o3');
    expect(out.value).toBe(0);
    expect(out.plan.lost).toBe(0);
  });

  it('creates options from text for select, multi select and status', () => {
    const sel = one('text', 'select', 'Gamma');
    expect(sel.prop.options!.map(o => o.name)).toContain('Gamma');
    expect(sel.prop.options!.find(o => o.id === sel.value)!.name).toBe('Gamma');
    const multi = one('text', 'multi_select', 'Gamma, Alpha, gamma');
    expect(multi.value).toHaveLength(2);
    const status = apply({ id: 'p', name: 'P', type: 'text' }, 'status', [row('r', 'Done'), row('s', 'Backlog')]);
    expect(status.prop.options!.map(o => o.name)).toEqual(['Not started', 'In progress', 'Done', 'Backlog']);
    expect(status.rows[0].props!.p).toBe('d3');
    expect(status.prop.options!.find(o => o.name === 'Backlog')!.group).toBe('todo');
    expect(status.plan.lost).toBe(0);
  });

  it('reuses an existing option with the same name', () => {
    const stale: Property = { ...prop('select'), type: 'text' };
    const out = apply(stale, 'select', [row('r', 'alpha')]);
    expect(out.rows[0].props!.p).toBe('o1');
    expect(out.prop.options).toHaveLength(3);
  });

  it('keeps options when a property leaves a select type', () => {
    const out = one('select', 'text', 'o1');
    expect(out.prop.options).toHaveLength(3);
    expect(apply(out.prop, 'select', out.plan.changes.length ? [row('r', 'Alpha')] : []).rows[0].props!.p).toBe('o1');
  });

  it('select, multi select and status share option ids', () => {
    expect(one('select', 'multi_select', 'o1').value).toEqual(['o1']);
    expect(one('multi_select', 'select', ['o2']).value).toBe('o2');
    expect(one('select', 'status', 'o1').value).toBe('o1');
    expect(one('status', 'select', 'o2').value).toBe('o2');
    const toStatus = one('select', 'status', 'o1');
    expect(toStatus.prop.options!.every(o => !!o.group)).toBe(true);
  });

  it('creating options does not touch rows that are unchanged', () => {
    const rows = [row('a', 'Alpha'), row('b', undefined)];
    const out = planTypeChange({ id: 'p', name: 'P', type: 'text' }, 'select', rows, ctx);
    expect(out.changes.map(c => c.rowId)).toEqual(['a']);
  });
});

describe('hidden previous values', () => {
  it('keeps what a conversion cannot represent and restores it on the way back', () => {
    const p = prop('text');
    const first = apply(p, 'number', [row('a', 'not a number'), row('b', '12')]);
    expect(first.plan.lost).toBe(1);
    expect(first.rows[0].props!.p).toBeUndefined();
    expect(first.rows[0].props![stashKey('p')].value).toBe('not a number');
    expect(first.rows[1].props!.p).toBe(12);
    const back = apply(first.prop, 'text', first.rows);
    expect(back.plan.restored).toBe(1);
    expect(back.rows[0].props!.p).toBe('not a number');
    expect(back.rows[0].props![stashKey('p')]).toBeUndefined();
    expect(back.rows[1].props!.p).toBe('12');
  });

  it('carries the original through a chain of conversions', () => {
    const first = apply(prop('multi_select'), 'select', [row('a', ['o1', 'o2'])]);
    expect(first.plan.lost).toBe(1);
    expect(first.rows[0].props!.p).toBe('o1');
    const second = apply(first.prop, 'text', first.rows);
    expect(second.rows[0].props!.p).toBe('Alpha');
    const third = apply(second.prop, 'multi_select', second.rows);
    expect(third.rows[0].props!.p).toEqual(['o1', 'o2']);
  });

  it('forgets the original once the converted value was edited', () => {
    const first = apply(prop('text'), 'number', [row('a', 'not a number')]);
    const edited = first.rows.map(r => ({ ...r, props: { ...r.props, p: 7 } }));
    const back = apply(first.prop, 'text', edited);
    expect(back.rows[0].props!.p).toBe('7');
    expect(back.rows[0].props![stashKey('p')]).toBeUndefined();
  });

  it('keeps derived time values recoverable', () => {
    const first = apply(prop('date'), 'created_time', [row('a', { start: '2024-03-09' })]);
    expect(first.plan.lost).toBe(1);
    expect(first.rows[0].props!.p).toBeUndefined();
    const back = apply(first.prop, 'date', first.rows);
    expect(back.rows[0].props!.p).toEqual({ start: '2024-03-09' });
  });

  it('reports lost values only when something cannot be shown', () => {
    expect(planTypeChange(prop('text'), 'select', [row('a', 'x')], ctx).lost).toBe(0);
    expect(planTypeChange(prop('date'), 'number', [row('a', { start: '2024-03-09' })], ctx).lost).toBe(1);
    expect(planTypeChange(prop('multi_select'), 'select', [row('a', ['o1', 'o2'])], ctx).lost).toBe(1);
    expect(planTypeChange(prop('multi_select'), 'select', [row('a', ['o1'])], ctx).lost).toBe(0);
    expect(planTypeChange(prop('text'), 'checkbox', [row('a', 'maybe')], ctx).lost).toBe(1);
  });

  it('parses numbers conservatively', () => {
    expect(parseNumberText(' 12 ')).toBe(12);
    expect(parseNumberText('1e3')).toBe(1000);
    expect(parseNumberText('1,23')).toBe(null);
    expect(parseNumberText('12abc')).toBe(null);
    expect(parseNumberText('')).toBe(null);
    expect(parseNumberText('NaN')).toBe(null);
  });
});

describe('filters after a type change', () => {
  const f = (propId: string, op: string, value?: any) => ({ id: 'f', propId, op, value });
  const view = (filters: ReturnType<typeof f>[]): DbView => ({ id: 'v', name: 'v', type: 'table', hidden: [], filters, sorts: [], groupBy: 'p', dateProp: 'p', calcs: { p: 'sum', q: 'count' } });

  it('keeps filters the new type still understands', () => {
    expect(remapFilter(f('p', 'contains', 'x'), 'text', 'url')).toEqual(f('p', 'contains', 'x'));
    expect(remapFilter(f('p', 'is', ['o1']), 'select', 'status')).toEqual(f('p', 'is', ['o1']));
    expect(remapFilter(f('p', 'empty'), 'text', 'number')).toEqual(f('p', 'empty'));
    expect(remapFilter(f('p', 'before', '2024-01-01'), 'date', 'created_time')).toEqual(f('p', 'before', '2024-01-01'));
  });

  it('remaps between select and multi select', () => {
    expect(remapFilter(f('p', 'is', ['o1']), 'select', 'multi_select')).toEqual(f('p', 'contains', ['o1']));
    expect(remapFilter(f('p', 'is_not', ['o1']), 'select', 'multi_select')).toEqual(f('p', 'not_contains', ['o1']));
    expect(remapFilter(f('p', 'contains', ['o1']), 'multi_select', 'select')).toEqual(f('p', 'is', ['o1']));
    expect(remapFilter(f('p', 'not_contains', ['o1']), 'multi_select', 'select')).toEqual(f('p', 'is_not', ['o1']));
  });

  it('drops filters with an operator or value the new type does not support', () => {
    expect(remapFilter(f('p', 'contains', 'x'), 'text', 'number')).toBeNull();
    expect(remapFilter(f('p', 'gt', 3), 'number', 'text')).toBeNull();
    expect(remapFilter(f('p', 'before', '2024-01-01'), 'date', 'text')).toBeNull();
    expect(remapFilter(f('p', 'empty'), 'text', 'checkbox')).toBeNull();
    expect(remapFilter(f('p', 'checked'), 'checkbox', 'text')).toBeNull();
    expect(remapFilter(f('p', 'is', ['o1']), 'select', 'text')).toBeNull();
    expect(remapFilter(f('p', 'contains', ['me']), 'person', 'multi_select')).toBeNull();
  });

  it('every remapped filter is valid for the new type', () => {
    const ops = (t: PropType) => opsFor(t).map(o => o.id);
    for (const from of ALL) {
      for (const to of ALL) {
        for (const op of ops(from)) {
          const r = remapFilter(f('p', op, 'x'), from, to);
          if (r) expect(ops(to), `${from} ${op} to ${to}`).toContain(r.op);
        }
      }
    }
  });

  it('cleans views: filters, grouping, date property and calculations', () => {
    const out = fixViewsForTypeChange([view([f('p', 'contains', 'x'), f('q', 'is', 'y')])], 'p', 'text', 'number');
    expect(out[0].filters).toEqual([f('q', 'is', 'y')]);
    expect(out[0].groupBy).toBeUndefined();
    expect(out[0].dateProp).toBeUndefined();
    expect(out[0].calcs).toEqual({ q: 'count' });
    const same = fixViewsForTypeChange([view([])], 'p', 'select', 'status');
    expect(same[0].groupBy).toBe('p');
  });

  it('removes a deleted option from filters and drops filters that select nothing', () => {
    const views = [view([f('p', 'is', ['o1', 'o2']), f('p', 'is', ['o1']), f('p', 'is', 'o1'), f('p', 'empty'), f('q', 'is', ['o1'])])];
    const out = fixFiltersForDeletedOption(views, 'p', 'o1');
    expect(out[0].filters).toEqual([f('p', 'is', ['o2']), f('p', 'empty'), f('q', 'is', ['o1'])]);
  });
});
