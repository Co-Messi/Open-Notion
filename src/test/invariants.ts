import type { Block, Doc, Page } from '../store/types';

/**
 * Structural invariants of a document. Returns a list of human readable violations
 * (empty when the document is consistent). Used by the property tests after every
 * operation, so every message names the ids involved.
 *
 * Link blocks (`isLink`) may point at a page that was deleted forever: they render
 * "Deleted page" on purpose, so their `pageId` is exempt from the dangling id check.
 */
export function checkInvariants(d: Doc): string[] {
  const out: string[] = [];
  const P = d.pages;
  const B = d.blocks;
  const has = (rec: Record<string, unknown>, id: unknown) => typeof id === 'string' && Object.hasOwn(rec, id);
  const err = (m: string) => {
    if (out.length < 40) out.push(m);
  };

  /* ---------------- Records ---------------- */
  for (const [k, p] of Object.entries(P)) {
    if (!p || p.id !== k) err(`page key ${k} does not match its id`);
    if (!Array.isArray(p?.content)) err(`page ${k} has no content array`);
  }
  for (const [k, b] of Object.entries(B)) {
    if (!b || b.id !== k) err(`block key ${k} does not match its id`);
    if (!Array.isArray(b?.children)) err(`block ${k} has no children array`);
  }
  if (out.length) return out;

  /* ---------------- Block lists: every block in exactly one list, parent pointers match ---------------- */
  const seen = new Map<string, number>();
  const visitList = (owner: string, list: string[]) => {
    for (const id of list) {
      seen.set(id, (seen.get(id) || 0) + 1);
      const b = B[id];
      if (!has(B, id)) err(`${owner} lists missing block ${id}`);
      else if (b.parent !== owner) err(`block ${id} is listed by ${owner} but its parent is ${b.parent}`);
    }
  };
  for (const p of Object.values(P)) visitList(p.id, p.content);
  for (const b of Object.values(B)) visitList(b.id, b.children);
  for (const b of Object.values(B)) {
    const n = seen.get(b.id) || 0;
    if (n !== 1) err(`block ${b.id} (${b.type}) appears in ${n} child lists`);
    if (has(P, b.parent) && has(B, b.parent)) err(`block ${b.id} parent ${b.parent} is both a page and a block`);
    if (!has(P, b.parent) && !has(B, b.parent)) err(`block ${b.id} has dangling parent ${b.parent}`);
  }

  /* ---------------- No block cycles; every block ends at a page ---------------- */
  const pageOf = new Map<string, string>();
  for (const b of Object.values(B)) {
    const path = new Set<string>();
    let cur: Block | undefined = b;
    let page = '';
    while (cur) {
      if (path.has(cur.id)) {
        err(`block cycle through ${cur.id}`);
        break;
      }
      path.add(cur.id);
      if (has(P, cur.parent)) {
        page = cur.parent;
        break;
      }
      cur = B[cur.parent];
    }
    pageOf.set(b.id, page);
  }

  /* ---------------- Column shape ---------------- */
  for (const b of Object.values(B)) {
    if (b.type === 'columns') {
      if (b.children.length < 2) err(`columns ${b.id} has ${b.children.length} columns`);
      for (const c of b.children) if (B[c] && B[c].type !== 'column') err(`columns ${b.id} holds a ${B[c].type} block ${c}`);
    }
    if (b.type === 'column') {
      if (B[b.parent]?.type !== 'columns') err(`column ${b.id} sits under ${B[b.parent]?.type || 'a page'} ${b.parent}`);
      if (b.children.length === 0) err(`column ${b.id} is empty`);
    }
  }

  /* ---------------- Owned page blocks ---------------- */
  const owner = new Map<string, string>();
  for (const b of Object.values(B)) {
    if ((b.type !== 'page' && b.type !== 'database') || b.isLink) continue;
    if (!b.pageId || !has(P, b.pageId)) {
      err(`${b.type} block ${b.id} points at missing page ${b.pageId}`);
      continue;
    }
    if (owner.has(b.pageId)) err(`page ${b.pageId} is owned by blocks ${owner.get(b.pageId)} and ${b.id}`);
    owner.set(b.pageId, b.id);
    const pg = P[b.pageId];
    const home = pageOf.get(b.id);
    if (pg.parentId !== home) err(`page ${pg.id} is owned by block ${b.id} in ${home} but its parentId is ${pg.parentId}`);
    if (pg.dbId) err(`row ${pg.id} is owned by block ${b.id}`);
    if (pg.trashed) err(`trashed page ${pg.id} still has its block ${b.id}`);
    if (home && P[home]?.isDatabase) err(`database ${home} holds page block ${b.id} in its content`);
  }

  /* ---------------- Root lists ---------------- */
  const roots = new Map<string, string>();
  const rootList = (name: string, ids: string[]) => {
    for (const id of ids) {
      if (!has(P, id)) {
        err(`${name} lists missing page ${id}`);
        continue;
      }
      if (roots.has(id)) err(`page ${id} is in root lists ${roots.get(id)} and ${name}`);
      roots.set(id, name);
      const p = P[id];
      if (p.parentId !== null) err(`root page ${id} in ${name} has parentId ${p.parentId}`);
      if (p.dbId) err(`row ${id} is in root list ${name}`);
      if (owner.has(id)) err(`root page ${id} in ${name} is also owned by block ${owner.get(id)}`);
    }
  };
  rootList('privatePages', d.workspace.privatePages);
  for (const t of d.workspace.teamspaces) rootList('teamspace ' + t.id, t.pages);
  const favs = new Set<string>();
  for (const id of d.workspace.favorites) {
    if (!has(P, id)) err(`favorites lists missing page ${id}`);
    if (favs.has(id)) err(`favorites lists ${id} twice`);
    favs.add(id);
  }
  for (const r of d.recent || []) if (!has(P, r.id)) err(`recent lists missing page ${r.id}`);

  /* ---------------- Databases and rows ---------------- */
  for (const p of Object.values(P)) {
    if (p.isDatabase) {
      const rows = p.rows || [];
      if (new Set(rows).size !== rows.length) err(`database ${p.id} lists a row twice`);
      for (const r of rows) {
        const row = P[r];
        if (!has(P, r)) err(`database ${p.id} lists missing row ${r}`);
        else if (row.dbId !== p.id) err(`database ${p.id} lists ${r} whose dbId is ${row.dbId}`);
        else if (row.trashed) err(`database ${p.id} lists trashed row ${r}`);
      }
    } else if (p.rows && p.rows.length) err(`page ${p.id} is not a database but has rows`);
    if (p.dbId) {
      const db = P[p.dbId];
      if (!has(P, p.dbId) || !db.isDatabase) err(`row ${p.id} points at missing database ${p.dbId}`);
      else {
        if (p.parentId !== p.dbId) err(`row ${p.id} has parentId ${p.parentId} instead of ${p.dbId}`);
        const listed = (db.rows || []).includes(p.id);
        if (!p.trashed && !listed) err(`row ${p.id} is missing from ${p.dbId}.rows`);
      }
    }
  }

  /* ---------------- Page ancestry: no dangling parents, no cycles ---------------- */
  for (const p of Object.values(P)) {
    const path = new Set<string>();
    let cur: Page | undefined = p;
    while (cur) {
      if (path.has(cur.id)) {
        err(`page cycle through ${cur.id} (from ${p.id})`);
        break;
      }
      path.add(cur.id);
      const up: string | null | undefined = cur.dbId || cur.parentId;
      if (!up) break;
      if (!has(P, up)) {
        err(`page ${cur.id} has dangling parent ${up}`);
        break;
      }
      cur = P[up];
    }
  }

  /* ---------------- Reachability ---------------- */
  const reached = new Set<string>();
  const queue: string[] = [];
  const push = (id: string) => {
    if (has(P, id) && !reached.has(id)) {
      reached.add(id);
      queue.push(id);
    }
  };
  d.workspace.privatePages.forEach(push);
  d.workspace.teamspaces.forEach(t => t.pages.forEach(push));
  // The Trash lists every page with the trashed flag.
  Object.values(P).forEach(p => p.trashed && push(p.id));
  const walked = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    const p = P[id];
    (p.rows || []).forEach(push);
    const walk = (ids: string[]) => {
      for (const bid of ids) {
        const b = B[bid];
        if (!b || walked.has(bid)) continue;
        walked.add(bid);
        if ((b.type === 'page' || b.type === 'database') && b.pageId && !b.isLink) push(b.pageId);
        walk(b.children);
      }
    };
    walk(p.content);
  }
  for (const p of Object.values(P)) if (!reached.has(p.id)) err(`page ${p.id} "${p.title}" is unreachable`);

  return out;
}
