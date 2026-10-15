import { useState } from 'react';
import { Plus, FileText } from 'lucide-react';
import { openPage } from '../store/actions';
import { PropValue } from './cells';
import { visibleProps, isEmptyValue } from './logic';
import { addRowAt } from './dbActions';
import { TitleEditor, RowMenu, RowIcon, type ViewProps } from './shared';

export function ListView({ dbId, view, rows, schema, defaults, editingTitle, setEditingTitle }: ViewProps) {
  const props = visibleProps(schema, view).filter(p => p.type !== 'title');
  const [rowMenu, setRowMenu] = useState<{ rowId: string; rect: DOMRect } | null>(null);
  return (
    <div className="db-list">
      {rows.map(row => (
        <div
          key={row.id}
          data-row-id={row.id}
          className="db-list-row"
          role="button"
          onClick={() => editingTitle !== row.id && openPage(row.id, { peek: true })}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            setRowMenu({ rowId: row.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
          }}
        >
          <div className="db-list-main">
            {row.icon ? <RowIcon page={row} /> : <span className="db-row-icon db-default-icon"><FileText size={16} /></span>}
            {editingTitle === row.id ? (
              <TitleEditor rowId={row.id} onDone={() => setEditingTitle(null)} />
            ) : (
              <span className={'db-list-title' + (row.title ? '' : ' db-untitled')}>{row.title || 'Untitled'}</span>
            )}
          </div>
          <div className="db-list-props">
            {props.map(p =>
              p.type !== 'checkbox' && isEmptyValue(row, p) ? null : (
                <span key={p.id} className={'db-list-prop t-' + p.type}>
                  <PropValue row={row} prop={p} mode="list" />
                </span>
              ),
            )}
          </div>
        </div>
      ))}
      <div className="db-new-row list" role="button" onClick={() => setEditingTitle(addRowAt(dbId, { ...defaults }))}>
        <Plus size={16} /> New page
      </div>
      {rowMenu && <RowMenu rowId={rowMenu.rowId} rect={rowMenu.rect} onClose={() => setRowMenu(null)} />}
    </div>
  );
}
