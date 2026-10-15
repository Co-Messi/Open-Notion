import type { ClipboardEvent } from 'react';
import { getDoc, transact, breakCoalescing, showToast } from '../store/store';
import { txInsertBlock, txInsertAfter, uid } from '../store/actions';
import type { Block } from '../store/types';
import { sanitizeInline, escapeHtml, htmlToText } from '../lib/html';
import { markdownToBlocks, pageToMarkdown } from '../lib/exporter';
import { splitAtSelection, isCollapsed } from './caret';
import { focusBlock } from './controller';

const MIME = 'application/x-nc-blocks';

interface Serialized {
  blocks: Record<string, Block>;
  roots: string[];
}

export function serializeBlocks(ids: string[]): Serialized {
  const d = getDoc();
  const out: Record<string, Block> = {};
  const walk = (id: string) => {
    const b = d.blocks[id];
    if (!b) return;
    out[id] = b;
    b.children.forEach(walk);
  };
  ids.forEach(walk);
  return { blocks: out, roots: ids };
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

export function copyBlocks(ids: string[], e?: ClipboardEvent | globalThis.ClipboardEvent) {
  const data = serializeBlocks(ids);
  const text = blocksToText(ids);
  if (e && e.clipboardData) {
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData(MIME, JSON.stringify(data));
  } else {
    navigator.clipboard?.writeText(text).catch(() => {});
  }
  lastCopied = data;
}
let lastCopied: Serialized | null = null;

/** Inserts serialized blocks (with fresh ids) after `afterId` or into `parent` at index. */
export function insertSerialized(data: Serialized, target: { afterId?: string; parent?: string; index?: number }): string[] {
  const created: string[] = [];
  transact(tx => {
    const clone = (id: string, parent: string): Block => {
      const src = data.blocks[id];
      const nid = uid();
      const b: Block = { ...src, id: nid, parent, children: [], createdAt: Date.now() };
      // Pasted page blocks become links so the original page is not shared by two parents.
      if ((b.type === 'page' || b.type === 'database') && b.pageId) b.isLink = true;
      tx.blocks[nid] = b;
      b.children = src.children.filter(c => data.blocks[c]).map(c => clone(c, nid).id);
      tx.blocks[nid] = { ...tx.blocks[nid], children: b.children };
      return tx.blocks[nid];
    };
    let parent: string;
    let index: number;
    if (target.afterId) {
      const ref = tx.block(target.afterId);
      parent = ref.parent;
      index = tx.siblings(target.afterId).indexOf(target.afterId) + 1;
    } else {
      parent = target.parent!;
      index = target.index ?? tx.childList(parent).length;
    }
    const list = [...tx.childList(parent)];
    data.roots.forEach((r, i) => {
      if (!data.blocks[r]) return;
      const b = clone(r, parent);
      list.splice(index + i, 0, b.id);
      created.push(b.id);
    });
    tx.setSiblings(parent, list);
  });
  breakCoalescing();
  return created;
}

export function handlePaste(e: ClipboardEvent<HTMLElement>, blockId: string, el: HTMLElement, commit: () => void) {
  const cd = e.clipboardData;
  const d = getDoc();
  const b = d.blocks[blockId];
  if (!b) return;

  // Images
  const file = Array.from(cd.files || []).find(f => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    if (file.size > 3 * 1024 * 1024) {
      showToast('Image is too large to store locally (max 3 MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let nid = '';
      transact(tx => {
        nid = txInsertAfter(tx, blockId, { type: 'image', url: String(reader.result) });
      });
      void nid;
    };
    reader.readAsDataURL(file);
    return;
  }

  const custom = cd.getData(MIME);
  if (custom) {
    e.preventDefault();
    try {
      const data = JSON.parse(custom) as Serialized;
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
    } catch {
      /* ignore */
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

export function pasteIntoSelection(afterId: string) {
  if (lastCopied) insertSerialized(lastCopied, { afterId });
}

export { pageToMarkdown, txInsertBlock };
