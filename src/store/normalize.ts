/**
 * The single ingest layer. Everything that reaches the store from outside (localStorage on
 * load, an imported backup, a clipboard payload, another tab) goes through these functions.
 *
 * Contract:
 * - Pure: the input is never mutated and the output shares no objects with it.
 * - Idempotent: normalizeDoc(normalizeDoc(x)) deep equals normalizeDoc(x).
 * - Lossless for valid data: a doc written by the current app comes back field for field.
 *   The allowlists below mirror src/store/types.ts exactly; a field missing here is lost on
 *   load, so extend both together.
 * - Safe: every html field except code source is sanitized, every URL follows lib/url.ts,
 *   record keys are safe ids (never `__proto__`), and structural references are repaired.
 */
import type {
  Block, BlockColor, BlockType, ColorName, Comment, DbView, Doc, Filter, Page, PropType, Property,
  SelectOption, Sort, Teamspace, ViewType, Workspace,
} from './types';
import { sanitizeInline } from '../lib/html';
import { isSafeId } from '../lib/own';
import { safeCover, safeIcon, safeImageSrc, safeLinkUrl } from '../lib/url';

export const BLOCK_TYPES: readonly BlockType[] = [
  'text', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'divider', 'code',
  'image', 'page', 'database', 'table', 'bookmark', 'columns', 'column',
];
const COLORS: readonly ColorName[] = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const PROP_TYPES: readonly PropType[] = [
  'title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person',
  'created_time', 'last_edited_time',
];
const VIEW_TYPES: readonly ViewType[] = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'];
const GROUPS = ['todo', 'in_progress', 'complete'] as const;
const NUMBER_FORMATS = ['number', 'percent', 'dollar', 'euro'] as const;
const FONTS = ['default', 'serif', 'mono'] as const;
const CARD_PREVIEWS = ['none', 'cover', 'content'] as const;
const CARD_SIZES = ['small', 'medium', 'large'] as const;

/** What the normalizer had to change. Empty for data written by the current app. */
export interface NormalizeReport {
  /** Number of individual repairs (dropped records, rewritten fields, broken references). */
  changes: number;
  /** Short descriptions of the first repairs, for the diagnostics panel. Ids only, no content. */
  notes: string[];
}

function newReport(): NormalizeReport {
  return { changes: 0, notes: [] };
}
function note(r: NormalizeReport, msg: string) {
  r.changes++;
  if (r.notes.length < 40) r.notes.push(msg);
}

export class NotADocError extends Error {
  constructor(msg = 'Not an OpenNotion workspace') {
    super(msg);
    this.name = 'NotADocError';
  }
}

/* ------------------------------------------------------------------ */
/* Primitive coercion                                                  */
/* ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}
/** Own keys that are safe ids; `__proto__` from JSON.parse and other prototype names are skipped. */
function safeKeys(o: Rec): string[] {
  return Object.keys(o).filter(isSafeId);
}
/** An array of safe id strings (order kept, invalid entries dropped). */
function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isSafeId) : [];
}
function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}
/** Sets `o[k] = v` only when `v` is defined, so absent fields never become `k: undefined`. */
function put<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined) {
  if (v !== undefined) o[k] = v;
}

/**
 * Deep copy of a JSON value (property values, filter values). Drops functions, prototype
 * keys and anything nested deeper than a sane limit.
 */
function jsonValue(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (depth > 8) return undefined;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const x of v.slice(0, 1000)) {
      const c = jsonValue(x, depth + 1);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  if (isObj(v)) {
    const out: Rec = {};
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const c = jsonValue(v[k], depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

/**
 * Sanitized inline HTML. A string without `<` cannot contain markup (character references
 * only ever decode to text), so it is kept byte for byte. Otherwise sanitize until stable.
 */
export function cleanHtml(v: unknown): string {
  if (typeof v !== 'string') return '';
  if (!v.includes('<')) return v;
  let cur = sanitizeInline(v);
  for (let i = 0; i < 4; i++) {
    if (!cur.includes('<')) return cur;
    const next = sanitizeInline(cur);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

function blockColor(v: unknown): BlockColor | undefined {
  if (typeof v !== 'string') return undefined;
  const base = v.endsWith('_background') ? v.slice(0, -'_background'.length) : v;
  return (COLORS as readonly string[]).includes(base) ? (v as BlockColor) : undefined;
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

interface BlockLimits {
  /** Longest html or caption kept (clipboard payloads only). */
  maxText?: number;
}

/** Field level normalization of one block. Structure (children, parent) is repaired later. */
export function normalizeBlockRecord(id: string, raw: unknown, r: NormalizeReport, lim: BlockLimits = {}): Block | null {
  if (!isObj(raw)) {
    note(r, `block ${id}: not an object`);
    return null;
  }
  const type = oneOf(raw.type, BLOCK_TYPES);
  if (!type) {
    note(r, `block ${id}: unknown type`);
    return null;
  }
  if (raw.id !== id) note(r, `block ${id}: id repaired`);
  let html: string;
  if (type === 'code') {
    // Raw source text: never parsed, kept byte for byte.
    html = typeof raw.html === 'string' ? raw.html : '';
  } else {
    html = cleanHtml(raw.html);
    if (typeof raw.html === 'string' && html !== raw.html) note(r, `block ${id}: html sanitized`);
  }
  if (lim.maxText && html.length > lim.maxText) html = html.slice(0, lim.maxText);
  const b: Block = {
    id,
    type,
    html,
    children: idList(raw.children),
    parent: typeof raw.parent === 'string' ? raw.parent : '',
    createdAt: num(raw.createdAt) ?? 0,
  };
  put(b, 'checked', bool(raw.checked));
  put(b, 'open', bool(raw.open));
  put(b, 'color', blockColor(raw.color));
  if (raw.icon !== undefined) {
    const icon = safeIcon(raw.icon);
    if (icon === null) note(r, `block ${id}: icon dropped`);
    else b.icon = icon;
  }
  const lang = str(raw.language);
  if (lang !== undefined) b.language = lang.slice(0, 64);
  if (raw.url !== undefined) {
    const u = type === 'bookmark' ? safeLinkUrl(raw.url) : type === 'image' ? safeImageSrc(raw.url) : (safeImageSrc(raw.url) ?? safeLinkUrl(raw.url));
    if (u === null) note(r, `block ${id}: url dropped`);
    else b.url = u;
  }
  const caption = str(raw.caption);
  if (caption !== undefined) b.caption = lim.maxText ? caption.slice(0, lim.maxText) : caption;
  const width = num(raw.width);
  if (width !== undefined && width > 0) b.width = width;
  if (raw.pageId !== undefined) {
    if (isSafeId(raw.pageId)) b.pageId = raw.pageId;
    else note(r, `block ${id}: pageId dropped`);
  }
  put(b, 'isLink', bool(raw.isLink));
  if (raw.rows !== undefined) {
    if (Array.isArray(raw.rows)) {
      const rows: string[][] = [];
      for (const row of raw.rows) {
        if (!Array.isArray(row)) {
          note(r, `block ${id}: table row dropped`);
          continue;
        }
        rows.push(
          row.map(cell => {
            const s = typeof cell === 'string' ? cell : typeof cell === 'number' ? String(cell) : '';
            const c = cleanHtml(s);
            if (c !== cell) note(r, `block ${id}: table cell sanitized`);
            return lim.maxText && c.length > lim.maxText ? c.slice(0, lim.maxText) : c;
          }),
        );
      }
      b.rows = rows;
    } else note(r, `block ${id}: rows dropped`);
  }
  put(b, 'headerRow', bool(raw.headerRow));
  return b;
}

function normalizeOption(raw: unknown): SelectOption | null {
  if (!isObj(raw) || !isSafeId(raw.id)) return null;
  const o: SelectOption = { id: raw.id, name: str(raw.name) ?? '', color: oneOf(raw.color, COLORS) ?? 'default' };
  put(o, 'group', oneOf(raw.group, GROUPS));
  return o;
}

function normalizeProperty(raw: unknown, r: NormalizeReport, pid: string): Property | null {
  if (!isObj(raw) || !isSafeId(raw.id) || !oneOf(raw.type, PROP_TYPES)) {
    note(r, `page ${pid}: property dropped`);
    return null;
  }
  const p: Property = { id: raw.id, name: str(raw.name) ?? '', type: raw.type as PropType };
  if (Array.isArray(raw.options)) {
    p.options = raw.options.map(normalizeOption).filter((o): o is SelectOption => !!o);
    if (p.options.length !== raw.options.length) note(r, `page ${pid}: option dropped`);
  }
  put(p, 'numberFormat', oneOf(raw.numberFormat, NUMBER_FORMATS));
  put(p, 'width', num(raw.width));
  return p;
}

function normalizeFilter(raw: unknown): Filter | null {
  if (!isObj(raw) || !isSafeId(raw.id) || !isSafeId(raw.propId)) return null;
  const f: Filter = { id: raw.id, propId: raw.propId, op: str(raw.op) ?? '' };
  if (raw.value !== undefined) put(f, 'value', jsonValue(raw.value));
  return f;
}

function normalizeSort(raw: unknown): Sort | null {
  if (!isObj(raw) || !isSafeId(raw.id) || !isSafeId(raw.propId)) return null;
  return { id: raw.id, propId: raw.propId, dir: raw.dir === 'desc' ? 'desc' : 'asc' };
}

function normalizeView(raw: unknown, r: NormalizeReport, pid: string): DbView | null {
  if (!isObj(raw) || !isSafeId(raw.id) || !oneOf(raw.type, VIEW_TYPES)) {
    note(r, `page ${pid}: view dropped`);
    return null;
  }
  const v: DbView = {
    id: raw.id,
    name: str(raw.name) ?? '',
    type: raw.type as ViewType,
    hidden: idList(raw.hidden),
    filters: Array.isArray(raw.filters) ? raw.filters.map(normalizeFilter).filter((f): f is Filter => !!f) : [],
    sorts: Array.isArray(raw.sorts) ? raw.sorts.map(normalizeSort).filter((s): s is Sort => !!s) : [],
  };
  if (raw.order !== undefined && Array.isArray(raw.order)) v.order = idList(raw.order);
  if (isSafeId(raw.groupBy)) v.groupBy = raw.groupBy;
  if (isSafeId(raw.dateProp)) v.dateProp = raw.dateProp;
  put(v, 'cardPreview', oneOf(raw.cardPreview, CARD_PREVIEWS));
  put(v, 'cardSize', oneOf(raw.cardSize, CARD_SIZES));
  put(v, 'wrapCells', bool(raw.wrapCells));
  if (isObj(raw.calcs)) {
    const calcs: Record<string, string> = {};
    for (const k of safeKeys(raw.calcs)) {
      const c = str(raw.calcs[k]);
      if (c !== undefined) calcs[k] = c;
    }
    v.calcs = calcs;
  }
  return v;
}

function normalizeComment(raw: unknown, r: NormalizeReport, pid: string): Comment | null {
  if (!isObj(raw) || !isSafeId(raw.id)) {
    note(r, `page ${pid}: comment dropped`);
    return null;
  }
  const c: Comment = { id: raw.id, createdAt: num(raw.createdAt) ?? 0, author: str(raw.author) ?? '' };
  put(c, 'text', str(raw.text));
  put(c, 'quote', str(raw.quote));
  if (raw.html !== undefined) {
    const h = cleanHtml(raw.html);
    if (h !== raw.html) note(r, `page ${pid}: comment html sanitized`);
    c.html = h;
  }
  return c;
}

function normalizePageRecord(id: string, raw: unknown, r: NormalizeReport): Page | null {
  if (!isObj(raw)) {
    note(r, `page ${id}: not an object`);
    return null;
  }
  if (raw.id !== id) note(r, `page ${id}: id repaired`);
  const createdAt = num(raw.createdAt) ?? 0;
  const p: Page = {
    id,
    title: str(raw.title) ?? '',
    parentId: isSafeId(raw.parentId) ? raw.parentId : null,
    content: idList(raw.content),
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
  };
  if (raw.parentId !== undefined && raw.parentId !== null && p.parentId === null) note(r, `page ${id}: parentId dropped`);
  if (raw.icon !== undefined) {
    const icon = safeIcon(raw.icon);
    if (icon === null) note(r, `page ${id}: icon dropped`);
    else p.icon = icon;
  }
  if (raw.cover !== undefined) {
    const cover = safeCover(raw.cover);
    if (cover === null) note(r, `page ${id}: cover dropped`);
    else p.cover = cover;
  }
  put(p, 'coverPos', num(raw.coverPos));
  put(p, 'trashed', bool(raw.trashed));
  put(p, 'trashedAt', num(raw.trashedAt));
  put(p, 'font', oneOf(raw.font, FONTS));
  put(p, 'smallText', bool(raw.smallText));
  put(p, 'fullWidth', bool(raw.fullWidth));
  put(p, 'locked', bool(raw.locked));
  put(p, 'isDatabase', bool(raw.isDatabase));
  put(p, 'inline', bool(raw.inline));
  if (Array.isArray(raw.schema)) p.schema = raw.schema.map(x => normalizeProperty(x, r, id)).filter((x): x is Property => !!x);
  if (Array.isArray(raw.views)) p.views = raw.views.map(x => normalizeView(x, r, id)).filter((x): x is DbView => !!x);
  if (Array.isArray(raw.rows)) p.rows = idList(raw.rows);
  if (raw.dbId !== undefined) {
    if (isSafeId(raw.dbId)) p.dbId = raw.dbId;
    else note(r, `page ${id}: dbId dropped`);
  }
  if (isObj(raw.props)) {
    const props: Record<string, unknown> = {};
    for (const k of Object.keys(raw.props)) {
      if (!isSafeId(k)) {
        note(r, `page ${id}: property value key dropped`);
        continue;
      }
      const v = jsonValue(raw.props[k]);
      if (v !== undefined) props[k] = v;
    }
    p.props = props;
  }
  if (Array.isArray(raw.comments)) p.comments = raw.comments.map(x => normalizeComment(x, r, id)).filter((x): x is Comment => !!x);
  return p;
}

const DEFAULT_WORKSPACE: Workspace = {
  name: 'My Workspace', icon: 'M', userName: 'You', userEmail: 'you@example.com', privatePages: [], favorites: [], teamspaces: [],
};

function normalizeWorkspace(raw: unknown, r: NormalizeReport): Workspace {
  if (!isObj(raw)) {
    note(r, 'workspace missing');
    return { ...DEFAULT_WORKSPACE, privatePages: [], favorites: [], teamspaces: [] };
  }
  const name = str(raw.name) ?? DEFAULT_WORKSPACE.name;
  const teamspaces: Teamspace[] = [];
  if (Array.isArray(raw.teamspaces)) {
    for (const t of raw.teamspaces) {
      if (!isObj(t) || !isSafeId(t.id) || teamspaces.some(x => x.id === t.id)) {
        note(r, 'teamspace dropped');
        continue;
      }
      const tname = str(t.name) ?? 'Teamspace';
      teamspaces.push({ id: t.id, name: tname, icon: safeIcon(t.icon) ?? (tname[0] || 'T'), pages: idList(t.pages) });
    }
  }
  return {
    name,
    icon: safeIcon(raw.icon) ?? (name[0]?.toUpperCase() || 'W'),
    userName: str(raw.userName) ?? DEFAULT_WORKSPACE.userName,
    userEmail: str(raw.userEmail) ?? DEFAULT_WORKSPACE.userEmail,
    privatePages: idList(raw.privatePages),
    favorites: idList(raw.favorites),
    teamspaces,
  };
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

/**
 * Makes `children`/`content` and `parent` agree, drops dangling ids, duplicates and blocks
 * that no page can reach (orphans and cycles). Iterative, so deep trees cannot overflow.
 */
function repairBlockTree(pages: Record<string, Page>, blocks: Record<string, Block>, r: NormalizeReport) {
  const has = (id: string) => Object.hasOwn(blocks, id);
  const listOf = (c: string) => (Object.hasOwn(pages, c) ? pages[c].content : blocks[c].children);
  // Every container that lists each block, in a deterministic order.
  const listers = new Map<string, string[]>();
  const containers = [...Object.keys(pages), ...Object.keys(blocks)];
  for (const c of containers) {
    for (const x of listOf(c)) {
      if (!has(x)) continue;
      const l = listers.get(x);
      if (l) {
        if (!l.includes(c)) l.push(c);
      } else listers.set(x, [c]);
    }
  }
  // Each block gets exactly one owner: its parent when the parent lists it, else the first lister.
  const owner = new Map<string, string>();
  for (const id of Object.keys(blocks)) {
    const b = blocks[id];
    const l = listers.get(id) || [];
    if (l.includes(b.parent)) owner.set(id, b.parent);
    else if (l.length) {
      owner.set(id, l[0]);
      blocks[id] = { ...b, parent: l[0] };
      note(r, `block ${id}: parent repaired`);
    }
    // A block that no list contains is unreachable and removed below.
  }
  for (const c of containers) {
    const list = listOf(c);
    const seen = new Set<string>();
    const next = list.filter(x => {
      if (!has(x) || owner.get(x) !== c || seen.has(x)) return false;
      seen.add(x);
      return true;
    });
    if (next.length !== list.length) {
      note(r, `${c}: dangling or duplicate child dropped`);
      if (Object.hasOwn(pages, c)) pages[c] = { ...pages[c], content: next };
      else blocks[c] = { ...blocks[c], children: next };
    }
  }
  // Keep only blocks reachable from a page.
  const reached = new Set<string>();
  const stack: string[] = [];
  for (const pid of Object.keys(pages)) stack.push(...pages[pid].content);
  while (stack.length) {
    const id = stack.pop()!;
    if (reached.has(id) || !has(id)) continue;
    reached.add(id);
    stack.push(...blocks[id].children);
  }
  for (const id of Object.keys(blocks)) {
    if (!reached.has(id)) {
      note(r, `block ${id}: unreachable, dropped`);
      delete blocks[id];
    }
  }
}

/** The page that (transitively) contains a block. */
function pageOfBlock(pages: Record<string, Page>, blocks: Record<string, Block>, id: string): string | null {
  let cur = Object.hasOwn(blocks, id) ? blocks[id] : undefined;
  let guard = 0;
  while (cur && guard++ < 100000) {
    if (Object.hasOwn(pages, cur.parent)) return cur.parent;
    cur = Object.hasOwn(blocks, cur.parent) ? blocks[cur.parent] : undefined;
  }
  return null;
}

const ownsPage = (b: Block) => (b.type === 'page' || b.type === 'database') && !!b.pageId && !b.isLink;

/**
 * Page level references: dbId and rows agree, each page has at most one owning block,
 * ownership has no cycles, parentId follows the owner, and the parent chain has no loops.
 */
function repairPages(pages: Record<string, Page>, blocks: Record<string, Block>, ws: Workspace, r: NormalizeReport) {
  const hasPage = (id: string | null | undefined): id is string => !!id && Object.hasOwn(pages, id);
  const setPage = (id: string, patch: Partial<Page>) => (pages[id] = { ...pages[id], ...patch });
  /** Removes a page from its database: both the dbId pointer and the db.rows entry. */
  const clearDbId = (id: string) => {
    const db = pages[id].dbId;
    if (db && hasPage(db) && pages[db].rows?.includes(id)) setPage(db, { rows: pages[db].rows!.filter(x => x !== id) });
    const { dbId: _drop, ...rest } = pages[id];
    pages[id] = rest;
  };

  for (const id of Object.keys(pages)) {
    const p = pages[id];
    if (p.parentId !== null && (!hasPage(p.parentId) || p.parentId === id)) {
      setPage(id, { parentId: null });
      note(r, `page ${id}: dangling parentId cleared`);
    }
    if (p.dbId !== undefined && (!hasPage(p.dbId) || !pages[p.dbId].isDatabase || p.dbId === id)) {
      clearDbId(id);
      note(r, `page ${id}: dangling dbId cleared`);
    }
  }
  // db.rows is a subset of the pages whose dbId points back (never the reverse: trashed
  // rows keep their dbId while out of the list so they can be restored).
  for (const id of Object.keys(pages)) {
    const p = pages[id];
    if (!p.rows) continue;
    const seen = new Set<string>();
    const rows = p.rows.filter(x => {
      if (seen.has(x) || !hasPage(x) || pages[x].dbId !== id) return false;
      seen.add(x);
      return true;
    });
    if (rows.length !== p.rows.length) {
      setPage(id, { rows });
      note(r, `page ${id}: rows repaired`);
    }
  }

  // Owning blocks, in document order: the first one owns the page, later ones become links.
  const ownerBlock = new Map<string, string>();
  const walk: string[] = [];
  for (const pid of Object.keys(pages)) walk.push(...[...pages[pid].content].reverse());
  while (walk.length) {
    const id = walk.pop()!;
    const b = blocks[id];
    if (!b) continue;
    if (ownsPage(b)) {
      if (ownerBlock.has(b.pageId!)) {
        blocks[id] = { ...b, isLink: true };
        note(r, `block ${id}: second owner of a page turned into a link`);
      } else ownerBlock.set(b.pageId!, id);
    }
    walk.push(...[...b.children].reverse());
  }

  // Structural parent of a page: the page holding its owning block, or its database.
  const up = (id: string): string | null => {
    const ob = ownerBlock.get(id);
    if (ob && blocks[ob]) return pageOfBlock(pages, blocks, ob);
    const p = pages[id];
    if (p.dbId && pages[p.dbId]?.rows?.includes(id)) return p.dbId;
    return null;
  };
  const placeAtRoot = (id: string) => {
    setPage(id, { parentId: null });
    const listed = ws.privatePages.includes(id) || ws.teamspaces.some(t => t.pages.includes(id));
    if (!listed && !pages[id].trashed) ws.privatePages = [...ws.privatePages, id];
  };
  // Break ownership cycles (a page placed inside itself or inside its own descendant).
  const state = new Map<string, 1 | 2>();
  for (const start of Object.keys(pages)) {
    const chain: string[] = [];
    let cur: string | null = start;
    while (cur && !state.has(cur)) {
      state.set(cur, 1);
      chain.push(cur);
      cur = up(cur);
    }
    if (cur && state.get(cur) === 1) {
      // The last page in the chain closes the loop: cut its upward edge.
      const last = chain[chain.length - 1];
      const ob = ownerBlock.get(last);
      if (ob && blocks[ob]) {
        blocks[ob] = { ...blocks[ob], isLink: true };
        ownerBlock.delete(last);
      } else if (pages[last].dbId) clearDbId(last);
      placeAtRoot(last);
      note(r, `page ${last}: ownership cycle broken`);
    }
    chain.forEach(c => state.set(c, 2));
  }
  // parentId follows the owning block.
  for (const [pid, bid] of ownerBlock) {
    if (!hasPage(pid) || !blocks[bid]) continue;
    const parent = pageOfBlock(pages, blocks, bid);
    if (parent && pages[pid].parentId !== parent) {
      setPage(pid, { parentId: parent });
      note(r, `page ${pid}: parentId repaired`);
    }
  }
  // No loops in the breadcrumb chain (dbId, else parentId). The cut removes the edge for
  // good (an owning block becomes a link) so a second pass cannot put it back.
  const done = new Set<string>();
  for (const start of Object.keys(pages)) {
    const chain = new Set<string>();
    let cur: string | null = start;
    let prev: string | null = null;
    while (cur && !done.has(cur)) {
      if (chain.has(cur)) {
        if (prev) {
          if (pages[prev].dbId) clearDbId(prev);
          else {
            const ob = ownerBlock.get(prev);
            if (ob && blocks[ob]) {
              blocks[ob] = { ...blocks[ob], isLink: true };
              ownerBlock.delete(prev);
            }
            placeAtRoot(prev);
          }
          note(r, `page ${prev}: parent loop broken`);
        }
        break;
      }
      chain.add(cur);
      prev = cur;
      const p: Page = pages[cur];
      cur = p.dbId || p.parentId;
      if (cur && !hasPage(cur)) cur = null;
    }
    chain.forEach(c => done.add(c));
  }
}

function filterPages(list: string[], pages: Record<string, Page>, r: NormalizeReport, what: string): string[] {
  const out = dedupe(list.filter(id => Object.hasOwn(pages, id)));
  if (out.length !== list.length) note(r, `${what}: missing or duplicate page dropped`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

export interface NormalizeResult {
  doc: Doc;
  report: NormalizeReport;
}

/**
 * Validates and repairs a whole workspace. Throws NotADocError when the value is not a
 * workspace at all (so the caller can keep the raw data and show recovery instead).
 */
export function normalizeDocWithReport(raw: unknown): NormalizeResult {
  if (!isObj(raw) || !isObj(raw.pages) || !isObj(raw.blocks)) throw new NotADocError();
  const r = newReport();
  const pages: Record<string, Page> = {};
  for (const k of Object.keys(raw.pages)) {
    if (!isSafeId(k)) {
      note(r, 'page with an unsafe key dropped');
      continue;
    }
    const p = normalizePageRecord(k, raw.pages[k], r);
    if (p) pages[k] = p;
  }
  const blocks: Record<string, Block> = {};
  for (const k of Object.keys(raw.blocks)) {
    if (!isSafeId(k)) {
      note(r, 'block with an unsafe key dropped');
      continue;
    }
    const b = normalizeBlockRecord(k, raw.blocks[k], r);
    if (b) blocks[k] = b;
  }
  repairBlockTree(pages, blocks, r);
  const ws = normalizeWorkspace(raw.workspace, r);
  // Each cut can expose the next problem in pathological data; repeat until stable so a
  // second normalize finds nothing left to do.
  for (let i = 0; i < 8; i++) {
    const before = r.changes;
    repairPages(pages, blocks, ws, r);
    if (r.changes === before) break;
  }
  ws.privatePages = filterPages(ws.privatePages, pages, r, 'private pages');
  ws.favorites = filterPages(ws.favorites, pages, r, 'favorites');
  ws.teamspaces = ws.teamspaces.map(t => ({ ...t, pages: filterPages(t.pages, pages, r, `teamspace ${t.id}`) }));
  const recent = normalizeRecent(raw.recent, pages);
  // Url property values must not keep a scheme outside the outbound allowlist.
  for (const id of Object.keys(pages)) {
    const p = pages[id];
    if (!p.dbId || !p.props) continue;
    const schema = pages[p.dbId]?.schema || [];
    let props: Record<string, unknown> | null = null;
    for (const prop of schema) {
      if (prop.type !== 'url') continue;
      const v = p.props[prop.id];
      if (typeof v === 'string' && /^\s*[a-z][a-z0-9+.-]*:/i.test(v) && !safeLinkUrl(v)) {
        props = props || { ...p.props };
        delete props[prop.id];
        note(r, `page ${id}: url value dropped`);
      }
    }
    if (props) pages[id] = { ...p, props };
  }
  const version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1;
  return { doc: { version, pages, blocks, workspace: ws, recent }, report: r };
}

export function normalizeDoc(raw: unknown): Doc {
  return normalizeDocWithReport(raw).doc;
}

/** The visit history: entries for existing pages, newest first, no duplicates, at most 30. */
export function normalizeRecent(raw: unknown, pages: Record<string, Page>): Doc['recent'] {
  if (!Array.isArray(raw)) return [];
  const out: Doc['recent'] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (!isObj(e) || !isSafeId(e.id) || !Object.hasOwn(pages, e.id) || seen.has(e.id)) continue;
    const at = num(e.at);
    if (at === undefined) continue;
    seen.add(e.id);
    out.push({ id: e.id, at });
    if (out.length >= 30) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

export const CLIP_LIMITS = { maxBlocks: 2000, maxDepth: 40, maxText: 200_000 };

export interface ClipBlocks {
  blocks: Record<string, Block>;
  roots: string[];
}

/**
 * Normalizes a clipboard block payload: the same field rules as the doc, plus caps on
 * block count, nesting depth and text size. Children that are missing, repeated or form
 * a cycle are dropped. Returns null when nothing usable is left.
 */
export function normalizeClipboardBlocks(raw: unknown): ClipBlocks | null {
  if (!isObj(raw) || !isObj(raw.blocks) || !Array.isArray(raw.roots)) return null;
  const r = newReport();
  const src = raw.blocks;
  const out: Record<string, Block> = {};
  const visited = new Set<string>();
  let count = 0;
  const take = (id: string, depth: number): Block | null => {
    if (visited.has(id) || count >= CLIP_LIMITS.maxBlocks || !isSafeId(id) || !Object.hasOwn(src, id)) return null;
    visited.add(id);
    const b = normalizeBlockRecord(id, src[id], r, { maxText: CLIP_LIMITS.maxText });
    if (!b) return null;
    count++;
    out[id] = b;
    return b;
  };
  // Iterative depth first walk; each block keeps only children that were accepted.
  const roots: string[] = [];
  for (const rid of idList(raw.roots)) {
    const root = take(rid, 0);
    if (!root) continue;
    roots.push(rid);
    const stack: { id: string; depth: number }[] = [{ id: rid, depth: 0 }];
    while (stack.length) {
      const { id, depth } = stack.pop()!;
      const b = out[id];
      const kids: string[] = [];
      if (depth < CLIP_LIMITS.maxDepth) {
        for (const c of b.children) {
          if (take(c, depth + 1)) {
            kids.push(c);
            stack.push({ id: c, depth: depth + 1 });
          }
        }
      }
      out[id] = { ...b, children: kids };
    }
  }
  return roots.length ? { blocks: out, roots } : null;
}
