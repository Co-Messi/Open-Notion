import { getDoc, transact, breakCoalescing, type Tx } from '../store/store';
import {
  txInsertBlock, txInsertAfter, txTurnInto, txOutdent, txIndent, txDeleteBlock, txMoveBlock, txDuplicateBlock,
  CONTAINER_TYPES, columnOf, isBlockWithin, pageOfBlockIn,
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
/* Store level edits behind Enter, Backspace and Delete                */
/* ------------------------------------------------------------------ */

/** Where the caret goes after a keyboard edit. */
export type CaretAfter = { block: string; at: number | 'start' | 'end' } | { title: string; at: number } | { select: string } | null;

/** Outcome of a key handled by the editor: `handled` stops the browser default. */
export interface KeyResult {
  handled: boolean;
  caret: CaretAfter;
}

/** The editable just before a block in document order: the page title or another block. */
export type PrevEditable = { title: string } | { block: string } | null;

const ABORT = new Error('no change');
const unchanged = (handled: boolean, caret: CaretAfter = null): KeyResult & { changed: false } => ({ handled, caret, changed: false });

/** Runs an edit as one undo step. An edit that reports no change commits nothing (no empty undo step). */
function edit(fn: (tx: Tx) => KeyResult & { changed: boolean }): KeyResult {
  let out: KeyResult = { handled: false, caret: null };
  try {
    transact(tx => {
      const r = fn(tx);
      out = { handled: r.handled, caret: r.caret };
      if (!r.changed) throw ABORT;
    });
  } catch (e) {
    if (e !== ABORT) throw e;
  }
  breakCoalescing();
  return out;
}

/** True when a block sits at the root of a page or of a column (nothing to outdent from). */
function atRoot(tx: Tx, id: string): boolean {
  const b = tx.blocks[id];
  return !!b && (!!tx.pages[b.parent] || tx.blocks[b.parent]?.type === 'column');
}

/** Two blocks may merge only on the same page, in the same column (or both outside columns). */
function sameScope(tx: Tx, a: string, b: string): boolean {
  return pageOfBlockIn(tx, a) === pageOfBlockIn(tx, b) && columnOf(tx, a) === columnOf(tx, b);
}

/** Enter with the selection split into `before` and `after` (sanitized html). */
export function enterAt(blockId: string, before: string, after: string): KeyResult {
  return edit(tx => {
    const b = tx.block(blockId);
    if (!b) return unchanged(false);
    // Empty list item: outdent if nested, else (at the root of a page or a column) turn into text.
    if (isEmptyHtml(before) && isEmptyHtml(after) && (CONTINUE_TYPES.includes(b.type) || b.type === 'quote' || b.type === 'callout')) {
      if (!(CONTINUE_TYPES.includes(b.type) && txOutdent(tx, blockId))) txTurnInto(tx, blockId, 'text');
      return { handled: true, changed: true, caret: { block: blockId, at: 'start' } };
    }
    const nextType: BlockType = CONTINUE_TYPES.includes(b.type) ? b.type : 'text';
    // Caret at the very start of a non-empty block: push an empty block above.
    if (isEmptyHtml(before) && !isEmptyHtml(after) && !before.includes('<br')) {
      txInsertBlock(tx, { parent: b.parent, type: nextType, html: '', open: nextType === 'toggle' ? false : undefined }, tx.siblings(blockId).indexOf(blockId));
      return { handled: true, changed: true, caret: { block: blockId, at: 'start' } };
    }
    tx.setBlock(blockId, { html: before });
    const partial = {
      type: nextType,
      html: after,
      checked: nextType === 'todo' ? false : undefined,
      open: nextType === 'toggle' ? false : undefined,
    };
    const opensInside = (b.type === 'toggle' && b.open) || (b.children.length > 0 && b.type !== 'toggle');
    const newId = opensInside
      ? txInsertBlock(tx, { ...partial, type: b.type === 'toggle' ? 'text' : partial.type, parent: blockId }, 0)
      : txInsertAfter(tx, blockId, partial);
    return { handled: true, changed: true, caret: { block: newId, at: 'start' } };
  });
}

/**
 * Backspace with the caret at the start of a block whose current html is `html`. `prev` is the
 * editable before it in document order. Blocks at the root of a page or a column merge with
 * the previous block in the same column; they never merge across columns, and only a block at
 * the top of the page itself merges into the title.
 */
export function backspaceAtStart(blockId: string, html: string, prev: PrevEditable): KeyResult {
  return edit(tx => {
    const b = tx.block(blockId);
    if (!b) return unchanged(false);
    if (b.type !== 'text') {
      txTurnInto(tx, blockId, 'text');
      return { handled: true, changed: true, caret: { block: blockId, at: 'start' } };
    }
    if (!atRoot(tx, blockId)) {
      const moved = txOutdent(tx, blockId);
      return { handled: true, changed: moved, caret: { block: blockId, at: 'start' } };
    }
    const list = tx.siblings(blockId);
    const idx = list.indexOf(blockId);
    // Previous sibling that cannot hold text: select it (or remove the empty current block).
    const prevSib = idx > 0 ? tx.blocks[list[idx - 1]] : null;
    if (prevSib && (NON_EDITABLE.includes(prevSib.type) || prevSib.type === 'columns')) {
      const remove = isEmptyHtml(html) && b.children.length === 0;
      if (remove) txDeleteBlock(tx, blockId);
      return { handled: true, changed: remove, caret: { select: prevSib.id } };
    }
    if (!prev) return unchanged(false);
    if ('title' in prev) {
      // Inside a column the title is only the neighbour in document order: never merge into it.
      if (prev.title !== b.parent || idx !== 0) return unchanged(true);
      const p = tx.page(prev.title);
      const len = p.title.length;
      if (!isEmptyHtml(html)) tx.setPage(p.id, { title: p.title + htmlToText(html).replace(/\n/g, ' ') });
      // Children move up to the page.
      tx.block(blockId).children.forEach((c, i) => txMoveBlock(tx, c, p.id, idx + i + 1));
      txDeleteBlock(tx, blockId);
      return { handled: true, changed: true, caret: { title: p.id, at: len } };
    }
    const target = tx.blocks[prev.block];
    if (!target || target.id === blockId) return unchanged(false);
    if (!sameScope(tx, target.id, blockId) || isBlockWithin(tx, target.id, blockId)) return unchanged(true);
    if (target.type === 'code') {
      const remove = isEmptyHtml(html) && b.children.length === 0;
      if (remove) txDeleteBlock(tx, blockId);
      return { handled: true, changed: remove, caret: remove ? { block: target.id, at: 'end' } : { select: target.id } };
    }
    if (!CONTAINER_TYPES.includes(target.type)) return unchanged(true);
    const junction = plainLength(target.html);
    tx.setBlock(target.id, { html: sanitizeInline(target.html + html) });
    [...tx.block(blockId).children].forEach(k => txMoveBlock(tx, k, target.id, tx.block(target.id).children.length));
    txDeleteBlock(tx, blockId);
    return { handled: true, changed: true, caret: { block: target.id, at: junction } };
  });
}

/** Delete with the caret at the end of a block: pulls the next editable block (same column only) into it. */
export function deleteAtEnd(blockId: string, html: string, nextId: string | null): KeyResult {
  return edit(tx => {
    const cur = tx.blocks[blockId];
    const next = nextId ? tx.blocks[nextId] : undefined;
    if (!cur || !next || next.id === blockId || !CONTAINER_TYPES.includes(next.type)) return unchanged(false);
    if (!sameScope(tx, next.id, blockId) || isBlockWithin(tx, blockId, next.id)) return unchanged(false);
    const junction = plainLength(html);
    tx.setBlock(blockId, { html: sanitizeInline(html + next.html) });
    [...next.children].forEach(k => txMoveBlock(tx, k, blockId, tx.block(blockId).children.length));
    txDeleteBlock(tx, next.id);
    return { handled: true, changed: true, caret: { block: blockId, at: junction } };
  });
}

/** Puts the caret where a keyboard edit says. */
export function applyCaret(c: CaretAfter) {
  if (!c) return;
  if ('select' in c) selectBlocks([c.select]);
  else if ('title' in c) focusTitle(c.title, c.at);
  else focusBlock(c.block, c.at);
}

/* ------------------------------------------------------------------ */
/* Enter                                                               */
/* ------------------------------------------------------------------ */

export function handleEnter(el: HTMLElement, blockId: string) {
  if (!getDoc().blocks[blockId]) return;
  const [rawBefore, rawAfter] = splitAtSelection(el);
  applyCaret(enterAt(blockId, sanitizeInline(rawBefore), sanitizeInline(rawAfter)).caret);
}

/* ------------------------------------------------------------------ */
/* Backspace at start / Delete at end                                  */
/* ------------------------------------------------------------------ */

/** The page title or block editable that precedes or follows `el` in document order. */
function editableNeighbor(el: HTMLElement, dir: -1 | 1): PrevEditable {
  const n = neighbor(el, dir);
  if (!n) return null;
  if (n.dataset.title !== undefined) return { title: n.dataset.title };
  return n.dataset.editableId ? { block: n.dataset.editableId } : null;
}

/** Returns true when handled. */
export function handleBackspaceAtStart(el: HTMLElement, blockId: string): boolean {
  const r = backspaceAtStart(blockId, sanitizeInline(el.innerHTML), editableNeighbor(el, -1));
  applyCaret(r.caret);
  return r.handled;
}

export function handleDeleteAtEnd(el: HTMLElement, blockId: string): boolean {
  const next = editableNeighbor(el, 1);
  const r = deleteAtEnd(blockId, sanitizeInline(el.innerHTML), next && 'block' in next ? next.block : null);
  applyCaret(r.caret);
  return r.handled;
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
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
/** The space that completes a block shortcut: a normal, non breaking or full width (CJK) space. */
const isShortcutSpace = (s: string | null | undefined) => s === ' ' || s === NBSP || s === IDEOGRAPHIC_SPACE;
/**
 * CJK input methods type full width forms (＃ ＞ － ＊ ［］ and full width digits). NFKC maps each
 * of them to its ASCII shortcut character, one character for one.
 */
export const asciiShortcut = (s: string) => s.normalize('NFKC');
/** Characters that open the slash menu: ASCII and full width (U+FF0F). */
export const SLASH_CHARS = ['/', String.fromCharCode(0xff0f)];

const BLOCK_SHORTCUTS: [RegExp, BlockType, Record<string, any>?][] = [
  [/^#$/, 'h1'],
  [/^##$/, 'h2'],
  [/^###$/, 'h3'],
  [/^[-*+]$/, 'bulleted'],
  [/^\d+\.$/, 'numbered'],
  [/^(\[\]|\[ \])$/, 'todo', { checked: false }],
  [/^\[x\]$/i, 'todo', { checked: true }],
  [/^>$/, 'toggle', { open: false }],
  // The CJK corner bracket (U+300C) opens a quotation the way '"' does.
  [new RegExp('^["' + String.fromCharCode(0x300c) + ']$'), 'quote'],
];

/** Full width inline mark characters (U+FF0A, U+FF40, U+FF3F, U+FF5E) and their ASCII forms. */
const FULL_WIDTH_MARKS: Record<string, string> = {
  [String.fromCharCode(0xff0a)]: '*',
  [String.fromCharCode(0xff40)]: '`',
  [String.fromCharCode(0xff3f)]: '_',
  [String.fromCharCode(0xff5e)]: '~',
};

/** Called after input; returns true if the block was transformed. */
export function tryMarkdown(el: HTMLElement, blockId: string, data: string | null): boolean {
  const d = getDoc();
  const b = d.blocks[blockId];
  if (!b || b.type === 'code') return false;
  const before = textBeforeCaret(el);

  if (isShortcutSpace(data) && (b.type === 'text' || CONTINUE_TYPES.includes(b.type) || b.type === 'quote')) {
    const prefix = asciiShortcut(before.slice(0, -1));
    const last = before.slice(-1);
    if (isShortcutSpace(last)) {
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
  const text = asciiShortcut(el.textContent || '');
  const ch = data ? asciiShortcut(data) : data;
  if (ch === '`' && asciiShortcut(before) === '```' && text === '```') {
    transact(tx => {
      txTurnInto(tx, blockId, 'code');
      tx.setBlock(blockId, { html: '', language: 'plain text' });
    });
    breakCoalescing();
    focusBlock(blockId, 'start');
    return true;
  }
  if (ch === '-' && text === '---' && b.type === 'text') {
    let nid = '';
    transact(tx => {
      txTurnInto(tx, blockId, 'divider');
      nid = txInsertAfter(tx, blockId, { type: 'text', html: '' });
    });
    breakCoalescing();
    focusBlock(nid, 'start');
    return true;
  }
  // Full width marks typed with a CJK input method count as their ASCII forms. The mapping is one
  // character for one character, so offsets into the text stay valid.
  const mark = data && data.length === 1 ? FULL_WIDTH_MARKS[data] ?? data : data;
  const marks = Array.from(before, ch => FULL_WIDTH_MARKS[ch] ?? ch).join('');
  // Inline marks
  if (mark === '`') {
    const m = marks.match(/`([^`]+)`$/);
    if (m) return wrapInline(el, m[0].length, `<code>${escapeHtml(m[1])}</code>`);
  }
  if (mark === '*') {
    let m = marks.match(/\*\*([^*]+)\*\*$/);
    if (m) return wrapInline(el, m[0].length, `<b>${escapeHtml(m[1])}</b>`);
    m = marks.match(/(?:^|[^*])\*([^*\s][^*]*)\*$/);
    if (m) return wrapInline(el, m[1].length + 2, `<i>${escapeHtml(m[1])}</i>`);
  }
  if (mark === '_') {
    const m = marks.match(/(?:^|\s)_([^_\s][^_]*)_$/);
    if (m) return wrapInline(el, m[1].length + 2, `<i>${escapeHtml(m[1])}</i>`);
  }
  if (mark === '~') {
    const m = marks.match(/~([^~]+)~$/);
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

/**
 * Opens the slash menu when the inserted text contains a slash (ASCII or full width). `data` is
 * the inserted text: one typed character, or a whole IME composition such as '／'.
 */
export function maybeOpenSlash(el: HTMLElement, blockId: string, data: string | null) {
  if (!data) return;
  const i = Math.max(...SLASH_CHARS.map(c => data.lastIndexOf(c)));
  if (i < 0) return;
  const off = caretOffset(el);
  if (off === null) return;
  const rect = caretRect();
  if (!rect) return;
  slashState.set({ blockId, start: off - (data.length - i), rect });
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
