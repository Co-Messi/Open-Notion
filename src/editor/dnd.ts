import { getDoc, getUi, transact, setUi, showToast } from '../store/store';
import { txMoveBlock, txMakeColumns, moveBlockProblem } from '../store/actions';
import { moveBlocksToPage } from './MoveBlocks';
import { htmlToText } from '../lib/html';
import { attrSel } from '../lib/dom';

type Drop = { el: HTMLElement; mode: 'before' | 'after' | 'inside' | 'left' | 'right'; blockId: string } | { el: HTMLElement; mode: 'page'; pageId: string };

/**
 * Pointer-driven block dragging from the ⋮⋮ handle.
 * A press without movement counts as a click and opens the block menu.
 */
export function startBlockDrag(e: React.PointerEvent, blockId: string, onClick: () => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  const sx = e.clientX;
  const sy = e.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;
  let drop: Drop | null = null;
  let ids: string[] = [];

  const clearMarks = () => {
    document.querySelectorAll('.drop-before, .drop-after, .drop-inside, .drop-left, .drop-right').forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-left', 'drop-right'));
    document.querySelectorAll('.sb-row.drop-into').forEach(n => n.classList.remove('drop-into'));
  };

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      dragging = true;
      const sel = getUi().selectedBlocks;
      ids = sel.includes(blockId) ? orderByDom(sel) : [blockId];
      setUi({ selectedBlocks: ids });
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      const d = getDoc();
      ghost.textContent = ids.map(id => htmlToText(d.blocks[id]?.html || '') || labelFor(id)).join('  ·  ').slice(0, 120);
      document.body.appendChild(ghost);
      document.body.style.cursor = 'grabbing';
    }
    if (ghost) {
      ghost.style.left = ev.clientX + 12 + 'px';
      ghost.style.top = ev.clientY + 8 + 'px';
    }
    clearMarks();
    drop = null;
    const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const sbRow = under?.closest('[data-sb-page]') as HTMLElement | null;
    if (sbRow) {
      sbRow.classList.add('drop-into');
      drop = { el: sbRow, mode: 'page', pageId: sbRow.dataset.sbPage! };
      return;
    }
    // Find the deepest block row under the pointer (ignore dragged blocks and their descendants).
    const blockEl = findBlockAt(ev.clientX, ev.clientY, ids);
    if (!blockEl) return;
    const tid = blockEl.dataset.blockId!;
    const row = blockEl.querySelector(':scope > .block-row') as HTMLElement;
    const r = (row || blockEl).getBoundingClientRect();
    const rel = (ev.clientY - r.top) / r.height;
    const b = getDoc().blocks[tid];
    const canNest = b && ['text', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'h1', 'h2', 'h3'].includes(b.type);
    const sideOk = b && b.type !== 'columns' && b.type !== 'column';
    if (sideOk && ev.clientX > r.right - 48 && ev.clientX < r.right + 40) {
      blockEl.classList.add('drop-right');
      drop = { el: blockEl, mode: 'right', blockId: tid };
    } else if (sideOk && ev.clientX < r.left + 12 && ev.clientX > r.left - 24) {
      blockEl.classList.add('drop-left');
      drop = { el: blockEl, mode: 'left', blockId: tid };
    } else if (rel < 0.5) {
      blockEl.classList.add('drop-before');
      drop = { el: blockEl, mode: 'before', blockId: tid };
    } else if (canNest && ev.clientX > r.left + 60 && b.type === 'toggle') {
      blockEl.classList.add('drop-inside');
      drop = { el: blockEl, mode: 'inside', blockId: tid };
    } else {
      blockEl.classList.add('drop-after');
      drop = { el: blockEl, mode: 'after', blockId: tid };
    }
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.style.cursor = '';
    ghost?.remove();
    clearMarks();
    if (!dragging) {
      onClick();
      return;
    }
    if (!drop) return;
    if (drop.mode === 'page') {
      moveBlocksToPage(ids, drop.pageId);
      return;
    }
    applyBlockDrop(ids, drop.blockId, drop.mode);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/**
 * Drops dragged blocks next to (before or after), inside (a toggle) or beside (columns) a target
 * block. Each block is placed after the one placed before it, re-reading the target's parent every
 * time: moving the last block out of a column can unwrap the column list mid drop.
 */
export function applyBlockDrop(ids: string[], targetId: string, mode: 'before' | 'after' | 'inside' | 'left' | 'right') {
  const d = getDoc();
  if (!d.blocks[targetId]) return;
  const problems = ids.map(id => moveBlockProblem(d, id, mode === 'inside' ? targetId : d.blocks[targetId].parent));
  if (problems.every(Boolean)) {
    const why = problems.find(p => p && p !== 'missing');
    if (why) showToast(why);
    return;
  }
  transact(tx => {
    if (mode === 'left' || mode === 'right') {
      txMakeColumns(tx, targetId, ids.filter(id => id !== targetId), mode);
      return;
    }
    if (mode === 'inside') {
      let moved = 0;
      for (const id of ids) if (txMoveBlock(tx, id, targetId, tx.block(targetId).children.length)) moved++;
      if (moved) tx.setBlock(targetId, { open: true });
      return;
    }
    let anchor = targetId;
    let after = mode === 'after';
    for (const id of ids) {
      const a = tx.block(anchor);
      if (!a || id === anchor) continue;
      const index = tx.siblings(anchor).indexOf(anchor) + (after ? 1 : 0);
      if (txMoveBlock(tx, id, a.parent, index)) {
        anchor = id;
        after = true;
      }
    }
  });
}

function labelFor(id: string) {
  const b = getDoc().blocks[id];
  if (!b) return '';
  if (b.pageId) return getDoc().pages[b.pageId]?.title || 'Untitled';
  return b.type;
}

function orderByDom(ids: string[]): string[] {
  const all = Array.from(document.querySelectorAll('.block[data-block-id]')).map(n => (n as HTMLElement).dataset.blockId!);
  return [...ids].sort((a, b) => all.indexOf(a) - all.indexOf(b));
}

function findBlockAt(x: number, y: number, exclude: string[]): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll('[data-editor-scope] .block[data-block-id]')) as HTMLElement[];
  let best: HTMLElement | null = null;
  for (const el of candidates) {
    if (exclude.some(id => el.dataset.blockId === id || el.closest(attrSel('data-block-id', id)))) continue;
    const row = el.querySelector(':scope > .block-row') as HTMLElement | null;
    const r = (row || el).getBoundingClientRect();
    // Expand horizontally so the gutter area also counts.
    if (y >= r.top - 2 && y <= r.bottom + 2 && x >= r.left - 80 && x <= r.right + 40) best = el;
  }
  return best;
}
