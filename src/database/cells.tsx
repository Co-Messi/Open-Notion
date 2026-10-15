import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CaseSensitive, AlignLeft, Hash, CircleChevronDown, List, Loader, Calendar, User, SquareCheck, Link, AtSign, Phone, Clock,
  ChevronLeft, ChevronRight, Check, X, Ellipsis, Trash2, ArrowUpRight, Plus,
} from 'lucide-react';
import { useDoc, getDoc } from '../store/store';
import { setRowProp, OPTION_COLORS } from '../store/actions';
import type { ColorName, Page, Property, PropType, SelectOption } from '../store/types';
import { Popover, Switch } from '../components/ui';
import {
  optionStyle, dotColor, optionById, fmtNumber, fmtDateValue, fmtTimestamp, fmtDate, parseYmd, ymd, todayYmd, shortMonthLabel, weekStartDay, weekdayName, getLocale, parseLooseDate, orderRange,
  COLOR_LABEL, rawValue, dayOf, timeOf, withTime,
} from './logic';
import { createOption, updateOption, deleteOption } from './dbActions';
import { useFocusLater } from './focus';
import { openExternal, safeLinkUrl } from '../lib/url';

/* ------------------------------------------------------------------ */
/* Icons + pills                                                       */
/* ------------------------------------------------------------------ */

export function PropIcon({ type, size = 14 }: { type: PropType; size?: number }) {
  const p = { size, strokeWidth: 1.75 };
  switch (type) {
    case 'title': return <CaseSensitive {...p} />;
    case 'text': return <AlignLeft {...p} />;
    case 'number': return <Hash {...p} />;
    case 'select': return <CircleChevronDown {...p} />;
    case 'multi_select': return <List {...p} />;
    case 'status': return <Loader {...p} />;
    case 'date': return <Calendar {...p} />;
    case 'person': return <User {...p} />;
    case 'checkbox': return <SquareCheck {...p} />;
    case 'url': return <Link {...p} />;
    case 'email': return <AtSign {...p} />;
    case 'phone': return <Phone {...p} />;
    default: return <Clock {...p} />;
  }
}

export function OptionPill({ opt, status, onRemove }: { opt: SelectOption; status?: boolean; onRemove?: () => void }) {
  return (
    <span className={'db-pill' + (status ? ' status' : '')} style={optionStyle(opt.color)}>
      {status && <span className="db-dot" style={{ background: dotColor(opt.color) }} />}
      <span className="db-pill-text">{opt.name}</span>
      {onRemove && (
        <span
          className="db-pill-x"
          role="button"
          onMouseDown={e => e.preventDefault()}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={12} />
        </span>
      )}
    </span>
  );
}

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="db-avatar" style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {(name || '?')[0].toUpperCase()}
    </span>
  );
}

export function CheckboxBox({ on, onToggle }: { on: boolean; onToggle?: () => void }) {
  return (
    <span
      className={'db-checkbox' + (on ? ' on' : '')}
      role="checkbox"
      aria-checked={on}
      onClick={e => {
        if (!onToggle) return;
        e.stopPropagation();
        onToggle();
      }}
    >
      {on && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Value display                                                       */
/* ------------------------------------------------------------------ */

export type ValueMode = 'table' | 'card' | 'list' | 'props';

/** Outbound link for a url, email or phone value; undefined when the scheme is not allowed. */
export function linkHref(prop: Property, v: string): string | undefined {
  const s = String(v ?? '').trim();
  if (prop.type === 'email') return safeLinkUrl('mailto:' + s) ?? undefined;
  if (prop.type === 'phone') return safeLinkUrl('tel:' + s.replace(/\s+/g, '')) ?? undefined;
  return (/^[a-z][a-z0-9+.-]*:/i.test(s) ? safeLinkUrl(s) : safeLinkUrl('https://' + s.replace(/^\/+/, ''))) ?? undefined;
}

/** Read-only rendering of a property value. Returns null when empty. */
export function PropValue({ row, prop, mode }: { row: Page; prop: Property; mode: ValueMode }) {
  const userName = useDoc(d => d.workspace.userName, Object.is);
  const v = rawValue(row, prop);
  switch (prop.type) {
    case 'title':
      return <span>{row.title}</span>;
    case 'select':
    case 'status': {
      const o = optionById(prop, v);
      return o ? <OptionPill opt={o} status={prop.type === 'status'} /> : null;
    }
    case 'multi_select': {
      const opts = (Array.isArray(v) ? v : []).map((id: string) => optionById(prop, id)).filter(Boolean) as SelectOption[];
      if (!opts.length) return null;
      return (
        <span className="db-pills">
          {opts.map(o => (
            <OptionPill key={o.id} opt={o} />
          ))}
        </span>
      );
    }
    case 'date': {
      const s = fmtDateValue(v);
      return s ? <span className="db-text">{s}</span> : null;
    }
    case 'checkbox':
      return <CheckboxBox on={!!v} onToggle={mode === 'table' || mode === 'props' ? undefined : () => setRowProp(row.id, prop.id, !v)} />;
    case 'number': {
      const s = fmtNumber(v, prop.numberFormat);
      return s ? <span className="db-text">{s}</span> : null;
    }
    case 'person': {
      const ids: string[] = Array.isArray(v) ? v : [];
      if (!ids.length) return null;
      return (
        <span className="db-people">
          {ids.map(id => {
            const nm = id === 'me' ? userName : id;
            return (
              <span key={id} className="db-person">
                <Avatar name={nm} />
                {mode !== 'card' || ids.length === 1 ? <span className="db-text">{nm}</span> : null}
              </span>
            );
          })}
        </span>
      );
    }
    case 'created_time':
    case 'last_edited_time':
      return <span className="db-text">{fmtTimestamp(v)}</span>;
    case 'url':
    case 'email':
    case 'phone': {
      if (!v) return null;
      const s = String(v);
      return (
        <span className="db-link-wrap">
          <a
            className="db-link"
            href={linkHref(prop, s)}
            target="_blank"
            rel="noreferrer"
            onClick={e => {
              // Plain click edits the cell; modifier click follows the link.
              if (!(e.metaKey || e.ctrlKey)) e.preventDefault();
              else e.stopPropagation();
            }}
          >
            {prop.type === 'url' ? s.replace(/^https?:\/\//, '') : s}
          </a>
          {(mode === 'table' || mode === 'props') && (
            <span
              className="db-link-open"
              role="button"
              title="Open link"
              onClick={e => {
                e.stopPropagation();
                openExternal(linkHref(prop, s));
              }}
            >
              <ArrowUpRight size={12} />
            </span>
          )}
        </span>
      );
    }
    default: {
      if (v === undefined || v === null || v === '') return null;
      return <span className="db-text">{String(v)}</span>;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Editors                                                             */
/* ------------------------------------------------------------------ */

export function isEditable(type: PropType) {
  return !['created_time', 'last_edited_time', 'checkbox', 'title'].includes(type);
}

/** Popover editor for a cell. `rect` is the cell rect; the editor overlays it. */
export function CellEditor({ dbId, rowId, prop, rect, onClose }: { dbId: string; rowId: string; prop: Property; rect: DOMRect; onClose: () => void }) {
  const overlay = useMemo(() => ({ x: rect.left, y: rect.top, width: rect.width, height: 0 }), [rect]);
  const below = useMemo(() => ({ x: rect.left, y: rect.bottom, width: rect.width, height: 0 }), [rect]);
  const minW = Math.max(rect.width, 240);
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      return (
        <Popover anchor={overlay} offset={0} onClose={onClose} width={Math.max(rect.width, 300)} className="db-editor-pop">
          <SelectEditor dbId={dbId} rowId={rowId} propId={prop.id} onClose={onClose} />
        </Popover>
      );
    case 'date':
      return (
        <Popover anchor={below} offset={4} onClose={onClose} className="db-editor-pop">
          <DateEditor rowId={rowId} propId={prop.id} />
        </Popover>
      );
    case 'person':
      return (
        <Popover anchor={overlay} offset={0} onClose={onClose} width={Math.max(rect.width, 260)} className="db-editor-pop">
          <PersonEditor rowId={rowId} propId={prop.id} />
        </Popover>
      );
    default:
      return <TextEditor rowId={rowId} prop={prop} anchor={overlay} width={minW} onClose={onClose} />;
  }
}

function TextEditor({ rowId, prop, anchor, width, onClose }: { rowId: string; prop: Property; anchor: { x: number; y: number }; width: number; onClose: () => void }) {
  const initial = getDoc().pages[rowId]?.props?.[prop.id];
  const [text, setText] = useState(initial === undefined || initial === null ? '' : String(initial));
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const t = textRef.current;
    let val: any = t;
    if (prop.type === 'number') {
      const n = parseFloat(t.replace(/[^\d.eE+-]/g, ''));
      val = t.trim() === '' || Number.isNaN(n) ? undefined : prop.numberFormat === 'percent' && /%/.test(t) ? n / 100 : n;
    } else if (t === '') val = undefined;
    if (val !== initial) setRowProp(rowId, prop.id, val);
    onClose();
  };
  useFocusLater(ref);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = el.scrollHeight + 'px';
  }, [text]);
  return (
    <Popover anchor={anchor} offset={0} onClose={commit} width={width} className="db-editor-pop db-text-editor">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        inputMode={prop.type === 'number' ? 'decimal' : undefined}
        placeholder={prop.type === 'number' ? '' : 'Empty'}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit();
          }
        }}
      />
    </Popover>
  );
}

const STATUS_GROUPS: { id: NonNullable<SelectOption['group']>; label: string }[] = [
  { id: 'todo', label: 'To-do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'complete', label: 'Complete' },
];

export function SelectEditor({ dbId, rowId, propId, onClose }: { dbId: string; rowId: string; propId: string; onClose: () => void }) {
  const prop = useDoc(d => d.pages[dbId]?.schema?.find(p => p.id === propId), Object.is);
  const value = useDoc(d => d.pages[rowId]?.props?.[propId], Object.is);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [optMenu, setOptMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusLater(inputRef);
  if (!prop) return null;
  const multi = prop.type === 'multi_select';
  const status = prop.type === 'status';
  const options = prop.options || [];
  const selected: string[] = multi ? (Array.isArray(value) ? value : []) : value ? [value] : [];
  const ql = q.trim().toLowerCase();
  const shown = ql ? options.filter(o => o.name.toLowerCase().includes(ql)) : options;
  const canCreate = !!ql && !options.some(o => o.name.toLowerCase() === ql);
  const total = shown.length + (canCreate ? 1 : 0);

  const choose = (id: string) => {
    if (multi) {
      setRowProp(rowId, propId, selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
      setQ('');
      inputRef.current?.focus({ preventScroll: true });
    } else {
      setRowProp(rowId, propId, selected[0] === id ? undefined : id);
      onClose();
    }
  };
  const create = () => {
    const o = createOption(dbId, propId, q.trim(), status ? 'todo' : undefined);
    choose(o.id);
    setQ('');
  };
  const remove = (id: string) => setRowProp(rowId, propId, multi ? selected.filter(x => x !== id) : undefined);

  const renderOpt = (o: SelectOption, idx: number) => (
    <div
      key={o.id}
      className={'db-opt-row' + (idx === active ? ' active' : '')}
      onMouseMove={() => setActive(idx)}
      onMouseDown={e => e.preventDefault()}
      onClick={() => choose(o.id)}
    >
      <OptionPill opt={o} status={status} />
      <span className="grow" />
      {selected.includes(o.id) && !multi && <Check size={14} className="db-opt-check" />}
      <span
        className="db-opt-more"
        role="button"
        onClick={e => {
          e.stopPropagation();
          setOptMenu({ id: o.id, rect: e.currentTarget.getBoundingClientRect() });
        }}
      >
        <Ellipsis size={14} />
      </span>
    </div>
  );

  let idx = -1;
  const list: ReactNode[] = [];
  if (status && !ql) {
    for (const g of STATUS_GROUPS) {
      const inGroup = shown.filter(o => (o.group || 'todo') === g.id);
      list.push(<div key={'g' + g.id} className="menu-label">{g.label}</div>);
      for (const o of inGroup) list.push(renderOpt(o, ++idx));
    }
  } else {
    for (const o of shown) list.push(renderOpt(o, ++idx));
  }
  const om = optMenu ? options.find(o => o.id === optMenu.id) : null;

  return (
    <div className="db-select-editor">
      <div className="db-sel-input" onClick={() => inputRef.current?.focus()}>
        {selected.map(id => {
          const o = optionById(prop, id);
          return o ? <OptionPill key={id} opt={o} status={status} onRemove={() => remove(id)} /> : null;
        })}
        <input
          ref={inputRef}
          value={q}
          placeholder={selected.length ? '' : 'Search for an option…'}
          onChange={e => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(a => (a + 1) % Math.max(1, total));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(a => (a - 1 + total) % Math.max(1, total));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (active < shown.length && shown[active]) choose(shown[active].id);
              else if (canCreate) create();
            } else if (e.key === 'Backspace' && !q && selected.length) {
              remove(selected[selected.length - 1]);
            }
          }}
        />
      </div>
      <div className="db-sel-body">
        <div className="menu-label">{options.length || q ? 'Select an option or create one' : 'Type to create an option'}</div>
        {list}
        {canCreate && (
          <div
            className={'db-opt-row' + (active === shown.length ? ' active' : '')}
            onMouseMove={() => setActive(shown.length)}
            onMouseDown={e => e.preventDefault()}
            onClick={create}
          >
            <span className="db-create-label">Create</span>
            <OptionPill opt={{ id: 'new', name: q.trim(), color: 'default' }} status={status} />
          </div>
        )}
      </div>
      {optMenu && om && (
        <Popover anchor={optMenu.rect} placement="right-start" onClose={() => setOptMenu(null)} width={220}>
          <OptionMenu dbId={dbId} propId={propId} opt={om} onClose={() => setOptMenu(null)} />
        </Popover>
      )}
    </div>
  );
}

/** Rename / recolor / delete an option. */
export function OptionMenu({ dbId, propId, opt, onClose }: { dbId: string; propId: string; opt: SelectOption; onClose: () => void }) {
  const [name, setName] = useState(opt.name);
  const ref = useRef<HTMLInputElement>(null);
  useFocusLater(ref);
  return (
    <div className="db-opt-menu">
      <div className="menu-search">
        <input
          ref={ref}
          value={name}
          onChange={e => {
            setName(e.target.value);
            if (e.target.value.trim()) updateOption(dbId, propId, opt.id, { name: e.target.value });
          }}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') onClose();
          }}
        />
      </div>
      <div className="menu">
        <div
          className="menu-item"
          onClick={() => {
            onClose();
            deleteOption(dbId, propId, opt.id);
          }}
        >
          <span className="mi-icon"><Trash2 size={16} /></span>
          <span className="mi-text">Delete</span>
        </div>
        <div className="menu-sep" />
        <div className="menu-label">Colors</div>
        {OPTION_COLORS.map((c: ColorName) => (
          <div key={c} className="menu-item" onClick={() => updateOption(dbId, propId, opt.id, { color: c })}>
            <span className="mi-icon"><span className="db-swatch" style={optionStyle(c)} /></span>
            <span className="mi-text">{COLOR_LABEL[c]}</span>
            {opt.color === c && <span className="mi-right"><Check size={14} /></span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonEditor({ rowId, propId }: { rowId: string; propId: string }) {
  const value = useDoc(d => d.pages[rowId]?.props?.[propId], Object.is);
  const userName = useDoc(d => d.workspace.userName, Object.is);
  const sel: string[] = Array.isArray(value) ? value : [];
  const has = sel.includes('me');
  return (
    <div className="db-person-editor">
      <div className="db-sel-input">
        {sel.map(id => (
          <span key={id} className="db-person-chip">
            <Avatar name={id === 'me' ? userName : id} size={18} />
            {id === 'me' ? userName : id}
            <span role="button" className="db-pill-x" onClick={() => setRowProp(rowId, propId, sel.filter(x => x !== id))}>
              <X size={12} />
            </span>
          </span>
        ))}
        {!sel.length && <span className="db-placeholder">Search for a person…</span>}
      </div>
      <div className="menu">
        <div className="menu-label">Select as many as you like</div>
        <div className="menu-item" onClick={() => setRowProp(rowId, propId, has ? sel.filter(x => x !== 'me') : [...sel, 'me'])}>
          <span className="mi-icon"><Avatar name={userName} /></span>
          <span className="mi-text">{userName}</span>
          {has && <span className="mi-right"><Check size={14} /></span>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Date picker                                                         */
/* ------------------------------------------------------------------ */

export function weekStartsMonday() {
  return weekStartDay() === 1;
}

export function DatePicker({ value, rangeEnd, onPick }: { value?: string; rangeEnd?: string; onPick: (d: string) => void }) {
  const init = parseYmd(value) || new Date();
  const [ym, setYm] = useState({ y: init.getFullYear(), m: init.getMonth() });
  const weekStart = weekStartDay();
  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(ym.y, ym.m, 1 - lead);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const dows = Array.from({ length: 7 }, (_, i) => {
    const n = weekdayName((weekStart + i) % 7, 'short');
    return /^en/i.test(getLocale() || 'en') ? n.slice(0, 2) : n;
  });
  const today = todayYmd();
  const shift = (n: number) => setYm(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  return (
    <div className="datepicker">
      <div className="dp-head">
        <span>{shortMonthLabel(ym.y, ym.m)}</span>
        <div className="nav">
          <span className="db-dp-today" role="button" onClick={() => setYm({ y: new Date().getFullYear(), m: new Date().getMonth() })}>
            Today
          </span>
          <span className="icon-btn" role="button" onClick={() => shift(-1)}><ChevronLeft size={16} /></span>
          <span className="icon-btn" role="button" onClick={() => shift(1)}><ChevronRight size={16} /></span>
        </div>
      </div>
      <div className="dp-grid">
        {dows.map(d => (
          <div key={d} className="dp-dow">{d}</div>
        ))}
        {days.map(d => {
          const k = ymd(d);
          const inRange = value && rangeEnd && k > value && k < rangeEnd;
          return (
            <div
              key={k}
              className={
                'dp-day' + (d.getMonth() !== ym.m ? ' other' : '') + (k === today ? ' today' : '') +
                (k === value || k === rangeEnd ? ' sel' : '') + (inRange ? ' db-in-range' : '')
              }
              onClick={() => onPick(k)}
            >
              {d.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const parseLoose = (s: string): string | null => parseLooseDate(s);

export function DateEditor({ rowId, propId }: { rowId: string; propId: string }) {
  const value = useDoc(d => d.pages[rowId]?.props?.[propId], Object.is) as { start: string; end?: string } | undefined;
  const start = value?.start;
  const end = value?.end;
  const [endOn, setEndOn] = useState(!!end);
  const [timeOn, setTimeOn] = useState(!!timeOf(start));
  const [editingEnd, setEditingEnd] = useState(false);
  const [startText, setStartText] = useState(fmtDate(dayOf(start)));
  const [endText, setEndText] = useState(fmtDate(dayOf(end)));
  useEffect(() => {
    setStartText(fmtDate(dayOf(start)));
    setEndText(fmtDate(dayOf(end || (endOn ? start : undefined))));
  }, [start, end, endOn]);

  const write = (s: string | undefined, e: string | undefined) => {
    if (!s) {
      setRowProp(rowId, propId, undefined);
      return;
    }
    [s, e] = orderRange(s, e);
    setRowProp(rowId, propId, e && e !== s ? { start: s, end: e } : { start: s });
  };
  const defStart = () => (timeOn ? '09:00' : '');
  const defEnd = () => (timeOn ? '10:00' : '');
  const curEnd = () => end || (endOn && start ? withTime(dayOf(start), timeOf(start) ? defEnd() : '') : undefined);

  const pick = (day: string) => {
    if (endOn && editingEnd && start) {
      write(start, withTime(day, timeOf(curEnd()) || defEnd()));
      setEditingEnd(false);
    } else {
      const s = withTime(day, timeOf(start) || defStart());
      const e = endOn ? withTime(end && dayOf(end) >= day ? dayOf(end) : day, timeOf(end) || defEnd()) : undefined;
      write(s, e);
      if (endOn) setEditingEnd(true);
    }
  };
  const toggleEnd = (on: boolean) => {
    setEndOn(on);
    if (!start) return;
    if (on) {
      write(start, withTime(dayOf(start), timeOf(start) ? defEnd() : ''));
      setEditingEnd(true);
    } else {
      write(start, undefined);
      setEditingEnd(false);
    }
  };
  const toggleTime = (on: boolean) => {
    setTimeOn(on);
    if (!start) return;
    if (on) write(withTime(dayOf(start), '09:00'), end || endOn ? withTime(dayOf(end || start), '10:00') : undefined);
    else write(dayOf(start), end ? dayOf(end) : undefined);
  };
  const commitText = (text: string, which: 'start' | 'end') => {
    if (text === fmtDate(dayOf(which === 'start' ? start : end))) return;
    const p = parseLoose(text);
    if (!p) return;
    if (which === 'start') write(withTime(p, timeOf(start) || defStart()), end);
    else write(start || p, withTime(p, timeOf(end) || defEnd()));
  };

  return (
    <div className="db-date-editor">
      <div className="db-date-inputs">
        <div className="db-date-line">
          <input
            className={'text-input' + (!editingEnd ? ' db-focus-ring' : '')}
            value={startText}
            placeholder="Start date"
            onFocus={() => setEditingEnd(false)}
            onChange={e => setStartText(e.target.value)}
            onBlur={() => commitText(startText, 'start')}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') commitText(startText, 'start');
            }}
          />
          {timeOn && start && (
            <input
              type="time"
              className="text-input db-time-input"
              value={timeOf(start) || '09:00'}
              onChange={e => e.target.value && write(withTime(dayOf(start), e.target.value), end)}
              onKeyDown={e => e.stopPropagation()}
            />
          )}
        </div>
        {endOn && (
          <div className="db-date-line">
            <input
              className={'text-input' + (editingEnd ? ' db-focus-ring' : '')}
              value={endText}
              placeholder="End date"
              onFocus={() => setEditingEnd(true)}
              onChange={e => setEndText(e.target.value)}
              onBlur={() => commitText(endText, 'end')}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') commitText(endText, 'end');
              }}
            />
            {timeOn && start && (
              <input
                type="time"
                className="text-input db-time-input"
                value={timeOf(curEnd()) || '10:00'}
                onChange={e => e.target.value && write(start, withTime(dayOf(curEnd() || start), e.target.value))}
                onKeyDown={e => e.stopPropagation()}
              />
            )}
          </div>
        )}
      </div>
      <DatePicker value={dayOf(start) || undefined} rangeEnd={dayOf(end) || undefined} onPick={pick} />
      <div className="db-date-foot">
        <div className="menu-item" onClick={() => toggleEnd(!endOn)}>
          <span className="mi-text">End date</span>
          <Switch on={endOn} onChange={toggleEnd} />
        </div>
        <div className="menu-item" onClick={() => toggleTime(!timeOn)}>
          <span className="mi-text">Include time</span>
          <Switch on={timeOn} onChange={toggleTime} />
        </div>
        <div className="menu-sep" />
        <div
          className="menu-item"
          onClick={() => {
            write(undefined, undefined);
            setEndOn(false);
            setTimeOn(false);
          }}
        >
          <span className="mi-text">Clear</span>
        </div>
      </div>
    </div>
  );
}

/** Small "+" glyph used in multiple views. */
export function PlusIcon({ size = 16 }: { size?: number }) {
  return <Plus size={size} strokeWidth={1.75} />;
}
