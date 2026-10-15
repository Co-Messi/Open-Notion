import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { openPage, updateView } from '../store/actions';
import type { Page } from '../store/types';
import { Popover, Menu } from '../components/ui';
import { PropIcon } from './cells';
import { ymd, todayYmd, monthLabel, dayOf, timeOf, diffDays, fmtTimeShort, weekStartDay, weekdayName, fmtMonthDay } from './logic';
import { addRowAt, shiftRowDate } from './dbActions';
import { RowMenu, RowIcon, startPointerDrag, type ViewProps } from './shared';

interface Seg {
  row: Page;
  col: number;
  span: number;
  lane: number;
  contL: boolean;
  contR: boolean;
  time: string;
}

const LANE_H = 24;
const TOP = 32;

/** Lays out a week's events into non-overlapping lanes (multi-day bars stay continuous). */
function layoutWeek(rows: Page[], propId: string, week: string[]): { segs: Seg[]; lanes: number } {
  const first = week[0];
  const last = week[6];
  const segs: Seg[] = [];
  for (const r of rows) {
    const v = r.props?.[propId];
    if (!v?.start) continue;
    const s = dayOf(v.start);
    let e = v.end ? dayOf(v.end) : s;
    if (e < s) e = s;
    if (e < first || s > last) continue;
    const col = s < first ? 0 : diffDays(first, s);
    const endCol = e > last ? 6 : diffDays(first, e);
    segs.push({ row: r, col, span: endCol - col + 1, lane: 0, contL: s < first, contR: e > last, time: s >= first ? timeOf(v.start) : '' });
  }
  segs.sort((a, b) => a.col - b.col || b.span - a.span);
  const lanes: number[][] = [];
  for (const seg of segs) {
    let lane = lanes.findIndex(cols => cols.every(c => c < seg.col || c > seg.col + seg.span - 1));
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    for (let c = seg.col; c < seg.col + seg.span; c++) lanes[lane].push(c);
    seg.lane = lane;
  }
  return { segs, lanes: lanes.length };
}

export function CalendarView({ dbId, view, rows, schema, defaults }: ViewProps) {
  const dateProp = schema.find(p => p.id === view.dateProp && p.type === 'date');
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }));
  const [drag, setDrag] = useState<{ rowId: string; over: string | null; x: number; y: number; title: string } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; rect: DOMRect } | null>(null);
  const [pick, setPick] = useState<DOMRect | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  if (!dateProp) {
    const dates = schema.filter(p => p.type === 'date');
    return (
      <div className="db-empty-state">
        <div>Calendar views show pages by a date property.</div>
        <span className="db-fchip add" role="button" onClick={e => setPick(e.currentTarget.getBoundingClientRect())}>
          Calendar by…
        </span>
        {pick && (
          <Popover anchor={pick} onClose={() => setPick(null)} width={240}>
            <Menu
              onClose={() => setPick(null)}
              items={
                dates.length
                  ? dates.map(p => ({ id: p.id, label: p.name, icon: <PropIcon type="date" size={16} />, onSelect: () => updateView(dbId, view.id, { dateProp: p.id }) }))
                  : [{ id: 'none', label: 'Add a date property first', disabled: true }]
              }
            />
          </Popover>
        )}
      </div>
    );
  }

  const weekStart = weekStartDay();
  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);
  const weeks: Date[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const wk: Date[] = [];
    for (let i = 0; i < 7; i++) wk.push(new Date(ym.y, ym.m, 1 - lead + w * 7 + i));
    weeks.push(wk);
  }
  const dows = Array.from({ length: 7 }, (_, i) => weekdayName((weekStart + i) % 7, 'short'));
  const today = todayYmd();

  const shift = (n: number) => setYm(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const dayAt = (x: number, y: number): string | null => {
    const cells = Array.from(gridRef.current?.querySelectorAll('.db-cal-day') || []) as HTMLElement[];
    const c = cells.find(el => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    });
    return c?.dataset.date || null;
  };

  const onItemDown = (e: RPointerEvent, row: Page) => {
    const grab = dayAt(e.clientX, e.clientY);
    startPointerDrag(e, {
      onStart: ev => setDrag({ rowId: row.id, over: dayAt(ev.clientX, ev.clientY), x: ev.clientX, y: ev.clientY, title: row.title || 'Untitled' }),
      onMove: ev => setDrag(d => (d ? { ...d, over: dayAt(ev.clientX, ev.clientY), x: ev.clientX, y: ev.clientY } : d)),
      onEnd: ev => {
        const k = dayAt(ev.clientX, ev.clientY);
        setDrag(null);
        if (k && grab) shiftRowDate(row.id, dateProp.id, diffDays(grab, k));
      },
      onClick: () => openPage(row.id, { peek: true }),
    });
  };

  const addOn = (k: string) => {
    const id = addRowAt(dbId, { ...defaults, [dateProp.id]: { start: k } });
    openPage(id, { peek: true });
  };

  return (
    <div className="db-cal">
      <div className="db-cal-head">
        <span className="db-cal-month">{monthLabel(ym.y, ym.m)}</span>
        <span className="grow" />
        <span className="db-cal-today" role="button" onClick={() => setYm({ y: new Date().getFullYear(), m: new Date().getMonth() })}>
          Today
        </span>
        <span className="icon-btn db-icon-24" role="button" onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </span>
        <span className="icon-btn db-icon-24" role="button" onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </span>
      </div>
      <div className="db-cal-dows">
        {dows.map(d => (
          <div key={d} className="db-cal-dow">{d}</div>
        ))}
      </div>
      <div className="db-cal-weeks" ref={gridRef}>
        {weeks.map(wk => {
          const keys = wk.map(ymd);
          const { segs, lanes } = layoutWeek(rows, dateProp.id, keys);
          const height = Math.max(120, TOP + lanes * LANE_H + 8);
          return (
            <div key={keys[0]} className="db-cal-week" style={{ height }}>
              {wk.map((d, i) => {
                const k = keys[i];
                const other = d.getMonth() !== ym.m;
                return (
                  <div key={k} className={'db-cal-day' + (other ? ' other' : '') + (drag?.over === k ? ' drop' : '')} data-date={k}>
                    <div className="db-cal-day-top">
                      <span className="db-cal-add" role="button" onClick={() => addOn(k)}>
                        <Plus size={14} />
                      </span>
                      <span className={'db-cal-num' + (k === today ? ' today' : '')}>
                        {d.getDate() === 1 && !other ? fmtMonthDay(d.getFullYear(), d.getMonth(), 1) : d.getDate()}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className="db-cal-events">
                {segs.map(seg => {
                  const r = seg.row;
                  return (
                    <div
                      key={r.id}
                      className={
                        'db-cal-item' + (drag?.rowId === r.id ? ' dragging' : '') + (seg.contL ? ' cont-l' : '') + (seg.contR ? ' cont-r' : '')
                      }
                      style={{
                        left: `calc(${(seg.col / 7) * 100}% + ${seg.contL ? 0 : 4}px)`,
                        width: `calc(${(seg.span / 7) * 100}% - ${(seg.contL ? 0 : 4) + (seg.contR ? 0 : 4)}px)`,
                        top: TOP + seg.lane * LANE_H,
                      }}
                      title={r.title || 'Untitled'}
                      onPointerDown={e => onItemDown(e, r)}
                      onContextMenu={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        setRowMenu({ rowId: r.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
                      }}
                    >
                      <RowIcon page={r} />
                      {seg.time && <span className="db-cal-time">{fmtTimeShort(seg.time)}</span>}
                      <span className={'db-cal-item-text' + (r.title ? '' : ' db-untitled')}>{r.title || 'Untitled'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {drag &&
        createPortal(
          <div className="db-cal-item db-cal-ghost" style={{ left: drag.x + 8, top: drag.y - 12 }}>
            {drag.title}
          </div>,
          document.body,
        )}
      {rowMenu && <RowMenu rowId={rowMenu.rowId} rect={rowMenu.rect} onClose={() => setRowMenu(null)} />}
    </div>
  );
}

