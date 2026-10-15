import { describe, expect, it } from 'vitest';
import fixture from '../test/fixtures/doc-v2-current.json';
import { CLIP_LIMITS, cleanHtml, normalizeClipboardBlocks, normalizeDoc, normalizeDocWithReport, NotADocError } from './normalize';
import { expectDocInvariants, htmlProblems } from '../test/invariants';
import type { Doc } from './types';
import { createSeed } from './seed';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Shapes that have broken HTML sanitizers before (mXSS, handlers, scheme tricks). */
const XSS = [
  '<img src=x onerror="window.__pwned=1">',
  '<svg><g onload="window.__pwned=1"></g></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=window.__pwned=1>',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=window.__pwned=1>',
  '<noscript><p title="</noscript><img src=x onerror=window.__pwned=1>">',
  '<iframe srcdoc="<script>window.__pwned=1</script>"></iframe>',
  '<script>window.__pwned=1</script>',
  '<b onmouseover=window.__pwned=1>bold</b>',
  '<a href="javascript:alert(1)" onclick="window.__pwned=1">a</a>',
  '<a href="&#106;avascript:alert(1)">entity</a>',
  '<a href=" javascript:alert(1)">space</a>',
  '<a href="//evil.example">protocol relative</a>',
  '<details open ontoggle=window.__pwned=1>d</details>',
  '<span style="background:url(javascript:1)" class="c-red onerror" onfocus=1>t</span>',
  '<template><img src=x onerror=1></template>',
  '<style>@import "//evil"</style>x',
  '<object data="javascript:1"></object><embed src="javascript:1">',
  '<video><source onerror="window.__pwned=1"></video>',
  '<a href="https://ok.example" target="_blank" rel="opener">ok</a>',
];
const BAD_URLS = ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', '//evil.example/x.png', '/\\evil.example', 'vbscript:x', 'data:text/html,<script>1</script>', ' javascript:alert(1)'];

/** A hostile workspace built as JSON text so `__proto__` keys are own properties. */
function hostileDocJson(): string {
  const blocks: Record<string, unknown> = {};
  const content: string[] = [];
  const add = (id: string, b: Record<string, unknown>) => {
    blocks[id] = { id, html: '', children: [], parent: 'pg', createdAt: 1, ...b };
    content.push(id);
  };
  XSS.forEach((h, i) => add(`x${i}`, { type: 'text', html: h }));
  add('code1', { type: 'code', html: '<img src=x onerror=1>', language: 'html' });
  add('tbl1', { type: 'table', rows: XSS.map(h => [h, 'plain', h]) });
  add('tbl2', { type: 'table', rows: 'not rows' });
  add('tbl3', { type: 'table', rows: [['a'], 'bad', [1, { x: 1 }, null, '<img src=x onerror=1>']] });
  BAD_URLS.forEach((u, i) => {
    add(`img${i}`, { type: 'image', url: u });
    add(`bm${i}`, { type: 'bookmark', url: u });
    add(`co${i}`, { type: 'callout', html: 'c', icon: '<img src=x onerror=1>' });
  });
  add('cl1', { type: 'callout', html: 'c', icon: u('javascript:alert(1)') });
  add('garbage1', { type: 'script', html: 'x' });
  add('garbage2', { type: 42 });
  add('nochildren', { type: 'toggle', html: 't', children: undefined });
  add('badchildren', { type: 'toggle', html: 't', children: 'abc' });
  add('dangling', { type: 'toggle', html: 't', children: ['missing1', 'missing2'] });
  add('dup', { type: 'toggle', html: 't', children: ['kid', 'kid'] });
  blocks.kid = { id: 'kid', type: 'text', html: 'k', children: [], parent: 'dup', createdAt: 1 };
  // A cycle that no page can reach.
  blocks.cyc1 = { id: 'cyc1', type: 'toggle', html: 'a', children: ['cyc2'], parent: 'cyc2', createdAt: 1 };
  blocks.cyc2 = { id: 'cyc2', type: 'toggle', html: 'b', children: ['cyc1'], parent: 'cyc1', createdAt: 1 };
  blocks.orphan = { id: 'orphan', type: 'text', html: 'o', children: [], parent: 'pg', createdAt: 1 };
  blocks.wrongid = { id: 'other', type: 'text', html: 'w', children: [], parent: 'pg', createdAt: 1 };
  content.push('wrongid', 'wrongid', 'missing3');
  // A page block inside its own page (H6 shape) plus a duplicate owner.
  add('self', { type: 'page', pageId: 'pg' });
  add('sub1', { type: 'page', pageId: 'sub' });
  add('sub2', { type: 'page', pageId: 'sub' });
  function u(s: string) {
    return s;
  }
  const comments = XSS.map((h, i) => ({ id: `cm${i}`, html: h, createdAt: 1, author: 'x' }));
  const json = JSON.stringify({
    version: 1,
    pages: {
      pg: {
        id: 'pg', title: 'Hostile', parentId: 'pg', content, createdAt: 1, updatedAt: 1, comments,
        icon: '<img src=x onerror=1>', cover: 'url(javascript:alert(1))',
      },
      sub: { id: 'sub', title: 'Sub', parentId: 'pg', content: [], createdAt: 1, updatedAt: 1, cover: 'javascript:alert(1)' },
      db: {
        id: 'db', title: 'DB', parentId: null, content: [], createdAt: 1, updatedAt: 1, isDatabase: true,
        schema: [
          { id: 'title', name: 'Name', type: 'title' },
          { id: 'link', name: 'Link', type: 'url' },
          { id: 'sel', name: 'S', type: 'select', options: [{ id: 'o1', name: 'A', color: 'red' }, { id: '__proto__', name: 'P', color: 'blue' }, { id: 'o2', name: 'B', color: 'not-a-color' }] },
          { id: 'weird', name: 'W', type: 'formula' },
        ],
        views: [
          { id: 'v1', name: 'T', type: 'table', hidden: ['__proto__', 'link'], filters: [{ id: 'f1', propId: 'sel', op: 'is', value: { __proto__: { polluted: 1 }, a: [1, 'b'] } }], sorts: [{ id: 's1', propId: 'link', dir: 'sideways' }], calcs: { title: 'count', constructor: 'sum' } },
          { id: 'v2', name: 'Bad', type: 'spreadsheet', hidden: [], filters: [], sorts: [] },
          'not a view',
        ],
        rows: ['r1', 'r2', 'r1', 'ghost', 'pg'],
      },
      r1: { id: 'r1', title: 'Row', parentId: 'db', dbId: 'db', content: [], createdAt: 1, updatedAt: 1, props: { link: 'javascript:alert(1)', __proto__: { polluted: true }, constructor: 'x', sel: 'o1' } },
      r2: { id: 'r2', title: 'Row 2', parentId: 'db', dbId: 'db', content: [], createdAt: 1, updatedAt: 1, props: { link: 'example.com/ok' } },
      r3: { id: 'r3', title: 'Row 3', parentId: 'nowhere', dbId: 'pg', content: 'nope', createdAt: 'yesterday', updatedAt: null },
      __proto__: { id: '__proto__', title: 'proto', parentId: null, content: [], createdAt: 1, updatedAt: 1 },
      constructor: { id: 'constructor', title: 'ctor', parentId: null, content: [], createdAt: 1, updatedAt: 1 },
      'bad id': { id: 'bad id', title: 'x', parentId: null, content: [], createdAt: 1, updatedAt: 1 },
      str: 'a page that is a string',
    },
    blocks: { ...blocks, __proto__: { id: '__proto__', type: 'text', html: '<img src=x onerror=1>', children: [], parent: 'pg', createdAt: 1 } },
    workspace: {
      name: 'W', icon: 'javascript:alert(1)<', userName: 'You', userEmail: 'a@b.c',
      privatePages: ['pg', 'db', 'missing', '__proto__', 'pg'],
      favorites: ['constructor', 'db', 7],
      teamspaces: [{ id: 'ts', name: 'T', icon: '<b>', pages: ['sub', 'nope'] }, { id: '__proto__', name: 'x', icon: 'x', pages: [] }, null],
    },
    recent: [{ id: 'pg', at: 5 }, { id: 'constructor', at: 4 }, { id: 'pg', at: 3 }, { id: 'missing', at: 2 }, 'junk'],
  });
  return json;
}

describe('normalizeDoc on the recorded fixture', () => {
  it('keeps every field of the current shape (zero loss)', () => {
    const { doc, report } = normalizeDocWithReport(fixture);
    expect(doc).toStrictEqual(fixture);
    expect(report).toEqual({ changes: 0, notes: [] });
  });
  it('keeps code source byte for byte, including html shaped text', () => {
    const d = normalizeDoc(fixture);
    expect(d.blocks['1dcj8fprpnh3'].html).toBe('<img src=x onerror=1>\nconst a = 1 < 2 && "q";');
  });
  it('never mutates its input and shares no objects with it', () => {
    const input = clone(fixture);
    const before = JSON.stringify(input);
    const d = normalizeDoc(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(d.pages).not.toBe(input.pages);
    expect(d.blocks.b2gc3zn.rows).not.toBe((input.blocks as any).b2gc3zn.rows);
  });
  it('is idempotent', () => {
    const once = normalizeDoc(fixture);
    expect(normalizeDoc(once)).toStrictEqual(once);
  });
  it('accepts the seed workspace unchanged', () => {
    const seed = createSeed();
    const { doc, report } = normalizeDocWithReport(seed);
    expect(report.notes).toEqual([]);
    expect(doc).toStrictEqual(seed);
  });
});

describe('normalizeDoc on hostile input', () => {
  const raw = () => JSON.parse(hostileDocJson());

  it('produces a doc that satisfies every invariant', () => {
    const { doc, report } = normalizeDocWithReport(raw());
    expect(report.changes).toBeGreaterThan(0);
    expectDocInvariants(doc);
  });

  it('is idempotent and does not mutate the input', () => {
    const input = raw();
    const snapshot = JSON.stringify(input);
    const once = normalizeDoc(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    const twice = normalizeDocWithReport(once);
    expect(twice.doc).toStrictEqual(once);
    expect(twice.report.changes).toBe(0);
  });

  it('removes handlers from block html, table cells and comments but keeps code source', () => {
    const d = normalizeDoc(raw());
    for (let i = 0; i < XSS.length; i++) expect(htmlProblems(d.blocks[`x${i}`].html), XSS[i]).toEqual([]);
    for (const row of d.blocks.tbl1.rows!) for (const c of row) expect(htmlProblems(c)).toEqual([]);
    for (const c of d.pages.pg.comments!) expect(htmlProblems(c.html!)).toEqual([]);
    expect(d.blocks.code1.html).toBe('<img src=x onerror=1>');
    expect(d.blocks.x9.html).toBe('<a>a</a>');
    expect(d.blocks.x19.html).toBe('<a href="https://ok.example">ok</a>');
  });

  it('repairs table rows that are not arrays of strings', () => {
    const d = normalizeDoc(raw());
    expect(d.blocks.tbl2.rows).toBeUndefined();
    expect(d.blocks.tbl3.rows).toEqual([['a'], ['1', '', '', '']]);
  });

  it('applies the URL policy to every url field', () => {
    const d = normalizeDoc(raw());
    BAD_URLS.forEach((_, i) => {
      expect(d.blocks[`img${i}`].url).toBeUndefined();
      expect(d.blocks[`bm${i}`].url).toBeUndefined();
      expect(d.blocks[`co${i}`].icon).toBeUndefined();
    });
    expect(d.pages.pg.icon).toBeUndefined();
    expect(d.pages.pg.cover).toBeUndefined();
    expect(d.pages.sub.cover).toBeUndefined();
    // A url property keeps bare hosts but never a disallowed scheme.
    expect(d.pages.r1.props).toEqual({ sel: 'o1' });
    expect(d.pages.r2.props).toEqual({ link: 'example.com/ok' });
    // Not an image, so it can only ever render as React text.
    expect(d.blocks.cl1.icon).toBe('javascript:alert(1)');
  });

  it('never keeps prototype keys at any level', () => {
    const d = normalizeDoc(raw());
    expect(Object.keys(d.pages)).not.toContain('__proto__');
    expect(Object.keys(d.pages)).not.toContain('constructor');
    expect(Object.keys(d.blocks)).not.toContain('__proto__');
    expect(Object.hasOwn(d.pages.r1.props!, '__proto__')).toBe(false);
    expect(Object.hasOwn(d.pages.r1.props!, 'constructor')).toBe(false);
    const db = d.pages.db;
    expect(db.schema!.find(p => p.id === 'sel')!.options!.map(o => o.id)).toEqual(['o1', 'o2']);
    expect(db.schema!.find(p => p.id === 'sel')!.options![1].color).toBe('default');
    expect(db.views![0].hidden).toEqual(['link']);
    expect(db.views![0].calcs).toEqual({ title: 'count' });
    expect(db.views![0].filters[0].value).toEqual({ a: [1, 'b'] });
    expect(({} as any).polluted).toBeUndefined();
    expect(d.workspace.teamspaces.map(t => t.id)).toEqual(['ts']);
  });

  it('drops garbage types and repairs dangling structure', () => {
    const d = normalizeDoc(raw());
    expect(d.blocks.garbage1).toBeUndefined();
    expect(d.blocks.garbage2).toBeUndefined();
    expect(d.blocks.cyc1).toBeUndefined();
    expect(d.blocks.orphan).toBeUndefined();
    expect(d.blocks.nochildren.children).toEqual([]);
    expect(d.blocks.badchildren.children).toEqual([]);
    expect(d.blocks.dangling.children).toEqual([]);
    expect(d.blocks.dup.children).toEqual(['kid']);
    expect(d.blocks.wrongid.id).toBe('wrongid');
    expect(d.pages.pg.content.filter(x => x === 'wrongid')).toHaveLength(1);
    expect(d.pages.pg.content).not.toContain('missing3');
    expect(d.pages.str).toBeUndefined();
    expect(d.pages.r3.content).toEqual([]);
    expect(d.pages.r3.createdAt).toBe(0);
    expect(d.pages.r3.dbId).toBeUndefined();
    expect(d.pages.r3.parentId).toBeNull();
  });

  it('breaks page cycles and keeps db.rows and dbId consistent', () => {
    const d = normalizeDoc(raw());
    // The page block inside its own page becomes a link and the page goes back to the root.
    expect(d.blocks.self.isLink).toBe(true);
    expect(d.pages.pg.parentId).toBeNull();
    // One owner per page: the second owning block becomes a link.
    expect(d.blocks.sub1.isLink).toBeUndefined();
    expect(d.blocks.sub2.isLink).toBe(true);
    expect(d.pages.sub.parentId).toBe('pg');
    expect(d.pages.db.rows).toEqual(['r1', 'r2']);
    expect(d.workspace.privatePages).toEqual(['pg', 'db']);
    expect(d.workspace.favorites).toEqual(['db']);
    expect(d.workspace.teamspaces[0].pages).toEqual(['sub']);
    expect(d.recent).toEqual([{ id: 'pg', at: 5 }]);
  });

  it('refuses values that are not a workspace at all', () => {
    for (const bad of [null, 'x', 42, [], { pages: [] }, { pages: {}, blocks: 'x' }]) {
      expect(() => normalizeDoc(bad), JSON.stringify(bad)).toThrow(NotADocError);
    }
    // A missing workspace or recent list is repaired, not fatal.
    const d = normalizeDoc({ pages: {}, blocks: {} });
    expect(d.workspace.privatePages).toEqual([]);
    expect(d.recent).toEqual([]);
  });

  it('keeps hidden previous value stashes and every number format', () => {
    const d = normalizeDoc(JSON.parse(JSON.stringify({
      pages: {
        db: { id: 'db', title: '', parentId: null, content: [], createdAt: 1, updatedAt: 1, isDatabase: true, rows: ['r'], schema: [{ id: 'n', name: 'N', type: 'number', numberFormat: 'canadian_dollar' }, { id: 'm', name: 'M', type: 'number', numberFormat: 'doubloon' }] },
        r: { id: 'r', title: '', parentId: 'db', dbId: 'db', content: [], createdAt: 1, updatedAt: 1, props: { n: 3, '~prev:n': { type: 'text', value: 'three', produced: 3 }, '~prev:__proto__': 1, '~prev:a b': 2 } },
      },
      blocks: {},
    })));
    expect(d.pages.db.schema![0].numberFormat).toBe('canadian_dollar');
    expect(d.pages.db.schema![1].numberFormat).toBeUndefined();
    expect(d.pages.r.props).toEqual({ n: 3, '~prev:n': { type: 'text', value: 'three', produced: 3 } });
  });

  it('cleanHtml keeps text without markup byte for byte and is stable', () => {
    expect(cleanHtml('Food & fun > 3')).toBe('Food & fun > 3');
    expect(cleanHtml('&lt;img src=x onerror=1&gt;')).toBe('&lt;img src=x onerror=1&gt;');
    for (const h of XSS) expect(cleanHtml(cleanHtml(h))).toBe(cleanHtml(h));
  });
});

describe('normalizeClipboardBlocks', () => {
  const block = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'text', html: '', children: [], parent: 'p', createdAt: 1, ...extra });

  it('sanitizes payload blocks like the doc', () => {
    const r = normalizeClipboardBlocks(JSON.parse(JSON.stringify({
      roots: ['a', 'b', 't', 'c'],
      blocks: {
        a: block('a', { html: XSS[0] }),
        b: block('b', { type: 'image', url: 'javascript:alert(1)' }),
        t: block('t', { type: 'table', rows: [[XSS[1]], 'x'] }),
        c: block('c', { type: 'code', html: '<img src=x onerror=1>' }),
      },
    })))!;
    expect(r.roots).toEqual(['a', 'b', 't', 'c']);
    expect(htmlProblems(r.blocks.a.html)).toEqual([]);
    expect(r.blocks.b.url).toBeUndefined();
    expect(r.blocks.t.rows).toEqual([['']]);
    expect(r.blocks.c.html).toBe('<img src=x onerror=1>');
  });

  it('drops prototype keys, garbage, missing children and cycles', () => {
    const raw = JSON.parse('{"roots":["a","__proto__","x","a"],"blocks":{"__proto__":{"id":"__proto__","type":"text","html":"p","children":[],"parent":"p","createdAt":1},"a":{"id":"a","type":"toggle","html":"a","children":["b","missing","b"],"parent":"p","createdAt":1},"b":{"id":"b","type":"toggle","html":"b","children":["a"],"parent":"a","createdAt":1},"x":{"id":"x","type":"script"}}}');
    const r = normalizeClipboardBlocks(raw)!;
    expect(r.roots).toEqual(['a']);
    expect(Object.keys(r.blocks).sort()).toEqual(['a', 'b']);
    expect(r.blocks.a.children).toEqual(['b']);
    expect(r.blocks.b.children).toEqual([]);
  });

  it('caps block count and depth', () => {
    const blocks: Record<string, unknown> = {};
    const roots: string[] = [];
    for (let i = 0; i < CLIP_LIMITS.maxBlocks + 50; i++) {
      blocks['k' + i] = block('k' + i);
      roots.push('k' + i);
    }
    expect(Object.keys(normalizeClipboardBlocks({ roots, blocks })!.blocks)).toHaveLength(CLIP_LIMITS.maxBlocks);
    const deep: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) deep['d' + i] = block('d' + i, { type: 'toggle', children: i < 199 ? ['d' + (i + 1)] : [] });
    const r = normalizeClipboardBlocks({ roots: ['d0'], blocks: deep })!;
    expect(Object.keys(r.blocks)).toHaveLength(CLIP_LIMITS.maxDepth + 1);
  });

  it('rejects payloads that are not block payloads', () => {
    for (const bad of [null, 'x', [], { roots: 'a', blocks: {} }, { roots: [], blocks: {} }, { roots: ['a'], blocks: { a: 1 } }]) {
      expect(normalizeClipboardBlocks(bad)).toBeNull();
    }
  });
});

export type { Doc };
