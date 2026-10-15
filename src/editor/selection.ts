import { getUi, setUi, getDoc, transact, undo, redo, breakCoalescing } from '../store/store';
import { deleteBlocks, duplicateBlocks, turnInto, txInsertAfter } from '../store/actions';
import { focusBlock, selectBlocks, clearBlockSelection } from './controller';
import { indentBlocks, NON_EDITABLE } from './ops';
import { CLIPBOARD_MIME, copyBlocks, cutBlocks, decodeClipboard, insertSerialized } from './clipboard';
import type { BlockType } from '../store/types';
import { attrSel } from '../lib/dom';

function scopeOf(id: string): Element | null {
  return document.querySelector('.block' + attrSel('data-block-id', id))?.closest('[data-editor-scope]') || null;
}

function visible(scope: Element | null): string[] {
  if (!scope) return [];
  return Array.from(scope.querySelectorAll('.block[data-block-id]')).map(n => (n as HTMLElement).dataset.blockId!);
}

/** Selected ids without descendants of other selected ids, in document order. */
export function topLevelSelection(): string[] {
  const sel = getUi().selectedBlocks;
  if (!sel.length) return [];
  const scope = scopeOf(sel[0]);
  const order = visible(scope);
  const set = new Set(sel);
  const d = getDoc();
  const isDesc = (id: string) => {
    let p = d.blocks[id]?.parent;
    let g = 0;
    while (p && d.blocks[p] && g++ < 500) {
      if (set.has(p)) return true;
      p = d.blocks[p].parent;
    }
    return false;
  };
  return order.filter(id => set.has(id) && !isDesc(id));
}

let anchorId: string | null = null;

let installed = false;
export function installSelectionKeys() {
  if (installed) return;
  installed = true;
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const sel = getUi().selectedBlocks;
    if (!sel.length) return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    // A popover playing its exit animation is already closed.
    if (document.querySelector('.popover:not(.is-exiting)')) return;
    const mod = e.metaKey || e.ctrlKey;
    const top = topLevelSelection();
    const scope = scopeOf(sel[0]);
    const order = visible(scope);

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const firstIdx = order.indexOf(top[0]);
      const prev = order.slice(0, firstIdx).reverse().find(id => !top.includes(id));
      deleteBlocks(top);
      clearBlockSelection();
      if (prev) {
        const b = getDoc().blocks[prev];
        if (b && !NON_EDITABLE.includes(b.type)) focusBlock(prev, 'end');
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      clearBlockSelection();
      return;
    }
    if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      const last = top[top.length - 1];
      const b = getDoc().blocks[last];
      if (b && !NON_EDITABLE.includes(b.type)) {
        clearBlockSelection();
        focusBlock(last, 'end');
      } else if (b) {
        let nid = '';
        transact(tx => {
          nid = txInsertAfter(tx, last, { type: 'text', html: '' });
        });
        clearBlockSelection();
        focusBlock(nid, 'start');
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (mod && e.shiftKey) {
        // Move blocks
        transact(tx => {
          const first = top[0];
          const b = tx.block(first);
          const list = tx.siblings(first);
          const idx = list.indexOf(first);
          const lastIdx = list.indexOf(top[top.length - 1]);
          if (e.key === 'ArrowUp' && idx > 0) {
            const prev = list[idx - 1];
            const l = list.filter(x => x !== prev);
            l.splice(lastIdx, 0, prev);
            tx.setSiblings(b.parent, l);
          } else if (e.key === 'ArrowDown' && lastIdx >= 0 && lastIdx < list.length - 1) {
            const next = list[lastIdx + 1];
            const l = list.filter(x => x !== next);
            l.splice(idx, 0, next);
            tx.setSiblings(b.parent, l);
          }
        });
        return;
      }
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey) {
        if (!anchorId || !sel.includes(anchorId)) anchorId = sel[0];
        const edgeIdx = dir < 0 ? Math.min(...sel.map(s => order.indexOf(s))) : Math.max(...sel.map(s => order.indexOf(s)));
        const next = order[edgeIdx + dir];
        if (next) {
          const a = order.indexOf(anchorId);
          const z = order.indexOf(next);
          selectBlocks(order.slice(Math.min(a, z), Math.max(a, z) + 1));
        }
      } else {
        const idx = dir < 0 ? order.indexOf(top[0]) : order.indexOf(top[top.length - 1]);
        const next = order[idx + dir];
        if (next) selectBlocks([next]);
        anchorId = next || null;
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      indentBlocks(top, e.shiftKey);
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'a') {
      e.preventDefault();
      selectBlocks(order);
    } else if (k === 'd') {
      e.preventDefault();
      selectBlocks(duplicateBlocks(top));
    } else if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (e.altKey && /^Digit[0-8]$/.test(e.code)) {
      e.preventDefault();
      const map: BlockType[] = ['text', 'h1', 'h2', 'h3', 'todo', 'bulleted', 'numbered', 'toggle', 'code'];
      turnInto(top, map[Number(e.code.slice(5))]);
      breakCoalescing();
    }
  };
  const onCopy = (e: ClipboardEvent) => {
    const sel = getUi().selectedBlocks;
    const ae = document.activeElement as HTMLElement | null;
    if (!sel.length || (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'))) return;
    copyBlocks(topLevelSelection(), e);
  };
  const onCut = (e: ClipboardEvent) => {
    const sel = getUi().selectedBlocks;
    const ae = document.activeElement as HTMLElement | null;
    if (!sel.length || (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'))) return;
    cutBlocks(topLevelSelection(), e);
    clearBlockSelection();
  };
  const onPaste = (e: ClipboardEvent) => {
    const sel = getUi().selectedBlocks;
    const ae = document.activeElement as HTMLElement | null;
    if (!sel.length || (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'))) return;
    // Without this install's nonce the payload is plain text, which this mode ignores.
    const data = decodeClipboard(e.clipboardData?.getData(CLIPBOARD_MIME));
    if (!data) return;
    e.preventDefault();
    const top = topLevelSelection();
    const created = insertSerialized(data, { afterId: top[top.length - 1] });
    selectBlocks(created);
  };
  window.addEventListener('keydown', onKey);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  // Any click outside a selected block clears the selection.
  window.addEventListener('mousedown', e => {
    const t = e.target as HTMLElement;
    if (!getUi().selectedBlocks.length) return;
    if (t.closest('.popover, .popover-layer, .block-gutter, .inline-toolbar')) return;
    const blk = t.closest('.block.selected');
    if (!blk) clearBlockSelection();
  });
}

/* ------------------------------------------------------------------ */
/* Rubber band + drag-select across blocks                             */
/* ------------------------------------------------------------------ */

export function startRubberBand(e: React.MouseEvent, scope: HTMLElement, onClick?: (ev: MouseEvent) => void) {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let band: HTMLDivElement | null = null;
  const blocks = Array.from(scope.querySelectorAll('.block[data-block-id]')) as HTMLElement[];
  const additive = e.shiftKey ? [...getUi().selectedBlocks] : [];
  const move = (ev: MouseEvent) => {
    if (!band) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      band = document.createElement('div');
      band.className = 'rubber-band';
      document.body.appendChild(band);
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.getSelection()?.removeAllRanges();
    }
    const l = Math.min(sx, ev.clientX);
    const t = Math.min(sy, ev.clientY);
    const w = Math.abs(ev.clientX - sx);
    const h = Math.abs(ev.clientY - sy);
    Object.assign(band.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
    const hit: string[] = [];
    for (const b of blocks) {
      const row = (b.querySelector(':scope > .block-row') as HTMLElement) || b;
      const r = row.getBoundingClientRect();
      if (r.bottom > t && r.top < t + h && r.right > l && r.left < l + w) hit.push(b.dataset.blockId!);
    }
    setUi({ selectedBlocks: Array.from(new Set([...additive, ...hit])) });
  };
  const up = (ev: MouseEvent) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (band) {
      band.remove();
      return;
    }
    onClick?.(ev);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/** While dragging a text selection out of its block, switch to block selection (Notion behaviour). */
export function watchCrossBlockDrag(e: React.MouseEvent) {
  const t = e.target as HTMLElement;
  const editable = t.closest('.editable') as HTMLElement | null;
  if (!editable || e.button !== 0) return;
  const originBlock = editable.closest('.block[data-block-id]') as HTMLElement | null;
  const scope = editable.closest('[data-editor-scope]');
  if (!originBlock || !scope) return;
  const originId = originBlock.dataset.blockId!;
  let active = false;
  const move = (ev: MouseEvent) => {
    const row = originBlock.querySelector(':scope > .block-row') as HTMLElement;
    const r = row.getBoundingClientRect();
    const outside = ev.clientY < r.top - 4 || ev.clientY > r.bottom + 4;
    if (!active && !outside) return;
    const order = visible(scope);
    const under = document.elementFromPoint(Math.max(r.left + 4, Math.min(ev.clientX, r.right - 4)), ev.clientY)?.closest('.block[data-block-id]') as HTMLElement | null;
    if (!under) return;
    const uid = under.dataset.blockId!;
    if (!active) {
      if (uid === originId) return;
      active = true;
      editable.blur();
    }
    window.getSelection()?.removeAllRanges();
    const a = order.indexOf(originId);
    const z = order.indexOf(uid);
    if (a < 0 || z < 0) return;
    setUi({ selectedBlocks: order.slice(Math.min(a, z), Math.max(a, z) + 1) });
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
