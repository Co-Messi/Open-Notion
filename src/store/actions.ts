import { getDoc, transact, Tx, setUi, showToast } from './store';
import type { Block, BlockType, DbView, Doc, Page, Property, PropType, SelectOption, ColorName } from './types';
import { htmlToText } from '../lib/html';
import { forgetPagesInTabs } from './tabs';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ------------------------------------------------------------------ */
/* Structure helpers                                                   */
/* ------------------------------------------------------------------ */

type DocLike = Pick<Doc, 'pages' | 'blocks'>;

/** Block types that can hold child blocks (rendered nested under them). */
export const CONTAINER_TYPES: BlockType[] = ['text', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout'];

/** Types that are part of the page and layout structure; "Turn into" never touches them. */
const STRUCTURAL_TYPES: BlockType[] = ['page', 'database', 'columns', 'column'];

/** A page or database block that owns its page (as opposed to a "link to page" block). */
export function ownsPage(b: Block | undefined): b is Block & { pageId: string } {
  return !!b && (b.type === 'page' || b.type === 'database') && !!b.pageId && !b.isLink;
}

/** The page that (transitively) holds a block, or '' for a detached block. */
export function pageOfBlockIn(d: DocLike, id: string): string {
  let cur = d.blocks[id];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (d.pages[cur.parent]) return cur.parent;
    cur = d.blocks[cur.parent];
  }
  return '';
}

/** Nearest column that contains a block, or '' when it is outside every column. */
export function columnOf(d: DocLike, id: string): string {
  let cur = d.blocks[d.blocks[id]?.parent];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.type === 'column') return cur.id;
    cur = d.blocks[cur.parent];
  }
  return '';
}

/** True when block `inner` is `outer` itself or sits inside its subtree. */
export function isBlockWithin(d: DocLike, inner: string, outer: string): boolean {
  let cur: string | undefined = inner;
  const seen = new Set<string>();
  while (cur && d.blocks[cur] && !seen.has(cur)) {
    if (cur === outer) return true;
    seen.add(cur);
    cur = d.blocks[cur].parent;
  }
  return false;
}

/** True when `pageId` is `ancestor` or one of its descendants (through parent pages and databases). */
export function isPageWithin(d: Pick<Doc, 'pages'>, pageId: string, ancestor: string): boolean {
  let cur: string | null | undefined = pageId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    const p: Page | undefined = d.pages[cur];
    cur = p ? p.dbId || p.parentId : null;
  }
  return false;
}

/** Pages owned by page and database blocks inside a block subtree (the block itself included). */
export function ownedPagesIn(d: DocLike, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (bid: string) => {
    const b = d.blocks[bid];
    if (!b || seen.has(bid)) return;
    seen.add(bid);
    if (ownsPage(b)) out.push(b.pageId);
    b.children.forEach(walk);
  };
  walk(id);
  return out;
}

/** Points the pages owned inside a block subtree at the page that now holds the block. */
export function txSyncOwnedPages(tx: Tx, id: string) {
  const home = pageOfBlockIn(tx, id) || null;
  for (const pid of ownedPagesIn(tx, id)) {
    if (tx.pages[pid] && tx.pages[pid].parentId !== home) tx.setPage(pid, { parentId: home });
  }
}

/**
 * Why block `id` cannot move into `parent` (a page or a block), or null when the move is fine.
 * Guards the structure: no cycles through blocks or pages, nothing hidden inside a database
 * or a block type that does not render children, and column lists only ever hold columns.
 */
export function moveBlockProblem(d: DocLike, id: string, parent: string): string | null {
  const b = d.blocks[id];
  if (!b) return 'missing';
  if (b.type === 'column') return 'Columns move with their column list';
  const parentPage = d.pages[parent];
  const parentBlock = parentPage ? undefined : d.blocks[parent];
  if (!parentPage && !parentBlock) return 'missing';
  if (parentBlock) {
    if (isBlockWithin(d, parent, id)) return 'A block can’t be moved inside itself';
    if (parentBlock.type === 'columns') return 'Only columns can go in a column list';
    if (parentBlock.type !== 'column' && !CONTAINER_TYPES.includes(parentBlock.type)) return 'This block can’t hold other blocks';
  }
  const target = parentPage ? parent : pageOfBlockIn(d, parent);
  if (!target) return 'missing';
  if (d.pages[target].isDatabase) return 'Blocks can’t be moved into a database';
  if (target !== pageOfBlockIn(d, id) && isTrashedDeep(d, target)) return 'That page is in the Trash';
  for (const owned of ownedPagesIn(d, id)) {
    if (isPageWithin(d, target, owned)) return 'A page can’t be moved inside itself';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

export function makeBlock(partial: Partial<Block> & { parent: string }): Block {
  return { id: uid(), type: 'text', html: '', children: [], createdAt: Date.now(), ...partial };
}

/** Inserts a block into `parent` at `index` (end when omitted). */
export function txInsertBlock(tx: Tx, partial: Partial<Block> & { parent: string }, index?: number): string {
  const b = makeBlock(partial);
  tx.blocks[b.id] = b;
  const list = [...tx.childList(partial.parent)];
  list.splice(index ?? list.length, 0, b.id);
  tx.setSiblings(partial.parent, list);
  tx.touched.add(tx.pageOfBlock(b.id));
  return b.id;
}

export function txInsertAfter(tx: Tx, refId: string, partial: Partial<Block>): string {
  const ref = tx.block(refId);
  const list = tx.siblings(refId);
  const idx = list.indexOf(refId);
  return txInsertBlock(tx, { ...partial, parent: ref.parent }, idx + 1);
}

/** Detaches a block from its parent list (does not delete it). */
export function txDetach(tx: Tx, id: string, cleanup = true) {
  const b = tx.block(id);
  if (!b) return;
  tx.touched.add(tx.pageOfBlock(id));
  const list = tx.siblings(id).filter(x => x !== id);
  tx.setSiblings(b.parent, list);
  if (cleanup) txCleanupColumns(tx, b.parent);
}

/** Removes empty columns and unwraps column lists that are left with a single column. */
export function txCleanupColumns(tx: Tx, parentId: string) {
  const col = tx.blocks[parentId];
  if (!col || col.type !== 'column') return;
  const listId = col.parent;
  const list = tx.blocks[listId];
  if (!list || list.type !== 'columns') return;
  if (col.children.length === 0) {
    tx.blocks[listId] = { ...list, children: list.children.filter(c => c !== parentId) };
    delete tx.blocks[parentId];
  }
  txUnwrapColumns(tx, listId);
}

/** A column list with one column left becomes plain blocks again; an empty one disappears. */
function txUnwrapColumns(tx: Tx, listId: string) {
  const cur = tx.blocks[listId];
  if (!cur || cur.type !== 'columns') return;
  if (cur.children.length <= 1) {
    const owner = cur.parent;
    const ownerList = [...tx.childList(owner)];
    const at = ownerList.indexOf(listId);
    const remaining = cur.children[0] ? tx.blocks[cur.children[0]] : null;
    const moved = remaining ? remaining.children : [];
    moved.forEach(m => (tx.blocks[m] = { ...tx.blocks[m], parent: owner }));
    ownerList.splice(at, 1, ...moved);
    tx.setSiblings(owner, ownerList);
    if (remaining) delete tx.blocks[remaining.id];
    delete tx.blocks[listId];
  }
}

/** Places `ids` beside `targetId` as a new column (left or right). Returns false when refused. */
export function txMakeColumns(tx: Tx, targetId: string, idsIn: string[], side: 'left' | 'right'): boolean {
  const target = tx.block(targetId);
  if (!target || target.type === 'columns' || target.type === 'column') return false;
  // Skip duplicates, the target itself, blocks that contain the target, and blocks whose
  // ancestor is also moving (they travel with it).
  const uniq = [...new Set(idsIn)];
  const ids = uniq.filter(
    id =>
      tx.blocks[id] &&
      id !== targetId &&
      !isBlockWithin(tx, targetId, id) &&
      !uniq.some(o => o !== id && isBlockWithin(tx, id, o)) &&
      !moveBlockProblem(tx, id, target.parent),
  );
  if (!ids.length) return false;
  const parent = tx.blocks[target.parent];
  const oldParents = ids.map(id => tx.block(id).parent);
  ids.forEach(id => txDetach(tx, id, false));
  const cleanupLater = () => oldParents.forEach(p => p !== target.parent && txCleanupColumns(tx, p));
  if (parent && parent.type === 'column') {
    // Add a sibling column inside the existing column list.
    const listId = parent.parent;
    const col: Block = makeBlock({ parent: listId, type: 'column' });
    tx.blocks[col.id] = { ...col, children: ids };
    ids.forEach(id => (tx.blocks[id] = { ...tx.blocks[id], parent: col.id }));
    const cols = [...tx.blocks[listId].children];
    const at = cols.indexOf(parent.id) + (side === 'right' ? 1 : 0);
    cols.splice(at, 0, col.id);
    tx.blocks[listId] = { ...tx.blocks[listId], children: cols };
    cleanupLater();
    ids.forEach(id => txSyncOwnedPages(tx, id));
    tx.touched.add(tx.pageOfBlock(targetId));
    return true;
  }
  const ownerList = [...tx.childList(tx.block(targetId).parent)];
  const at = ownerList.indexOf(targetId);
  const list = makeBlock({ parent: tx.block(targetId).parent, type: 'columns' });
  const a = makeBlock({ parent: list.id, type: 'column' });
  const bcol = makeBlock({ parent: list.id, type: 'column' });
  tx.blocks[list.id] = { ...list, children: side === 'right' ? [a.id, bcol.id] : [bcol.id, a.id] };
  tx.blocks[a.id] = { ...a, children: [targetId] };
  tx.blocks[bcol.id] = { ...bcol, children: ids };
  tx.blocks[targetId] = { ...tx.blocks[targetId], parent: a.id };
  ids.forEach(id => (tx.blocks[id] = { ...tx.blocks[id], parent: bcol.id }));
  ownerList.splice(at, 1, list.id);
  tx.setSiblings(list.parent, ownerList);
  cleanupLater();
  ids.forEach(id => txSyncOwnedPages(tx, id));
  tx.touched.add(tx.pageOfBlock(targetId));
  return true;
}

/** Inserts a column list with `n` columns, each holding an empty text block. Returns the first text block id. */
export function txInsertColumns(tx: Tx, parent: string, index: number, n: number): string {
  const list = makeBlock({ parent, type: 'columns' });
  const cols: string[] = [];
  let first = '';
  for (let i = 0; i < n; i++) {
    const c = makeBlock({ parent: list.id, type: 'column' });
    const t = makeBlock({ parent: c.id, type: 'text' });
    tx.blocks[t.id] = t;
    tx.blocks[c.id] = { ...c, children: [t.id] };
    cols.push(c.id);
    if (!first) first = t.id;
  }
  tx.blocks[list.id] = { ...list, children: cols };
  const l = [...tx.childList(parent)];
  l.splice(index, 0, list.id);
  tx.setSiblings(parent, l);
  return first;
}

/** Deletes a block and its subtree. Page blocks move their page to trash. */
export function txDeleteBlock(tx: Tx, id: string) {
  const b = tx.block(id);
  if (!b) return;
  txDetach(tx, id);
  // A column removed on its own leaves its list; a list with one column left is unwrapped.
  if (b.type === 'column') txUnwrapColumns(tx, b.parent);
  const rm = (bid: string) => {
    const x = tx.blocks[bid];
    if (!x) return;
    delete tx.blocks[bid];
    x.children.forEach(rm);
    if (ownsPage(x) && tx.pages[x.pageId]) {
      tx.setPage(x.pageId, { trashed: true, trashedAt: Date.now() });
    }
  };
  rm(id);
}

/** Moves a block (with its subtree) into `parent` at `index`. Returns false when the move is refused. */
export function txMoveBlock(tx: Tx, id: string, parent: string, index: number): boolean {
  const b = tx.block(id);
  if (!b) return false;
  if (moveBlockProblem(tx, id, parent)) return false;
  const sameParent = b.parent === parent;
  const oldParent = b.parent;
  const oldIdx = tx.siblings(id).indexOf(id);
  txDetach(tx, id, false);
  let idx = index;
  if (sameParent && oldIdx < index) idx -= 1;
  tx.blocks[id] = { ...tx.blocks[id], parent };
  const list = [...tx.childList(parent)];
  list.splice(Math.max(0, Math.min(idx, list.length)), 0, id);
  tx.setSiblings(parent, list);
  tx.touched.add(tx.pageOfBlock(id));
  if (oldParent !== parent) txCleanupColumns(tx, oldParent);
  // Sub pages anywhere in the moved subtree keep their parent pointer in sync.
  txSyncOwnedPages(tx, id);
  return true;
}

export function txDuplicateBlock(tx: Tx, id: string, parent?: string, index?: number): string {
  const src = tx.block(id);
  const list = tx.siblings(id);
  const target = parent ?? src.parent;
  const idx = index ?? list.indexOf(id) + 1;
  const copy = (bid: string, par: string): string => {
    const b = tx.blocks[bid];
    const nid = uid();
    let pageId = b.pageId;
    if ((b.type === 'page' || b.type === 'database') && b.pageId && !b.isLink && tx.pages[b.pageId]) {
      pageId = txDuplicatePage(tx, b.pageId, tx.pageOfBlock(bid) || null, false);
    }
    tx.blocks[nid] = { ...b, id: nid, parent: par, children: [], pageId, createdAt: Date.now() };
    tx.blocks[nid].children = b.children.map(c => copy(c, nid));
    return nid;
  };
  const nid = copy(id, target);
  const l = [...tx.childList(target)];
  l.splice(idx, 0, nid);
  tx.setSiblings(target, l);
  tx.touched.add(tx.pageOfBlock(nid));
  txSyncOwnedPages(tx, nid);
  return nid;
}

export function updateBlock(id: string, patch: Partial<Block>, historyKey?: string) {
  transact(tx => tx.setBlock(id, patch), historyKey ? { key: historyKey } : 'push');
}

export function deleteBlocks(ids: string[]) {
  transact(tx => ids.forEach(id => txDeleteBlock(tx, id)));
}

export function duplicateBlocks(ids: string[]): string[] {
  const out: string[] = [];
  transact(tx => {
    // Insert each copy after the last selected block to keep order.
    let after = ids[ids.length - 1];
    for (const id of ids) {
      const list = tx.siblings(after);
      const nid = txDuplicateBlock(tx, id, tx.block(after).parent, list.indexOf(after) + 1);
      out.push(nid);
      after = nid;
    }
  });
  return out;
}

const KEEP_HTML_TYPES: BlockType[] = ['text', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'code'];

export function txTurnInto(tx: Tx, id: string, type: BlockType) {
  const b = tx.block(id);
  if (!b || b.type === type) return;
  // Pages, databases and column layouts are structure, not text: turning them would orphan a page
  // or break a column list.
  if (STRUCTURAL_TYPES.includes(b.type) || STRUCTURAL_TYPES.includes(type)) return;
  const patch: Partial<Block> = { type };
  if (type === 'callout' && !b.icon) patch.icon = '💡';
  if (type === 'code') {
    patch.language = b.language || 'plain text';
    // Code stores plain text; htmlToText parses inside an inert template.
    patch.html = htmlToText(b.html);
  } else if (b.type === 'code') {
    patch.html = (b.html || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
  if (type === 'toggle' && b.open === undefined) patch.open = true;
  if (!KEEP_HTML_TYPES.includes(type)) patch.html = '';
  tx.setBlock(id, patch);
}

export function turnInto(ids: string[], type: BlockType) {
  transact(tx => ids.forEach(id => txTurnInto(tx, id, type)));
}

export function setBlockColor(ids: string[], color: Block['color']) {
  transact(tx => ids.forEach(id => tx.setBlock(id, { color })));
}

/** Indent: block becomes the last child of its previous sibling. */
export function txIndent(tx: Tx, id: string): boolean {
  const list = tx.siblings(id);
  const idx = list.indexOf(id);
  if (idx <= 0) return false;
  const prevId = list[idx - 1];
  const prev = tx.block(prevId);
  // Only text like blocks hold children; a columns block or a column must never receive one.
  if (!prev || !CONTAINER_TYPES.includes(prev.type)) return false;
  if (!txMoveBlock(tx, id, prevId, prev.children.length)) return false;
  if (prev.type === 'toggle' && !prev.open) tx.setBlock(prevId, { open: true });
  return true;
}

/**
 * Outdent: block moves after its parent; following siblings become its children (Notion behaviour).
 * Blocks at the top level of a page or of a column are already at the root and do not move.
 */
export function txOutdent(tx: Tx, id: string): boolean {
  const b = tx.block(id);
  if (!b || tx.pages[b.parent]) return false;
  const parent = tx.block(b.parent);
  if (!parent || parent.type === 'column' || parent.type === 'columns') return false;
  const list = tx.siblings(id);
  const idx = list.indexOf(id);
  const following = list.slice(idx + 1);
  const grand = parent.parent;
  const gList = tx.childList(grand);
  const pIdx = gList.indexOf(parent.id);
  if (!txMoveBlock(tx, id, grand, pIdx + 1)) return false;
  following.forEach(f => {
    const cur = tx.block(id);
    txMoveBlock(tx, f, id, cur.children.length);
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export function makePage(partial: Partial<Page> = {}): Page {
  const now = Date.now();
  return { id: uid(), title: '', parentId: null, content: [], createdAt: now, updatedAt: now, ...partial };
}

export interface CreatePageOpts {
  parentId?: string | null;
  /** Where a top-level page goes: private section or a teamspace. */
  section?: 'private' | string;
  title?: string;
  icon?: string;
  /** Insert the page block after this block (inside the parent page). */
  afterBlockId?: string;
  /** Insert the page block into this list owner at index. */
  blockParent?: string;
  blockIndex?: number;
  replaceBlockId?: string;
  isDatabase?: boolean;
  inline?: boolean;
  dbViewType?: DbView['type'];
}

export function txCreatePage(tx: Tx, o: CreatePageOpts = {}): string {
  const p = makePage({ parentId: o.parentId ?? null, title: o.title ?? '', icon: o.icon });
  tx.pages[p.id] = p;
  if (o.isDatabase) txInitDatabase(tx, p.id, o.dbViewType || 'table', !!o.inline);
  const blockType: BlockType = o.isDatabase ? 'database' : 'page';
  if (o.replaceBlockId && tx.blocks[o.replaceBlockId]) {
    tx.setBlock(o.replaceBlockId, { type: blockType, html: '', pageId: p.id, children: [] });
  } else if (o.afterBlockId && tx.blocks[o.afterBlockId]) {
    txInsertAfter(tx, o.afterBlockId, { type: blockType, pageId: p.id });
  } else if (o.blockParent) {
    txInsertBlock(tx, { parent: o.blockParent, type: blockType, pageId: p.id }, o.blockIndex);
  } else if (o.parentId && tx.pages[o.parentId]) {
    txInsertBlock(tx, { parent: o.parentId, type: blockType, pageId: p.id });
  } else {
    const section = o.section || 'private';
    if (section === 'private') {
      tx.setWorkspace({ privatePages: [...tx.workspace.privatePages, p.id] });
    } else {
      tx.setWorkspace({
        teamspaces: tx.workspace.teamspaces.map(t => (t.id === section ? { ...t, pages: [...t.pages, p.id] } : t)),
      });
    }
  }
  return p.id;
}

export function createPage(o: CreatePageOpts = {}): string {
  let id = '';
  transact(tx => {
    id = txCreatePage(tx, o);
  });
  return id;
}

export function updatePage(id: string, patch: Partial<Page>, historyKey?: string) {
  transact(tx => tx.setPage(id, patch), historyKey ? { key: historyKey } : 'push');
}

/** True when the page or any ancestor (parent page or database) is in the Trash. */
export function isTrashedDeep(d: { pages: Record<string, Page> }, id: string): boolean {
  let p: Page | undefined = d.pages[id];
  let guard = 0;
  while (p && guard++ < 100) {
    if (p.trashed) return true;
    const parent: string | null | undefined = p.dbId || p.parentId;
    p = parent ? d.pages[parent] : undefined;
  }
  return !d.pages[id];
}

/** Ordered child pages of a page, derived from its content (including nested blocks). */
export function childPagesOf(d: { pages: Record<string, Page>; blocks: Record<string, Block> }, pageId: string): string[] {
  const p = d.pages[pageId];
  if (!p) return [];
  if (p.isDatabase) return (p.rows || []).filter(r => d.pages[r] && !d.pages[r].trashed);
  const out: string[] = [];
  const walk = (ids: string[]) => {
    for (const id of ids) {
      const b = d.blocks[id];
      if (!b) continue;
      if ((b.type === 'page' || b.type === 'database') && b.pageId && !b.isLink) {
        const cp = d.pages[b.pageId];
        if (cp && !cp.trashed) out.push(b.pageId);
      }
      if (b.children.length) walk(b.children);
    }
  };
  walk(p.content);
  return out;
}

/** Ancestor chain from the workspace root down to (and including) the page. */
export function pagePath(pageId: string): Page[] {
  const d = getDoc();
  const out: Page[] = [];
  let cur: Page | undefined = d.pages[pageId];
  let guard = 0;
  while (cur && guard++ < 50) {
    out.unshift(cur);
    const parentId: string | null | undefined = cur.dbId || cur.parentId;
    cur = parentId ? d.pages[parentId] : undefined;
  }
  return out;
}

export function txTrashPage(tx: Tx, id: string) {
  tx.setPage(id, { trashed: true, trashedAt: Date.now() });
}

export function trashPage(id: string) {
  const page = getDoc().pages[id];
  if (!page) return;
  transact(tx => {
    txTrashPage(tx, id);
    // Remove the page block from its parent so the parent content no longer shows it.
    for (const b of Object.values(tx.blocks)) {
      if ((b.type === 'page' || b.type === 'database') && b.pageId === id && !b.isLink) {
        txDetach(tx, b.id);
        delete tx.blocks[b.id];
      }
    }
    if (page?.dbId && tx.pages[page.dbId]) {
      const db = tx.pages[page.dbId];
      tx.setPage(page.dbId, { rows: (db.rows || []).filter(r => r !== id) });
    }
  });
  showToast(`Moved “${page?.title || 'Untitled'}” to Trash`);
}

/** Adds a page to the private section unless a root list already holds it. */
function txEnsureRoot(tx: Tx, id: string) {
  const inTeam = tx.workspace.teamspaces.some(t => t.pages.includes(id));
  if (!tx.workspace.privatePages.includes(id) && !inTeam) {
    tx.setWorkspace({ privatePages: [...tx.workspace.privatePages, id] });
  }
}

/**
 * Brings a page back from the Trash. A row whose database is still in the Trash (or gone)
 * comes back as a normal private page: its dbId is cleared so nothing treats it as trashed.
 * A page whose parent is in the Trash comes back at the top of the private section.
 */
export function restorePage(id: string) {
  transact(tx => {
    const p = tx.page(id);
    if (!p) return;
    tx.setPage(id, { trashed: false, trashedAt: undefined });
    if (p.dbId) {
      const db = tx.pages[p.dbId];
      if (db && db.isDatabase && !isTrashedDeep(tx, db.id)) {
        if (!(db.rows || []).includes(id)) tx.setPage(db.id, { rows: [...(db.rows || []), id] });
        if (p.parentId !== db.id) tx.setPage(id, { parentId: db.id });
        return;
      }
      if (db?.rows?.includes(id)) tx.setPage(db.id, { rows: db.rows.filter(r => r !== id) });
      tx.setPage(id, { dbId: undefined, parentId: null });
      txEnsureRoot(tx, id);
      return;
    }
    const parent = p.parentId ? tx.pages[p.parentId] : null;
    if (parent && parent.id !== id && !parent.isDatabase && !isTrashedDeep(tx, parent.id) && !isPageWithin(tx, parent.id, id)) {
      const has = Object.values(tx.blocks).some(b => ownsPage(b) && b.pageId === id);
      if (!has) txInsertBlock(tx, { parent: parent.id, type: p.isDatabase ? 'database' : 'page', pageId: id });
    } else {
      tx.setPage(id, { parentId: null });
      txEnsureRoot(tx, id);
    }
  });
}

/**
 * Deletes a page, everything inside it and its database rows (trashed rows included).
 * Trashed pages that pointed at a deleted page as their parent move to the top level, so
 * restoring them later still works. Tabs, favorites and recents drop the deleted ids; link
 * blocks elsewhere keep pointing at the id and render "Deleted page".
 */
export function deletePageForever(id: string) {
  const gone = new Set<string>();
  transact(tx => {
    if (!tx.pages[id]) return;
    // A live page (not only in the Trash) also leaves the page that holds its block.
    const holder = Object.values(tx.blocks).find(b => ownsPage(b) && b.pageId === id);
    if (holder) txDeleteBlock(tx, holder.id);
    const pageQueue = [id];
    const removeBlocks = (ids: string[]) => {
      const stack = [...ids];
      while (stack.length) {
        const bid = stack.pop()!;
        const b = tx.blocks[bid];
        if (!b) continue;
        delete tx.blocks[bid];
        stack.push(...b.children);
        if (ownsPage(b)) pageQueue.push(b.pageId);
      }
    };
    const removeQueued = () => {
      while (pageQueue.length) {
        const pid = pageQueue.pop()!;
        const p = tx.pages[pid];
        if (!p || gone.has(pid)) continue;
        gone.add(pid);
        removeBlocks(p.content);
        pageQueue.push(...(p.rows || []));
        delete tx.pages[pid];
      }
    };
    removeQueued();
    // Rows that were trashed on their own are no longer listed by their database; they go too.
    for (const p of Object.values(tx.pages)) if (p.dbId && gone.has(p.dbId)) pageQueue.push(p.id);
    removeQueued();
    for (const p of Object.values(tx.pages)) {
      if (p.rows?.some(r => gone.has(r))) tx.setPage(p.id, { rows: p.rows.filter(r => !gone.has(r)) });
      if (p.parentId && gone.has(p.parentId)) {
        tx.setPage(p.id, { parentId: null });
        if (!p.trashed) txEnsureRoot(tx, p.id);
      }
    }
    tx.setWorkspace({
      privatePages: tx.workspace.privatePages.filter(x => !gone.has(x)),
      favorites: tx.workspace.favorites.filter(x => !gone.has(x)),
      teamspaces: tx.workspace.teamspaces.map(t => ({ ...t, pages: t.pages.filter(x => !gone.has(x)) })),
    });
    tx.recent = tx.recent.filter(r => !gone.has(r.id));
  });
  // In app tabs live outside the document (and outside undo), so they are cleaned after it.
  forgetPagesInTabs(gone);
}

export function txDuplicatePage(tx: Tx, id: string, parentId: string | null, rename = true): string {
  const src = tx.pages[id];
  const np = makePage({
    ...src,
    id: uid(),
    title: rename ? (src.title || 'Untitled') + ' (1)' : src.title,
    parentId,
    content: [],
    rows: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    comments: [],
  });
  tx.pages[np.id] = np;
  const copyBlock = (bid: string, par: string): string => {
    const b = tx.blocks[bid];
    const nid = uid();
    let pageId = b.pageId;
    if (b.pageId && !b.isLink && tx.pages[b.pageId]) pageId = txDuplicatePage(tx, b.pageId, np.id, false);
    tx.blocks[nid] = { ...b, id: nid, parent: par, children: [], pageId };
    tx.blocks[nid].children = b.children.map(c => copyBlock(c, nid));
    return nid;
  };
  tx.pages[np.id] = { ...tx.pages[np.id], content: src.content.map(c => copyBlock(c, np.id)) };
  if (src.isDatabase) {
    const rows = (src.rows || []).filter(r => tx.pages[r] && !tx.pages[r].trashed).map(r => {
      const nr = txDuplicatePage(tx, r, np.id, false);
      tx.pages[nr] = { ...tx.pages[nr], dbId: np.id };
      return nr;
    });
    tx.pages[np.id] = { ...tx.pages[np.id], rows };
  }
  return np.id;
}

export function duplicatePage(id: string): string {
  let nid = '';
  if (!getDoc().pages[id]) return nid;
  transact(tx => {
    const src = tx.pages[id];
    nid = txDuplicatePage(tx, id, src.parentId);
    // The copy is never trashed, even when the source is.
    tx.pages[nid] = { ...tx.pages[nid], trashed: undefined, trashedAt: undefined };
    if (src.dbId && tx.pages[src.dbId]?.isDatabase) {
      tx.pages[nid] = { ...tx.pages[nid], dbId: src.dbId };
      const db = tx.pages[src.dbId];
      const rows = [...(db.rows || [])];
      rows.splice(rows.indexOf(id) + 1, 0, nid);
      tx.setPage(src.dbId, { rows });
      return;
    }
    const blk = Object.values(tx.blocks).find(b => ownsPage(b) && b.pageId === id);
    if (blk) {
      const list = tx.siblings(blk.id);
      txInsertBlock(tx, { parent: blk.parent, type: src.isDatabase ? 'database' : 'page', pageId: nid }, list.indexOf(blk.id) + 1);
    } else {
      const ws = tx.workspace;
      if (!ws.privatePages.includes(id) && !ws.teamspaces.some(t => t.pages.includes(id))) {
        // The source is not placed anywhere (for example it sits in the Trash): the copy goes to Private.
        tx.pages[nid] = { ...tx.pages[nid], parentId: null };
        tx.setWorkspace({ privatePages: [...ws.privatePages, nid] });
      } else if (ws.privatePages.includes(id)) {
        const l = [...ws.privatePages];
        l.splice(l.indexOf(id) + 1, 0, nid);
        tx.setWorkspace({ privatePages: l });
      } else {
        tx.setWorkspace({
          teamspaces: ws.teamspaces.map(t => {
            if (!t.pages.includes(id)) return t;
            const l = [...t.pages];
            l.splice(l.indexOf(id) + 1, 0, nid);
            return { ...t, pages: l };
          }),
        });
      }
    }
  });
  return nid;
}

/**
 * Why a page cannot move to `target`, or null when it can. Moving into a database only
 * reorders that database's own rows; any other page dropped there is refused, because a
 * database renders rows, never content.
 */
export function movePageProblem(d: Pick<Doc, 'pages' | 'workspace'>, id: string, target: { pageId?: string; section?: string }): string | null {
  const p = d.pages[id];
  if (!p) return 'missing';
  if (p.trashed) return 'That page is in the Trash';
  if (target.pageId) {
    const dest = d.pages[target.pageId];
    if (!dest) return 'missing';
    if (isPageWithin(d, target.pageId, id)) return 'A page can’t be moved inside itself';
    if (isTrashedDeep(d, target.pageId)) return 'That page is in the Trash';
    if (dest.isDatabase && p.dbId !== dest.id) return 'Pages can’t be moved into a database';
    return null;
  }
  const section = target.section || 'private';
  if (section !== 'private' && section !== 'favorites' && !d.workspace.teamspaces.some(t => t.id === section)) return 'missing';
  return null;
}

/** Moves a page under another page (as a page block at the end) or to a top-level section. Returns false when refused. */
export function movePage(id: string, target: { pageId?: string; section?: string; index?: number }): boolean {
  const problem = movePageProblem(getDoc(), id, target);
  if (problem) {
    if (problem !== 'missing') showToast(problem);
    return false;
  }
  // Favorites is a list of shortcuts, not a location: dropping there only reorders/adds the shortcut.
  if (target.section === 'favorites') {
    transact(tx => {
      const f = tx.workspace.favorites;
      const orig = f.indexOf(id);
      let idx = target.index ?? f.length;
      if (orig >= 0 && orig < idx) idx -= 1;
      const l = f.filter(x => x !== id);
      l.splice(Math.max(0, Math.min(idx, l.length)), 0, id);
      tx.setWorkspace({ favorites: l });
    });
    return true;
  }
  // Indices refer to the list before the page is removed; moving down within the same list shifts by one.
  let index = target.index;
  if (index !== undefined) {
    const d = getDoc();
    const list = target.pageId
      ? childPagesOf(d, target.pageId)
      : target.section && target.section !== 'private'
        ? d.workspace.teamspaces.find(t => t.id === target.section)?.pages || []
        : d.workspace.privatePages.filter(x => d.pages[x] && !d.pages[x].trashed);
    const orig = list.indexOf(id);
    if (orig >= 0 && orig < index) index -= 1;
  }
  target = { ...target, index };
  transact(tx => {
    const p = tx.pages[id];
    if (!p) return;
    const dest = target.pageId ? tx.pages[target.pageId] : undefined;
    if (dest?.isDatabase) {
      // A row dropped among its own database's rows: reorder.
      const rows = (dest.rows || []).filter(r => r !== id);
      const visible = rows.filter(r => tx.pages[r] && !tx.pages[r].trashed);
      const at = target.index === undefined || target.index >= visible.length ? rows.length : rows.indexOf(visible[target.index]);
      rows.splice(at, 0, id);
      tx.setPage(dest.id, { rows });
      return;
    }
    // A row that leaves its database stops being a row.
    if (p.dbId) {
      const db = tx.pages[p.dbId];
      if (db?.rows?.includes(id)) tx.setPage(db.id, { rows: db.rows.filter(r => r !== id) });
      tx.setPage(id, { dbId: undefined });
    }
    // Detach from current location.
    const blk = Object.values(tx.blocks).find(b => ownsPage(b) && b.pageId === id);
    if (blk) {
      txDetach(tx, blk.id);
      delete tx.blocks[blk.id];
    }
    tx.setWorkspace({
      privatePages: tx.workspace.privatePages.filter(x => x !== id),
      teamspaces: tx.workspace.teamspaces.map(t => ({ ...t, pages: t.pages.filter(x => x !== id) })),
    });
    if (target.pageId) {
      tx.setPage(id, { parentId: target.pageId });
      const parentPage = tx.pages[target.pageId];
      // Place among existing page blocks according to index (index counts child pages).
      let insertAt = parentPage.content.length;
      if (target.index !== undefined) {
        const pageBlocks = parentPage.content.filter(b => tx.blocks[b]?.pageId && tx.pages[tx.blocks[b].pageId!] && !tx.pages[tx.blocks[b].pageId!].trashed);
        if (target.index < pageBlocks.length) insertAt = parentPage.content.indexOf(pageBlocks[target.index]);
      }
      txInsertBlock(tx, { parent: target.pageId, type: p.isDatabase ? 'database' : 'page', pageId: id }, insertAt);
    } else {
      tx.setPage(id, { parentId: null });
      const section = target.section || 'private';
      if (section === 'private') {
        const l = [...tx.workspace.privatePages];
        const visible = l.filter(x => tx.pages[x] && !tx.pages[x].trashed);
        const at = target.index === undefined || target.index >= visible.length ? l.length : l.indexOf(visible[target.index]);
        l.splice(at, 0, id);
        tx.setWorkspace({ privatePages: l });
      } else {
        tx.setWorkspace({
          teamspaces: tx.workspace.teamspaces.map(t => {
            if (t.id !== section) return t;
            const l = [...t.pages];
            l.splice(target.index ?? l.length, 0, id);
            return { ...t, pages: l };
          }),
        });
      }
    }
  });
  return true;
}

export function toggleFavorite(id: string) {
  transact(tx => {
    const f = tx.workspace.favorites;
    tx.setWorkspace({ favorites: f.includes(id) ? f.filter(x => x !== id) : [...f, id] });
  });
}

export function visitPage(id: string) {
  transact(tx => {
    tx.recent = [{ id, at: Date.now() }, ...tx.recent.filter(r => r.id !== id)].slice(0, 30);
  }, 'none');
}

/* ------------------------------------------------------------------ */
/* Databases                                                           */
/* ------------------------------------------------------------------ */

export const OPTION_COLORS: ColorName[] = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function randomOptionColor(): ColorName {
  return OPTION_COLORS[1 + Math.floor(Math.random() * (OPTION_COLORS.length - 1))];
}

export function makeView(type: DbView['type'], schema: Property[]): DbView {
  const names: Record<string, string> = { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar', timeline: 'Timeline' };
  const v: DbView = { id: uid(), name: names[type], type, hidden: [], filters: [], sorts: [] };
  if (type === 'board') {
    const g = schema.find(p => p.type === 'status') || schema.find(p => p.type === 'select');
    v.groupBy = g?.id;
  }
  if (type === 'calendar' || type === 'timeline') v.dateProp = schema.find(p => p.type === 'date')?.id;
  if (type === 'gallery') v.cardPreview = 'content';
  if (type === 'list' || type === 'gallery' || type === 'board') {
    v.hidden = schema.filter(p => p.type !== 'title' && p.type !== 'multi_select' && p.type !== 'select' && p.type !== 'status').map(p => p.id);
  }
  return v;
}

export function defaultStatusOptions(): SelectOption[] {
  return [
    { id: uid(), name: 'Not started', color: 'default', group: 'todo' },
    { id: uid(), name: 'In progress', color: 'blue', group: 'in_progress' },
    { id: uid(), name: 'Done', color: 'green', group: 'complete' },
  ];
}

export function txInitDatabase(tx: Tx, id: string, viewType: DbView['type'], inline: boolean) {
  const schema: Property[] = [{ id: 'title', name: 'Name', type: 'title' }];
  if (viewType === 'board') schema.push({ id: uid(), name: 'Status', type: 'status', options: defaultStatusOptions() });
  else if (viewType === 'calendar') schema.push({ id: uid(), name: 'Date', type: 'date' });
  else schema.push({ id: uid(), name: 'Tags', type: 'multi_select', options: [] });
  if (viewType === 'calendar') schema.push({ id: uid(), name: 'Tags', type: 'multi_select', options: [] });
  const view = makeView(viewType, schema);
  tx.setPage(id, { isDatabase: true, inline, schema, views: [view], rows: [] });
  const rows: string[] = [];
  const n = viewType === 'calendar' ? 0 : 3;
  for (let i = 0; i < n; i++) {
    const r = makePage({ parentId: id, dbId: id, props: {} });
    if (viewType === 'board') r.props = { [schema[1].id]: schema[1].options![i % 3].id };
    tx.pages[r.id] = r;
    rows.push(r.id);
  }
  tx.setPage(id, { rows });
}

export function createDatabase(o: CreatePageOpts & { viewType?: DbView['type'] }): string {
  let id = '';
  transact(tx => {
    id = txCreatePage(tx, { ...o, isDatabase: true, dbViewType: o.viewType || o.dbViewType || 'table' });
  });
  return id;
}

export function txAddRow(tx: Tx, dbId: string, props: Record<string, any> = {}, index?: number, title = ''): string {
  const db = tx.pages[dbId];
  const withDefaults = { ...props };
  for (const p of db.schema || []) {
    if (p.type === 'status' && !(p.id in withDefaults)) {
      const first = (p.options || []).find(o => o.group === 'todo') || p.options?.[0];
      if (first) withDefaults[p.id] = first.id;
    }
  }
  const r = makePage({ parentId: dbId, dbId, props: withDefaults, title });
  tx.pages[r.id] = r;
  const rows = [...(db.rows || [])];
  rows.splice(index ?? rows.length, 0, r.id);
  tx.setPage(dbId, { rows });
  return r.id;
}

export function addRow(dbId: string, props: Record<string, any> = {}, index?: number, title = ''): string {
  let id = '';
  transact(tx => {
    id = txAddRow(tx, dbId, props, index, title);
  });
  return id;
}

export function setRowProp(rowId: string, propId: string, value: any, historyKey?: string) {
  transact(tx => {
    const r = tx.pages[rowId];
    if (!r) return;
    if (propId === 'title') tx.setPage(rowId, { title: String(value ?? '') });
    else tx.setPage(rowId, { props: { ...(r.props || {}), [propId]: value } });
  }, historyKey ? { key: historyKey } : 'push');
}

export function updateSchema(dbId: string, fn: (schema: Property[]) => Property[]) {
  transact(tx => {
    const db = tx.pages[dbId];
    tx.setPage(dbId, { schema: fn(db.schema || []) });
  });
}

export function addProperty(dbId: string, type: PropType, name?: string): string {
  const id = uid();
  const defaults: Record<string, string> = {
    text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', status: 'Status', date: 'Date',
    checkbox: 'Checkbox', url: 'URL', email: 'Email', phone: 'Phone', person: 'Person', created_time: 'Created time',
    last_edited_time: 'Last edited time',
  };
  updateSchema(dbId, s => [
    ...s,
    { id, name: name || defaults[type] || 'Property', type, options: type === 'status' ? defaultStatusOptions() : type.includes('select') ? [] : undefined },
  ]);
  return id;
}

export function updateView(dbId: string, viewId: string, patch: Partial<DbView>) {
  transact(tx => {
    const db = tx.pages[dbId];
    tx.setPage(dbId, { views: (db.views || []).map(v => (v.id === viewId ? { ...v, ...patch } : v)) });
  });
}

export function addView(dbId: string, type: DbView['type']): string {
  let id = '';
  transact(tx => {
    const db = tx.pages[dbId];
    const v = makeView(type, db.schema || []);
    if (type === 'board' && !v.groupBy) {
      const p: Property = { id: uid(), name: 'Status', type: 'status', options: defaultStatusOptions() };
      tx.setPage(dbId, { schema: [...(db.schema || []), p] });
      v.groupBy = p.id;
    }
    if ((type === 'calendar' || type === 'timeline') && !v.dateProp) {
      const p: Property = { id: uid(), name: 'Date', type: 'date' };
      tx.setPage(dbId, { schema: [...(tx.pages[dbId].schema || []), p] });
      v.dateProp = p.id;
    }
    id = v.id;
    tx.setPage(dbId, { views: [...(tx.pages[dbId].views || []), v] });
  });
  return id;
}

export function deleteView(dbId: string, viewId: string) {
  transact(tx => {
    const db = tx.pages[dbId];
    const views = (db.views || []).filter(v => v.id !== viewId);
    if (views.length) tx.setPage(dbId, { views });
  });
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

export function openPage(id: string, opts: { peek?: boolean } = {}) {
  const p = getDoc().pages[id];
  if (!p) return;
  if (opts.peek && p.dbId) {
    setUi({ peekRowId: id, selectedBlocks: [] });
    return;
  }
  setUi({ peekRowId: null, selectedBlocks: [] });
  const hash = `#/p/${id}`;
  if (location.hash !== hash) location.hash = hash;
}

export function goHome() {
  setUi({ peekRowId: null, selectedBlocks: [] });
  location.hash = '#/home';
}

export function pageTitle(p: Page | undefined): string {
  if (!p) return 'Untitled';
  return p.title?.trim() || (p.isDatabase ? 'Untitled' : p.dbId ? 'Untitled' : 'New page');
}
