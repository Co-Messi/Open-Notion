import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc, getUi, replaceDoc, transact, undo } from './store';
import { getRecentErrors } from '../lib/diagnostics';
import * as A from './actions';
import type { Block, BlockType, Doc, Page } from './types';
import { checkInvariants } from '../test/invariants';
import { moveBlocksToPage, moveTargetPages } from '../editor/MoveBlocks';
import { backspaceAtStart, deleteAtEnd, enterAt } from '../editor/ops';
import { applyBlockDrop } from '../editor/dnd';
import { getTabs, newTab } from './tabs';

/** Builds documents by hand: pages with nested block specs, so each case reads like its scenario. */
type Spec = [id: string, type: BlockType, html?: string, kids?: Spec[], extra?: Partial<Block>];

function build(pages: (Partial<Page> & { id: string; blocks?: Spec[] })[], roots: string[], valid = true): Doc {
  const doc: Doc = {
    version: 1,
    pages: {},
    blocks: {},
    workspace: { name: 'W', icon: 'W', userName: 'Me', userEmail: 'me@example.com', privatePages: roots, favorites: [], teamspaces: [] },
    recent: [],
  };
  for (const { blocks = [], ...p } of pages) {
    const add = (parent: string, specs: Spec[]): string[] =>
      specs.map(([id, type, html = '', kids = [], extra = {}]) => {
        doc.blocks[id] = { id, type, html, parent, children: add(id, kids), createdAt: 1, ...extra };
        return id;
      });
    doc.pages[p.id] = { title: p.id, parentId: null, createdAt: 1, updatedAt: 1, ...p, content: add(p.id, blocks) };
  }
  replaceDoc(doc);
  if (valid) expect(checkInvariants(getDoc())).toEqual([]);
  return doc;
}

const d = () => getDoc();
const ok = () => expect(checkInvariants(getDoc())).toEqual([]);
const toast = () => getUi().toast;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* H6: page cycles                                                     */
/* ------------------------------------------------------------------ */

/** Root R holds sub page P (block bp, inside toggle tg); P holds C; C holds G. S is unrelated. */
function family() {
  build(
    [
      { id: 'R', blocks: [['tg', 'toggle', 'T', [['bp', 'page', '', [], { pageId: 'P' }]], { open: true }], ['t1', 'text', 'r']] },
      { id: 'P', parentId: 'R', blocks: [['bc', 'page', '', [], { pageId: 'C' }], ['p1', 'text', 'p']] },
      { id: 'C', parentId: 'P', blocks: [['bg', 'page', '', [], { pageId: 'G' }]] },
      { id: 'G', parentId: 'C' },
      { id: 'S', blocks: [['s1', 'text', 's']] },
    ],
    ['R', 'S'],
  );
}

describe('H6: a page can never move into itself', () => {
  it('refuses a page block dropped on its own page or a descendant (sidebar row drop)', () => {
    family();
    for (const target of ['P', 'C', 'G']) {
      expect(moveBlocksToPage(['bp'], target)).toBe(false);
      expect(toast()).toBe('A page can’t be moved inside itself');
    }
    expect(d().pages.P.parentId).toBe('R');
    expect(d().blocks.bp.parent).toBe('tg');
    ok();
  });

  it('refuses a block whose subtree owns the target page (a toggle holding the sub page)', () => {
    family();
    expect(moveBlocksToPage(['tg'], 'C')).toBe(false);
    transact(tx => expect(A.txMoveBlock(tx, 'tg', 'p1', 0)).toBe(false));
    expect(d().blocks.tg.parent).toBe('R');
    ok();
  });

  it('keeps sub page parents in sync when a block holding them moves to another page', () => {
    family();
    expect(moveBlocksToPage(['tg'], 'S')).toBe(true);
    expect(d().pages.P.parentId).toBe('S');
    ok();
  });

  it('Move to lists neither the moved page nor anything inside it', () => {
    family();
    const ids = moveTargetPages(['tg']).map(p => p.id);
    expect(ids).toContain('S');
    expect(ids).not.toContain('R'); // the page the block is on
    for (const x of ['P', 'C', 'G']) expect(ids).not.toContain(x);
    expect(moveTargetPages(['t1']).map(p => p.id)).toEqual(expect.arrayContaining(['P', 'C', 'G', 'S']));
  });

  it('refuses a sidebar page drop into its own descendant', () => {
    family();
    expect(A.movePage('P', { pageId: 'G' })).toBe(false);
    expect(toast()).toBe('A page can’t be moved inside itself');
    expect(A.movePage('P', { pageId: 'P' })).toBe(false);
    ok();
  });

  it('deletes a cyclic tree forever without overflowing the stack', () => {
    build(
      [
        { id: 'X', parentId: 'Y', trashed: true, blocks: [['by', 'page', '', [], { pageId: 'Y' }]] },
        { id: 'Y', parentId: 'X', blocks: [['bx', 'page', '', [], { pageId: 'X' }]] },
        { id: 'K' },
      ],
      ['K'],
      false, // a corrupted (cyclic) document, as old builds could leave behind
    );
    expect(() => A.deletePageForever('X')).not.toThrow();
    expect(d().pages.X).toBeUndefined();
    expect(d().pages.Y).toBeUndefined();
    expect(Object.keys(d().blocks)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* H7: databases in the sidebar                                        */
/* ------------------------------------------------------------------ */

function withDatabase() {
  build(
    [
      { id: 'H', blocks: [['bdb', 'database', '', [], { pageId: 'D' }], ['h1', 'text', 'h']] },
      { id: 'D', parentId: 'H', isDatabase: true, inline: true, rows: ['r1', 'r2', 'r3'], schema: [{ id: 'title', name: 'Name', type: 'title' }], views: [] },
      { id: 'r1', parentId: 'D', dbId: 'D', blocks: [['r1b', 'text', 'in row']] },
      { id: 'r2', parentId: 'D', dbId: 'D' },
      { id: 'r3', parentId: 'D', dbId: 'D' },
      { id: 'N', blocks: [['n1', 'text', 'n']] },
      { id: 'F', isDatabase: true, rows: [], schema: [], views: [] },
    ],
    ['H', 'N', 'F'],
  );
}

describe('H7: database drop targets', () => {
  it('refuses a page dropped between database rows instead of hiding it in content', () => {
    withDatabase();
    expect(A.movePage('N', { pageId: 'D', index: 1 })).toBe(false);
    expect(toast()).toBe('Pages can’t be moved into a database');
    expect(d().pages.D.content).toEqual([]);
    expect(d().workspace.privatePages).toContain('N');
    ok();
  });

  it('reorders rows when a row is dropped among its own database rows', () => {
    withDatabase();
    expect(A.movePage('r3', { pageId: 'D', index: 0 })).toBe(true);
    expect(d().pages.D.rows).toEqual(['r3', 'r1', 'r2']);
    expect(A.movePage('r3', { pageId: 'D', index: 3 })).toBe(true);
    expect(d().pages.D.rows).toEqual(['r1', 'r2', 'r3']);
    ok();
  });

  it('a row dragged out of its database stops being a row', () => {
    withDatabase();
    expect(A.movePage('r1', { pageId: 'N' })).toBe(true);
    expect(d().pages.r1.dbId).toBeUndefined();
    expect(d().pages.r1.parentId).toBe('N');
    expect(d().pages.D.rows).toEqual(['r2', 'r3']);
    expect(A.pagePath('r1').map(p => p.id)).toEqual(['N', 'r1']);
    expect(A.movePage('r2', { section: 'private', index: 0 })).toBe(true);
    expect(d().pages.r2.dbId).toBeUndefined();
    expect(d().workspace.privatePages[0]).toBe('r2');
    ok();
  });

  it('a row cannot move into another database', () => {
    withDatabase();
    expect(A.movePage('r1', { pageId: 'F' })).toBe(false);
    expect(d().pages.D.rows).toContain('r1');
    ok();
  });

  it('refuses blocks dropped on a database row in the sidebar', () => {
    withDatabase();
    expect(moveBlocksToPage(['n1'], 'D')).toBe(false);
    expect(toast()).toBe('Blocks can’t be moved into a database');
    expect(d().blocks.n1.parent).toBe('N');
    expect(d().pages.D.content).toEqual([]);
    // A row page renders its content, so blocks can go there.
    expect(moveBlocksToPage(['n1'], 'r2')).toBe(true);
    expect(d().pages.r2.content).toEqual(['n1']);
    ok();
  });
});

/* ------------------------------------------------------------------ */
/* H8: columns behave like page roots                                  */
/* ------------------------------------------------------------------ */

/** Page Q: a columns block first (A holds a1, a2; B holds b1 (bullet), b2), then t1. */
function twoColumns() {
  build(
    [
      {
        id: 'Q',
        blocks: [
          ['cl', 'columns', '', [['ca', 'column', '', [['a1', 'text', 'alpha'], ['a2', 'text', 'beta']]], ['cb', 'column', '', [['b1', 'bulleted', ''], ['b2', 'text', 'gamma']]]]],
          ['t1', 'text', 'after'],
        ],
      },
    ],
    ['Q'],
  );
}
const columnsIntact = () => {
  expect(d().blocks.cl.children).toEqual(['ca', 'cb']);
  expect(d().blocks.ca.children.length + d().blocks.cb.children.length).toBeGreaterThan(0);
  ok();
};

describe('H8: Enter, Backspace and Shift+Tab inside columns', () => {
  it('Backspace at the start of a column block merges only within the same column', () => {
    twoColumns();
    // b2's neighbour in document order is b1, in the same column: merge.
    expect(backspaceAtStart('b2', 'gamma', { block: 'b1' }).handled).toBe(true);
    expect(d().blocks.b2).toBeUndefined();
    expect(d().blocks.b1.html).toBe('gamma');
    columnsIntact();
  });

  it('Backspace at the start of a column never merges into the previous column or the title', () => {
    twoColumns();
    const before = JSON.stringify(d().blocks);
    backspaceAtStart('b1', '', { block: 'a2' }); // a bullet first turns into text
    expect(d().blocks.b1.type).toBe('text');
    backspaceAtStart('b1', '', { block: 'a2' });
    backspaceAtStart('a1', 'alpha', { title: 'Q' });
    expect(d().blocks.a2.html).toBe('beta');
    expect(d().pages.Q.title).toBe('Q');
    expect(d().blocks.a1.parent).toBe('ca');
    expect(d().blocks.b1.parent).toBe('cb');
    expect(JSON.stringify(d().blocks)).not.toBe(before);
    columnsIntact();
  });

  it('a refused Backspace commits nothing: no empty undo step and no recorded error', () => {
    twoColumns();
    const errors = getRecentErrors().length;
    A.updateBlock('a2', { html: 'edited' });
    // a1 is the first block of a column and its document order neighbour is the title: refused.
    expect(backspaceAtStart('a1', 'alpha', { title: 'Q' }).handled).toBe(true);
    undo();
    expect(d().blocks.a2.html).toBe('beta');
    expect(getRecentErrors().length).toBe(errors);
    columnsIntact();
  });

  it('Backspace after a column list never pulls the text into a column', () => {
    twoColumns();
    expect(backspaceAtStart('t1', 'after', { block: 'b2' }).caret).toEqual({ select: 'cl' });
    expect(d().blocks.t1.parent).toBe('Q');
    columnsIntact();
  });

  it('Enter on an empty bullet in a column turns it into text in place', () => {
    twoColumns();
    enterAt('b1', '', '');
    expect(d().blocks.b1.type).toBe('text');
    expect(d().blocks.b1.parent).toBe('cb');
    columnsIntact();
  });

  it('Shift+Tab at the root of a column does nothing; nested blocks still outdent', () => {
    twoColumns();
    transact(tx => expect(A.txOutdent(tx, 'a1')).toBe(false));
    transact(tx => expect(A.txIndent(tx, 'a2')).toBe(true));
    expect(d().blocks.a2.parent).toBe('a1');
    transact(tx => expect(A.txOutdent(tx, 'a2')).toBe(true));
    expect(d().blocks.a2.parent).toBe('ca');
    columnsIntact();
  });

  it('Tab right after a column list does not create a phantom column', () => {
    twoColumns();
    transact(tx => expect(A.txIndent(tx, 't1')).toBe(false));
    expect(d().blocks.t1.parent).toBe('Q');
    columnsIntact();
  });

  it('Delete at the end of a column never pulls in the next column', () => {
    twoColumns();
    expect(deleteAtEnd('a2', 'beta', 'b1').handled).toBe(false);
    expect(d().blocks.b1.parent).toBe('cb');
    expect(deleteAtEnd('a1', 'alpha', 'a2').handled).toBe(true);
    expect(d().blocks.a1.html).toBe('alphabeta');
    columnsIntact();
  });

  it('dropping the last block of a column into the other column unwraps the list', () => {
    build([{ id: 'Q', blocks: [['cl', 'columns', '', [['ca', 'column', '', [['a1', 'text', 'a']]], ['cb', 'column', '', [['b1', 'text', 'b']]]]]] }], ['Q']);
    applyBlockDrop(['a1'], 'b1', 'after');
    expect(d().pages.Q.content).toEqual(['b1', 'a1']);
    ok();
  });
});

/* ------------------------------------------------------------------ */
/* M7: Trash consistency                                               */
/* ------------------------------------------------------------------ */

describe('M7: restore and delete forever keep references consistent', () => {
  it('a row restored while its database is in the Trash comes back as a normal page', () => {
    withDatabase();
    A.trashPage('r1');
    A.trashPage('D');
    A.restorePage('r1');
    const r1 = d().pages.r1;
    expect(r1.trashed).toBe(false);
    expect(r1.dbId).toBeUndefined();
    expect(r1.parentId).toBeNull();
    expect(d().workspace.privatePages).toContain('r1');
    expect(d().pages.D.rows).not.toContain('r1');
    expect(A.isTrashedDeep(d(), 'r1')).toBe(false);
    ok();
  });

  it('a row restored while its database is live goes back into the rows', () => {
    withDatabase();
    A.trashPage('r2');
    expect(d().pages.D.rows).toEqual(['r1', 'r3']);
    A.restorePage('r2');
    expect(d().pages.D.rows).toContain('r2');
    expect(d().pages.r2.dbId).toBe('D');
    ok();
  });

  it('a page whose parent is trashed deep comes back at the top level', () => {
    family();
    A.trashPage('C');
    A.trashPage('R');
    A.restorePage('C');
    expect(d().pages.C.parentId).toBeNull();
    expect(d().workspace.privatePages).toContain('C');
    expect(A.isTrashedDeep(d(), 'C')).toBe(false);
    ok();
  });

  it('deleting a database forever also deletes its trashed rows and every reference', () => {
    withDatabase();
    A.toggleFavorite('r2');
    A.toggleFavorite('D');
    A.trashPage('r1');
    A.trashPage('D');
    A.deletePageForever('D');
    for (const id of ['D', 'r1', 'r2', 'r3']) expect(d().pages[id]).toBeUndefined();
    expect(d().workspace.favorites).toEqual([]);
    expect(d().blocks.r1b).toBeUndefined();
    ok();
  });

  it('a trashed child of a page deleted forever is re-rooted, not left dangling', () => {
    family();
    A.trashPage('C');
    A.trashPage('P');
    A.deletePageForever('P');
    expect(d().pages.C.parentId).toBeNull();
    expect(d().pages.C.trashed).toBe(true);
    A.restorePage('C');
    expect(d().workspace.privatePages).toContain('C');
    ok();
  });

  it('closes in app tabs and forgets history entries that point at a deleted page', () => {
    family();
    newTab('#/p/S');
    newTab('#/p/G');
    const tabCount = getTabs().tabs.length;
    A.trashPage('C');
    A.deletePageForever('C');
    expect(d().pages.G).toBeUndefined();
    const hashes = getTabs().tabs.flatMap(t => t.stack);
    expect(hashes.some(h => h.includes('/G') || h.includes('/C'))).toBe(false);
    expect(getTabs().tabs.length).toBe(tabCount - 1);
    expect(getTabs().tabs.some(t => t.id === getTabs().active)).toBe(true);
  });

  it('keeps link blocks to a deleted page (they render "Deleted page")', () => {
    build(
      [
        { id: 'L', blocks: [['lk', 'page', '', [], { pageId: 'Z', isLink: true }]] },
        { id: 'Z', trashed: true },
      ],
      ['L', 'Z'],
    );
    A.deletePageForever('Z');
    expect(d().blocks.lk.pageId).toBe('Z');
    ok();
  });
});
