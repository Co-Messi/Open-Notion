import { useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { PanelRight, Maximize2, Copy, Trash2 } from 'lucide-react';
import { getDoc, breakCoalescing } from '../store/store';
import { setRowProp, openPage, duplicatePage, trashPage } from '../store/actions';
import type { DbView, Page, Property } from '../store/types';
import { Popover, Menu } from '../components/ui';
import { StoredImg } from '../components/StoredImage';
import { isImageIcon } from '../lib/url';

export interface ViewProps {
  dbId: string;
  db: Page;
  view: DbView;
  /** Rows after search, filters and sorts. */
  rows: Page[];
  schema: Property[];
  inline: boolean;
  /** Prefill values so a new row matches the active filters. */
  defaults: Record<string, any>;
  startFilter: (propId: string) => void;
  /** Row whose title should start in edit mode (e.g. just created). */
  editingTitle: string | null;
  setEditingTitle: (id: string | null) => void;
}

/** Inline contentEditable title editor. Enter/blur commit, Escape cancels. */
export function TitleEditor({ rowId, className = '', onDone, placeholder = 'Untitled' }: { rowId: string; className?: string; onDone: () => void; placeholder?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const original = useRef(getDoc().pages[rowId]?.title || '');
  const finished = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = original.current;
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }, []);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const el = ref.current;
    const text = (el?.textContent || '').replace(/\n/g, ' ');
    if (save && text !== original.current) {
      setRowProp(rowId, 'title', text);
      breakCoalescing();
    }
    doneRef.current();
  };

  // Commit when unmounted without blur (e.g. view switch); never re-closes.
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (finished.current) return;
      const text = (el?.textContent || '').replace(/\n/g, ' ');
      if (text !== original.current) setRowProp(rowId, 'title', text);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      ref={ref}
      className={'db-title-edit ' + className}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onBlur={() => finish(true)}
      onPaste={e => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n/g, ' '));
      }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (ref.current) ref.current.textContent = original.current;
          finish(false);
        }
      }}
    />
  );
}

/** Right-click menu for a row. */
export function RowMenu({ rowId, rect, onClose }: { rowId: string; rect: DOMRect; onClose: () => void }) {
  return (
    <Popover anchor={rect} onClose={onClose} width={240}>
      <Menu
        onClose={onClose}
        items={[
          { id: 'peek', label: 'Open in side peek', icon: <PanelRight size={16} />, onSelect: () => openPage(rowId, { peek: true }) },
          { id: 'full', label: 'Open as full page', icon: <Maximize2 size={16} />, onSelect: () => openPage(rowId) },
          { id: 'dup', label: 'Duplicate', icon: <Copy size={16} />, separatorBefore: true, onSelect: () => duplicatePage(rowId) },
          { id: 'del', label: 'Delete', icon: <Trash2 size={16} />, danger: true, onSelect: () => trashPage(rowId) },
        ]}
      />
    </Popover>
  );
}

export function RowIcon({ page }: { page: Page }) {
  if (!page.icon) return null;
  return <span className="db-row-icon">{isImageIcon(page.icon) ? <StoredImg src={page.icon} /> : page.icon}</span>;
}

/** Shared pointer-drag helper: calls onStart after a small threshold, then onMove/onEnd. */
export function startPointerDrag(
  e: RPointerEvent,
  h: { onStart: (ev: PointerEvent) => void; onMove: (ev: PointerEvent) => void; onEnd: (ev: PointerEvent) => void; onClick?: () => void },
) {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
      started = true;
      document.body.classList.add('db-dragging');
      h.onStart(ev);
    }
    h.onMove(ev);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('db-dragging');
    if (started) h.onEnd(ev);
    else h.onClick?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
