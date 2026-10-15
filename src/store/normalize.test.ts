import { describe, expect, it } from 'vitest';
import fixture from '../test/fixtures/doc-v2-current.json';
import { CLIP_LIMITS, cleanHtml, normalizeClipboardBlocks, normalizeDoc, normalizeDocWithReport, NotADocError } from './normalize';
import { expectDocInvariants, htmlProblems } from '../test/docInvariants';
import { checkInvariants } from '../test/invariants';
import type { Doc } from './types';
import { createSeed } from './seed';
import { BAD_URLS, XSS, hostileDocJson } from '../test/hostile';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('normalizeDoc on the recorded fixture', () => {
  it('keeps every field of the current shape (zero loss)', () => {
    const { doc, report } = normalizeDocWithReport(fixture);
    expect(doc).toStrictEqual(fixture);
    expect(report).toEqual({ changes: 0, notes: [] });
    expect(checkInvariants(doc)).toEqual([]);
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
    expect(checkInvariants(doc)).toEqual([]);
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
    // r3 lost its database and its parent, so nothing listed it: it joins the private section.
    expect(d.workspace.privatePages).toEqual(['pg', 'db', 'r3']);
    expect(d.workspace.favorites).toEqual(['db']);
    // sub lives in pg (its block owns it), so the teamspace no longer lists it a second time.
    expect(d.workspace.teamspaces[0].pages).toEqual([]);
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

/** A small workspace in the stored shape; `mutate` breaks it the way an older build could. */
function broken(mutate: (d: any) => void): any {
  const page = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, parentId: null, content: [], createdAt: 1, updatedAt: 1, ...extra });
  const blk = (id: string, parent: string, extra: Record<string, unknown> = {}) => ({ id, type: 'text', html: id, children: [], parent, createdAt: 1, ...extra });
  const d: any = {
    version: 1,
    pages: {
      home: page('home', { content: ['t1', 'dbb', 'subb'] }),
      sub: page('sub', { parentId: 'home', content: ['t2'] }),
      db: page('db', { parentId: 'home', isDatabase: true, inline: true, rows: ['r1', 'r2'], schema: [{ id: 'title', name: 'Name', type: 'title' }] }),
      r1: page('r1', { parentId: 'db', dbId: 'db', props: { title: 'one' } }),
      r2: page('r2', { parentId: 'db', dbId: 'db' }),
      full: page('full', { isDatabase: true, rows: [], schema: [{ id: 'title', name: 'Name', type: 'title' }] }),
      other: page('other', { content: ['t3'] }),
    },
    blocks: {
      t1: blk('t1', 'home'),
      dbb: blk('dbb', 'home', { type: 'database', pageId: 'db' }),
      subb: blk('subb', 'home', { type: 'page', pageId: 'sub' }),
      t2: blk('t2', 'sub'),
      t3: blk('t3', 'other'),
    },
    workspace: { name: 'W', icon: 'W', userName: 'Me', userEmail: 'me@example.com', privatePages: ['home', 'full'], favorites: [], teamspaces: [{ id: 'ts', name: 'T', icon: 'T', pages: ['other'] }] },
    recent: [],
  };
  mutate(d);
  return JSON.parse(JSON.stringify(d));
}

/** Normalizes, then checks every structural invariant, idempotence and that no text was lost. */
function repaired(raw: any): Doc {
  const { doc, report } = normalizeDocWithReport(raw);
  expect(report.changes).toBeGreaterThan(0);
  expect(checkInvariants(doc)).toEqual([]);
  expectDocInvariants(doc);
  const again = normalizeDocWithReport(doc);
  expect(again.report).toEqual({ changes: 0, notes: [] });
  expect(again.doc).toStrictEqual(doc);
  const texts = (d: any) => Object.values(d.blocks as Record<string, { html: string }>).map(b => b.html).filter(Boolean).sort();
  expect(texts(doc)).toEqual(texts(raw));
  return doc;
}

describe('normalizeDoc on structures older builds left behind', () => {
  it('the clean base passes every invariant untouched', () => {
    const raw = broken(() => {});
    const { doc, report } = normalizeDocWithReport(raw);
    expect(report.changes).toBe(0);
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('moves a page block out of an inline database to the page holding the database (H7)', () => {
    const d = repaired(
      broken(d => {
        d.pages.home.content = ['t1', 'dbb'];
        d.pages.db.content = ['subb'];
        d.blocks.subb.parent = 'db';
      }),
    );
    expect(d.pages.db.content).toEqual([]);
    expect(d.pages.home.content).toEqual(['t1', 'dbb', 'subb']);
    expect(d.pages.sub.parentId).toBe('home');
    expect(d.blocks.subb.isLink).toBeUndefined();
  });

  it('makes a page dropped into a full page database a root page (H7)', () => {
    const d = repaired(
      broken(d => {
        d.pages.home.content = ['t1', 'dbb'];
        d.pages.full.content = ['subb'];
        d.blocks.subb.parent = 'full';
        d.pages.sub.parentId = 'full';
      }),
    );
    expect(d.pages.sub.parentId).toBeNull();
    expect(d.workspace.privatePages).toEqual(['home', 'full', 'sub']);
    expect(d.blocks.subb.isLink).toBe(true);
  });

  it('lets the block win when a row was dragged out but kept its database (H7)', () => {
    const d = repaired(
      broken(d => {
        d.pages.other.content = ['t3', 'rowb'];
        d.blocks.rowb = { id: 'rowb', type: 'page', pageId: 'r1', html: '', children: [], parent: 'other', createdAt: 1 };
      }),
    );
    expect(d.pages.r1.dbId).toBeUndefined();
    expect(d.pages.r1.parentId).toBe('other');
    expect(d.pages.db.rows).toEqual(['r2']);
    // The values stay on the page.
    expect(d.pages.r1.props).toEqual({ title: 'one' });
  });

  it('lists live rows and only live rows', () => {
    const d = repaired(
      broken(d => {
        d.pages.db.rows = ['r1'];
        d.pages.r1.trashed = true;
        d.pages.r1.trashedAt = 5;
      }),
    );
    expect(d.pages.db.rows).toEqual(['r2']);
    expect(d.pages.r1).toMatchObject({ trashed: true, dbId: 'db', parentId: 'db' });
  });

  it('places pages that nothing lists in the private section', () => {
    const d = repaired(
      broken(d => {
        // A root page missing from every root list, and a page whose parent lost its block.
        d.workspace.privatePages = ['home'];
        d.pages.home.content = ['t1', 'dbb'];
        delete d.blocks.subb;
        // A page whose parent is gone.
        d.pages.lost = { id: 'lost', title: 'lost', parentId: 'gone', content: [], createdAt: 1, updatedAt: 1 };
      }),
    );
    expect(d.workspace.privatePages).toEqual(['home', 'sub', 'full', 'lost']);
    expect(d.pages.sub.parentId).toBeNull();
    expect(d.pages.lost.parentId).toBeNull();
  });

  it('keeps each root page in one section, and never a row or an owned page', () => {
    const d = repaired(
      broken(d => {
        d.workspace.privatePages = ['home', 'full', 'other', 'r1', 'sub'];
      }),
    );
    expect(d.workspace.privatePages).toEqual(['home', 'full', 'other']);
    expect(d.workspace.teamspaces[0].pages).toEqual([]);
  });

  it('turns blocks of trashed pages and blocks of missing pages into links', () => {
    const d = repaired(
      broken(d => {
        d.pages.sub.trashed = true;
        d.pages.sub.trashedAt = 5;
        d.pages.other.content = ['t3', 'ghost'];
        d.blocks.ghost = { id: 'ghost', type: 'page', pageId: 'nope', html: '', children: [], parent: 'other', createdAt: 1 };
      }),
    );
    expect(d.blocks.subb.isLink).toBe(true);
    expect(d.pages.sub).toMatchObject({ trashed: true, parentId: 'home' });
    expect(d.blocks.ghost.isLink).toBe(true);
  });

  it('flattens broken column layouts without losing a block', () => {
    const col = (id: string, parent: string, children: string[]) => ({ id, type: 'column', html: '', children, parent, createdAt: 1 });
    const d = repaired(
      broken(d => {
        d.pages.other.content = ['t3', 'lone', 'one', 'mixed'];
        // A column directly in a page.
        d.blocks.lone = col('lone', 'other', ['a']);
        // A column list with a single column.
        d.blocks.one = { id: 'one', type: 'columns', html: '', children: ['c1'], parent: 'other', createdAt: 1 };
        d.blocks.c1 = col('c1', 'one', ['b']);
        // A column list with a stray text block and an empty column.
        d.blocks.mixed = { id: 'mixed', type: 'columns', html: '', children: ['c2', 'stray', 'c3', 'c4'], parent: 'other', createdAt: 1 };
        d.blocks.c2 = col('c2', 'mixed', ['c']);
        d.blocks.c3 = col('c3', 'mixed', []);
        d.blocks.c4 = col('c4', 'mixed', ['e']);
        for (const [id, parent] of [['a', 'lone'], ['b', 'c1'], ['c', 'c2'], ['stray', 'mixed'], ['e', 'c4']]) d.blocks[id] = { id, type: 'text', html: id, children: [], parent, createdAt: 1 };
      }),
    );
    expect(d.pages.other.content).toEqual(['t3', 'a', 'b', 'mixed', 'stray']);
    expect(d.blocks.mixed.children).toEqual(['c2', 'c4']);
    expect(d.blocks.lone).toBeUndefined();
    expect(d.blocks.one).toBeUndefined();
  });

  it('never lets a block id name a page too', () => {
    const d = repaired(
      broken(d => {
        d.blocks.other = { id: 'other', type: 'text', html: '', children: [], parent: 'home', createdAt: 1 };
        d.pages.home.content.push('other');
      }),
    );
    expect(d.blocks.other).toBeUndefined();
    expect(d.pages.other.content).toEqual(['t3']);
  });

  it('repairs random structural damage to the recorded fixture', () => {
    // Deterministic fuzz: break parent pointers, row lists, owners, trash flags and root lists.
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pickOf = <X,>(xs: X[]) => xs[Math.floor(rand() * xs.length)];
    let repairedRuns = 0;
    for (let run = 0; run < 250; run++) {
      const d: any = clone(fixture);
      const pageIds = Object.keys(d.pages);
      const blockIds = Object.keys(d.blocks);
      const roots = (): string[][] => [d.workspace.privatePages, ...d.workspace.teamspaces.map((t: any) => t.pages)];
      for (let n = 1 + Math.floor(rand() * 4); n > 0; n--) {
        const p = d.pages[pickOf(pageIds)];
        const b = d.blocks[pickOf(blockIds)];
        switch (Math.floor(rand() * 10)) {
          case 0: p.parentId = pickOf([null, 'gone', ...pageIds]); break;
          case 1: p.dbId = pickOf(pageIds); break;
          case 2: delete p.dbId; break;
          case 3: p.trashed = !p.trashed; break;
          case 4: d.pages[pickOf(pageIds)].rows = [...(d.pages[pickOf(pageIds)].rows || []), p.id]; break;
          case 5: pickOf(roots()).push(p.id); break;
          case 6: for (const l of roots()) l.splice(0, l.length, ...l.filter((x: string) => x !== p.id)); break;
          case 7: b.type = pickOf(['page', 'database', 'column', 'columns', 'text']); b.pageId = pickOf([p.id, undefined]); break;
          case 8: b.isLink = !b.isLink; break;
          default: {
            // Move a block into another container without fixing anything else.
            const to = pickOf([...pageIds, ...blockIds]);
            const list = d.pages[to]?.content || d.blocks[to].children;
            list.push(b.id);
            b.parent = to;
          }
        }
      }
      const { doc, report } = normalizeDocWithReport(d);
      if (report.changes) repairedRuns++;
      expect(checkInvariants(doc), `run ${run}`).toEqual([]);
      const again = normalizeDocWithReport(doc);
      expect(again.report.changes, `run ${run}: ${again.report.notes.join('; ')}`).toBe(0);
    }
    // Guards the fuzz itself: most runs must have needed a repair.
    expect(repairedRuns).toBeGreaterThan(200);
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

  it('flattens broken column layouts in a payload', () => {
    const r = normalizeClipboardBlocks(JSON.parse(JSON.stringify({
      roots: ['lone', 'one', 'ok'],
      blocks: {
        lone: block('lone', { type: 'column', children: ['a'] }),
        a: block('a', { html: 'a' }),
        one: block('one', { type: 'columns', children: ['c1', 'stray'] }),
        c1: block('c1', { type: 'column', children: ['b'] }),
        b: block('b', { html: 'b' }),
        stray: block('stray', { html: 's' }),
        ok: block('ok', { type: 'columns', children: ['c2', 'c3'] }),
        c2: block('c2', { type: 'column', children: ['c'] }),
        c3: block('c3', { type: 'column', children: ['d'] }),
        c: block('c', { html: 'c' }),
        d: block('d', { html: 'd' }),
      },
    })))!;
    expect(r.roots).toEqual(['a', 'b', 'stray', 'ok']);
    expect(r.blocks.ok.children).toEqual(['c2', 'c3']);
    expect(Object.keys(r.blocks).sort()).toEqual(['a', 'b', 'c', 'c2', 'c3', 'd', 'ok', 'stray']);
  });

  it('rejects payloads that are not block payloads', () => {
    for (const bad of [null, 'x', [], { roots: 'a', blocks: {} }, { roots: [], blocks: {} }, { roots: ['a'], blocks: { a: 1 } }]) {
      expect(normalizeClipboardBlocks(bad)).toBeNull();
    }
  });
});

export type { Doc };
