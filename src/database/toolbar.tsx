import { useEffect, useRef, useState } from 'react';
import {
  Table2, SquareKanban, List, LayoutGrid, CalendarDays, Plus, ListFilter, ArrowUpDown, Search, Ellipsis, ChevronDown, FileText,
  Copy, Trash2, Eye, SquareChartGantt, Group, Image as ImageIcon, WrapText, LayoutTemplate, Calendar, Check, Pencil,
} from 'lucide-react';
import { transact, useDoc } from '../store/store';
import { addView, deleteView, updateView, uid, defaultStatusOptions } from '../store/actions';
import type { DbView, Page, Property, ViewType } from '../store/types';
import { Popover, Menu, Switch, Tooltip, type MenuItemDef, pressable } from '../components/ui';
import { PropIcon } from './cells';
import { orderedProps } from './logic';
import { duplicateView, togglePropHidden, setAllHidden } from './dbActions';
import { FocusMenuSearch } from './focus';
import { PropPicker, SortPopover, addSort, patchView } from './filters';

export function ViewIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const p = { size, strokeWidth: 1.75 };
  if (type === 'board') return <SquareKanban {...p} />;
  if (type === 'list') return <List {...p} />;
  if (type === 'gallery') return <LayoutGrid {...p} />;
  if (type === 'calendar') return <CalendarDays {...p} />;
  if (type === 'timeline') return <SquareChartGantt {...p} />;
  return <Table2 {...p} />;
}

const VIEW_TYPES: { type: ViewType; label: string }[] = [
  { type: 'table', label: 'Table' },
  { type: 'board', label: 'Board' },
  { type: 'gallery', label: 'Gallery' },
  { type: 'list', label: 'List' },
  { type: 'calendar', label: 'Calendar' },
  { type: 'timeline', label: 'Timeline' },
];

/** Switches a view's layout, creating a group/date property when the layout needs one. */
export function switchLayout(dbId: string, viewId: string, type: ViewType) {
  transact(tx => {
    const db = tx.pages[dbId];
    let schema = db.schema || [];
    const patch: Partial<DbView> = { type };
    const v = (db.views || []).find(x => x.id === viewId);
    if (!v) return;
    if (type === 'board') {
      const ok = schema.find(p => p.id === v.groupBy && (p.type === 'status' || p.type === 'select'));
      let g = ok || schema.find(p => p.type === 'status') || schema.find(p => p.type === 'select');
      if (!g) {
        g = { id: uid(), name: 'Status', type: 'status', options: defaultStatusOptions() };
        schema = [...schema, g];
      }
      patch.groupBy = g.id;
    }
    if (type === 'calendar' || type === 'timeline') {
      let dp = schema.find(p => p.id === v.dateProp && p.type === 'date') || schema.find(p => p.type === 'date');
      if (!dp) {
        dp = { id: uid(), name: 'Date', type: 'date' };
        schema = [...schema, dp];
      }
      patch.dateProp = dp.id;
    }
    if (type === 'gallery' && !v.cardPreview) patch.cardPreview = 'content';
    tx.setPage(dbId, { schema, views: (db.views || []).map(x => (x.id === viewId ? { ...x, ...patch } : x)) });
  });
}

/* ------------------------------------------------------------------ */
/* View bar                                                            */
/* ------------------------------------------------------------------ */

interface ViewBarProps {
  dbId: string;
  db: Page;
  view: DbView;
  setViewId: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  onNew: () => void;
  startFilter: (propId: string) => void;
  barOpen: boolean;
  setBarOpen: (b: boolean) => void;
}

export function ViewBar({ dbId, db, view, setViewId, query, setQuery, onNew, startFilter, barOpen, setBarOpen }: ViewBarProps) {
  const views = db.views || [];
  const schema = db.schema || [];
  const [addMenu, setAddMenu] = useState<DOMRect | null>(null);
  const [tabMenu, setTabMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [filterPick, setFilterPick] = useState<DOMRect | null>(null);
  const [sortPick, setSortPick] = useState<DOMRect | null>(null);
  const [sortOpen, setSortOpen] = useState<DOMRect | null>(null);
  const [options, setOptions] = useState<DOMRect | null>(null);
  const [newMenu, setNewMenu] = useState<DOMRect | null>(null);
  const [searchOpen, setSearchOpen] = useState(!!query);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionsBtn = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const hasFilters = view.filters.length > 0;
  const hasSorts = view.sorts.length > 0;

  return (
    <div className="db-viewbar">
      <div className="db-tabs" role="tablist" aria-label="Views">
        {views.map(v => (
          <div
            key={v.id}
            className={'db-tab' + (v.id === view.id ? ' on' : '')}
            {...pressable(undefined, 'tab')}
            aria-selected={v.id === view.id}
            onClick={e => {
              if (v.id === view.id) setTabMenu({ id: v.id, rect: e.currentTarget.getBoundingClientRect() });
              else setViewId(v.id);
            }}
            onDoubleClick={e => setTabMenu({ id: v.id, rect: e.currentTarget.getBoundingClientRect() })}
            onContextMenu={e => {
              e.preventDefault();
              e.stopPropagation();
              setTabMenu({ id: v.id, rect: e.currentTarget.getBoundingClientRect() });
            }}
          >
            <ViewIcon type={v.type} />
            <span className="db-tab-name">{v.name || 'Untitled'}</span>
          </div>
        ))}
        <Tooltip label="Add a new view">
          <span className="icon-btn db-icon-24" {...pressable()} onClick={e => setAddMenu(e.currentTarget.getBoundingClientRect())}>
            <Plus size={16} />
          </span>
        </Tooltip>
      </div>
      <div className="db-tools">
        <Tooltip label="Filter">
          <span
            className={'icon-btn db-tool' + (hasFilters ? ' on' : '')}
            {...pressable()}
            onClick={e => {
              if (hasFilters) setBarOpen(!barOpen);
              else setFilterPick(e.currentTarget.getBoundingClientRect());
            }}
          >
            <ListFilter size={16} />
          </span>
        </Tooltip>
        <Tooltip label="Sort">
          <span
            className={'icon-btn db-tool' + (hasSorts ? ' on' : '')}
            {...pressable()}
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect();
              if (hasSorts) setSortOpen(r);
              else setSortPick(r);
            }}
          >
            <ArrowUpDown size={16} />
          </span>
        </Tooltip>
        <div className={'db-search' + (searchOpen ? ' open' : '')}>
          <Tooltip label="Search">
            <span className="icon-btn db-tool" {...pressable()} onClick={() => (searchOpen ? searchRef.current?.focus() : setSearchOpen(true))}>
              <Search size={16} />
            </span>
          </Tooltip>
          {searchOpen && (
            <input
              ref={searchRef}
              value={query}
              placeholder="Type to search…"
              onChange={e => setQuery(e.target.value)}
              onBlur={() => !query && setSearchOpen(false)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setQuery('');
                  setSearchOpen(false);
                }
              }}
            />
          )}
        </div>
        <Tooltip label="View settings">
          <span ref={optionsBtn} className="icon-btn db-tool" {...pressable()} onClick={e => setOptions(e.currentTarget.getBoundingClientRect())}>
            <Ellipsis size={16} />
          </span>
        </Tooltip>
        <div className="db-new">
          <span className="db-new-main" {...pressable()} onClick={onNew}>
            New
          </span>
          <span className="db-new-chev" {...pressable()} aria-label="New item options" aria-haspopup="menu" onClick={e => setNewMenu((e.currentTarget.parentElement as HTMLElement).getBoundingClientRect())}>
            <ChevronDown size={14} strokeWidth={2} />
          </span>
        </div>
      </div>

      {addMenu && (
        <Popover anchor={addMenu} onClose={() => setAddMenu(null)} width={220}>
          <div className="menu-label" style={{ paddingTop: 10 }}>Add a new view</div>
          <Menu
            onClose={() => setAddMenu(null)}
            items={VIEW_TYPES.map(t => ({
              id: t.type,
              label: t.label,
              icon: <ViewIcon type={t.type} size={16} />,
              onSelect: () => setViewId(addView(dbId, t.type)),
            }))}
          />
        </Popover>
      )}
      {tabMenu && (
        <TabMenu
          dbId={dbId}
          view={views.find(v => v.id === tabMenu.id) || view}
          canDelete={views.length > 1}
          rect={tabMenu.rect}
          onClose={() => setTabMenu(null)}
          onEdit={() => setOptions(optionsBtn.current?.getBoundingClientRect() || tabMenu.rect)}
          onDeleted={() => {
            const rest = views.filter(v => v.id !== tabMenu.id);
            if (rest[0]) setViewId(rest[0].id);
          }}
          onDuplicated={id => setViewId(id)}
        />
      )}
      {filterPick && (
        <PropPicker
          schema={schema}
          view={view}
          anchor={filterPick}
          placeholder="Filter by…"
          onClose={() => setFilterPick(null)}
          onPick={p => {
            setFilterPick(null);
            startFilter(p.id);
          }}
        />
      )}
      {sortPick && (
        <PropPicker
          schema={schema}
          view={view}
          anchor={sortPick}
          placeholder="Sort by…"
          onClose={() => setSortPick(null)}
          onPick={p => {
            addSort(dbId, view.id, p.id);
            setSortOpen(sortPick);
            setSortPick(null);
          }}
        />
      )}
      {sortOpen && <SortPopover dbId={dbId} viewId={view.id} anchor={sortOpen} onClose={() => setSortOpen(null)} />}
      {options && (
        <ViewOptions
          dbId={dbId}
          db={db}
          view={view}
          rect={options}
          onClose={() => setOptions(null)}
          onFilter={() => setFilterPick(options)}
          onSort={() => (hasSorts ? setSortOpen(options) : setSortPick(options))}
          onDeleted={() => {
            const rest = views.filter(v => v.id !== view.id);
            if (rest[0]) setViewId(rest[0].id);
          }}
          onDuplicated={id => setViewId(id)}
        />
      )}
      {newMenu && (
        <Popover anchor={newMenu} placement="bottom-end" onClose={() => setNewMenu(null)} width={200}>
          <Menu onClose={() => setNewMenu(null)} items={[{ id: 'new', label: 'New page', icon: <FileText size={16} />, onSelect: onNew }]} />
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab menu                                                            */
/* ------------------------------------------------------------------ */

function TabMenu({
  dbId, view, canDelete, rect, onClose, onEdit, onDeleted, onDuplicated,
}: {
  dbId: string; view: DbView; canDelete: boolean; rect: DOMRect; onClose: () => void; onEdit: () => void; onDeleted: () => void; onDuplicated: (id: string) => void;
}) {
  const [name, setName] = useState(view.name);
  return (
    <Popover anchor={rect} onClose={onClose} width={240}>
      <FocusMenuSearch />
      <Menu
        onClose={onClose}
        header={
          <div className="db-prop-rename">
            <span className="db-prop-rename-icon"><ViewIcon type={view.type} size={16} /></span>
            <input
              className="text-input"
              autoFocus
              value={name}
              onChange={e => {
                setName(e.target.value);
                patchView(dbId, view.id, () => ({ name: e.target.value }), 'view-name:' + view.id);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key.startsWith('Arrow')) {
                  e.stopPropagation();
                  if (e.key === 'Enter') onClose();
                }
              }}
            />
          </div>
        }
        items={[
          { id: 'edit', label: 'Edit view', icon: <Pencil size={16} />, separatorBefore: true, onSelect: onEdit },
          { id: 'dup', label: 'Duplicate view', icon: <Copy size={16} />, onSelect: () => onDuplicated(duplicateView(dbId, view.id)) },
          {
            id: 'del', label: 'Delete view', icon: <Trash2 size={16} />, danger: true, disabled: !canDelete,
            onSelect: () => {
              onDeleted();
              deleteView(dbId, view.id);
            },
          },
        ]}
      />
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* View options                                                        */
/* ------------------------------------------------------------------ */

function ViewOptions({
  dbId, db, view, rect, onClose, onFilter, onSort, onDeleted, onDuplicated,
}: {
  dbId: string; db: Page; view: DbView; rect: DOMRect; onClose: () => void; onFilter: () => void; onSort: () => void; onDeleted: () => void; onDuplicated: (id: string) => void;
}) {
  const schema = db.schema || [];
  const props = orderedProps(schema, view).filter(p => p.type !== 'title');
  const visibleCount = props.filter(p => !view.hidden.includes(p.id)).length;
  const label = (t: ViewType) => VIEW_TYPES.find(x => x.type === t)!.label;

  const pickList = (list: Property[], current: string | undefined, onPick: (id: string) => void, empty: string) => () => (
    <div style={{ width: 240 }}>
      <Menu
        onClose={onClose}
        items={
          list.length
            ? list.map(p => ({
                id: p.id,
                label: p.name,
                icon: <PropIcon type={p.type} size={16} />,
                right: p.id === current ? <Check size={14} /> : undefined,
                onSelect: () => onPick(p.id),
              }))
            : [{ id: 'none', label: empty, disabled: true }]
        }
      />
    </div>
  );

  const items: MenuItemDef[] = [
    {
      id: 'layout', label: 'Layout', icon: <LayoutTemplate size={16} />, right: label(view.type),
      submenu: () => (
        <div style={{ width: 220 }}>
          <Menu
            onClose={onClose}
            items={VIEW_TYPES.map(t => ({
              id: t.type, label: t.label, icon: <ViewIcon type={t.type} size={16} />,
              right: t.type === view.type ? <Check size={14} /> : undefined,
              onSelect: () => switchLayout(dbId, view.id, t.type),
            }))}
          />
        </div>
      ),
    },
    {
      id: 'props', label: 'Properties', icon: <Eye size={16} />, right: `${visibleCount} shown`,
      submenu: () => <PropertyToggles dbId={dbId} viewId={view.id} />,
    },
    { id: 'filter', label: 'Filter', icon: <ListFilter size={16} />, right: view.filters.length ? `${view.filters.length}` : undefined, onSelect: onFilter },
    { id: 'sort', label: 'Sort', icon: <ArrowUpDown size={16} />, right: view.sorts.length ? `${view.sorts.length}` : undefined, onSelect: onSort },
  ];
  if (view.type === 'board') {
    const groupable = schema.filter(p => p.type === 'status' || p.type === 'select' || p.type === 'multi_select');
    items.push({
      id: 'group', label: 'Group', icon: <Group size={16} />, right: schema.find(p => p.id === view.groupBy)?.name || 'None',
      submenu: pickList(groupable, view.groupBy, id => updateView(dbId, view.id, { groupBy: id }), 'No select or status properties'),
    });
  }
  if (view.type === 'calendar' || view.type === 'timeline') {
    items.push({
      id: 'calby', label: view.type === 'timeline' ? 'Timeline by' : 'Calendar by', icon: <Calendar size={16} />, right: schema.find(p => p.id === view.dateProp)?.name || 'None',
      submenu: pickList(schema.filter(p => p.type === 'date'), view.dateProp, id => updateView(dbId, view.id, { dateProp: id }), 'No date properties'),
    });
  }
  if (view.type === 'gallery') {
    const cp = view.cardPreview || 'none';
    const names = { none: 'None', cover: 'Page cover', content: 'Page content' } as const;
    items.push({
      id: 'preview', label: 'Card preview', icon: <ImageIcon size={16} />, right: names[cp],
      submenu: () => (
        <div style={{ width: 200 }}>
          <Menu
            onClose={onClose}
            items={(['none', 'cover', 'content'] as const).map(k => ({
              id: k, label: names[k], right: k === cp ? <Check size={14} /> : undefined,
              onSelect: () => updateView(dbId, view.id, { cardPreview: k }),
            }))}
          />
        </div>
      ),
    });
  }
  if (view.type === 'table') {
    items.push({
      id: 'wrap', label: 'Wrap all columns', icon: <WrapText size={16} />, keepOpen: true,
      right: <Switch on={!!view.wrapCells} />, onSelect: () => updateView(dbId, view.id, { wrapCells: !view.wrapCells }),
    });
  }
  items.push({ id: 'dup', label: 'Duplicate view', icon: <Copy size={16} />, separatorBefore: true, onSelect: () => onDuplicated(duplicateView(dbId, view.id)) });
  items.push({
    id: 'del', label: 'Delete view', icon: <Trash2 size={16} />, danger: true, disabled: (db.views || []).length < 2,
    onSelect: () => {
      onDeleted();
      deleteView(dbId, view.id);
    },
  });

  return (
    <Popover anchor={rect} placement="bottom-end" onClose={onClose} width={290}>
      <div className="db-options-head">
        <span>View settings</span>
      </div>
      <Menu items={items} onClose={onClose} />
    </Popover>
  );
}

function PropertyToggles({ dbId, viewId }: { dbId: string; viewId: string }) {
  const db = useDoc(d => d.pages[dbId], Object.is);
  const view = db?.views?.find(v => v.id === viewId);
  if (!db || !view) return null;
  const props = orderedProps(db.schema || [], view);
  const allShown = props.every(p => p.type === 'title' || !view.hidden.includes(p.id));
  return (
    <div className="db-prop-toggles">
      <div className="menu-label">
        <span>Shown in {view.type}</span>
        <span className="db-link-btn" {...pressable()} onClick={() => setAllHidden(dbId, viewId, allShown)}>
          {allShown ? 'Hide all' : 'Show all'}
        </span>
      </div>
      <div className="menu" style={{ maxHeight: 360 }}>
        {props.map(p => {
          const on = p.type === 'title' || !view.hidden.includes(p.id);
          return (
            <div {...pressable()}
              key={p.id}
              className={'menu-item' + (p.type === 'title' ? ' disabled' : '')}
              onClick={() => p.type !== 'title' && togglePropHidden(dbId, viewId, p.id, on)}
            >
              <span className="mi-icon"><PropIcon type={p.type} size={16} /></span>
              <span className="mi-text">{p.name}</span>
              <span className="mi-right">
                <Switch on={on} onChange={() => p.type !== 'title' && togglePropHidden(dbId, viewId, p.id, on)} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
