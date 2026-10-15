import type { Block, BlockType, Doc, Page, Property } from './types';

let n = 0;
const sid = (p: string) => `${p}${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const photo = (id: string) => `https://images.unsplash.com/${id}?w=1600&q=80&auto=format&fit=crop`;

/** Builds the initial workspace shown on first launch. */
export function createSeed(): Doc {
  const now = Date.now();
  const H = 3600000;
  const D = 86400000;
  const pages: Record<string, Page> = {};
  const blocks: Record<string, Block> = {};

  const page = (p: Partial<Page> & { title: string }): Page => {
    const pg: Page = { id: sid('p'), parentId: null, content: [], createdAt: now - 3 * D, updatedAt: now - H, ...p };
    pages[pg.id] = pg;
    return pg;
  };
  type Spec = [BlockType, string?, Partial<Block>?, Spec[]?];
  const add = (parent: string, specs: Spec[]): string[] =>
    specs.map(([type, html = '', extra = {}, kids = []]) => {
      const b: Block = { id: sid('b'), type, html, children: [], parent, createdAt: now - 2 * D, ...extra };
      blocks[b.id] = b;
      b.children = add(b.id, kids);
      return b.id;
    });
  const setContent = (pg: Page, specs: Spec[]) => {
    pg.content = add(pg.id, specs);
  };
  /** Two or more columns, each a list of block specs. */
  const cols = (...columns: Spec[][]): Spec => ['columns', '', {}, columns.map(c => ['column', '', {}, c] as Spec)];
  const day = (d: number) => {
    const t = new Date();
    t.setDate(t.getDate() + d);
    // Local calendar date (toISOString would shift the day for timezones ahead of UTC).
    return { start: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` };
  };

  /* ---------------- Getting Started ---------------- */
  const gs = page({ title: 'Getting Started', icon: '👋', updatedAt: now - 60000 });
  const sub = page({ title: 'Example sub-page', icon: '📄', parentId: gs.id });
  setContent(sub, [
    ['text', 'Sub-pages live inside other pages. You can nest them as deep as you like.'],
    ['callout', 'Drag a page in the sidebar onto another page to move it inside.', { icon: '💡', color: 'gray_background' }],
    ['text', ''],
  ]);
  setContent(gs, [
    ['text', '👋 Welcome to your workspace!'],
    ['h2', 'Here are the basics'],
    ['todo', 'Click anywhere and just start typing'],
    ['todo', 'Hit <code>/</code> to see all the types of content you can add: headers, columns, sub pages, databases, etc.'],
    ['todo', 'Highlight any text, and use the menu that pops up to <b>style</b> <i>your</i> <s>writing</s> <code>however</code> <span class="c-blue">you</span> <span class="bg-yellow">like</span>'],
    ['todo', 'See the <code>⋮⋮</code> to the left of this checkbox on hover? Click and drag to move this line'],
    ['todo', 'Click the <code>New page</code> button at the top of your sidebar to add a new page'],
    ['todo', 'Drag a block to the right edge of another block to make columns', { checked: true }],
    ['toggle', 'This is a toggle block. Click the little triangle to see more useful tips!', { open: false }, [
      ['bulleted', 'Use <code>Tab</code> and <code>Shift+Tab</code> to indent and outdent blocks.'],
      ['bulleted', 'Type <code>[]</code> followed by a space to start a to-do list, <code>#</code> for a heading, <code>-</code> for a bulleted list.'],
      ['bulleted', 'Press <code>Esc</code> to select a block, then use arrow keys to move between blocks.'],
      ['bulleted', 'Press <code>⌘K</code> or <code>⌘P</code> to search across all of your pages.'],
    ]],
    ['divider'],
    ['h3', 'Things you can make'],
    cols(
      [
        ['callout', '<b>Docs</b><br>Write with headings, quotes, code and images.', { icon: '📝', color: 'gray_background' }],
      ],
      [
        ['callout', '<b>Projects</b><br>Track work on boards, tables and calendars.', { icon: '🚀', color: 'blue_background' }],
      ],
      [
        ['callout', '<b>Wikis</b><br>Nest pages to build a knowledge base.', { icon: '📚', color: 'yellow_background' }],
      ],
    ),
    ['quote', 'Simplicity is about subtracting the obvious and adding the meaningful.'],
    ['code', 'function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("world"));', { language: 'javascript' }],
    ['page', '', { pageId: sub.id }],
    ['text', 'See it in action:'],
    ['image', '', { url: photo('photo-1484480974693-6ca0a78fb36b'), caption: 'A calm desk is a productive desk.' }],
    ['text', ''],
  ]);

  /* ---------------- Quick Note ---------------- */
  const qn = page({ title: 'Quick Note', icon: '📝', updatedAt: now - 2 * H });
  setContent(qn, [
    ['text', 'Quickly jot down ideas, links, and anything else you want to come back to.'],
    ['h3', 'Ideas'],
    ['bulleted', 'Weekend trip to the coast'],
    ['bulleted', 'Learn a new keyboard shortcut every day', {}, [['bulleted', '<code>⌘⇧L</code> toggles dark mode']]],
    ['bulleted', 'Read <a href="https://en.wikipedia.org/wiki/Zettelkasten">about Zettelkasten</a>'],
    ['h3', 'Groceries'],
    ['todo', 'Oat milk', { checked: true }],
    ['todo', 'Coffee beans'],
    ['todo', 'Blueberries'],
    ['text', ''],
  ]);

  /* ---------------- Weekly To-do ---------------- */
  const weekly = page({ title: 'Weekly To-do List', icon: '🗓️', cover: 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)', updatedAt: now - 5 * H });
  setContent(weekly, [
    ['callout', 'Plan the week on Sunday, review it on Friday.', { icon: '📌', color: 'yellow_background' }],
    cols(
      [
        ['h3', 'Monday'],
        ['todo', 'Inbox zero', { checked: true }],
        ['todo', 'Team standup', { checked: true }],
        ['todo', 'Draft project brief'],
      ],
      [
        ['h3', 'Tuesday'],
        ['todo', 'Design review'],
        ['todo', 'Gym 🏋️'],
      ],
      [
        ['h3', 'Wednesday'],
        ['todo', 'Write launch checklist'],
        ['todo', 'Call mom'],
      ],
    ),
    cols(
      [
        ['h3', 'Thursday'],
        ['todo', 'Collect user feedback'],
      ],
      [
        ['h3', 'Friday'],
        ['todo', 'Weekly review'],
        ['todo', 'Plan next week'],
      ],
      [
        ['h3', 'Weekend'],
        ['todo', 'Farmers market'],
        ['todo', 'Read for an hour'],
      ],
    ),
    ['text', ''],
  ]);

  /* ---------------- Trip ---------------- */
  const trip = page({ title: 'Trip to Japan', icon: '🗾', cover: photo('photo-1454496522488-7a8e488e8606'), coverPos: 60, updatedAt: now - D });
  setContent(trip, [
    ['callout', '<b>Dates:</b> April 3 to April 14 · <b>Budget:</b> ¥350,000', { icon: '✈️', color: 'blue_background' }],
    ['h2', 'Itinerary'],
    ['toggle', '<b>Tokyo</b> · Days 1 to 4', { open: true }, [
      ['bulleted', 'Shibuya crossing at night'],
      ['bulleted', 'TeamLab Planets'],
      ['bulleted', 'Day trip to Kamakura'],
    ]],
    ['toggle', '<b>Kyoto</b> · Days 5 to 9', { open: false }, [
      ['bulleted', 'Fushimi Inari at sunrise'],
      ['bulleted', 'Arashiyama bamboo grove'],
    ]],
    ['toggle', '<b>Osaka</b> · Days 10 to 12', { open: false }, [['bulleted', 'Dotonbori street food']]],
    ['h2', 'Budget'],
    ['table', '', {
      headerRow: true, rows: [
        ['Item', 'Cost', 'Booked'],
        ['Flights', '¥120,000', '✅'],
        ['Hotels', '¥140,000', '✅'],
        ['JR Pass', '¥50,000', ''],
        ['Food & fun', '¥40,000', ''],
      ],
    }],
    ['h2', 'Packing list'],
    cols(
      [
        ['todo', 'Passport', { checked: true }],
        ['todo', 'Power adapter'],
        ['todo', 'Walking shoes'],
      ],
      [
        ['todo', 'Camera'],
        ['todo', 'Rain jacket'],
        ['todo', 'Suica card'],
      ],
    ),
    ['image', '', { url: photo('photo-1500964757637-c85e8a162699'), caption: '' }],
    ['text', ''],
  ]);

  /* ---------------- Task List (board) ---------------- */
  const statusProp: Property = {
    id: 'status', name: 'Status', type: 'status', options: [
      { id: 'st1', name: 'Not started', color: 'default', group: 'todo' },
      { id: 'st2', name: 'In progress', color: 'blue', group: 'in_progress' },
      { id: 'st3', name: 'Done', color: 'green', group: 'complete' },
    ],
  };
  const tasks = page({
    title: 'Task List', icon: '✅', isDatabase: true, inline: false, updatedAt: now - 3 * H,
    cover: photo('photo-1517694712202-14dd9538aa97'),
    schema: [
      { id: 'title', name: 'Name', type: 'title' },
      statusProp,
      { id: 'assignee', name: 'Assignee', type: 'person' },
      { id: 'due', name: 'Due', type: 'date' },
      { id: 'priority', name: 'Priority', type: 'select', options: [
        { id: 'pr1', name: 'High', color: 'red' },
        { id: 'pr2', name: 'Medium', color: 'yellow' },
        { id: 'pr3', name: 'Low', color: 'green' },
      ] },
    ],
    views: [
      { id: 'v_board', name: 'Board', type: 'board', groupBy: 'status', hidden: [], filters: [], sorts: [] },
      { id: 'v_table', name: 'Table', type: 'table', hidden: [], filters: [], sorts: [] },
      { id: 'v_cal', name: 'Calendar', type: 'calendar', dateProp: 'due', hidden: [], filters: [], sorts: [] },
      { id: 'v_tl', name: 'Timeline', type: 'timeline', dateProp: 'due', hidden: [], filters: [], sorts: [] },
    ],
    rows: [],
  });
  const taskRows: [string, string, string, number, number, string][] = [
    ['Draft project brief', 'st2', 'pr1', -1, 3, '📄'],
    ['Review design mockups', 'st1', 'pr2', 2, 4, '🎨'],
    ['Set up weekly sync', 'st3', 'pr3', -4, 1, '📅'],
    ['Write launch checklist', 'st1', 'pr1', 4, 6, '🚀'],
    ['Collect user feedback', 'st2', 'pr2', 1, 7, '💬'],
    ['Update onboarding docs', 'st3', 'pr3', -6, 2, '📚'],
  ];
  tasks.rows = taskRows.map(([title, st, pr, d, len, icon]) => {
    const due = { start: day(d).start, end: day(d + len).start };
    const r = page({ title, icon, parentId: tasks.id, dbId: tasks.id, props: { status: st, priority: pr, due, assignee: ['me'] } });
    setContent(r, [
      ['h3', 'Context'],
      ['text', 'Why this matters and what done looks like.'],
      ['h3', 'Checklist'],
      ['todo', 'Outline'],
      ['todo', 'First draft'],
      ['todo', 'Share for feedback'],
    ]);
    return r.id;
  });

  /* ---------------- Reading List (gallery) ---------------- */
  const reading = page({
    title: 'Reading List', icon: '📚', isDatabase: true, inline: false, updatedAt: now - D,
    cover: photo('photo-1481627834876-b7833e8f5570'),
    schema: [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'type', name: 'Type', type: 'select', options: [
        { id: 'ty1', name: 'Book', color: 'orange' },
        { id: 'ty2', name: 'Article', color: 'blue' },
        { id: 'ty3', name: 'Podcast', color: 'purple' },
      ] },
      { id: 'author', name: 'Author', type: 'text' },
      { id: 'rating', name: 'Rating', type: 'select', options: [
        { id: 'ra5', name: '★★★★★', color: 'yellow' },
        { id: 'ra4', name: '★★★★', color: 'yellow' },
        { id: 'ra3', name: '★★★', color: 'yellow' },
      ] },
      { id: 'done', name: 'Finished', type: 'checkbox' },
      { id: 'link', name: 'Link', type: 'url' },
    ],
    views: [
      { id: 'v_gal', name: 'Gallery', type: 'gallery', hidden: ['author', 'link'], filters: [], sorts: [], cardPreview: 'cover' },
      { id: 'v_rtable', name: 'All', type: 'table', hidden: [], filters: [], sorts: [] },
    ],
    rows: [],
  });
  const readCovers = [
    photo('photo-1456513080510-7bf3a84b82f8'),
    photo('photo-1497436072909-60f360e1d4b1'),
    photo('photo-1519681393784-d120267933ba'),
    photo('photo-1507525428034-b723cf961d3e'),
    photo('photo-1441974231531-c6227db76b6e'),
  ];
  const readRows: [string, string, string, string, boolean, string][] = [
    ['The Design of Everyday Things', 'ty1', 'Don Norman', 'ra5', true, '📕'],
    ['How to Take Smart Notes', 'ty1', 'Sönke Ahrens', 'ra4', false, '📗'],
    ['Shape Up', 'ty2', 'Ryan Singer', 'ra4', true, '📘'],
    ['The Knowledge Project', 'ty3', 'Shane Parrish', 'ra3', false, '🎧'],
    ['Deep Work', 'ty1', 'Cal Newport', 'ra5', true, '📙'],
  ];
  reading.rows = readRows.map(([title, ty, author, ra, done, icon], i) => {
    const r = page({ title, icon, parentId: reading.id, dbId: reading.id, cover: readCovers[i], props: { type: ty, author, rating: ra, done } });
    setContent(r, [
      ['h3', 'Key ideas'],
      ['bulleted', 'Notes and highlights go here.'],
      ['quote', 'Favorite quote from the book.'],
    ]);
    return r.id;
  });

  /* ---------------- Journal (list) ---------------- */
  const journal = page({
    title: 'Journal', icon: '📔', isDatabase: true, inline: false, updatedAt: now - 2 * D,
    cover: photo('photo-1470071459604-3b5ec3a7fe05'),
    schema: [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'created', name: 'Created', type: 'created_time' },
      { id: 'tags', name: 'Tags', type: 'multi_select', options: [
        { id: 'tg1', name: 'Daily', color: 'blue' },
        { id: 'tg2', name: 'Ideas', color: 'pink' },
        { id: 'tg3', name: 'Gratitude', color: 'green' },
      ] },
    ],
    views: [{ id: 'v_list', name: 'List', type: 'list', hidden: [], filters: [], sorts: [] }],
    rows: [],
  });
  journal.rows = (
    [
      ['Morning pages', ['tg1'], '☀️'],
      ['Things I learned this week', ['tg2'], '💡'],
      ['Three good things', ['tg3', 'tg1'], '🌱'],
    ] as [string, string[], string][]
  ).map(([title, tags, icon], i) => {
    const r = page({ title, icon, parentId: journal.id, dbId: journal.id, props: { tags }, createdAt: now - (i + 1) * D });
    setContent(r, [['text', 'Write freely for ten minutes.'], ['text', '']]);
    return r.id;
  });

  /* ---------------- Teamspace ---------------- */
  const tsHome = page({ title: 'Teamspace Home', icon: '🏠', cover: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', updatedAt: now - 6 * H });
  const wiki = page({ title: 'Engineering Wiki', icon: '📖', parentId: tsHome.id, updatedAt: now - 8 * H });
  const onboarding = page({ title: 'Onboarding guide', icon: '🧭', parentId: wiki.id });
  const review = page({ title: 'Code review guidelines', icon: '🔍', parentId: wiki.id });
  setContent(onboarding, [
    ['h2', 'Your first week'],
    ['numbered', 'Set up your laptop and accounts'],
    ['numbered', 'Read the architecture overview'],
    ['numbered', 'Ship a small change on day one'],
    ['callout', 'Ask questions early. Everyone was new once.', { icon: '🙌', color: 'green_background' }],
  ]);
  setContent(review, [
    ['h2', 'What we look for'],
    ['bulleted', 'Correctness first, then clarity'],
    ['bulleted', 'Small, focused pull requests'],
    ['bulleted', 'Tests for behaviour changes'],
    ['code', '# run before pushing\nnpm run lint && npm test', { language: 'bash' }],
  ]);
  setContent(wiki, [
    ['text', 'Everything engineers need to know, in one place.'],
    ['page', '', { pageId: onboarding.id }],
    ['page', '', { pageId: review.id }],
    ['h3', 'Useful links'],
    ['bookmark', '', { url: 'https://developer.mozilla.org/' }],
  ]);

  const roadmap = page({
    title: 'Product Roadmap', icon: '🚀', isDatabase: true, inline: false, parentId: tsHome.id, updatedAt: now - 4 * H,
    schema: [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'rstatus', name: 'Status', type: 'status', options: [
        { id: 'rs1', name: 'Planned', color: 'default', group: 'todo' },
        { id: 'rs2', name: 'Building', color: 'blue', group: 'in_progress' },
        { id: 'rs3', name: 'Shipped', color: 'green', group: 'complete' },
      ] },
      { id: 'quarter', name: 'Quarter', type: 'select', options: [
        { id: 'q1', name: 'Q4 2026', color: 'purple' },
        { id: 'q2', name: 'Q1 2027', color: 'pink' },
      ] },
      { id: 'owner', name: 'Owner', type: 'person' },
    ],
    views: [
      { id: 'v_rb', name: 'Board', type: 'board', groupBy: 'rstatus', hidden: [], filters: [], sorts: [] },
      { id: 'v_rt', name: 'Table', type: 'table', hidden: [], filters: [], sorts: [] },
    ],
    rows: [],
  });
  roadmap.rows = (
    [
      ['Dark mode polish', 'rs3', 'q1', '🌙'],
      ['Offline sync', 'rs2', 'q1', '🔄'],
      ['Public API', 'rs1', 'q2', '🧩'],
      ['Mobile widgets', 'rs1', 'q2', '📱'],
    ] as [string, string, string, string][]
  ).map(([title, st, q, icon]) => {
    const r = page({ title, icon, parentId: roadmap.id, dbId: roadmap.id, props: { rstatus: st, quarter: q, owner: ['me'] } });
    setContent(r, [['text', '']]);
    return r.id;
  });

  const meetings = page({
    title: 'Meeting Notes', icon: '🗒️', isDatabase: true, inline: true, parentId: tsHome.id, updatedAt: now - 7 * H,
    schema: [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'mdate', name: 'Date', type: 'date' },
      { id: 'mtype', name: 'Type', type: 'select', options: [
        { id: 'mt1', name: 'Standup', color: 'blue' },
        { id: 'mt2', name: 'Planning', color: 'orange' },
        { id: 'mt3', name: 'Retro', color: 'purple' },
      ] },
      { id: 'attendees', name: 'Attendees', type: 'person' },
    ],
    views: [{ id: 'v_mt', name: 'Table', type: 'table', hidden: [], filters: [], sorts: [] }],
    rows: [],
  });
  const at = (d: number, from: string, to: string) => {
    const s = day(d).start;
    return { start: `${s}T${from}`, end: `${s}T${to}` };
  };
  meetings.rows = (
    [
      ['Design review', at(0, '10:00', '11:00'), 'mt2'],
      ['Eng kickoff', at(0, '12:00', '13:00'), 'mt2'],
      ['Product updates', at(0, '16:00', '17:00'), 'mt1'],
      ['Daily standup', at(-1, '09:30', '09:45'), 'mt1'],
      ['Q3 retrospective', at(-6, '15:00', '16:00'), 'mt3'],
    ] as [string, { start: string; end: string }, string][]
  ).map(([title, when, t]) => {
    const r = page({ title, parentId: meetings.id, dbId: meetings.id, props: { mdate: when, mtype: t, attendees: ['me'] } });
    setContent(r, [['h3', 'Agenda'], ['bulleted', ''], ['h3', 'Action items'], ['todo', '']]);
    return r.id;
  });

  const specs = page({ title: 'Product Specs', icon: '📐', updatedAt: now - 9 * H, cover: 'linear-gradient(120deg, #f093fb 0%, #f5576c 100%)' });
  setContent(specs, [
    ['text', 'Every feature starts with a one page spec.'],
    ['h2', 'Template'],
    ['numbered', '<b>Problem</b>: who has it and how often'],
    ['numbered', '<b>Goals</b>: what success looks like'],
    ['numbered', '<b>Solution</b>: the smallest thing that works'],
    ['callout', 'Link the spec from the roadmap card so everyone can find it.', { icon: '🔗', color: 'purple_background' }],
  ]);
  const arch = page({ title: 'Architecture', icon: '🏗️', updatedAt: now - 10 * H });
  setContent(arch, [
    ['text', 'How the system fits together.'],
    cols(
      [['h3', 'Frontend'], ['bulleted', 'React + Vite'], ['bulleted', 'Local first storage']],
      [['h3', 'Data'], ['bulleted', 'Pages and blocks'], ['bulleted', 'Undo history per action']],
    ),
    ['code', 'page -> blocks[] -> children[]', { language: 'plain text' }],
  ]);

  setContent(tsHome, [
    ['callout', 'This is the home page for your teamspace. Share docs, wikis and projects with everyone here.', { icon: '👋', color: 'blue_background' }],
    cols(
      [
        ['h3', 'Team docs'],
        ['page', '', { pageId: wiki.id }],
        ['database', '', { pageId: roadmap.id }],
      ],
      [
        ['h3', 'This week'],
        ['todo', 'Ship the beta to five customers'],
        ['todo', 'Hiring sync on Thursday', { checked: true }],
        ['todo', 'Write the changelog'],
      ],
    ),
    ['h2', 'Meetings'],
    ['database', '', { pageId: meetings.id }],
    ['text', ''],
  ]);

  return {
    version: 1,
    pages,
    blocks,
    workspace: {
      name: 'My Workspace',
      icon: '🏔️',
      userName: 'You',
      userEmail: 'you@example.com',
      privatePages: [gs.id, qn.id, weekly.id, trip.id, tasks.id, reading.id, journal.id],
      favorites: [tasks.id, weekly.id],
      teamspaces: [
        { id: 'ts1', name: 'General', icon: '🏠', pages: [tsHome.id] },
        { id: 'ts2', name: 'Product', icon: '🧩', pages: [specs.id] },
        { id: 'ts3', name: 'Engineering', icon: '⚙️', pages: [arch.id] },
      ],
    },
    recent: [
      { id: gs.id, at: now - 60000 },
      { id: weekly.id, at: now - 40 * 60000 },
      { id: tasks.id, at: now - H },
      { id: trip.id, at: now - 3 * H },
      { id: qn.id, at: now - 5 * H },
      { id: reading.id, at: now - D },
      { id: tsHome.id, at: now - 2 * D },
    ],
  };
}
