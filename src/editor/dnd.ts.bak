import { getDoc, getUi, transact, setUi } from '../store/store';
import { txMoveBlock, txMakeColumns } from '../store/actions';
import { moveBlocksToPage } from './MoveBlocks';
import { htmlToText } from '../lib/html';

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
    const target = drop;
    transact(tx => {
      const t = tx.block(target.blockId);
      if (!t) return;
      if (target.mode === 'left' || target.mode === 'right') {
        txMakeColumns(tx, target.blockId, ids.filter(id => id !== target.blockId), target.mode);
        return;
      }
      if (target.mode === 'inside') {
        ids.forEach(id => txMoveBlock(tx, id, target.blockId, tx.block(target.blockId).children.length));
        tx.setBlock(target.blockId, { open: true });
        return;
      }
      let index = tx.siblings(target.blockId).indexOf(target.blockId) + (target.mode === 'after' ? 1 : 0);
      const parent = t.parent;
      for (const id of ids) {
        const before = tx.childList(parent).indexOf(id);
        txMoveBlock(tx, id, parent, index);
        const after = tx.childList(parent).indexOf(id);
        index = after + 1;
        void before;
      }
    });
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
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
    if (exclude.some(id => el.dataset.blockId === id || el.closest(`[data-block-id="${id}"]`))) continue;
    const row = el.querySelector(':scope > .block-row') as HTMLElement | null;
    const r = (row || el).getBoundingClientRect();
    // Expand horizontally so the gutter area also counts.
    if (y >= r.top - 2 && y <= r.bottom + 2 && x >= r.left - 80 && x <= r.right + 40) best = el;
  }
  return best;
}
