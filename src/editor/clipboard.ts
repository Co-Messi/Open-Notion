import type { ClipboardEvent } from 'react';
import { getDoc, transact, breakCoalescing, showToast } from '../store/store';
import { txInsertBlock, txInsertAfter, uid } from '../store/actions';
import type { Block } from '../store/types';
import { sanitizeInline, escapeHtml, htmlToText } from '../lib/html';
import { markdownToBlocks, pageToMarkdown } from '../lib/exporter';
import { splitAtSelection, isCollapsed } from './caret';
import { focusBlock } from './controller';
import { normalizeClipboardBlocks } from '../store/normalize';
import { storageGet, storageSet } from '../lib/storage';
import { isSafeId, own } from '../lib/own';
import { ImageError, ingestImage } from '../lib/images';
import { recordError } from '../lib/diagnostics';

export const CLIPBOARD_MIME = 'application/x-nc-blocks';
const MIME = CLIPBOARD_MIME;
const NONCE_KEY = 'on:clip-nonce';
/** Payloads larger than this are treated as plain text. */
const MAX_PAYLOAD_CHARS = 8 * 1024 * 1024;

/** Pages trashed by a cut, so pasting them again is a move rather than a dead link. */
export interface CutInfo {
  at: number;
  pages: string[];
}

export interface Serialized {
  blocks: Record<string, Block>;
  roots: string[];
  cut?: CutInfo;
}

let memoryNonce: string | null = null;
/**
 * A random secret per install. Structured block payloads are accepted only when they carry
 * it, so another site cannot plant blocks through the public custom MIME type: without the
 * nonce a paste is plain text.
 */
export function clipboardNonce(): string {
  const stored = storageGet(NONCE_KEY);
  if (stored && /^[a-f0-9]{32}$/.test(stored)) return stored;
  if (!memoryNonce) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    memoryNonce = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  storageSet(NONCE_KEY, memoryNonce);
  return memoryNonce;
}

export function encodeClipboard(data: Serialized): string {
  return JSON.stringify({ v: 1, nonce: clipboardNonce(), ...data });
}

/**
 * Reads a custom MIME payload. Returns null (treat the paste as plain text) when it is
 * malformed, too large or lacks this install's nonce. Accepted payloads still go through
 * the block normalizer.
 */
export function decodeClipboard(raw: string | null | undefined): Serialized | null {
  if (!raw || raw.length > MAX_PAYLOAD_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { nonce?: unknown }).nonce !== clipboardNonce()) return null;
  const blocks = normalizeClipboardBlocks(parsed);
  if (!blocks) return null;
  const c = (parsed as { cut?: unknown }).cut as Partial<CutInfo> | undefined;
  const cut = c && typeof c.at === 'number' && Array.isArray(c.pages) ? { at: c.at, pages: c.pages.filter(isSafeId).slice(0, 2000) } : undefined;
  return cut ? { ...blocks, cut } : blocks;
}

export function serializeBlocks(ids: string[], opts: { cut?: boolean } = {}): Serialized {
  const d = getDoc();
  const out: Record<string, Block> = {};
  const pages: string[] = [];
  const walk = (id: string) => {
    const b = own(d.blocks, id);
    if (!b || out[id]) return;
    out[id] = b;
    if ((b.type === 'page' || b.type === 'database') && b.pageId && !b.isLink) pages.push(b.pageId);
    b.children.forEach(walk);
  };
  ids.forEach(walk);
  const data: Serialized = { blocks: out, roots: ids.filter(id => out[id]) };
  if (opts.cut && pages.length) data.cut = { at: Date.now(), pages };
  return data;
}

export function blocksToText(ids: string[]): string {
  const d = getDoc();
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const b = d.blocks[id];
    if (!b) return;
    const ind = '  '.repeat(depth);
    const t = b.type === 'code' ? b.html : htmlToText(b.html);
    const prefix = b.type === 'bulleted' ? '- ' : b.type === 'numbered' ? '1. ' : b.type === 'todo' ? (b.checked ? '- [x] ' : '- [ ] ') : b.type === 'h1' ? '# ' : b.type === 'h2' ? '## ' : b.type === 'h3' ? '### ' : b.type === 'quote' ? '> ' : '';
    if (b.type === 'divider') lines.push('---');
    else if (b.type === 'page' && b.pageId) lines.push(ind + (d.pages[b.pageId]?.title || 'Untitled'));
    else lines.push(ind + prefix + t);
    b.children.forEach(c => walk(c, depth + 1));
  };
  ids.forEach(id => walk(id, 0));
  return lines.join('\n');
}

export function copyBlocks(ids: string[], e?: ClipboardEvent | globalThis.ClipboardEvent, opts: { cut?: boolean } = {}) {
  const data = serializeBlocks(ids, opts);
  const text = blocksToText(ids);
  if (e && e.clipboardData) {
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData(MIME, encodeClipboard(data));
  } else {
    navigator.clipboard?.writeText(text).catch(() => {});
  }
  lastCopied = data;
}
let lastCopied: Serialized | null = null;

/**
 * Inserts serialized blocks (with fresh ids) after `afterId` or into `parent` at index.
 * `data` must come from serializeBlocks or decodeClipboard (both normalized).
 */
export function insertSerialized(data: Serialized, target: { afterId?: string; parent?: string; index?: number }): string[] {
  const created: string[] = [];
  transact(tx => {
    // Pages this payload's cut sent to Trash: the first paste moves them here.
    const movable = new Set(
      (data.cut?.pages || []).filter(pid => {
        const p = own(tx.pages, pid);
        return !!p && p.trashed === true && (p.trashedAt ?? 0) >= data.cut!.at;
      }),
    );
    const moved: { pageId: string; blockId: string }[] = [];
    const clone = (id: string, parent: string): Block => {
      const src = data.blocks[id];
      const nid = uid();
      const b: Block = { ...src, id: nid, parent, children: [], createdAt: Date.now() };
      if ((b.type === 'page' || b.type === 'database') && b.pageId) {
        if (!src.isLink && movable.has(b.pageId)) {
          // Cut then paste is a move: this block owns the page again.
          movable.delete(b.pageId);
          delete b.isLink;
          moved.push({ pageId: b.pageId, blockId: nid });
        } else {
          // Otherwise a link, so the original page is not shared by two parents.
          b.isLink = true;
        }
      }
      tx.blocks[nid] = b;
      b.children = src.children.filter(c => data.blocks[c]).map(c => clone(c, nid).id);
      tx.blocks[nid] = { ...tx.blocks[nid], children: b.children };
      return tx.blocks[nid];
    };
    let parent: string;
    let index: number;
    if (target.afterId) {
      const ref = tx.block(target.afterId);
      if (!ref) return;
      parent = ref.parent;
      index = tx.siblings(target.afterId).indexOf(target.afterId) + 1;
    } else {
      parent = target.parent!;
      index = target.index ?? tx.childList(parent).length;
    }
    if (!own(tx.pages, parent) && !own(tx.blocks, parent)) return;
    const list = [...tx.childList(parent)];
    data.roots.forEach((r, i) => {
      if (!data.blocks[r]) return;
      const b = clone(r, parent);
      list.splice(index + i, 0, b.id);
      created.push(b.id);
    });
    tx.setSiblings(parent, list);
    for (const m of moved) tx.setPage(m.pageId, { trashed: false, trashedAt: undefined, parentId: tx.pageOfBlock(m.blockId) || null });
  });
  breakCoalescing();
  return created;
}

export function handlePaste(e: ClipboardEvent<HTMLElement>, blockId: string, el: HTMLElement, commit: () => void) {
  const cd = e.clipboardData;
  const d = getDoc();
  const b = d.blocks[blockId];
  if (!b) return;

  // Images: downscaled and stored in IndexedDB; the block keeps a reference.
  const file = Array.from(cd.files || []).find(f => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    void pasteImage(file, blockId);
    return;
  }

  // Structured blocks only from this install; anything else falls through to plain text.
  const data = decodeClipboard(cd.getData(MIME));
  if (data) {
    e.preventDefault();
    try {
      const empty = !(el.textContent || '').length;
      const created = insertSerialized(data, { afterId: blockId });
      if (empty && b.type === 'text') transact(tx => {
        const cur = tx.block(blockId);
        if (cur && !cur.html && cur.children.length === 0) {
          tx.setSiblings(cur.parent, tx.siblings(blockId).filter(x => x !== blockId));
          delete tx.blocks[blockId];
        }
      });
      if (created.length) focusBlock(created[created.length - 1], 'end');
    } catch (err) {
      recordError('paste', err);
    }
    return;
  }

  const text = cd.getData('text/plain');
  const html = cd.getData('text/html');

  // A URL pasted over a selection becomes a link.
  if (/^https?:\/\/\S+$/.test(text.trim()) && !isCollapsed()) {
    e.preventDefault();
    document.execCommand('createLink', false, text.trim());
    commit();
    return;
  }

  if (b.type === 'code') return; // handled by textarea

  // Multi-line text becomes several blocks.
  if (text.includes('\n')) {
    e.preventDefault();
    const specs = markdownToBlocks(text);
    if (!specs.length) return;
    const [before, after] = splitAtSelection(el);
    const first = specs.shift()!;
    let lastId = blockId;
    transact(tx => {
      const firstIsPlain = first.type === 'text' || !first.type;
      if (firstIsPlain) {
        tx.setBlock(blockId, { html: sanitizeInline(before + (first.html || '')) });
      } else if (!htmlToText(before)) {
        tx.setBlock(blockId, { ...first, html: first.html || '' } as Partial<Block>);
      } else {
        tx.setBlock(blockId, { html: sanitizeInline(before) });
        lastId = txInsertAfter(tx, lastId, first);
      }
      for (const s of specs) {
        delete (s as any).depth;
        lastId = txInsertAfter(tx, lastId, s);
      }
      if (htmlToText(after)) {
        const last = tx.block(lastId);
        tx.setBlock(lastId, { html: sanitizeInline((last.html || '') + after) });
      }
    });
    breakCoalescing();
    focusBlock(lastId, 'end');
    return;
  }

  e.preventDefault();
  const inline = html ? sanitizeInline(html) : escapeHtml(text);
  document.execCommand('insertHTML', false, inline);
  commit();
}

/** Stores a pasted image and inserts it after the block (or at the end of its page). */
async function pasteImage(file: File, blockId: string) {
  const d = getDoc();
  const startBlock = own(d.blocks, blockId);
  let pageId = '';
  for (let cur = startBlock, g = 0; cur && g < 1000; g++) {
    if (own(d.pages, cur.parent)) {
      pageId = cur.parent;
      break;
    }
    cur = own(d.blocks, cur.parent);
  }
  try {
    const url = await ingestImage(file);
    transact(tx => {
      if (own(tx.blocks, blockId)) txInsertAfter(tx, blockId, { type: 'image', url });
      else if (pageId && own(tx.pages, pageId)) txInsertBlock(tx, { parent: pageId, type: 'image', url });
    });
  } catch (err) {
    recordError('paste', err);
    showToast(err instanceof ImageError ? err.message : 'Could not paste the image');
  }
}

export function pasteIntoSelection(afterId: string) {
  if (lastCopied) insertSerialized(lastCopied, { afterId });
}

export { pageToMarkdown, txInsertBlock };
