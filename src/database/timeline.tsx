import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, FileText } from 'lucide-react';
import { openPage, updateView } from '../store/actions';
import type { Page } from '../store/types';
import { Popover, Menu, pressable } from '../components/ui';
import { PropIcon } from './cells';
import { ymd, parseYmd, todayYmd, monthLabel, dayOf, timeOf, withTime, addDays, diffDays, shortMonth, readPref, writePref, weekStartDay } from './logic';
import { addRowAt, setRowRange, shiftRowDate } from './dbActions';
import { TitleEditor, RowMenu, RowIcon, startPointerDrag, rowItemProps, type ViewProps } from './shared';

type Zoom = 'days' | 'weeks' | 'months';
const DAY_W: Record<Zoom, number> = { days: 40, weeks: 14, months: 4 };
const ZOOM_LABEL: Record<Zoom, string> = { days: 'Days', weeks: 'Weeks', months: 'Months' };
const ROW_H = 36;
const HEAD_H = 52;

interface Preview {
  rowId: string;
  s: string;
  e: string;
}

export function TimelineView({ dbId, view, rows, schema, defaults, editingTitle, setEditingTitle }: ViewProps) {
  const dateProp = schema.find(p => p.id === view.dateProp && p.type === 'date');
  const titleProp = schema.find(p => p.type === 'title');
  const [zoom, setZoomState] = useState<Zoom>(() => (readPref('on:tl-zoom:' + view.id) as Zoom) || 'days');
  const [leftW, setLeftW] = useState(() => Number(readPref('on:tl-w')) || 280);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hoverAdd, setHoverAdd] = useState<{ rowId: string; idx: number } | null>(null);
  const [zoomMenu, setZoomMenu] = useState<DOMRect | null>(null);
  const [pick, setPick] = useState<DOMRect | null>(null);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; rect: DOMRect } | null>(null);
  const [labelDay, setLabelDay] = useState(todayYmd());
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const dayW = DAY_W[zoom];
  const today = todayYmd();

  // Visible range: a generous window around today that also covers every row.
  let minK = addDays(today, -75);
  let maxK = addDays(today, 200);
  if (dateProp) {
    for (const r of rows) {
      const v = r.props?.[dateProp.id];
      if (!v?.start) continue;
      const s = dayOf(v.start);
      const e = dayOf(v.end || v.start);
      if (s < minK) minK = addDays(s, -21);
      if (e > maxK) maxK = addDays(e, 45);
    }
  }
  const o = parseYmd(minK)!;
  const origin = ymd(new Date(o.getFullYear(), o.getMonth(), 1));
  const m = parseYmd(maxK)!;
  const last = ymd(new Date(m.getFullYear(), m.getMonth() + 1, 0));
  const total = diffDays(origin, last) + 1;
  const xOf = (k: string) => diffDays(origin, k) * dayW;

  const scrollToDay = (k: string, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, xOf(k) - el.clientWidth / 3), behavior: smooth ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    scrollToDay(today);
  }, [zoom, !!dateProp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const on = () => setLabelDay(addDays(origin, Math.floor((el.scrollLeft + el.clientWidth / 3) / dayW)));
    on();
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [origin, dayW]);

  if (!dateProp) {
    const dates = schema.filter(p => p.type === 'date');
    return (
      <div className="db-empty-state">
        <div>Timeline views show pages by a date property.</div>
        <span className="db-fchip add" {...pressable()} onClick={e => setPick(e.currentTarget.getBoundingClientRect())}>
          Timeline by…
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
  const propId = dateProp.id;

  const setZoom = (z: Zoom) => {
    setZoomState(z);
    writePref('on:tl-zoom:' + view.id, z);
  };

  const rangeOf = (r: Page): { s: string; e: string } | null => {
    if (preview && preview.rowId === r.id) return { s: preview.s, e: preview.e };
    const v = r.props?.[propId];
    if (!v?.start) return null;
    const s = dayOf(v.start);
    const e = dayOf(v.end || v.start);
    return { s, e: e < s ? s : e };
  };

  const startBarDrag = (e: RPointerEvent, row: Page, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    const v = row.props?.[propId];
    if (!v?.start) return;
    const s0 = dayOf(v.start);
    const e0 = dayOf(v.end || v.start);
    const sx = e.clientX;
    const calc = (x: number) => {
      const d = Math.round((x - sx) / dayW);
      if (mode === 'move') return { s: addDays(s0, d), e: addDays(e0, d), d };
      if (mode === 'l') {
        const s = addDays(s0, d);
        return { s: s > e0 ? e0 : s, e: e0, d };
      }
      const en = addDays(e0, d);
      return { s: s0, e: en < s0 ? s0 : en, d };
    };
    startPointerDrag(e, {
      onStart: ev => setPreview({ rowId: row.id, ...calc(ev.clientX) }),
      onMove: ev => setPreview({ rowId: row.id, ...calc(ev.clientX) }),
      onEnd: ev => {
        const r = calc(ev.clientX);
        setPreview(null);
        if (mode === 'move') shiftRowDate(row.id, propId, r.d);
        else if (r.s !== s0 || r.e !== e0) {
          const st = withTime(r.s, timeOf(v.start));
          const en = withTime(r.e, timeOf(v.end || v.start));
          setRowRange(row.id, propId, st, r.e === r.s && !timeOf(v.start) ? undefined : en);
        }
      },
      onClick: mode === 'move' ? () => openPage(row.id, { peek: true }) : undefined,
    });
  };

  const onTrackMove = (e: RMouseEvent, row: Page) => {
    if (rangeOf(row)) return;
    const c = canvasRef.current?.getBoundingClientRect();
    if (!c) return;
    const idx = Math.floor((e.clientX - c.left) / dayW);
    if (!hoverAdd || hoverAdd.rowId !== row.id || hoverAdd.idx !== idx) setHoverAdd({ rowId: row.id, idx });
  };

  const startResizeLeft = (e: RPointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const w0 = leftW;
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.max(160, Math.min(560, w0 + ev.clientX - sx));
      setLeftW(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('db-col-resizing');
      writePref('on:tl-w', String(w));
    };
    document.body.classList.add('db-col-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------------- Header segments ---------------- */
  const top: { k: string; x: number; w: number; label: string }[] = [];
  const bottom: { k: string; x: number; w: number; label: string; today?: boolean }[] = [];
  const lines: number[] = [];
  const first = parseYmd(origin)!;
  if (zoom === 'months') {
    for (let y = first.getFullYear(); ymd(new Date(y, 0, 1)) <= last; y++) {
      const k = ymd(new Date(y, 0, 1));
      const x = Math.max(0, xOf(k));
      top.push({ k, x, w: Math.min(total * dayW, xOf(ymd(new Date(y + 1, 0, 1)))) - x, label: String(y) });
    }
    for (let d = new Date(first); ymd(d) <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const k = ymd(d);
      const next = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1));
      bottom.push({ k, x: xOf(k), w: diffDays(k, next) * dayW, label: shortMonth(d.getMonth()) });
      lines.push(xOf(k));
    }
  } else {
    for (let d = new Date(first); ymd(d) <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const k = ymd(d);
      const next = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1));
      top.push({ k, x: xOf(k), w: diffDays(k, next) * dayW, label: monthLabel(d.getFullYear(), d.getMonth()) });
    }
    if (zoom === 'days') {
      for (let i = 0; i < total; i++) {
        const k = addDays(origin, i);
        bottom.push({ k, x: i * dayW, w: dayW, label: String(Number(k.slice(8))), today: k === today });
      }
    } else {
      const lead = (7 + weekStartDay() - first.getDay()) % 7; // first day of the user's week
      for (let i = lead; i < total; i += 7) {
        const k = addDays(origin, i);
        bottom.push({ k, x: i * dayW, w: 7 * dayW, label: String(Number(k.slice(8))) });
        lines.push(i * dayW);
      }
    }
  }
  const gridStyle =
    zoom === 'days'
      ? { backgroundImage: 'linear-gradient(to right, var(--border-secondary-translucent) 1px, transparent 1px)', backgroundSize: `${dayW}px 100%` }
      : undefined;
  const todayX = xOf(today) + dayW / 2;
  const lab = parseYmd(labelDay) || new Date();

  return (
    <div className="db-tl">
      <div className="db-tl-toolbar">
        <span className="db-cal-month">{monthLabel(lab.getFullYear(), lab.getMonth())}</span>
        <span className="grow" />
        <span className="db-cal-today" {...pressable()} onClick={e => setZoomMenu(e.currentTarget.getBoundingClientRect())}>
          {ZOOM_LABEL[zoom]} <ChevronDown size={12} style={{ marginInlineStart: 4 }} />
        </span>
        <span className="db-cal-today" {...pressable()} onClick={() => scrollToDay(today, true)}>
          Today
        </span>
        <span className="icon-btn db-icon-24" {...pressable()} aria-label="Scroll left" onClick={() => scrollRef.current?.scrollBy({ left: -scrollRef.current.clientWidth / 2, behavior: 'smooth' })}>
          <ChevronLeft size={16} />
        </span>
        <span className="icon-btn db-icon-24" {...pressable()} aria-label="Scroll right" onClick={() => scrollRef.current?.scrollBy({ left: scrollRef.current.clientWidth / 2, behavior: 'smooth' })}>
          <ChevronRight size={16} />
        </span>
      </div>
      <div className="db-tl-body">
        <div className="db-tl-left" style={{ width: leftW }}>
          <div className="db-tl-left-head" style={{ height: HEAD_H }}>
            <span className="db-th-icon"><PropIcon type="title" /></span>
            {titleProp?.name || 'Name'}
          </div>
          {rows.map(r => (
            <div
              key={r.id}
              className="db-tl-left-row"
              style={{ height: ROW_H }}
              {...pressable()}
              onClick={() => editingTitle !== r.id && openPage(r.id, { peek: true })}
              onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                setRowMenu({ rowId: r.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
              }}
            >
              {r.icon ? <RowIcon page={r} /> : <span className="db-row-icon db-default-icon"><FileText size={16} /></span>}
              {editingTitle === r.id ? (
                <TitleEditor rowId={r.id} onDone={() => setEditingTitle(null)} />
              ) : (
                <span className={'db-tl-title' + (r.title ? '' : ' db-untitled')}>{r.title || 'Untitled'}</span>
              )}
            </div>
          ))}
          <div className="db-new-row db-tl-new" style={{ height: ROW_H }} {...pressable()} onClick={() => setEditingTitle(addRowAt(dbId, { ...defaults }))}>
            <Plus size={16} /> New page
          </div>
          <span className="db-tl-resizer" onPointerDown={startResizeLeft} />
        </div>
        <div className="db-tl-scroll" ref={scrollRef}>
          <div className="db-tl-canvas" ref={canvasRef} style={{ width: total * dayW }}>
            <div className="db-tl-head" style={{ height: HEAD_H }}>
              <div className="db-tl-head-top">
                {top.map(t => (
                  <div key={t.k} className="db-tl-month-seg" style={{ left: t.x, width: t.w }}>
                    <span className="db-tl-month">{t.label}</span>
                  </div>
                ))}
              </div>
              <div className="db-tl-head-bottom">
                {bottom.map(b => (
                  <span key={b.k} className={'db-tl-tick' + (zoom === 'days' ? ' day' : '')} style={{ left: b.x, width: zoom === 'days' ? b.w : undefined }}>
                    <span className={b.today ? 'db-tl-today-num' : ''}>{b.label}</span>
                  </span>
                ))}
                {zoom !== 'days' && <span className="db-tl-today-dot" style={{ left: todayX - 4 }} />}
              </div>
            </div>
            <div className="db-tl-rows" style={gridStyle}>
              {lines.map(x => (
                <span key={x} className="db-tl-vline" style={{ left: x }} />
              ))}
              <span className="db-tl-today-line" style={{ left: todayX }} />
              {rows.map(r => {
                const rg = rangeOf(r);
                const left = rg ? xOf(rg.s) : 0;
                const width = rg ? (diffDays(rg.s, rg.e) + 1) * dayW : 0;
                const narrow = width < 90;
                return (
                  <div
                    key={r.id}
                    className="db-tl-track"
                    style={{ height: ROW_H }}
                    onMouseMove={e => onTrackMove(e, r)}
                    onMouseLeave={() => hoverAdd?.rowId === r.id && setHoverAdd(null)}
                  >
                    {rg ? (
                      <>
                        <div
                          className={'db-tl-bar' + (preview?.rowId === r.id ? ' dragging' : '')}
                          style={{ left, width: Math.max(width, 8) }}
                          {...rowItemProps(r, rect => setRowMenu({ rowId: r.id, rect }), r.title || 'Untitled')}
                          onPointerDown={e => startBarDrag(e, r, 'move')}
                          onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setRowMenu({ rowId: r.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
                          }}
                        >
                          <span className="db-tl-handle l" onPointerDown={e => startBarDrag(e, r, 'l')} />
                          {!narrow && (
                            <span className="db-tl-bar-text">
                              <RowIcon page={r} />
                              <span className={r.title ? '' : 'db-untitled'}>{r.title || 'Untitled'}</span>
                            </span>
                          )}
                          <span className="db-tl-handle r" onPointerDown={e => startBarDrag(e, r, 'r')} />
                        </div>
                        {narrow && (
                          <span className="db-tl-bar-label" style={{ left: left + Math.max(width, 8) + 6 }}>
                            {r.title || 'Untitled'}
                          </span>
                        )}
                      </>
                    ) : (
                      hoverAdd?.rowId === r.id && (
                        <span
                          className="db-tl-add"
                          aria-label="Add an item here"
                          style={{ left: hoverAdd.idx * dayW, width: Math.max(dayW, 24) }}
                          {...pressable()}
                          onClick={() => setRowRange(r.id, propId, addDays(origin, hoverAdd.idx))}
                        >
                          <Plus size={14} />
                        </span>
                      )
                    )}
                  </div>
                );
              })}
              <div className="db-tl-track" style={{ height: ROW_H }} />
            </div>
          </div>
        </div>
      </div>
      {zoomMenu && (
        <Popover anchor={zoomMenu} onClose={() => setZoomMenu(null)} width={160}>
          <Menu
            onClose={() => setZoomMenu(null)}
            items={(['days', 'weeks', 'months'] as Zoom[]).map(z => ({ id: z, label: ZOOM_LABEL[z], right: z === zoom ? '✓' : undefined, onSelect: () => setZoom(z) }))}
          />
        </Popover>
      )}
      {rowMenu && <RowMenu rowId={rowMenu.rowId} rect={rowMenu.rect} onClose={() => setRowMenu(null)} />}
    </div>
  );
}
