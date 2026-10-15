import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureJson from '../test/fixtures/doc-v2-current.json';
import { checkInvariants } from '../test/invariants';
import { getDoc, reloadFromStorage, replaceDoc, transact, undo, redo } from './store';
import { createSeed } from './seed';
import { normalizeDocWithReport } from './normalize';
import * as A from './actions';
import type { Block, BlockType, Doc } from './types';
import { moveBlocksToPage, moveTargetPages } from '../editor/MoveBlocks';
import { backspaceAtStart, deleteAtEnd, enterAt, type PrevEditable } from '../editor/ops';
import { applyBlockDrop } from '../editor/dnd';
import { turnIntoPage } from '../editor/BlockMenu';
import { escapeHtml, htmlToText } from '../lib/html';
import { CLIPBOARD_MIME, copyBlocks, cutBlocks, decodeClipboard, insertSerialized } from '../editor/clipboard';

/**
 * Property test for the document structure. Random sequences of the editor's store level
 * operations run against the recorded fixture and the seed workspace; after every single
 * operation the invariants in test/invariants.ts must hold (parent pointers, column shape,
 * page ownership, database rows, no cycles, everything reachable, no dangling ids).
 * A failure prints the seed and the operation log, so it can be replayed.
 */

const fixture = fixtureJson as unknown as Doc;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Small deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTUAL: BlockType[] = ['text', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout'];
const LIST_TYPES: BlockType[] = ['bulleted', 'numbered', 'todo', 'toggle'];

interface Ctx {
  r: () => number;
  log: string[];
  /** What the last copy or cut put on the clipboard (MIME type to data), kept across ops. */
  clip?: Record<string, string>;
}
const pick = <T,>(c: Ctx, xs: T[]): T | undefined => (xs.length ? xs[Math.floor(c.r() * xs.length)] : undefined);
const blocksOf = () => Object.values(getDoc().blocks);
const pagesOf = () => Object.values(getDoc().pages);
const textual = () => blocksOf().filter(b => TEXTUAL.includes(b.type));
const inColumn = (b: Block) => getDoc().blocks[b.parent]?.type === 'column';
const nested = (b: Block) => TEXTUAL.includes(getDoc().blocks[b.parent]?.type as BlockType);

/** Pages inside a page (through page blocks and database rows), at any depth. */
function descendantsOf(pageId: string): string[] {
  const d = getDoc();
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const p = d.pages[id];
    if (!p) return;
    (p.rows || []).forEach(r => {
      out.push(r);
      visit(r);
    });
    const walk = (ids: string[]) =>
      ids.forEach(bid => {
        const b = d.blocks[bid];
        if (!b) return;
        if (A.ownsPage(b)) {
          out.push(b.pageId);
          visit(b.pageId);
        }
        walk(b.children);
      });
    walk(p.content);
  };
  visit(pageId);
  return out;
}

/**
 * Editables of a page in document order, the way BlockView renders them: the title, then text
 * and code blocks, recursing into shown children and into every column of a column list.
 */
function editableOrder(pageId: string): PrevEditable[] {
  const d = getDoc();
  const out: PrevEditable[] = [{ title: pageId }];
  const walk = (ids: string[]) => {
    for (const id of ids) {
      const b = d.blocks[id];
      if (!b) continue;
      if (TEXTUAL.includes(b.type) || b.type === 'code') out.push({ block: id });
      if (b.type === 'columns') b.children.forEach(col => walk(d.blocks[col]?.children || []));
      else if (b.children.length && b.type !== 'page' && b.type !== 'database' && b.type !== 'column' && (b.type !== 'toggle' || b.open)) walk(b.children);
    }
  };
  walk(d.pages[pageId]?.content || []);
  return out;
}

/** The editable next to a block in document order (what neighbor() finds in the DOM). */
function domNeighbor(id: string, dir: -1 | 1): PrevEditable {
  const page = A.pageOfBlockIn(getDoc(), id);
  const order = editableOrder(page);
  const i = order.findIndex(e => e && 'block' in e && e.block === id);
  return i < 0 ? null : order[i + dir] || null;
}

/** A block selection the way topLevelSelection reports it: no block inside another selected one. */
function topLevel(ids: string[]): string[] {
  const d = getDoc();
  const uniq = Array.from(new Set(ids));
  return uniq.filter(id => !uniq.some(o => o !== id && A.isBlockWithin(d, d.blocks[id]?.parent, o)));
}

/** Blocks the editor lets a user select (columns are not selectable on their own). */
const selectable = () => blocksOf().filter(b => b.type !== 'column');

/** Picks one or two blocks to copy or cut, often a page block (the M2 and H6 shapes). */
function pickSelection(c: Ctx): string[] {
  const pages = selectable().filter(b => A.ownsPage(b));
  const first = c.r() < 0.5 ? pick(c, pages) : pick(c, selectable());
  const second = c.r() < 0.3 ? pick(c, selectable()) : undefined;
  return topLevel([first?.id, second?.id].filter(Boolean) as string[]);
}

/** A clipboard event as the browser hands it to the copy and cut handlers. */
function clipEvent(c: Ctx): ClipboardEvent {
  const data: Record<string, string> = {};
  c.clip = data;
  return { clipboardData: { setData: (k: string, v: string) => (data[k] = v) }, preventDefault: () => {} } as unknown as ClipboardEvent;
}

type Op = (c: Ctx) => void;

const OPS: Record<string, Op> = {
  insert: c => {
    const ref = pick(c, blocksOf().filter(b => b.type !== 'column'));
    if (!ref) return;
    const type = pick(c, TEXTUAL)!;
    c.log.push(`insert ${type} after ${ref.id}`);
    transact(tx => A.txInsertAfter(tx, ref.id, { type, html: 'x' }));
  },
  insertInColumn: c => {
    const col = pick(c, blocksOf().filter(b => b.type === 'column'));
    if (!col) return;
    const at = Math.floor(c.r() * (col.children.length + 1));
    const type = pick(c, TEXTUAL)!;
    c.log.push(`insert ${type} into column ${col.id} at ${at}`);
    transact(tx => A.txInsertBlock(tx, { parent: col.id, type, html: 'c' }, at));
  },
  split: c => {
    const b = pick(c, textual());
    if (!b) return;
    const text = htmlToText(b.html);
    const at = Math.floor(c.r() * (text.length + 1));
    c.log.push(`enter in ${b.id} (${b.type}) at ${at}`);
    enterAt(b.id, escapeHtml(text.slice(0, at)), escapeHtml(text.slice(at)));
  },
  enterOnEmptyListItem: c => {
    // Bias towards list items inside columns: Enter on an empty bullet used to create a phantom column.
    const lists = textual().filter(b => LIST_TYPES.includes(b.type));
    const b = pick(c, c.r() < 0.6 ? lists.filter(inColumn) : lists);
    if (!b) return;
    c.log.push(`enter on emptied ${b.type} ${b.id}`);
    enterAt(b.id, '', '');
  },
  backspaceAtStart: c => {
    const all = textual();
    const b = pick(c, c.r() < 0.5 ? all.filter(inColumn) : all);
    if (!b) return;
    // Mostly the real document order neighbour; sometimes an arbitrary block to stress the guards.
    const prev: PrevEditable = c.r() < 0.8 ? domNeighbor(b.id, -1) : c.r() < 0.5 ? { block: pick(c, blocksOf())!.id } : { title: pick(c, pagesOf())!.id };
    c.log.push(`backspace at start of ${b.id} (${b.type}) prev ${JSON.stringify(prev)}`);
    backspaceAtStart(b.id, b.html, prev);
  },
  deleteAtEnd: c => {
    const all = textual();
    const b = pick(c, c.r() < 0.5 ? all.filter(inColumn) : all);
    if (!b) return;
    const next = c.r() < 0.8 ? domNeighbor(b.id, 1) : { block: pick(c, blocksOf())!.id };
    const nextId = next && 'block' in next ? next.block : null;
    c.log.push(`delete at end of ${b.id} next ${nextId}`);
    deleteAtEnd(b.id, b.html, nextId);
  },
  indent: c => {
    const b = pick(c, blocksOf().filter(b => b.type !== 'column'));
    if (!b) return;
    c.log.push(`indent ${b.id}`);
    transact(tx => A.txIndent(tx, b.id));
  },
  outdent: c => {
    // Blocks at the root of a column must stay put; nested blocks must come out one level.
    const roll = c.r();
    const pool = blocksOf().filter(b => (roll < 0.4 ? inColumn(b) : roll < 0.9 ? nested(b) : b.type !== 'column'));
    const b = pick(c, pool);
    if (!b) return;
    c.log.push(`outdent ${b.id}`);
    transact(tx => A.txOutdent(tx, b.id));
  },
  moveBlock: c => {
    const b = pick(c, blocksOf());
    if (!b) return;
    const d = getDoc();
    const parent = pick(c, [...Object.keys(d.pages), ...Object.keys(d.blocks)])!;
    const list = d.pages[parent]?.content || d.blocks[parent]?.children || [];
    const index = Math.floor(c.r() * (list.length + 1));
    c.log.push(`txMoveBlock ${b.id} (${b.type}) to ${parent} at ${index}`);
    transact(tx => A.txMoveBlock(tx, b.id, parent, index));
  },
  movePageBlockIntoDescendant: c => {
    const d = getDoc();
    const b = pick(c, blocksOf().filter(x => A.ownsPage(x) && d.pages[x.pageId!]));
    if (!b) return;
    const target = pick(c, [b.pageId!, ...descendantsOf(b.pageId!)])!;
    c.log.push(`txMoveBlock page block ${b.id} into its own page or a descendant ${target}`);
    transact(tx => A.txMoveBlock(tx, b.id, target, 0));
  },
  moveSubtreeIntoOwnedPage: c => {
    // A toggle (or any block) holding a sub page, moved into that sub page.
    const d = getDoc();
    const holder = pick(c, blocksOf().filter(b => !A.ownsPage(b) && A.ownedPagesIn(d, b.id).length > 0));
    if (!holder) return;
    const owned = A.ownedPagesIn(d, holder.id);
    const target = pick(c, owned.flatMap(p => [p, ...descendantsOf(p)]))!;
    c.log.push(`moveBlocksToPage [${holder.id}] into owned page ${target}`);
    moveBlocksToPage([holder.id], target);
  },
  dropBlocks: c => {
    const ids = [pick(c, blocksOf())?.id, c.r() < 0.3 ? pick(c, blocksOf())?.id : undefined].filter(Boolean) as string[];
    const target = pick(c, blocksOf().filter(b => b.type !== 'column' && !ids.includes(b.id)));
    if (!ids.length || !target) return;
    const mode = pick(c, ['before', 'after', 'inside', 'left', 'right'] as const)!;
    c.log.push(`drop [${ids}] ${mode} ${target.id}`);
    applyBlockDrop(ids, target.id, mode);
  },
  movePage: c => {
    const p = pick(c, pagesOf());
    if (!p) return;
    const d = getDoc();
    const roll = c.r();
    if (roll < 0.15) {
      const section = pick(c, ['private', 'favorites', 'bogus', ...d.workspace.teamspaces.map(t => t.id)])!;
      const index = c.r() < 0.5 ? undefined : Math.floor(c.r() * 5);
      c.log.push(`movePage ${p.id} to section ${section} at ${index}`);
      A.movePage(p.id, { section, index });
      return;
    }
    // Sidebar drops: databases (between their rows), rows (into), own descendants, anything.
    const dbs = pagesOf().filter(x => x.isDatabase).map(x => x.id);
    const rows = pagesOf().filter(x => x.dbId).map(x => x.id);
    const pool = roll < 0.45 ? dbs : roll < 0.6 ? rows : roll < 0.75 ? descendantsOf(p.id) : Object.keys(d.pages);
    const target = pick(c, pool);
    if (!target) return;
    const index = c.r() < 0.5 ? undefined : Math.floor(c.r() * 6);
    c.log.push(`movePage ${p.id} to page ${target} at ${index}`);
    A.movePage(p.id, { pageId: target, index });
  },
  reorderRow: c => {
    const row = pick(c, pagesOf().filter(p => p.dbId && !p.trashed));
    if (!row) return;
    const index = Math.floor(c.r() * 6);
    c.log.push(`movePage row ${row.id} within ${row.dbId} at ${index}`);
    A.movePage(row.id, { pageId: row.dbId, index });
  },
  moveBlocksToPage: c => {
    const ids = [pick(c, blocksOf())?.id, c.r() < 0.3 ? pick(c, blocksOf())?.id : undefined].filter(Boolean) as string[];
    if (!ids.length) return;
    const pool = c.r() < 0.4 ? pagesOf().filter(p => p.isDatabase || p.dbId).map(p => p.id) : Object.keys(getDoc().pages);
    const target = pick(c, pool);
    if (!target) return;
    c.log.push(`moveBlocksToPage [${ids}] to ${target}`);
    moveBlocksToPage(ids, target);
  },
  moveTo: c => {
    // "Move to" offers only valid pages: every one of them must work.
    const b = pick(c, blocksOf().filter(b => b.type !== 'column' && b.type !== 'columns'));
    if (!b) return;
    const target = pick(c, moveTargetPages([b.id]));
    if (!target) return;
    c.log.push(`Move to: [${b.id}] to ${target.id}`);
    expect(moveBlocksToPage([b.id], target.id), `Move to offered ${target.id} for ${b.id}`).toBe(true);
  },
  duplicateBlock: c => {
    const b = pick(c, blocksOf().filter(b => b.type !== 'column'));
    if (!b) return;
    c.log.push(`duplicateBlocks ${b.id}`);
    A.duplicateBlocks([b.id]);
  },
  duplicatePage: c => {
    const p = pick(c, pagesOf());
    if (!p) return;
    c.log.push(`duplicatePage ${p.id}`);
    A.duplicatePage(p.id);
  },
  trashPage: c => {
    const p = pick(c, pagesOf().filter(p => !p.trashed));
    if (!p) return;
    c.log.push(`trashPage ${p.id}`);
    A.trashPage(p.id);
  },
  deleteBlocks: c => {
    const b = pick(c, blocksOf().filter(b => b.type !== 'column'));
    if (!b) return;
    c.log.push(`deleteBlocks ${b.id}`);
    A.deleteBlocks([b.id]);
  },
  restore: c => {
    const p = pick(c, pagesOf().filter(p => p.trashed));
    if (!p) return;
    c.log.push(`restorePage ${p.id}`);
    A.restorePage(p.id);
  },
  deleteForever: c => {
    const p = pick(c, pagesOf().filter(p => p.trashed));
    if (!p) return;
    c.log.push(`deletePageForever ${p.id}`);
    A.deletePageForever(p.id);
  },
  makeColumns: c => {
    const all = blocksOf().filter(b => b.type !== 'column');
    const target = pick(c, all.filter(b => b.type !== 'columns'));
    const moved = pick(c, all);
    if (!target || !moved) return;
    const side = c.r() < 0.5 ? 'left' : 'right';
    c.log.push(`txMakeColumns target ${target.id} ids [${moved.id}] ${side}`);
    transact(tx => A.txMakeColumns(tx, target.id, [moved.id], side));
  },
  turnInto: c => {
    const b = pick(c, blocksOf());
    if (!b) return;
    const type = pick(c, [...TEXTUAL, 'code', 'divider', 'page'] as BlockType[])!;
    c.log.push(`turnInto ${b.id} (${b.type}) to ${type}`);
    A.turnInto([b.id], type);
  },
  turnIntoPage: c => {
    const b = pick(c, blocksOf());
    if (!b) return;
    c.log.push(`turnIntoPage ${b.id} (${b.type})`);
    turnIntoPage(b.id);
  },
  createPage: c => {
    const parent = pick(c, pagesOf().filter(p => !p.trashed && !p.isDatabase));
    c.log.push(`createPage under ${parent?.id}`);
    A.createPage(parent ? { parentId: parent.id } : { section: 'private' });
  },
  addRow: c => {
    const db = pick(c, pagesOf().filter(p => p.isDatabase));
    if (!db) return;
    c.log.push(`addRow ${db.id}`);
    A.addRow(db.id);
  },
  cut: c => {
    // The document cut handler: copy with the trashed pages noted, then delete (selection.ts).
    const ids = pickSelection(c);
    if (!ids.length) return;
    c.log.push(`cut [${ids}]`);
    cutBlocks(ids, clipEvent(c));
  },
  copy: c => {
    const ids = pickSelection(c);
    if (!ids.length) return;
    c.log.push(`copy [${ids}]`);
    copyBlocks(ids, clipEvent(c));
  },
  paste: c => {
    // What handlePaste and the block selection paste do: decode (nonce and normalizer), insert.
    const data = c.clip && decodeClipboard(c.clip[CLIPBOARD_MIME]);
    if (!data) return;
    const cutPages = (data.cut?.pages || []).filter(p => getDoc().pages[p]);
    const roll = c.r();
    if (cutPages.length && roll < 0.4) {
      // Into the cut page itself or one of its descendants: the H6 cycle shape.
      const p = pick(c, cutPages)!;
      const target = pick(c, [p, ...descendantsOf(p)])!;
      const content = getDoc().pages[target].content;
      const anchor = c.r() < 0.5 ? pick(c, content.filter(id => getDoc().blocks[id]?.type !== 'column')) : undefined;
      c.log.push(`paste into cut page ${p} via ${target} ${anchor ? 'after ' + anchor : 'at 0'}`);
      insertSerialized(data, anchor ? { afterId: anchor } : { parent: target, index: 0 });
    } else if (roll < 0.8) {
      const anchor = pick(c, selectable());
      if (!anchor) return;
      c.log.push(`paste after ${anchor.id}`);
      insertSerialized(data, { afterId: anchor.id });
    } else {
      const page = pick(c, pagesOf())!;
      const index = Math.floor(c.r() * (page.content.length + 1));
      c.log.push(`paste into page ${page.id} at ${index}`);
      insertSerialized(data, { parent: page.id, index });
    }
  },
  undo: c => {
    c.log.push('undo');
    undo();
  },
  redo: c => {
    c.log.push('redo');
    redo();
  },
};

/** A structural fingerprint, to count operations that actually changed the document. */
function shape(d: Doc): string {
  const b = Object.values(d.blocks).map(x => `${x.id}:${x.type}:${x.parent}:${x.children.join(',')}:${x.html.length}`);
  const p = Object.values(d.pages).map(x => `${x.id}:${x.parentId}:${x.dbId}:${!!x.trashed}:${x.content.join(',')}:${(x.rows || []).join(',')}:${x.title}`);
  return b.join('|') + p.join('|') + JSON.stringify(d.workspace);
}

/**
 * Runs one random sequence; returns the first violation with the op log, or null. With a
 * tally, counts per operation how often it actually changed the document.
 */
function runSequence(seed: number, start: Doc, steps: number, tally?: Record<string, number>): string | null {
  const r = prng(seed);
  vi.spyOn(Math, 'random').mockImplementation(prng(seed ^ 0x9e3779b9));
  replaceDoc(clone(start));
  // Start with empty undo history, so a printed seed replays on its own.
  expect(reloadFromStorage()).toBe(true);
  const c: Ctx = { r, log: [] };
  const names = Object.keys(OPS);
  for (let i = 0; i < steps; i++) {
    const name = pick(c, names)!;
    const before = tally ? shape(getDoc()) : '';
    try {
      OPS[name](c);
    } catch (e) {
      return `seed ${seed}: ${name} threw ${(e as Error).stack}\nops:\n${c.log.join('\n')}`;
    }
    if (tally && shape(getDoc()) !== before) tally[name] = (tally[name] || 0) + 1;
    const v = checkInvariants(getDoc());
    if (v.length) return `seed ${seed} after step ${i}:\n  ${v.join('\n  ')}\nops:\n${c.log.join('\n')}`;
  }
  // What the app writes must load without a single repair (no repaired copy, no notes).
  const { report } = normalizeDocWithReport(clone(getDoc()));
  if (report.changes) return `seed ${seed}: the normalizer changed app data: ${report.notes.join('; ')}\nops:\n${c.log.join('\n')}`;
  return null;
}

describe('baseline documents', () => {
  it('the recorded fixture satisfies the structural invariants', () => {
    expect(checkInvariants(clone(fixture))).toEqual([]);
  });
  it('the seed workspace satisfies the structural invariants', () => {
    expect(checkInvariants(createSeed())).toEqual([]);
  });
});

describe('structural invariants under random edit sequences', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const SEQUENCES = 200;
  const STEPS = 30;

  it('keeps the recorded fixture consistent', () => {
    for (let s = 1; s <= SEQUENCES; s++) {
      const failure = runSequence(s, fixture, STEPS);
      if (failure) throw new Error(failure);
    }
  }, 60000);

  it('keeps the seed workspace consistent', () => {
    const seed = createSeed();
    for (let s = 1001; s <= 1000 + SEQUENCES; s++) {
      const failure = runSequence(s, seed, STEPS);
      if (failure) throw new Error(failure);
    }
  }, 60000);

  it('actually exercises every kind of edit', () => {
    // Guards the test itself: an operation that never changes anything proves nothing. It runs
    // its own sequences, so it does not depend on the tests above or on test order.
    const tally: Record<string, number> = {};
    const seed = createSeed();
    for (let s = 1; s <= 60; s++) {
      const failure = runSequence(s, s % 2 ? fixture : seed, STEPS, tally);
      if (failure) throw new Error(failure);
    }
    const never = ['movePageBlockIntoDescendant', 'moveSubtreeIntoOwnedPage', 'redo', 'copy'];
    const mustChange = Object.keys(OPS).filter(n => !never.includes(n));
    for (const n of mustChange) expect(tally[n] || 0, `${n} never changed the document`).toBeGreaterThan(0);
  }, 60000);
});
