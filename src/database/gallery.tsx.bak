import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useDoc } from '../store/store';
import { openPage } from '../store/actions';
import type { Block, Page } from '../store/types';
import { PropValue } from './cells';
import { visibleProps, isEmptyValue, htmlText, coverBackground } from './logic';
import { addRowAt } from './dbActions';
import { TitleEditor, RowMenu, RowIcon, type ViewProps } from './shared';

function ContentPreview({ page, blocks }: { page: Page; blocks: Record<string, Block> }) {
  const lines: { id: string; text: string; type: string }[] = [];
  const walk = (ids: string[]) => {
    for (const id of ids) {
      if (lines.length >= 8) return;
      const b = blocks[id];
      if (!b) continue;
      const text = b.type === 'code' ? b.html : htmlText(b.html || '');
      if (text.trim()) lines.push({ id, text, type: b.type });
      if (b.children.length) walk(b.children);
    }
  };
  walk(page.content);
  return (
    <div className="db-gcard-content">
      {lines.map(l => (
        <div key={l.id} className={'db-gc-line t-' + l.type}>
          {l.type === 'bulleted' ? '• ' : l.type === 'todo' ? '☐ ' : ''}
          {l.text}
        </div>
      ))}
    </div>
  );
}

export function GalleryView({ dbId, view, rows, schema, defaults, editingTitle, setEditingTitle }: ViewProps) {
  const props = visibleProps(schema, view).filter(p => p.type !== 'title');
  const blocks = useDoc(d => d.blocks, Object.is);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; rect: DOMRect } | null>(null);
  const preview = view.cardPreview || 'none';
  return (
    <div className="db-gallery">
      {rows.map(row => (
        <div
          key={row.id}
          data-row-id={row.id}
          className="db-gcard"
          role="button"
          onClick={() => editingTitle !== row.id && openPage(row.id, { peek: true })}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            setRowMenu({ rowId: row.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
          }}
        >
          {preview === 'cover' && (
            <div className="db-gcard-preview" style={row.cover ? { background: coverBackground(row.cover) } : undefined} />
          )}
          {preview === 'content' && (
            <div className="db-gcard-preview content">
              <ContentPreview page={row} blocks={blocks} />
            </div>
          )}
          <div className="db-gcard-body">
            <div className="db-gcard-title">
              <RowIcon page={row} />
              {editingTitle === row.id ? (
                <TitleEditor rowId={row.id} onDone={() => setEditingTitle(null)} />
              ) : (
                <span className={row.title ? '' : 'db-untitled'}>{row.title || 'Untitled'}</span>
              )}
            </div>
            {props.map(p =>
              p.type !== 'checkbox' && isEmptyValue(row, p) ? null : (
                <div key={p.id} className={'db-card-prop t-' + p.type}>
                  <PropValue row={row} prop={p} mode="card" />
                  {p.type === 'checkbox' && <span className="db-card-prop-name">{p.name}</span>}
                </div>
              ),
            )}
          </div>
        </div>
      ))}
      <div className="db-gcard db-gcard-new" role="button" onClick={() => setEditingTitle(addRowAt(dbId, { ...defaults }))}>
        <Plus size={16} /> New page
      </div>
      {rowMenu && <RowMenu rowId={rowMenu.rowId} rect={rowMenu.rect} onClose={() => setRowMenu(null)} />}
    </div>
  );
}
