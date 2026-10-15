import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Trash2, Plus, ArrowUpDown, X, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { useDoc, transact } from '../store/store';
import { uid } from '../store/actions';
import type { DbView, Filter, Property, Sort } from '../store/types';
import { Popover, Menu, type Anchor, type MenuItemDef } from '../components/ui';
import { PropIcon, OptionPill, Avatar, DatePicker, CheckboxBox } from './cells';
import { FocusMenuSearch } from './focus';
import { opsFor, opDef, defaultOp, filterActive, optionById, fmtDate, orderedProps } from './logic';
import { attrSel } from '../lib/dom';

/* ------------------------------------------------------------------ */
/* View patch helpers                                                  */
/* ------------------------------------------------------------------ */

export function patchView(dbId: string, viewId: string, fn: (v: DbView) => Partial<DbView>, historyKey?: string) {
  transact(tx => {
    const db = tx.pages[dbId];
    if (!db) return;
    tx.setPage(dbId, { views: (db.views || []).map(v => (v.id === viewId ? { ...v, ...fn(v) } : v)) });
  }, historyKey ? { key: historyKey } : 'push');
}

export function addFilter(dbId: string, viewId: string, prop: Property): string {
  const f: Filter = { id: uid(), propId: prop.id, op: defaultOp(prop.type) };
  patchView(dbId, viewId, v => ({ filters: [...v.filters, f] }));
  return f.id;
}

export function addSort(dbId: string, viewId: string, propId: string) {
  patchView(dbId, viewId, v => ({ sorts: [...v.sorts.filter(s => s.propId !== propId), { id: uid(), propId, dir: 'asc' }] }));
}

/* ------------------------------------------------------------------ */
/* Property picker                                                     */
/* ------------------------------------------------------------------ */

export function PropPicker({
  schema, view, anchor, onClose, onPick, placeholder, exclude = [],
}: { schema: Property[]; view: DbView; anchor: Anchor; onClose: () => void; onPick: (p: Property) => void; placeholder: string; exclude?: string[] }) {
  const items: MenuItemDef[] = orderedProps(schema, view)
    .filter(p => !exclude.includes(p.id))
    .map(p => ({ id: p.id, label: p.name || 'Untitled', icon: <PropIcon type={p.type} size={16} />, onSelect: () => onPick(p) }));
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <FocusMenuSearch />
      <Menu items={items} onClose={onClose} search searchPlaceholder={placeholder} maxHeight={360} />
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Filter bar                                                          */
/* ------------------------------------------------------------------ */

function valueLabel(prop: Property, f: Filter, userName: string): string {
  const v = f.value;
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      return (Array.isArray(v) ? v : v ? [v] : []).map((id: string) => optionById(prop, id)?.name).filter(Boolean).join(', ');
    case 'person':
      return (Array.isArray(v) ? v : []).map((id: string) => (id === 'me' ? userName : id)).join(', ');
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return fmtDate(v);
    default:
      return v == null ? '' : String(v);
  }
}

export function filterLabel(prop: Property, f: Filter, userName: string): string {
  const def = opDef(prop.type, f.op);
  if (prop.type === 'checkbox') return `${prop.name}: ${f.op === 'checked' ? 'Checked' : 'Unchecked'}`;
  if (def.noValue) return `${prop.name}: ${def.label}`;
  if (!filterActive(prop, f)) return prop.name;
  return `${prop.name}: ${def.short ? def.short + ' ' : ''}${valueLabel(prop, f, userName)}`;
}

interface FilterBarProps {
  dbId: string;
  view: DbView;
  schema: Property[];
  editing: string | null;
  setEditing: (id: string | null) => void;
}

export function FilterBar({ dbId, view, schema, editing, setEditing }: FilterBarProps) {
  const userName = useDoc(d => d.workspace.userName, Object.is);
  const barRef = useRef<HTMLDivElement>(null);
  const [editRect, setEditRect] = useState<DOMRect | null>(null);
  const [adding, setAdding] = useState<DOMRect | null>(null);
  const [sortOpen, setSortOpen] = useState<DOMRect | null>(null);

  // Anchor the filter editor to its pill once the pill has rendered.
  useLayoutEffect(() => {
    if (!editing) {
      setEditRect(null);
      return;
    }
    const el = barRef.current?.querySelector(attrSel('data-fid', editing)) as HTMLElement | null;
    if (el) setEditRect(el.getBoundingClientRect());
  }, [editing]);

  const sorts = view.sorts.filter(s => schema.some(p => p.id === s.propId));
  const filters = view.filters.filter(f => schema.some(p => p.id === f.propId));
  const firstSort = sorts[0] && schema.find(p => p.id === sorts[0].propId);

  return (
    <div className="db-filter-bar" ref={barRef}>
      {sorts.length > 0 && (
        <>
          <span className="db-fchip on" role="button" onClick={e => setSortOpen(e.currentTarget.getBoundingClientRect())}>
            <ArrowUpDown size={14} />
            {sorts.length === 1 ? firstSort?.name : `${sorts.length} sorts`}
            <ChevronDown size={12} />
          </span>
          {filters.length > 0 && <span className="db-fbar-sep" />}
        </>
      )}
      {filters.map(f => {
        const prop = schema.find(p => p.id === f.propId)!;
        const on = filterActive(prop, f);
        return (
          <span
            key={f.id}
            data-fid={f.id}
            className={'db-fchip' + (on ? ' on' : '')}
            role="button"
            onClick={() => setEditing(f.id)}
          >
            <PropIcon type={prop.type} size={14} />
            <span className="db-fchip-text">{filterLabel(prop, f, userName)}</span>
            <ChevronDown size={12} />
          </span>
        );
      })}
      <span className="db-fchip add" role="button" onClick={e => setAdding(e.currentTarget.getBoundingClientRect())}>
        <Plus size={14} /> Add filter
      </span>
      {adding && (
        <PropPicker
          schema={schema}
          view={view}
          anchor={adding}
          placeholder="Filter by…"
          onClose={() => setAdding(null)}
          onPick={p => {
            const id = addFilter(dbId, view.id, p);
            setAdding(null);
            requestAnimationFrame(() => setEditing(id));
          }}
        />
      )}
      {editing && editRect && (
        <FilterEditor dbId={dbId} viewId={view.id} filterId={editing} anchor={editRect} onClose={() => setEditing(null)} />
      )}
      {sortOpen && <SortPopover dbId={dbId} viewId={view.id} anchor={sortOpen} onClose={() => setSortOpen(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filter editor                                                       */
/* ------------------------------------------------------------------ */

function FilterEditor({ dbId, viewId, filterId, anchor, onClose }: { dbId: string; viewId: string; filterId: string; anchor: Anchor; onClose: () => void }) {
  const db = useDoc(d => d.pages[dbId], Object.is);
  const userName = useDoc(d => d.workspace.userName, Object.is);
  const [opMenu, setOpMenu] = useState<DOMRect | null>(null);
  const [q, setQ] = useState('');
  const view = db?.views?.find(v => v.id === viewId);
  const f = view?.filters.find(x => x.id === filterId);
  const prop = f && db?.schema?.find(p => p.id === f.propId);
  if (!view || !f || !prop) return null;
  const def = opDef(prop.type, f.op);
  const patch = (p: Partial<Filter>, key?: string) =>
    patchView(dbId, viewId, v => ({ filters: v.filters.map(x => (x.id === filterId ? { ...x, ...p } : x)) }), key);
  const remove = () => {
    onClose();
    patchView(dbId, viewId, v => ({ filters: v.filters.filter(x => x.id !== filterId) }));
  };

  let body: ReactNode = null;
  if (!def.noValue) {
    if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select' || prop.type === 'person') {
      const sel: string[] = Array.isArray(f.value) ? f.value : f.value ? [f.value] : [];
      const opts = prop.type === 'person' ? [{ id: 'me', name: userName, color: 'default' as const }] : prop.options || [];
      const shown = opts.filter(o => o.name.toLowerCase().includes(q.toLowerCase()));
      body = (
        <>
          <div className="menu-search">
            <input autoFocus value={q} placeholder="Search for an option…" onChange={e => setQ(e.target.value)} onKeyDown={e => e.stopPropagation()} />
          </div>
          <div className="menu" style={{ maxHeight: 280 }}>
            {shown.length === 0 && <div className="menu-empty">No options</div>}
            {shown.map(o => (
              <div
                key={o.id}
                className="menu-item"
                onClick={() => patch({ value: sel.includes(o.id) ? sel.filter(x => x !== o.id) : [...sel, o.id] })}
              >
                <CheckboxBox on={sel.includes(o.id)} />
                {prop.type === 'person' ? (
                  <span className="db-person"><Avatar name={o.name} />{o.name}</span>
                ) : (
                  <OptionPill opt={o} status={prop.type === 'status'} />
                )}
              </div>
            ))}
          </div>
        </>
      );
    } else if (prop.type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time') {
      body = (
        <div className="db-filter-date">
          <div className="db-filter-input">
            <input className="text-input" readOnly value={fmtDate(f.value)} placeholder="Pick a date" />
          </div>
          <DatePicker value={f.value} onPick={d => patch({ value: d })} />
        </div>
      );
    } else {
      body = (
        <div className="db-filter-input">
          <input
            className="text-input"
            autoFocus
            type={prop.type === 'number' ? 'number' : 'text'}
            value={f.value ?? ''}
            placeholder="Type a value…"
            onChange={e => patch({ value: prop.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value }, 'filter:' + filterId)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') onClose();
            }}
          />
        </div>
      );
    }
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={prop.type === 'date' ? 268 : 290}>
      <FocusMenuSearch />
      <div className="db-filter-head">
        <span className="db-filter-prop">{prop.name}</span>
        <span className="db-filter-op" role="button" onClick={e => setOpMenu(e.currentTarget.getBoundingClientRect())}>
          {def.label.toLowerCase()} <ChevronDown size={12} />
        </span>
        <span className="grow" />
        <span className="icon-btn db-icon-24" role="button" title="Delete filter" onClick={remove}>
          <Trash2 size={14} />
        </span>
      </div>
      {body}
      {opMenu && (
        <Popover anchor={opMenu} onClose={() => setOpMenu(null)} width={200}>
          <Menu
            onClose={() => setOpMenu(null)}
            items={opsFor(prop.type).map(o => ({
              id: o.id,
              label: o.label,
              right: o.id === f.op ? '✓' : undefined,
              onSelect: () => patch({ op: o.id, value: o.noValue ? undefined : f.value }),
            }))}
          />
        </Popover>
      )}
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Sort popover                                                        */
/* ------------------------------------------------------------------ */

export function SortPopover({ dbId, viewId, anchor, onClose }: { dbId: string; viewId: string; anchor: Anchor; onClose: () => void }) {
  const db = useDoc(d => d.pages[dbId], Object.is);
  const [pick, setPick] = useState<{ rect: DOMRect; sortId?: string } | null>(null);
  const [dirMenu, setDirMenu] = useState<{ rect: DOMRect; sortId: string } | null>(null);
  const view = db?.views?.find(v => v.id === viewId);
  if (!db || !view) return null;
  const schema = db.schema || [];
  const sorts = view.sorts.filter(s => schema.some(p => p.id === s.propId));
  const patchSort = (id: string, p: Partial<Sort>) => patchView(dbId, viewId, v => ({ sorts: v.sorts.map(s => (s.id === id ? { ...s, ...p } : s)) }));

  return (
    <Popover anchor={anchor} onClose={onClose} width={340}>
      <div className="db-sort-list">
        {sorts.length === 0 && <div className="menu-empty">No sorts applied to this view</div>}
        {sorts.map(s => {
          const prop = schema.find(p => p.id === s.propId)!;
          return (
            <div key={s.id} className="db-sort-row">
              <GripVertical size={14} className="db-sort-grip" />
              <span className="db-select-btn grow" role="button" onClick={e => setPick({ rect: e.currentTarget.getBoundingClientRect(), sortId: s.id })}>
                <PropIcon type={prop.type} size={14} />
                <span className="db-select-btn-text">{prop.name}</span>
                <ChevronDown size={12} />
              </span>
              <span className="db-select-btn" role="button" onClick={e => setDirMenu({ rect: e.currentTarget.getBoundingClientRect(), sortId: s.id })}>
                {s.dir === 'asc' ? 'Ascending' : 'Descending'}
                <ChevronDown size={12} />
              </span>
              <span
                className="icon-btn db-icon-24"
                role="button"
                title="Remove sort"
                onClick={() => patchView(dbId, viewId, v => ({ sorts: v.sorts.filter(x => x.id !== s.id) }))}
              >
                <X size={14} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="menu" style={{ paddingTop: 0 }}>
        <div className="menu-item db-muted-item" onClick={e => setPick({ rect: e.currentTarget.getBoundingClientRect() })}>
          <span className="mi-icon"><Plus size={16} /></span>
          <span className="mi-text">Add sort</span>
        </div>
        {sorts.length > 0 && (
          <div
            className="menu-item db-muted-item"
            onClick={() => {
              patchView(dbId, viewId, () => ({ sorts: [] }));
              onClose();
            }}
          >
            <span className="mi-icon"><Trash2 size={16} /></span>
            <span className="mi-text">Delete sort</span>
          </div>
        )}
      </div>
      {pick && (
        <PropPicker
          schema={schema}
          view={view}
          anchor={pick.rect}
          placeholder="Sort by…"
          exclude={sorts.filter(s => s.id !== pick.sortId).map(s => s.propId)}
          onClose={() => setPick(null)}
          onPick={p => {
            if (pick.sortId) patchSort(pick.sortId, { propId: p.id });
            else addSort(dbId, viewId, p.id);
            setPick(null);
          }}
        />
      )}
      {dirMenu && (
        <Popover anchor={dirMenu.rect} onClose={() => setDirMenu(null)} width={180}>
          <Menu
            onClose={() => setDirMenu(null)}
            items={[
              { id: 'asc', label: 'Ascending', icon: <ArrowUp size={16} />, onSelect: () => patchSort(dirMenu.sortId, { dir: 'asc' }) },
              { id: 'desc', label: 'Descending', icon: <ArrowDown size={16} />, onSelect: () => patchSort(dirMenu.sortId, { dir: 'desc' }) },
            ]}
          />
        </Popover>
      )}
    </Popover>
  );
}

/** Values that a new row should get so it stays visible under the current filters. */
export function filterDefaults(view: DbView, schema: Property[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of view.filters) {
    const prop = schema.find(p => p.id === f.propId);
    if (!prop || !filterActive(prop, f)) continue;
    const vals = Array.isArray(f.value) ? f.value : [f.value];
    if ((prop.type === 'select' || prop.type === 'status') && f.op === 'is' && vals.length === 1) out[prop.id] = vals[0];
    if ((prop.type === 'multi_select' || prop.type === 'person') && f.op === 'contains' && vals.length) out[prop.id] = [vals[0]];
    if (prop.type === 'checkbox') out[prop.id] = f.op === 'checked';
    if (prop.type === 'date' && f.op === 'is' && f.value) out[prop.id] = { start: f.value };
  }
  return out;
}

