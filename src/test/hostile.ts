/** A hostile workspace used by the ingest fuzz tests and the render safety test. */

/** Shapes that have broken HTML sanitizers before (mXSS, handlers, scheme tricks). */
export const XSS = [
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
export const BAD_URLS = ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', '//evil.example/x.png', '/\\evil.example', 'vbscript:x', 'data:text/html,<script>1</script>', ' javascript:alert(1)'];

/** A hostile workspace built as JSON text so `__proto__` keys are own properties. */
export function hostileDocJson(): string {
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

