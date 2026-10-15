import type { Block } from '../store/types';
import { transact, getDoc } from '../store/store';
import { sanitizeInline } from '../lib/html';

/** Notion's "simple table" block: a grid of rich-text cells. */
export function TableBlock({ block, readOnly }: { block: Block; readOnly?: boolean }) {
  const rows = block.rows || [['']];
  // Always build on the latest stored rows: a cell blur and a structural change can happen in the same event.
  const latest = () => (getDoc().blocks[block.id]?.rows || [['']]).map(r => [...r]);
  const set = (r: number, c: number, html: string) => {
    const next = latest();
    if (!next[r]) return;
    next[r][c] = html;
    transact(tx => tx.setBlock(block.id, { rows: next }), { key: 'cell:' + block.id + r + ':' + c });
  };
  const addRow = () => {
    const next = latest();
    transact(tx => tx.setBlock(block.id, { rows: [...next, next[0].map(() => '')] }));
  };
  const addCol = () => transact(tx => tx.setBlock(block.id, { rows: latest().map(r => [...r, '']) }));
  return (
    <div className="simple-table-wrap" onMouseDown={e => e.stopPropagation()}>
      <table className="simple-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={block.headerRow && r === 0 ? 'header' : ''}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  contentEditable={!readOnly}
                  suppressContentEditableWarning
                  dangerouslySetInnerHTML={{ __html: cell }}
                  onBlur={e => {
                    const h = sanitizeInline(e.currentTarget.innerHTML);
                    if (h !== cell) set(r, c, h);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const tds = Array.from((e.currentTarget.closest('table') as HTMLTableElement).querySelectorAll('td'));
                      const i = tds.indexOf(e.currentTarget as HTMLTableCellElement);
                      const next = tds[i + (e.shiftKey ? -1 : 1)];
                      if (next) next.focus();
                      else if (!e.shiftKey) {
                        const cell = e.currentTarget as HTMLElement;
                        const h = sanitizeInline(cell.innerHTML);
                        set(r, c, h);
                        addRow();
                        requestAnimationFrame(() => {
                          const all = (cell.closest('table') as HTMLTableElement | null)?.querySelectorAll('td');
                          (all?.[all.length - row.length] as HTMLElement | undefined)?.focus();
                        });
                      }
                    }
                  }}
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
