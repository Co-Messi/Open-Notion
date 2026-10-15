import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Block } from '../store/types';
import { transact, getDoc } from '../store/store';
import { sanitizeInline } from '../lib/html';
import { caretOffset, setCaret } from './caret';
import { handleInlineLinkClick } from './Editable';

/** A rectangular grid of cell strings, whatever shape the stored rows have (imported data may be malformed). */
export function normalizeRows(raw: unknown): string[][] {
  const rows = Array.isArray(raw) ? raw.map(r => (Array.isArray(r) ? r.map(c => (typeof c === 'string' ? c : '')) : [])) : [];
  const width = Math.max(1, ...rows.map(r => r.length));
  const out = rows.map(r => [...r, ...Array<string>(width - r.length).fill('')]);
  return out.length ? out : [Array<string>(width).fill('')];
}

/** Notion's "simple table" block: a grid of rich-text cells. */
export function TableBlock({ block, readOnly }: { block: Block; readOnly?: boolean }) {
  const rows = normalizeRows(block.rows);
  // Always build on the latest stored rows: a cell commit and a structural change can happen in the same event.
  const latest = () => normalizeRows(getDoc().blocks[block.id]?.rows);
  const set = (r: number, c: number, html: string) => {
    const next = latest();
    if (!next[r] || c >= next[r].length || next[r][c] === html) return;
    next[r][c] = html;
    transact(tx => tx.setBlock(block.id, { rows: next }), { key: 'cell:' + block.id + ':' + r + ':' + c });
  };
  const addRow = () => {
    const next = latest();
    transact(tx => tx.setBlock(block.id, { rows: [...next, next[0].map(() => '')] }));
  };
  const addCol = () => transact(tx => tx.setBlock(block.id, { rows: latest().map(r => [...r, '']) }));
  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>, r: number, c: number, width: number) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const tds = Array.from((e.currentTarget.closest('table') as HTMLTableElement).querySelectorAll('td'));
    const i = tds.indexOf(e.currentTarget);
    const next = tds[i + (e.shiftKey ? -1 : 1)];
    if (next) next.focus();
    else if (!e.shiftKey) {
      const cell = e.currentTarget;
      set(r, c, sanitizeInline(cell.innerHTML));
      addRow();
      requestAnimationFrame(() => {
        const all = (cell.closest('table') as HTMLTableElement | null)?.querySelectorAll('td');
        (all?.[all.length - width] as HTMLElement | undefined)?.focus();
      });
    }
  };
  return (
    <div className="simple-table-wrap" onMouseDown={e => e.stopPropagation()}>
      <table className="simple-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={block.headerRow && r === 0 ? 'header' : ''}>
              {row.map((cell, c) => (
                <Cell
                  key={c}
                  html={cell}
                  readOnly={readOnly}
                  onCommit={h => set(r, c, h)}
                  onKeyDown={e => onKeyDown(e, r, c, row.length)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div className="table-add">
          <button onClick={addRow}>+ Row</button>
          <button onClick={addCol}>+ Column</button>
          <button onClick={() => transact(tx => tx.setBlock(block.id, { headerRow: !block.headerRow }))}>
            {block.headerRow ? 'Remove header row' : 'Header row'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One editable cell. Like `Editable`, the DOM is the source of truth while typing: every input is
 * committed to the store (so a reload never loses it), and the store is written back into the DOM
 * only when it changes from outside (undo, import), so the caret never jumps.
 */
function Cell({
  html, readOnly, onCommit, onKeyDown,
}: { html: string; readOnly?: boolean; onCommit: (html: string) => void; onKeyDown: (e: KeyboardEvent<HTMLTableCellElement>) => void }) {
  const ref = useRef<HTMLTableCellElement>(null);
  const committed = useRef<string | null>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || composing.current || html === committed.current) return;
    // Cells are sanitized here too: imported or pasted rows must never become live markup.
    const safe = sanitizeInline(html);
    if (el.innerHTML !== safe) {
      const off = document.activeElement === el ? caretOffset(el) : null;
      el.innerHTML = safe;
      if (off !== null) setCaret(el, off);
    }
    committed.current = html;
  }, [html]);

  const commit = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    const h = sanitizeInline(el.innerHTML);
    committed.current = h;
    onCommit(h);
  };

  return (
    <td
      ref={ref}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onInput={e => {
        if (!(e.nativeEvent as InputEvent).isComposing) commit();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        commit();
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={e => handleInlineLinkClick(e, !readOnly)}
    />
  );
}
