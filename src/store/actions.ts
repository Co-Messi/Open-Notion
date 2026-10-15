import { getDoc, transact, Tx, setUi, showToast } from './store';
import type { Block, BlockType, DbView, Page, Property, PropType, SelectOption, ColorName } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

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
  const cur = tx.blocks[listId];
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

/** Places `ids` beside `targetId` as a new column (left or right). */
export function txMakeColumns(tx: Tx, targetId: string, ids: string[], side: 'left' | 'right') {
  const target = tx.block(targetId);
  if (!target) return;
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
    return;
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
  const rm = (bid: string) => {
    const x = tx.blocks[bid];
    if (!x) return;
    x.children.forEach(rm);
    if ((x.type === 'page' || x.type === 'database') && x.pageId && !x.isLink && tx.pages[x.pageId]) {
      tx.setPage(x.pageId, { trashed: true, trashedAt: Date.now() });
    }
    delete tx.blocks[bid];
  };
  rm(id);
}

export function txMoveBlock(tx: Tx, id: string, parent: string, index: number) {
  const b = tx.block(id);
  if (!b) return;
  // Prevent moving into own subtree.
  let p: string | undefined = parent;
  let guard = 0;
  while (p && tx.blocks[p] && guard++ < 1000) {
    if (p === id) return;
    p = tx.blocks[p].parent;
  }
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
  // Sub-page blocks keep their page's parent pointer in sync.
  const nb = tx.blocks[id];
  if ((nb.type === 'page' || nb.type === 'database') && nb.pageId && !nb.isLink && tx.pages[nb.pageId]) {
    tx.setPage(nb.pageId, { parentId: tx.pageOfBlock(id) || null });
  }
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
  if (!b) return;
  const patch: Partial<Block> = { type };
  if (type === 'callout' && !b.icon) patch.icon = '💡';
  if (type === 'code') {
    patch.language = b.language || 'plain text';
    // Code stores plain text.
    const tmp = document.createElement('div');
    tmp.innerHTML = b.html.replace(/<br\s*\/?>/g, '\n');
    patch.html = tmp.textContent || '';
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
  if (!prev || ['divider', 'image', 'page', 'database', 'code', 'table', 'bookmark'].includes(prev.type)) return false;
  txMoveBlock(tx, id, prevId, prev.children.length);
  if (prev.type === 'toggle' && !prev.open) tx.setBlock(prevId, { open: true });
  return true;
}

/** Outdent: block moves after its parent; following siblings become its children (Notion behaviour). */
export function txOutdent(tx: Tx, id: string): boolean {
  const b = tx.block(id);
  if (!b || tx.pages[b.parent]) return false;
  const parent = tx.block(b.parent);
  if (!parent) return false;
  const list = tx.siblings(id);
  const idx = list.indexOf(id);
  const following = list.slice(idx + 1);
  const grand = parent.parent;
  const gList = tx.childList(grand);
  const pIdx = gList.indexOf(parent.id);
  txMoveBlock(tx, id, grand, pIdx + 1);
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

/*
 * Performance note. Every transaction builds a new Tx that shallow copies the `pages` and
 * `blocks` maps, so a keystroke costs O(number of pages + blocks) in pointer copies, and every
 * `useDoc` selector reruns on every emit. That is acceptable for now: a copy of a few thousand
 * pointers takes well under a millisecond, undo snapshots share all unchanged objects, and the
 * expensive parts (JSON.stringify and the localStorage write) are already debounced. What does
 * not scale is work that walks block trees once per sidebar row, so `childPagesOf` below is
 * memoized per document snapshot: the maps are replaced on every transaction, which makes the
 * `pages` and `blocks` objects a free, exact cache key.
 */
const childPagesCache = new WeakMap<object, WeakMap<object, Map<string, string[]>>>();

/**
 * Ordered child pages of a page, derived from its content (including nested blocks). The result
 * is cached per document snapshot and shared between callers: treat it as read only.
 */
export function childPagesOf(d: { pages: Record<string, Page>; blocks: Record<string, Block> }, pageId: string): string[] {
  let byBlocks = childPagesCache.get(d.pages);
  if (!byBlocks) childPagesCache.set(d.pages, (byBlocks = new WeakMap()));
  let byId = byBlocks.get(d.blocks);
  if (!byId) byBlocks.set(d.blocks, (byId = new Map()));
  const hit = byId.get(pageId);
  if (hit) return hit;
  const out = Object.freeze(computeChildPages(d, pageId)) as string[];
  byId.set(pageId, out);
  return out;
}

function computeChildPages(d: { pages: Record<string, Page>; blocks: Record<string, Block> }, pageId: string): string[] {
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

export function restorePage(id: string) {
  transact(tx => {
    const p = tx.page(id);
    if (!p) return;
    tx.setPage(id, { trashed: false, trashedAt: undefined });
    if (p.dbId && tx.pages[p.dbId] && !tx.pages[p.dbId].trashed) {
      const db = tx.pages[p.dbId];
      if (!(db.rows || []).includes(id)) tx.setPage(p.dbId, { rows: [...(db.rows || []), id] });
      return;
    }
    const parent = p.parentId ? tx.pages[p.parentId] : null;
    if (parent && !parent.trashed) {
      const has = Object.values(tx.blocks).some(b => b.pageId === id && !b.isLink);
      if (!has) txInsertBlock(tx, { parent: parent.id, type: p.isDatabase ? 'database' : 'page', pageId: id });
    } else {
      tx.setPage(id, { parentId: null });
      const inTeam = tx.workspace.teamspaces.some(t => t.pages.includes(id));
      if (!tx.workspace.privatePages.includes(id) && !inTeam) {
        tx.setWorkspace({ privatePages: [...tx.workspace.privatePages, id] });
      }
    }
  });
}

export function deletePageForever(id: string) {
  transact(tx => {
    const rm = (pid: string) => {
      const p = tx.pages[pid];
      if (!p) return;
      const rmBlock = (bid: string) => {
        const b = tx.blocks[bid];
        if (!b) return;
        b.children.forEach(rmBlock);
        if (b.pageId && !b.isLink) rm(b.pageId);
        delete tx.blocks[bid];
      };
      p.content.forEach(rmBlock);
      (p.rows || []).forEach(rm);
      delete tx.pages[pid];
    };
    rm(id);
    // Drop references to the page and everything that was inside it.
    const gone = (x: string) => !tx.pages[x];
    tx.setWorkspace({
      privatePages: tx.workspace.privatePages.filter(x => !gone(x)),
      favorites: tx.workspace.favorites.filter(x => !gone(x)),
      teamspaces: tx.workspace.teamspaces.map(t => ({ ...t, pages: t.pages.filter(x => !gone(x)) })),
    });
    tx.recent = tx.recent.filter(r => !gone(r.id));
  });
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
  transact(tx => {
    const src = tx.pages[id];
    nid = txDuplicatePage(tx, id, src.parentId);
    if (src.dbId && tx.pages[src.dbId]) {
      tx.pages[nid] = { ...tx.pages[nid], dbId: src.dbId };
      const db = tx.pages[src.dbId];
      const rows = [...(db.rows || [])];
      rows.splice(rows.indexOf(id) + 1, 0, nid);
      tx.setPage(src.dbId, { rows });
      return;
    }
    const blk = Object.values(tx.blocks).find(b => b.pageId === id && !b.isLink);
    if (blk) {
      const list = tx.siblings(blk.id);
      txInsertBlock(tx, { parent: blk.parent, type: src.isDatabase ? 'database' : 'page', pageId: nid }, list.indexOf(blk.id) + 1);
    } else {
      const ws = tx.workspace;
      if (ws.privatePages.includes(id)) {
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

/** Moves a page under another page (as a page block at the end) or to a top-level section. */
export function movePage(id: string, target: { pageId?: string; section?: string; index?: number }) {
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
    return;
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
    if (target.pageId) {
      // Refuse to move into own descendant.
      let cur: Page | undefined = tx.pages[target.pageId];
      let guard = 0;
      while (cur && guard++ < 100) {
        if (cur.id === id) return;
        cur = cur.parentId ? tx.pages[cur.parentId] : undefined;
      }
    }
    // Detach from current location.
    const blk = Object.values(tx.blocks).find(b => b.pageId === id && !b.isLink && (b.type === 'page' || b.type === 'database'));
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
