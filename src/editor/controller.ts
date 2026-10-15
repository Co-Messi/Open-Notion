import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { setCaret, placeAtX, caretOffset } from './caret';
import { getUi, setUi, setFocusProvider, setRestoreFocus, type FocusHint } from '../store/store';

/* ------------------------------------------------------------------ */
/* Tiny observable used for editor overlays                            */
/* ------------------------------------------------------------------ */

export function observable<T>(initial: T) {
  let value = initial;
  const ls = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      ls.forEach(l => l());
    },
    use: (): T => {
      const [, force] = useState(0);
      useEffect(() => {
        const l = () => force(x => x + 1);
        ls.add(l);
        return () => {
          ls.delete(l);
        };
      }, []);
      return value;
    },
  };
}

export interface SlashState {
  blockId: string;
  /** Text offset of the "/" character. */
  start: number;
  rect: DOMRect;
}
export const slashState = observable<SlashState | null>(null);

export interface MentionState {
  blockId: string;
  start: number;
  rect: DOMRect;
}
export const mentionState = observable<MentionState | null>(null);

/* ------------------------------------------------------------------ */
/* Focus                                                               */
/* ------------------------------------------------------------------ */

export type FocusPos = 'start' | 'end' | number | { x: number; line: 'first' | 'last' } | { start: number; end: number };

export function editableFor(blockId: string): HTMLElement | null {
  return document.querySelector(`[data-editable-id="${blockId}"]`) as HTMLElement | null;
}

/** Focus a block's editable once it is in the DOM. */
export function focusBlock(blockId: string, pos: FocusPos = 'end') {
  let tries = 0;
  const attempt = () => {
    const el = editableFor(blockId);
    if (!el) {
      if (tries++ < 10) requestAnimationFrame(attempt);
      return;
    }
    if (el instanceof HTMLTextAreaElement) {
      el.focus();
      const len = el.value.length;
      const o = pos === 'start' ? 0 : typeof pos === 'number' ? pos : len;
      el.setSelectionRange(o, o);
      return;
    }
    el.focus({ preventScroll: true });
    if (typeof pos === 'object' && 'x' in pos) placeAtX(el, pos.x, pos.line);
    else if (typeof pos === 'object' && 'start' in pos) setCaret(el, pos.start, pos.end);
    else setCaret(el, pos);
    scrollIntoViewIfNeeded(el);
  };
  // Flush pending React work so the target exists now; typing that follows immediately must land in it.
  try {
    flushSync(() => {});
  } catch {
    /* called during render; fall back to the next frame */
  }
  if (editableFor(blockId)) attempt();
  else requestAnimationFrame(attempt);
}

export function scrollIntoViewIfNeeded(el: HTMLElement) {
  const frame = el.closest('.frame, .peek-scroll') as HTMLElement | null;
  if (!frame) return;
  const r = el.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  if (r.bottom > f.bottom - 40) frame.scrollTop += r.bottom - f.bottom + 80;
  else if (r.top < f.top + 20) frame.scrollTop -= f.top - r.top + 80;
}

/** All editable elements of the page currently containing `el`, in document order. */
export function editablesInScope(el: Element): HTMLElement[] {
  const scope = el.closest('[data-editor-scope]') || document;
  return Array.from(scope.querySelectorAll('[data-nav]')) as HTMLElement[];
}

export function neighbor(el: HTMLElement, dir: -1 | 1): HTMLElement | null {
  const list = editablesInScope(el);
  const i = list.indexOf(el);
  return list[i + dir] || null;
}

/** Ordered block ids in the scope (visible blocks only). */
export function visibleBlockIds(scope: Element | Document = document): string[] {
  return Array.from(scope.querySelectorAll('.block[data-block-id]')).map(e => (e as HTMLElement).dataset.blockId!);
}

/* ------------------------------------------------------------------ */
/* History focus hooks                                                 */
/* ------------------------------------------------------------------ */

setFocusProvider((): FocusHint | null => {
  const el = document.activeElement as HTMLElement | null;
  const id = el?.dataset?.editableId;
  if (!id || !el) return null;
  if (el instanceof HTMLTextAreaElement) return { blockId: id, offset: el.selectionStart };
  return { blockId: id, offset: caretOffset(el) ?? undefined };
});

setRestoreFocus(f => {
  if (!f) return;
  focusBlock(f.blockId, f.offset ?? 'end');
});

/* ------------------------------------------------------------------ */
/* Block selection                                                     */
/* ------------------------------------------------------------------ */

export function selectBlocks(ids: string[]) {
  if (ids.length) {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.isContentEditable || ae instanceof HTMLTextAreaElement)) ae.blur();
    window.getSelection()?.removeAllRanges();
  }
  setUi({ selectedBlocks: ids });
}

export function clearBlockSelection() {
  if (getUi().selectedBlocks.length) setUi({ selectedBlocks: [] });
}
