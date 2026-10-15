import { useState } from 'react';
import { Undo2, Trash2, CircleHelp } from 'lucide-react';
import { useUi, setUi, useDoc } from '../store/store';
import { restorePage, deletePageForever, openPage, pageTitle, pagePath } from '../store/actions';
import { Popover, Tooltip, SearchIcon, pressable } from './ui';
import { PageIconView } from './PageIcon';

export function TrashPopover() {
  const open = useUi(u => u.trashOpen);
  if (!open) return null;
  return <TrashInner />;
}

function TrashInner() {
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const trashed = useDoc(d =>
    Object.values(d.pages)
      .filter(p => p.trashed)
      .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0))
      .map(p => p.id),
  );
  const pages = useDoc(d => d.pages, Object.is);
  const anchor = (document.querySelector('[data-trash-anchor]') as HTMLElement | null)?.getBoundingClientRect() || new DOMRect(240, 400, 0, 0);
  const close = () => setUi({ trashOpen: false });
  const shown = trashed.filter(id => pageTitle(pages[id]).toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover anchor={anchor} onClose={close} placement="right-start" className="trash-pop">
      <div className="menu-search icon" style={{ paddingTop: 10 }}>
        <SearchIcon size={14} />
        <input autoFocus placeholder="Search pages in Trash" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="trash-list">
        {shown.length === 0 && (
          <div className="empty-view" style={{ height: 'auto', padding: '48px 20px' }}>
            <Trash2 size={28} color="var(--icon-tertiary)" />
            <div>{q ? 'No matches' : 'No pages in Trash'}</div>
          </div>
        )}
        {shown.map(id => {
          const p = pages[id];
          const path = pagePath(id)
            .slice(0, -1)
            .map(x => pageTitle(x))
            .join(' / ');
          return (
            <div {...pressable()}
              key={id}
              className="trash-item"
              onClick={() => {
                close();
                openPage(id);
              }}
            >
              <PageIconView page={p} size={18} />
              <div className="grow">
                <div className="t">{pageTitle(p)}</div>
                {path && <div className="p">{path}</div>}
              </div>
              <Tooltip label="Restore">
                <div {...pressable()}
                  className="icon-btn"
                  onClick={e => {
                    e.stopPropagation();
                    restorePage(id);
                  }}
                >
                  <Undo2 size={15} />
                </div>
              </Tooltip>
              {confirm === id ? (
                <span style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button className="btn danger sm" style={{ height: 24, padding: '0 8px', fontSize: 12 }} onClick={() => { deletePageForever(id); setConfirm(null); }}>
                    Delete
                  </button>
                  <button className="btn secondary sm" style={{ height: 24, padding: '0 8px', fontSize: 12 }} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <Tooltip label="Delete from Trash">
                  <div {...pressable()}
                    className="icon-btn"
                    onClick={e => {
                      e.stopPropagation();
                      setConfirm(id);
                    }}
                  >
                    <Trash2 size={15} />
                  </div>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
      <div className="menu-footer" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Pages in Trash stay here until you delete them.
        <span style={{ flex: 1 }} />
        <CircleHelp size={14} />
      </div>
    </Popover>
  );
}
