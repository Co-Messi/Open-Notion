import { getDoc, transact, breakCoalescing } from '../store/store';
import {
  txInsertBlock, txInsertAfter, txTurnInto, txOutdent, txIndent, txDeleteBlock, txMoveBlock, txDuplicateBlock,
} from '../store/actions';
import type { BlockType } from '../store/types';
import { sanitizeInline, htmlToText, escapeHtml } from '../lib/html';
import { splitAtSelection, textBeforeCaret, caretOffset, setCaret, plainLength, caretRect, atStart } from './caret';
import { focusBlock, neighbor, selectBlocks, slashState } from './controller';
import { attrSel } from '../lib/dom';

export const CONTINUE_TYPES: BlockType[] = ['bulleted', 'numbered', 'todo', 'toggle'];
export const TEXTUAL_TYPES: BlockType[] = ['text', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout'];
export const NON_EDITABLE: BlockType[] = ['divider', 'image', 'page', 'database', 'bookmark', 'table'];

const isEmptyHtml = (h: string) => !htmlToText(h).replace(/\n/g, '').length;

/* ------------------------------------------------------------------ */
/* Enter                                                               */
/* ------------------------------------------------------------------ */

export function handleEnter(el: HTMLElement, blockId: string) {
  const d = getDoc();
  const b = d.blocks[blockId];
  if (!b) return;
  const [rawBefore, rawAfter] = splitAtSelection(el);
  const before = sanitizeInline(rawBefore);
  const after = sanitizeInline(rawAfter);
  const wholeEmpty = isEmptyHtml(before) && isEmptyHtml(after);

  // Empty list item: outdent if nested, else turn into text.
  if (wholeEmpty && (CONTINUE_TYPES.includes(b.type) || b.type === 'quote' || b.type === 'callout')) {
    transact(tx => {
      if (!tx.pages[b.parent] && CONTINUE_TYPES.includes(b.type)) txOutdent(tx, blockId);
      else txTurnInto(tx, blockId, 'text');
    });
    breakCoalescing();
    focusBlock(blockId, 'start');
    return;
  }

  const nextType: BlockType = CONTINUE_TYPES.includes(b.type) ? b.type : 'text';
  let newId = '';

  // Caret at the very start of a non-empty block: push an empty block above.
  if (isEmptyHtml(before) && !isEmptyHtml(after) && !before.includes('<br')) {
    transact(tx => {
      const list = tx.siblings(blockId);
      newId = txInsertBlock(tx, { parent: b.parent, type: nextType, html: '', open: nextType === 'toggle' ? false : undefined }, list.indexOf(blockId));
    });
    breakCoalescing();
    focusBlock(blockId, 'start');
    return;
  }

  transact(tx => {
    tx.setBlock(blockId, { html: before });
    const partial = {
      type: nextType,
      html: after,
      checked: nextType === 'todo' ? false : undefined,
      open: nextType === 'toggle' ? false : undefined,
    };
    const opensInside = (b.type === 'toggle' && b.open) || (b.children.length > 0 && b.type !== 'toggle');
    if (opensInside) {
      newId = txInsertBlock(tx, { ...partial, type: b.type === 'toggle' ? 'text' : partial.type, parent: blockId }, 0);
    } else {
      newId = txInsertAfter(tx, blockId, partial);
    }
  });
  breakCoalescing();
  focusBlock(newId, 'start');
}

/* ------------------------------------------------------------------ */
/* Backspace at start / Delete at end                                  */
/* ------------------------------------------------------------------ */

/** Returns true when handled. */
export function handleBackspaceAtStart(el: HTMLElement, blockId: string): boolean {
  const d = getDoc();
  const b = d.blocks[blockId];
  if (!b) return false;

  if (b.type !== 'text') {
    transact(tx => txTurnInto(tx, blockId, 'text'));
    breakCoalescing();
    focusBlock(blockId, 'start');
    return true;
  }
  if (!d.pages[b.parent]) {
    transact(tx => txOutdent(tx, blockId));
    breakCoalescing();
    focusBlock(blockId, 'start');
    return true;
  }

  // Previous sibling that cannot hold text: select it (or remove the empty current block).
  const list = d.pages[b.parent].content;
  const idx = list.indexOf(blockId);
  const prevSib = idx > 0 ? d.blocks[list[idx - 1]] : null;
  if (prevSib && NON_EDITABLE.includes(prevSib.type)) {
    if (isEmptyHtml(b.html) && b.children.length === 0) {
      transact(tx => txDeleteBlock(tx, blockId));
    }
    selectBlocks([prevSib.id]);
    return true;
  }

  const prevEl = neighbor(el, -1);
  if (!prevEl) return false;
  const html = sanitizeInline(el.innerHTML);

  // Merge into the page title.
  if (prevEl.dataset.title !== undefined) {
    const pageId = prevEl.dataset.title!;
    const p = d.pages[pageId];
    const len = (p?.title || '').length;
    transact(tx => {
      if (!isEmptyHtml(html)) tx.setPage(pageId, { title: (p?.title || '') + htmlToText(html) });
      // Children move up to the page.
      const cur = tx.block(blockId);
      cur.children.forEach((c, i) => txMoveBlock(tx, c, pageId, idx + i + 1));
      txDeleteBlock(tx, blockId);
    });
    breakCoalescing();
    focusTitle(pageId, len);
    return true;
  }

  const prevId = prevEl.dataset.editableId;
  if (!prevId) return false;
  const prev = d.blocks[prevId];
  if (!prev) return false;
  if (prev.type === 'code') {
    if (isEmptyHtml(html)) {
      transact(tx => txDeleteBlock(tx, blockId));
      focusBlock(prevId, 'end');
    } else selectBlocks([prevId]);
    return true;
  }
  const junction = plainLength(prev.html);
  transact(tx => {
    tx.setBlock(prevId, { html: sanitizeInline(prev.html + html) });
    const cur = tx.block(blockId);
    const kids = [...cur.children];
    const target = tx.block(prevId);
    kids.forEach(k => txMoveBlock(tx, k, prevId, tx.block(prevId).children.length));
    void target;
    txDeleteBlock(tx, blockId);
  });
  breakCoalescing();
  focusBlock(prevId, junction);
  return true;
}

export function handleDeleteAtEnd(el: HTMLElement, blockId: string): boolean {
  const d = getDoc();
  const nextEl = neighbor(el, 1);
  if (!nextEl) return false;
  const nextId = nextEl.dataset.editableId;
  if (!nextId) return false;
  const next = d.blocks[nextId];
  if (!next || next.type === 'code') return false;
  const cur = d.blocks[blockId];
  const html = sanitizeInline(el.innerHTML);
  const junction = plainLength(html);
  transact(tx => {
    tx.setBlock(blockId, { html: sanitizeInline(html + next.html) });
    const nb = tx.block(nextId);
    [...nb.children].forEach(k => txMoveBlock(tx, k, blockId, tx.block(blockId).children.length));
    txDeleteBlock(tx, nextId);
  });
  void cur;
  breakCoalescing();
  focusBlock(blockId, junction);
  return true;
}

export function focusTitle(pageId: string, offset: number | 'end' = 'end') {
  requestAnimationFrame(() => {
    const t = document.querySelector(attrSel('data-title', pageId)) as HTMLElement | null;
    if (!t) return;
    t.focus();
    setCaret(t, offset);
  });
}

/* ------------------------------------------------------------------ */
/* Indent                                                              */
/* ------------------------------------------------------------------ */

export function indentBlocks(ids: string[], outdent: boolean, keepFocus?: { id: string; offset: number | null }) {
  transact(tx => {
    const order = outdent ? [...ids].reverse() : ids;
    order.forEach(id => (outdent ? txOutdent(tx, id) : txIndent(tx, id)));
  });
  breakCoalescing();
  if (keepFocus) focusBlock(keepFocus.id, keepFocus.offset ?? 'end');
}

/* ------------------------------------------------------------------ */
/* Markdown shortcuts                                                  */
/* ------------------------------------------------------------------ */

const NBSP = String.fromCharCode(160);
const BLOCK_SHORTCUTS: [RegExp, BlockType, Record<string, any>?][] = [
  [/^#$/, 'h1'],
  [/^##$/, 'h2'],
  [/^###$/, 'h3'],
  [/^[-*+]$/, 'bulleted'],
  [/^\d+\.$/, 'numbered'],
  [/^(\[\]|\[ \])$/, 'todo', { checked: false }],
  [/^\[x\]$/i, 'todo', { checked: true }],
  [/^>$/, 'toggle', { open: false }],
  [/^"$/, 'quote'],
];

/** Called after input; returns true if the block was transformed. */
export function tryMarkdown(el: HTMLElement, blockId: string, data: string | null): boolean {
  const d = getDoc();
  const b = d.blocks[blockId];
  if (!b || b.type === 'code') return false;
  const before = textBeforeCaret(el);

  if (data === ' ' && (b.type === 'text' || CONTINUE_TYPES.includes(b.type) || b.type === 'quote')) {
    const prefix = before.slice(0, -1);
    const last = before.slice(-1);
    if (last === ' ' || last === NBSP) {
      for (const [re, type, extra] of BLOCK_SHORTCUTS) {
        if (re.test(prefix)) {
          if (b.type === type && !extra) return false;
          // Record the typed text first so a single undo brings back "## " as text.
          const typed = sanitizeInline(el.innerHTML);
          if (typed !== b.html) transact(tx => tx.setBlock(blockId, { html: typed }), { key: 'type:' + blockId });
          breakCoalescing();
          const off = caretOffset(el) ?? before.length;
          setCaret(el, off);
          const [, after] = splitAtSelection(el);
          transact(tx => {
            txTurnInto(tx, blockId, type);
            tx.setBlock(blockId, { html: sanitizeInline(after), ...(extra || {}) });
          });
          breakCoalescing();
          focusBlock(blockId, 'start');
          return true;
        }
      }
    }
  }
  const text = el.textContent || '';
  if (data === '`' && before === '```' && text === '```') {
    transact(tx => {
      txTurnInto(tx, blockId, 'code');
      tx.setBlock(blockId, { html: '', language: 'plain text' });
    });
    breakCoalescing();
    focusBlock(blockId, 'start');
    return true;
  }
  if (data === '-' && text === '---' && b.type === 'text') {
    let nid = '';
    transact(tx => {
      txTurnInto(tx, blockId, 'divider');
      nid = txInsertAfter(tx, blockId, { type: 'text', html: '' });
    });
    breakCoalescing();
    focusBlock(nid, 'start');
    return true;
  }
  // Inline marks
  if (data === '`') {
    const m = before.match(/`([^`]+)`$/);
    if (m) return wrapInline(el, m[0].length, `<code>${escapeHtml(m[1])}</code>`);
  }
  if (data === '*') {
    let m = before.match(/\*\*([^*]+)\*\*$/);
    if (m) return wrapInline(el, m[0].length, `<b>${escapeHtml(m[1])}</b>`);
    m = before.match(/(?:^|[^*])\*([^*\s][^*]*)\*$/);
    if (m) return wrapInline(el, m[1].length + 2, `<i>${escapeHtml(m[1])}</i>`);
  }
  if (data === '_') {
    const m = before.match(/(?:^|\s)_([^_\s][^_]*)_$/);
    if (m) return wrapInline(el, m[1].length + 2, `<i>${escapeHtml(m[1])}</i>`);
  }
  if (data === '~') {
    const m = before.match(/~([^~]+)~$/);
    if (m) return wrapInline(el, m[0].length, `<s>${escapeHtml(m[1])}</s>`);
  }
  return false;
}

/** Inline element created by a markdown shortcut; the next typed text goes after it. */
export let exitFormatting: HTMLElement | null = null;
export function clearExitFormatting() {
  exitFormatting = null;
}

function wrapInline(el: HTMLElement, len: number, html: string): boolean {
  const off = caretOffset(el);
  if (off === null) return false;
  setCaret(el, off - len, off);
  document.execCommand('insertHTML', false, html);
  // Remember the new mark so the next keystroke is inserted after it (Chrome would otherwise
  // keep typing inside it because of its "typing style").
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    let n: Node | null = null;
    if (r.startContainer.nodeType === Node.ELEMENT_NODE) n = r.startContainer.childNodes[r.startOffset - 1] || null;
    else if (r.startOffset === 0) n = r.startContainer.previousSibling;
    else n = r.startContainer.parentNode;
    const isMark = (x: Node | null) => x instanceof HTMLElement && /^(CODE|B|I|S)$/.test(x.tagName);
    if (n instanceof HTMLElement && !isMark(n)) {
      const inner = n.querySelectorAll('code, b, i, s');
      n = inner.length ? inner[inner.length - 1] : n;
    }
    let guard = 0;
    while (n && n !== el && !isMark(n) && guard++ < 50) n = n.parentNode;
    if (n && n !== el) {
      const after = document.createRange();
      after.setStartAfter(n);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      exitFormatting = n as HTMLElement;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Slash                                                               */
/* ------------------------------------------------------------------ */

export function maybeOpenSlash(el: HTMLElement, blockId: string, data: string | null) {
  if (data !== '/') return;
  const off = caretOffset(el);
  if (off === null) return;
  const rect = caretRect();
  if (!rect) return;
  slashState.set({ blockId, start: off - 1, rect });
}

/* ------------------------------------------------------------------ */
/* Block-level commands used by shortcuts and menus                    */
/* ------------------------------------------------------------------ */

export function duplicateAndFocus(blockId: string) {
  let nid = '';
  transact(tx => {
    nid = txDuplicateBlock(tx, blockId);
  });
  breakCoalescing();
  focusBlock(nid, 'end');
}

export function moveBlockBy(blockId: string, dir: -1 | 1) {
  const d = getDoc();
  const b = d.blocks[blockId];
  if (!b) return;
  const list = d.pages[b.parent] ? d.pages[b.parent].content : d.blocks[b.parent]?.children || [];
  const idx = list.indexOf(blockId);
  const target = idx + dir;
  if (target < 0 || target >= list.length) return;
  transact(tx => txMoveBlock(tx, blockId, b.parent, dir > 0 ? target + 1 : target));
}

export { atStart };
