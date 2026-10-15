import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Maximize2, Plus } from 'lucide-react';
import { usePage, useDoc } from '../store/store';
import { openPage, setRowProp } from '../store/actions';
import type { Page } from '../store/types';
import { Tooltip } from '../components/ui';
import { applyView, rawValue, readPref, writePref, isEmptyValue } from './logic';
import { addRowAt, setDbTitle } from './dbActions';
import { PropIcon, PropValue, CellEditor, isEditable } from './cells';
import { PropertyMenu, AddPropertyMenu } from './menus';
import { FilterBar, addFilter, filterDefaults } from './filters';
import { ViewBar } from './toolbar';
import { TableView } from './table';
import { BoardView } from './board';
import { ListView } from './list';
import { GalleryView } from './gallery';
import { CalendarView } from './calendar';
import { TimelineView } from './timeline';
import type { ViewProps } from './shared';

/** Non-trashed row pages of a database, in stored order. */
function useRows(dbId: string): Page[] {
  return useDoc(d => {
    const out: Page[] = [];
    for (const id of d.pages[dbId]?.rows || []) {
      const p = d.pages[id];
      if (p && !p.trashed) out.push(p);
    }
    return out;
  });
}

function DbShell({ dbId, inline, prefKey, isLink }: { dbId: string; inline: boolean; prefKey: string; isLink?: boolean }) {
  const db = usePage(dbId);
  const allRows = useRows(dbId);
  const [viewId, setViewIdState] = useState<string | null>(() => readPref('on:dbview:' + prefKey));
  const [query, setQuery] = useState('');
  const [barOpen, setBarOpen] = useState(true);
  const [filterEdit, setFilterEdit] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  if (!db || db.trashed || !db.isDatabase) {
    return (
      <div className={'db db-missing' + (inline ? ' db-inline' : '')}>
        {db?.trashed ? 'This database is in the Trash.' : 'This database no longer exists.'}
      </div>
    );
  }
  const views = db.views || [];
  const view = views.find(v => v.id === viewId) || views[0];
  const schema = db.schema || [];
  if (!view) return <div className="db db-missing">This database has no views.</div>;

  const setViewId = (id: string) => {
    setViewIdState(id);
    writePref('on:dbview:' + prefKey, id);
  };
  const rows = applyView(allRows, schema, view, query);
  const defaults = filterDefaults(view, schema);
  const startFilter = (propId: string) => {
    const prop = schema.find(p => p.id === propId);
    if (!prop) return;
    const id = addFilter(dbId, view.id, prop);
    setBarOpen(true);
    setFilterEdit(id);
  };
  const onNew = () => {
    const id = addRowAt(dbId, { ...defaults });
    openPage(id, { peek: true });
  };

  const vp: ViewProps = { dbId, db, view, rows, schema, inline, defaults, startFilter, editingTitle, setEditingTitle };
  const showBar = barOpen && (view.filters.length > 0 || view.sorts.length > 0);

  return (
    <div className={'db ' + (inline ? 'db-inline' : 'db-full')} data-db={dbId}>
      {inline && <DbHeader db={db} isLink={isLink} />}
      <ViewBar
        dbId={dbId}
        db={db}
        view={view}
        setViewId={setViewId}
        query={query}
        setQuery={setQuery}
        onNew={onNew}
        startFilter={startFilter}
        barOpen={barOpen}
        setBarOpen={setBarOpen}
      />
      {showBar && <FilterBar dbId={dbId} view={view} schema={schema} editing={filterEdit} setEditing={setFilterEdit} />}
      <div className={'db-body db-body-' + view.type}>
        {view.type === 'table' && <TableView {...vp} />}
        {view.type === 'board' && <BoardView {...vp} />}
        {view.type === 'list' && <ListView {...vp} />}
        {view.type === 'gallery' && <GalleryView {...vp} />}
        {view.type === 'calendar' && <CalendarView {...vp} />}
        {view.type === 'timeline' && <TimelineView {...vp} />}
      </div>
    </div>
  );
}

function DbHeader({ db, isLink }: { db: Page; isLink?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== db.title) el.textContent = db.title;
  }, [db.title]);
  const icon = db.icon;
  return (
    <div className="db-header">
      {isLink && <ArrowUpRight size={16} className="db-link-arrow" />}
      {icon && (
        <span className="db-header-icon">
          {icon.startsWith('data:') || icon.startsWith('http') ? <img src={icon} alt="" /> : icon}
        </span>
      )}
      <div
        ref={ref}
        className="db-title"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder="Untitled"
        onInput={e => setDbTitle(db.id, (e.currentTarget.textContent || '').replace(/\n/g, ' '))}
        onPaste={e => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n/g, ' '));
        }}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <Tooltip label="Open as full page">
        <span className="icon-btn db-open-full" role="button" onClick={() => openPage(db.id)}>
          <Maximize2 size={14} />
        </span>
      </Tooltip>
    </div>
  );
}

export function InlineDatabase({ dbId, blockId, isLink }: { dbId: string; blockId: string; isLink?: boolean }) {
  return <DbShell dbId={dbId} inline prefKey={blockId} isLink={isLink} />;
}

export function DatabaseFull({ dbId }: { dbId: string }) {
  return <DbShell dbId={dbId} inline={false} prefKey={dbId} />;
}

/* ------------------------------------------------------------------ */
/* Row page property list                                              */
/* ------------------------------------------------------------------ */

export function PageProperties({ pageId }: { pageId: string }) {
  const page = usePage(pageId);
  const db = usePage(page?.dbId);
  const [menu, setMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [editor, setEditor] = useState<{ propId: string; rect: DOMRect } | null>(null);
  const [adding, setAdding] = useState<DOMRect | null>(null);
  if (!page || !db) return null;
  const props = (db.schema || []).filter(p => p.type !== 'title');
  const editorProp = editor ? props.find(p => p.id === editor.propId) : undefined;
  return (
    <div className="page-props">
      {props.map(p => {
        const empty = p.type !== 'checkbox' && isEmptyValue(page, p);
        const readOnly = p.type === 'created_time' || p.type === 'last_edited_time';
        return (
          <div className="pp-row" key={p.id}>
            <div className="pp-name" role="button" onClick={e => setMenu({ id: p.id, rect: e.currentTarget.getBoundingClientRect() })}>
              <span className="pp-icon"><PropIcon type={p.type} size={16} /></span>
              <span className="pp-label">{p.name}</span>
            </div>
            <div
              className={'pp-value' + (readOnly ? ' readonly' : '') + (editor?.propId === p.id ? ' editing' : '')}
              onClick={e => {
                if (p.type === 'checkbox') setRowProp(page.id, p.id, !rawValue(page, p));
                else if (isEditable(p.type)) setEditor({ propId: p.id, rect: e.currentTarget.getBoundingClientRect() });
              }}
            >
              {empty ? <span className="pp-empty">Empty</span> : <PropValue row={page} prop={p} mode="props" />}
            </div>
          </div>
        );
      })}
      <div className="pp-add" role="button" onClick={e => setAdding(e.currentTarget.getBoundingClientRect())}>
        <Plus size={16} /> Add a property
      </div>
      <div className="pp-divider" />
      {menu && <PropertyMenu dbId={db.id} propId={menu.id} anchor={menu.rect} onClose={() => setMenu(null)} />}
      {editor && editorProp && <CellEditor dbId={db.id} rowId={page.id} prop={editorProp} rect={editor.rect} onClose={() => setEditor(null)} />}
      {adding && <AddPropertyMenu dbId={db.id} anchor={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

