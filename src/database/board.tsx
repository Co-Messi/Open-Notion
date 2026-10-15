import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Ellipsis } from 'lucide-react';
import { openPage, updateView } from '../store/actions';
import type { Page, SelectOption } from '../store/types';
import { Popover, Menu } from '../components/ui';
import { OptionPill, PropValue, PropIcon, OptionMenu } from './cells';
import { visibleProps, isEmptyValue, rawValue, columnTint } from './logic';
import { moveRowToGroup, addRowAt } from './dbActions';
import { TitleEditor, RowMenu, RowIcon, startPointerDrag, type ViewProps } from './shared';

const NONE = '__none';

interface Group {
  id: string;
  opt?: SelectOption;
  rows: Page[];
}

interface DragState {
  rowId: string;
  from: string;
  to: string;
  index: number;
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
  h: number;
}

export function BoardView(vp: ViewProps) {
  const { dbId, view, rows, schema, defaults, editingTitle, setEditingTitle } = vp;
  const groupProp = schema.find(p => p.id === view.groupBy && (p.type === 'status' || p.type === 'select' || p.type === 'multi_select'));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; rect: DOMRect } | null>(null);
  const [optMenu, setOptMenu] = useState<{ optId: string; rect: DOMRect } | null>(null);
  const [groupPick, setGroupPick] = useState<DOMRect | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  if (!groupProp) {
    const groupable = schema.filter(p => p.type === 'status' || p.type === 'select' || p.type === 'multi_select');
    return (
      <div className="db-empty-state">
        <div>Board views are grouped by a select or status property.</div>
        <span className="db-fchip add" role="button" onClick={e => setGroupPick(e.currentTarget.getBoundingClientRect())}>
          Group by…
        </span>
        {groupPick && (
          <Popover anchor={groupPick} onClose={() => setGroupPick(null)} width={240}>
            <Menu
              onClose={() => setGroupPick(null)}
              items={
                groupable.length
                  ? groupable.map(p => ({ id: p.id, label: p.name, icon: <PropIcon type={p.type} size={16} />, onSelect: () => updateView(dbId, view.id, { groupBy: p.id }) }))
                  : [{ id: 'none', label: 'Add a select or status property first', disabled: true }]
              }
            />
          </Popover>
        )}
      </div>
    );
  }

  const status = groupProp.type === 'status';
  const cardProps = visibleProps(schema, view).filter(p => p.type !== 'title');
  const inGroup = (r: Page, gid: string) => {
    const v = rawValue(r, groupProp);
    if (gid === NONE) return isEmptyValue(r, groupProp);
    return Array.isArray(v) ? v.includes(gid) : v === gid;
  };
  const groups: Group[] = (groupProp.options || []).map(o => ({ id: o.id, opt: o, rows: rows.filter(r => inGroup(r, o.id)) }));
  const none: Group = { id: NONE, rows: rows.filter(r => inGroup(r, NONE)) };
  if (none.rows.length || (drag && drag.from === NONE)) groups.unshift(none);

  const valueFor = (gid: string) => (gid === NONE ? undefined : gid);

  const newInGroup = (g: Group, top = false) => {
    const props = { ...defaults, [groupProp.id]: groupProp.type === 'multi_select' ? (g.id === NONE ? [] : [g.id]) : valueFor(g.id) };
    const id = addRowAt(dbId, props, top && g.rows[0] ? { before: g.rows[0].id } : g.rows.length ? { after: g.rows[g.rows.length - 1].id } : {});
    setEditingTitle(id);
  };

  const locate = (x: number, y: number, rowId: string): { to: string; index: number } | null => {
    const cols = Array.from(boardRef.current?.querySelectorAll('.db-board-col') || []) as HTMLElement[];
    let col = cols.find(c => {
      const r = c.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    if (!col && cols.length) {
      // Snap to the nearest column horizontally.
      col = cols.reduce((best, c) => {
        const r = c.getBoundingClientRect();
        const d = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
        const br = best.getBoundingClientRect();
        return d < Math.min(Math.abs(x - br.left), Math.abs(x - br.right)) ? c : best;
      });
    }
    if (!col) return null;
    const cards = (Array.from(col.querySelectorAll('.db-card[data-row-id]')) as HTMLElement[]).filter(c => c.dataset.rowId !== rowId);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    return { to: col.dataset.gid!, index };
  };

  const onCardDown = (e: RPointerEvent, row: Page, gid: string) => {
    if ((e.target as HTMLElement).closest('.db-title-edit, [role=checkbox], a')) return;
    const card = e.currentTarget as HTMLElement;
    startPointerDrag(e, {
      onStart: ev => {
        const r = card.getBoundingClientRect();
        const loc = locate(ev.clientX, ev.clientY, row.id);
        setDrag({
          rowId: row.id, from: gid, to: loc?.to ?? gid, index: loc?.index ?? 0, x: ev.clientX, y: ev.clientY,
          offX: e.clientX - r.left, offY: e.clientY - r.top, w: r.width, h: r.height,
        });
      },
      onMove: ev => {
        const loc = locate(ev.clientX, ev.clientY, row.id);
        setDrag(d => (d ? { ...d, x: ev.clientX, y: ev.clientY, ...(loc || {}) } : d));
      },
      onEnd: ev => {
        const loc = locate(ev.clientX, ev.clientY, row.id);
        setDrag(null);
        if (!loc) return;
        const target = groups.find(g => g.id === loc.to);
        const list = (target?.rows || []).filter(r => r.id !== row.id);
        const pos = loc.index < list.length ? { before: list[loc.index].id } : list.length ? { after: list[list.length - 1].id } : {};
        moveRowToGroup(dbId, row.id, groupProp.id, valueFor(loc.to), pos);
      },
      onClick: () => openPage(row.id, { peek: true }),
    });
  };

  const dragRow = drag ? rows.find(r => r.id === drag.rowId) : null;
  const om = optMenu ? (groupProp.options || []).find(o => o.id === optMenu.optId) : null;

  const renderCard = (row: Page, gid: string, ghost = false) => (
    <div
      key={row.id + (ghost ? '-ghost' : '')}
      className={'db-card' + (ghost ? ' ghost' : '')}
      data-row-id={ghost ? undefined : row.id}
      onPointerDown={ghost ? undefined : e => onCardDown(e, row, gid)}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        setRowMenu({ rowId: row.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
      }}
    >
      <div className="db-card-title">
        <RowIcon page={row} />
        {editingTitle === row.id && !ghost ? (
          <TitleEditor rowId={row.id} onDone={() => setEditingTitle(null)} placeholder="Type a name…" />
        ) : (
          <span className={row.title ? '' : 'db-untitled'}>{row.title || 'Untitled'}</span>
        )}
      </div>
      {cardProps.map(p => {
        if (p.type !== 'checkbox' && isEmptyValue(row, p)) return null;
        return (
          <div key={p.id} className={'db-card-prop t-' + p.type}>
            <PropValue row={row} prop={p} mode="card" />
            {p.type === 'checkbox' && <span className="db-card-prop-name">{p.name}</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="db-board-scroll">
      <div className="db-board" ref={boardRef}>
        {groups.map(g => {
          const list = drag ? g.rows.filter(r => r.id !== drag.rowId) : g.rows;
          const items = list.map(r => renderCard(r, g.id));
          if (drag && drag.to === g.id) {
            items.splice(Math.min(drag.index, items.length), 0, <div key="ph" className="db-card-placeholder" style={{ height: drag.h }} />);
          }
          return (
            <div key={g.id} className={'db-board-col' + (drag && drag.to === g.id ? ' drop' : '')} data-gid={g.id} style={{ background: columnTint(g.opt?.color) }}>
              <div className="db-col-head">
                {g.opt ? (
                  <OptionPill opt={g.opt} status={status} />
                ) : (
                  <span className="db-pill" style={{ background: 'var(--on-gray-background-secondary-translucent)', color: 'var(--text-secondary)' }}>
                    {status && <span className="db-dot" style={{ background: 'var(--on-gray-icon-secondary)' }} />}
                    <span className="db-pill-text">No {groupProp.name}</span>
                  </span>
                )}
                <span className="db-col-count">{g.rows.length}</span>
                <span className="grow" />
                {g.opt && (
                  <span className="icon-btn db-icon-24 db-col-act" role="button" onClick={e => setOptMenu({ optId: g.opt!.id, rect: e.currentTarget.getBoundingClientRect() })}>
                    <Ellipsis size={14} />
                  </span>
                )}
                <span className="icon-btn db-icon-24 db-col-act" role="button" onClick={() => newInGroup(g, true)}>
                  <Plus size={14} />
                </span>
              </div>
              <div className="db-col-cards">{items}</div>
              <div className="db-col-new" role="button" onClick={() => newInGroup(g)}>
                <Plus size={16} /> New page
              </div>
            </div>
          );
        })}
      </div>
      {drag && dragRow &&
        createPortal(
          <div className="db-drag-ghost" style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.w }}>
            {renderCard(dragRow, drag.from, true)}
          </div>,
          document.body,
        )}
      {rowMenu && <RowMenu rowId={rowMenu.rowId} rect={rowMenu.rect} onClose={() => setRowMenu(null)} />}
      {optMenu && om && (
        <Popover anchor={optMenu.rect} onClose={() => setOptMenu(null)} width={220}>
          <OptionMenu dbId={dbId} propId={groupProp.id} opt={om} onClose={() => setOptMenu(null)} />
        </Popover>
      )}
    </div>
  );
}

