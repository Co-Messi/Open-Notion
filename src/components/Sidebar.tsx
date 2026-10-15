import { useEffect, useRef, useState } from 'react';
import {
  House, MessageCircle, CalendarDays, SquarePen, Library, ChevronRight, ChevronDown, Plus, MoreHorizontal,
  Settings, Trash2, SlidersHorizontal, LayoutTemplate, CircleHelp, Grid2x2, ChevronsLeft, CalendarPlus, Users,
  LogOut, UserPlus, Check,
} from 'lucide-react';
import { getDoc, setSettings, setUi, useDoc, useSettings, useUi, getUi } from '../store/store';
import { childPagesOf, createPage, openPage, pageTitle, updatePage, movePage, goHome, isTrashedDeep } from '../store/actions';
import { PageIconView } from './PageIcon';
import { SidebarPageMenu } from './PageMenus';
import { Popover, Menu, SearchIcon, Tooltip, MOD, type Anchor } from './ui';

const OPEN_KEY = 'on:sb-open';
function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}');
  } catch {
    return {};
  }
}
let openState: Record<string, boolean> = loadOpen();
const openListeners = new Set<() => void>();
function setOpen(id: string, v: boolean) {
  openState = { ...openState, [id]: v };
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(openState));
  } catch {
    /* ignore */
  }
  openListeners.forEach(l => l());
}
function useOpen(id: string): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(x => x + 1);
    openListeners.add(l);
    return () => {
      openListeners.delete(l);
    };
  }, []);
  return !!openState[id];
}
export function expandSidebarTo(pageId: string) {
  const d = getDoc();
  let p = d.pages[pageId];
  let guard = 0;
  while (p && guard++ < 50) {
    const parent = p.dbId || p.parentId;
    if (!parent) break;
    if (!openState[parent]) setOpen(parent, true);
    p = d.pages[parent];
  }
}

/* ------------------------------------------------------------------ */
/* Drag and drop of pages inside the sidebar                           */
/* ------------------------------------------------------------------ */

interface DragState {
  pageId: string;
  target: { kind: 'into'; pageId: string } | { kind: 'between'; section: string; parentId: string | null; index: number; y: number } | null;
}
let drag: DragState | null = null;
const dragListeners = new Set<() => void>();
function setDrag(d: DragState | null) {
  drag = d;
  dragListeners.forEach(l => l());
}
function useDrag() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(x => x + 1);
    dragListeners.add(l);
    return () => {
      dragListeners.delete(l);
    };
  }, []);
  return drag;
}

/* ------------------------------------------------------------------ */
/* Page tree                                                           */
/* ------------------------------------------------------------------ */

function PageRow({ pageId, depth, section, parentId, index }: { pageId: string; depth: number; section: string; parentId: string | null; index: number }) {
  const page = useDoc(d => d.pages[pageId], Object.is);
  const children = useDoc(d => childPagesOf(d, pageId));
  const activeId = useUi(u => (u.route.name === 'page' ? u.route.pageId : null));
  const open = useOpen(pageId);
  const dragInfo = useDrag();
  const [menu, setMenu] = useState<Anchor>(null);
  const [renaming, setRenaming] = useState<Anchor>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  if (!page || page.trashed) return null;
  const isActive = activeId === pageId;
  const dropInto = dragInfo?.target?.kind === 'into' && dragInfo.target.pageId === pageId;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.sb-actions, .sb-caret')) return;
    const startY = e.clientY;
    const startX = e.clientX;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      started = true;
      document.body.style.cursor = 'grabbing';
      // Find row under pointer
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-sb-page]') as HTMLElement | null;
      if (!el) {
        setDrag({ pageId, target: null });
        return;
      }
      const tid = el.dataset.sbPage!;
      const r = el.getBoundingClientRect();
      const rel = (ev.clientY - r.top) / r.height;
      if (tid !== pageId && rel > 0.25 && rel < 0.75 && !getDoc().pages[tid]?.isDatabase) {
        setDrag({ pageId, target: { kind: 'into', pageId: tid } });
      } else {
        const sec = el.dataset.sbSection!;
        const par = el.dataset.sbParent || null;
        const idx = Number(el.dataset.sbIndex) + (rel >= 0.5 ? 1 : 0);
        setDrag({ pageId, target: { kind: 'between', section: sec, parentId: par, index: idx, y: rel >= 0.5 ? r.bottom : r.top } });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      const t = drag?.target;
      setDrag(null);
      if (!started) return;
      if (!t) return;
      if (t.kind === 'into') {
        movePage(pageId, { pageId: t.pageId });
        setOpen(t.pageId, true);
      } else if (t.parentId) {
        movePage(pageId, { pageId: t.parentId, index: t.index });
      } else {
        movePage(pageId, { section: t.section, index: t.index });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <div
        ref={rowRef}
        className={'sb-row' + (isActive ? ' active' : '') + (menu ? ' menu-open' : '') + (dropInto ? ' drop-into' : '')}
        style={{ paddingLeft: 8 + depth * 12 }}
        data-sb-page={pageId}
        data-sb-section={section}
        data-sb-parent={parentId || ''}
        data-sb-index={index}
        onPointerDown={onPointerDown}
        onClick={e => {
          if (drag) return;
          openPage(pageId, { peek: e.altKey });
        }}
        onContextMenu={e => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="sb-icon">
          <PageIconView page={page} size={18} />
          <div
            className={'sb-caret' + (open ? ' open' : '')}
            role="button"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={e => {
              e.stopPropagation();
              setOpen(pageId, !open);
            }}
          >
            <ChevronRight size={14} strokeWidth={2} />
          </div>
        </div>
        <div className="sb-label">{pageTitle(page)}</div>
        <div className="sb-actions">
          <Tooltip label="Delete, duplicate, and more…">
            <div
              className="icon-btn"
              role="button"
              onClick={e => {
                e.stopPropagation();
                setMenu((e.currentTarget as HTMLElement).getBoundingClientRect());
              }}
            >
              <MoreHorizontal size={15} />
            </div>
          </Tooltip>
          {!page.isDatabase && (
            <Tooltip label="Add a page inside">
              <div
                className="icon-btn"
                role="button"
                onClick={e => {
                  e.stopPropagation();
                  const id = createPage({ parentId: pageId });
                  setOpen(pageId, true);
                  openPage(id);
                }}
              >
                <Plus size={16} />
              </div>
            </Tooltip>
          )}
        </div>
      </div>
      {open && (
        <>
          {children.length === 0 ? (
            <div className="sb-empty" style={{ paddingLeft: 46 + depth * 12 }}>
              No pages inside
            </div>
          ) : (
            children.map((c, i) => <PageRow key={c} pageId={c} depth={depth + 1} section={section} parentId={pageId} index={i} />)
          )}
        </>
      )}
      {menu && (
        <SidebarPageMenu
          pageId={pageId}
          anchor={menu}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(rowRef.current?.getBoundingClientRect() || null)}
        />
      )}
      {renaming && <RenamePopover pageId={pageId} anchor={renaming} onClose={() => setRenaming(null)} />}
    </>
  );
}

export function RenamePopover({ pageId, anchor, onClose }: { pageId: string; anchor: Anchor; onClose: () => void }) {
  const page = getDoc().pages[pageId];
  const [v, setV] = useState(page?.title || '');
  return (
    <Popover anchor={anchor} onClose={onClose} width={360} placement="bottom-start">
      <div style={{ display: 'flex', gap: 6, padding: 6, alignItems: 'center' }}>
        <div className="icon-btn" style={{ width: 28, height: 28, boxShadow: 'inset 0 0 0 1px var(--border-translucent)' }}>
          <PageIconView page={page} size={18} />
        </div>
        <input
          className="text-input"
          autoFocus
          value={v}
          onFocus={e => e.currentTarget.select()}
          onChange={e => {
            setV(e.target.value);
            updatePage(pageId, { title: e.target.value }, 'rename:' + pageId);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') onClose();
          }}
        />
      </div>
    </Popover>
  );
}

function DropLine() {
  const d = useDrag();
  if (!d?.target || d.target.kind !== 'between') return null;
  const sb = document.querySelector('.sidebar')?.getBoundingClientRect();
  if (!sb) return null;
  return <div className="sb-drop-line" style={{ top: d.target.y - sb.top - 1 }} />;
}

function Section({
  id, title, pages, onAdd, emptyText, children,
}: { id: string; title: string; pages: string[]; onAdd?: () => void; emptyText?: string; children?: React.ReactNode }) {
  const collapsedKey = 'section:' + id;
  const collapsed = useOpen(collapsedKey);
  return (
    <div className="sb-section">
      <div className="sb-section-header" onClick={() => setOpen(collapsedKey, !collapsed)}>
        <span className="grow">
          {title}
          <span className="chev">{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
        </span>
        {onAdd && (
          <span className="sb-actions">
            <Tooltip label="Add a page">
              <span
                className="icon-btn"
                onClick={e => {
                  e.stopPropagation();
                  onAdd();
                }}
              >
                <Plus size={16} />
              </span>
            </Tooltip>
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="sb-group">
          {children}
          {pages.map((p, i) => (
            <PageRow key={p} pageId={p} depth={0} section={id} parentId={null} index={i} />
          ))}
          {pages.length === 0 && emptyText && <div className="sb-empty" style={{ paddingLeft: 46 }}>{emptyText}</div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

export function Sidebar() {
  const width = useSettings(s => s.sidebarWidth);
  const sbOpen = useSettings(s => s.sidebarOpen);
  const hoverPeek = useUi(u => u.sidebarHover);
  const route = useUi(u => u.route);
  const ws = useDoc(d => d.workspace, Object.is);
  const privatePages = useDoc(d => d.workspace.privatePages.filter(id => d.pages[id] && !d.pages[id].trashed));
  const favorites = useDoc(d => d.workspace.favorites.filter(id => !isTrashedDeep(d, id)));
  const [switcher, setSwitcher] = useState<Anchor>(null);
  const [scrolled, setScrolled] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const on = () => setScrolled(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    on();
    el.addEventListener('scroll', on);
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', on);
      ro.disconnect();
    };
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const move = (ev: PointerEvent) => setSettings({ sidebarWidth: Math.max(200, Math.min(480, ev.clientX)) });
    const up = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const newPrivatePage = () => {
    const id = createPage({ section: 'private' });
    openPage(id);
  };

  const shownPrivate = showAll ? privatePages : privatePages.slice(0, 12);

  return (
    <nav
      className={'sidebar' + (sbOpen ? '' : ' collapsed') + (!sbOpen && hoverPeek ? ' peek' : '')}
      style={{ width }}
      onMouseLeave={() => !sbOpen && setUi({ sidebarHover: false })}
    >
      <div className="sb-search" onClick={() => setUi({ searchOpen: true })} role="button">
        <SearchIcon size={14} />
        <span className="label">Search or ask</span>
        <span className="kbd">⌘K</span>
      </div>

      <div className="sb-tabs">
        <div className={'sb-tab' + (route.name === 'home' ? ' active' : '')} onClick={goHome} role="button">
          <House size={18} strokeWidth={route.name === 'home' ? 2 : 1.6} fill={route.name === 'home' ? 'currentColor' : 'none'} />
          Home
        </div>
        <div className={'sb-tab' + (route.name === 'chat' ? ' active' : '')} onClick={() => (location.hash = '#/chat')} role="button">
          <MessageCircle size={17} strokeWidth={1.6} />
          Chat
        </div>
        <div className={'sb-tab' + (route.name === 'meetings' ? ' active' : '')} onClick={() => (location.hash = '#/meetings')} role="button">
          <CalendarDays size={17} strokeWidth={1.6} />
          Meetings
        </div>
      </div>

      <div className="sidebar-scroll" ref={scrollRef}>
        <div className="sb-group top">
          <div className="sb-row" onClick={newPrivatePage} role="button">
            <div className="sb-icon">
              <SquarePen size={18} strokeWidth={1.6} />
            </div>
            <div className="sb-label">New page</div>
          </div>
          <div className={'sb-row' + (route.name === 'library' ? ' active' : '')} onClick={() => (location.hash = '#/library')} role="button">
            <div className="sb-icon">
              <Library size={18} strokeWidth={1.6} />
            </div>
            <div className="sb-label">Library</div>
          </div>
        </div>

        {favorites.length > 0 && <Section id="favorites" title="Favorites" pages={favorites} />}

        <UpcomingEvents />

        <TeamspacesSection />

        <Section id="private" title="Private" pages={shownPrivate} onAdd={newPrivatePage}>
          {null}
        </Section>
        <div className="sb-group">
          {privatePages.length > 12 && (
            <div className="sb-row muted" onClick={() => setShowAll(!showAll)} role="button">
              <div className="sb-icon">
                <MoreHorizontal size={16} />
              </div>
              <div className="sb-label">{showAll ? 'Show less' : 'View all'}</div>
            </div>
          )}
          <div className="sb-row muted" onClick={newPrivatePage} role="button">
            <div className="sb-icon">
              <Plus size={16} />
            </div>
            <div className="sb-label">Add new</div>
          </div>
        </div>

        <div className="sb-group" style={{ marginTop: 16 }}>
          <div className="sb-row" onClick={() => setUi({ settingsOpen: true, settingsTab: 'preferences' })} role="button">
            <div className="sb-icon">
              <Settings size={18} strokeWidth={1.6} />
            </div>
            <div className="sb-label">Settings</div>
          </div>
          <div className="sb-row" onClick={() => setUi({ trashOpen: true })} role="button" data-trash-anchor>
            <div className="sb-icon">
              <Trash2 size={18} strokeWidth={1.6} />
            </div>
            <div className="sb-label">Trash</div>
          </div>
          <div className="sb-row muted" onClick={() => setUi({ settingsOpen: true, settingsTab: 'sidebar' })} role="button">
            <div className="sb-icon">
              <SlidersHorizontal size={17} strokeWidth={1.6} />
            </div>
            <div className="sb-label">Customize sidebar</div>
          </div>
        </div>
        <DropLine />
      </div>

      <div className={'sb-footer' + (scrolled ? ' scrolled' : '')}>
        <div className="sb-switcher" onClick={e => setSwitcher(e.currentTarget.getBoundingClientRect())} role="button">
          <WorkspaceIcon />
          <span className="ws-name">{ws.name}</span>
          <ChevronDown size={14} />
        </div>
        <Tooltip label="Templates">
          <div className="icon-btn" role="button" onClick={() => window.dispatchEvent(new Event('on:templates'))}>
            <LayoutTemplate size={18} strokeWidth={1.6} />
          </div>
        </Tooltip>
        <Tooltip label="Help & support">
          <div className="icon-btn" role="button" onClick={() => setUi({ settingsOpen: true, settingsTab: 'shortcuts' })}>
            <CircleHelp size={18} strokeWidth={1.6} />
          </div>
        </Tooltip>
        <Tooltip label="Close sidebar" shortcut={`${MOD}\\`}>
          <div className="icon-btn" role="button" onClick={() => setSettings({ sidebarOpen: false })}>
            <ChevronsLeft size={18} strokeWidth={1.6} />
          </div>
        </Tooltip>
      </div>

      {sbOpen && <div className={'sb-resizer' + (resizing ? ' dragging' : '')} onPointerDown={startResize} onDoubleClick={() => setSettings({ sidebarWidth: 300 })} />}

      {switcher && <WorkspaceSwitcherMenu anchor={switcher} onClose={() => setSwitcher(null)} />}
    </nav>
  );
}

/** Dated database rows from today on, shown like calendar events. */
function UpcomingEvents() {
  const events = useDoc(
    d => {
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const out: { id: string; title: string; start: string; end?: string; color: string }[] = [];
      for (const db of Object.values(d.pages)) {
        if (!db.isDatabase || isTrashedDeep(d, db.id)) continue;
        const dateProp = db.schema?.find(s => s.type === 'date');
        if (!dateProp) continue;
        const color = db.icon ? 'var(--theme-blue-glyph)' : 'var(--theme-purple-glyph)';
        for (const rid of db.rows || []) {
          const r = d.pages[rid];
          const v = r?.props?.[dateProp.id];
          if (r && !r.trashed && v?.start && String(v.start).slice(0, 10) >= todayKey) {
            out.push({ id: rid, title: pageTitle(r), start: v.start, end: v.end, color });
          }
        }
      }
      return out.sort((x, y) => x.start.localeCompare(y.start)).slice(0, 4);
    },
    (x, y) => JSON.stringify(x) === JSON.stringify(y),
  );
  const collapsed = useOpen('section:events');
  return (
    <div className="sb-section">
      <div className="sb-section-header" onClick={() => setOpen('section:events', !collapsed)}>
        <span className="grow">Upcoming events</span>
      </div>
      {!collapsed && (
        <div className="sb-group">
          {events.map(e => (
            <div key={e.id} className="sb-row sb-event" role="button" onClick={() => openPage(e.id, { peek: true })}>
              <div className="sb-icon">
                <span className="sb-event-dot" style={{ background: e.color }} />
              </div>
              <div className="sb-label">{e.title}</div>
              <span className="sb-event-time">{eventTime(e.start, e.end)}</span>
            </div>
          ))}
          {events.length === 0 && (
            <div className="sb-row" onClick={() => (location.hash = '#/meetings')} role="button">
              <div className="sb-icon">
                <CalendarPlus size={18} strokeWidth={1.6} />
              </div>
              <div className="sb-label">Connect your calendar</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "10 – 11AM" for timed events today, otherwise a short weekday/date. */
function eventTime(start: string, end?: string): string {
  const s = new Date(start.length > 10 ? start : start + 'T00:00:00');
  const hasTime = start.length > 10;
  const today = new Date();
  const sameDay = s.toDateString() === today.toDateString();
  if (!hasTime) return sameDay ? 'Today' : s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const part = (d: Date) => {
    const h = d.getHours() % 12 || 12;
    const m = d.getMinutes();
    return { t: m ? `${h}:${String(m).padStart(2, '0')}` : String(h), ap: d.getHours() < 12 ? 'AM' : 'PM' };
  };
  const a = part(s);
  const prefix = sameDay ? '' : s.toLocaleDateString(undefined, { weekday: 'short' }) + ' ';
  if (end && end.length > 10 && end.slice(0, 10) === start.slice(0, 10)) {
    const b = part(new Date(end));
    return a.ap === b.ap ? `${prefix}${a.t}–${b.t}${b.ap}` : `${prefix}${a.t}${a.ap}–${b.t}${b.ap}`;
  }
  return `${prefix}${a.t}${a.ap}`;
}

function TeamspacesSection() {
  const ids = useDoc(d => d.workspace.teamspaces.map(t => t.id));
  const [showAll, setShowAll] = useState(false);
  const collapsed = useOpen('section:teamspaces');
  if (!ids.length) return null;
  const shown = showAll ? ids : ids.slice(0, 3);
  return (
    <div className="sb-section">
      <div className="sb-section-header" onClick={() => setOpen('section:teamspaces', !collapsed)}>
        <span className="grow">
          Teamspaces
          <span className="chev">{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
        </span>
      </div>
      {!collapsed && (
        <div className="sb-group">
          {shown.map(id => (
            <TeamspaceRows key={id} id={id} />
          ))}
          {ids.length > 3 && (
            <div className="sb-row muted" role="button" onClick={() => setShowAll(!showAll)}>
              <div className="sb-icon">
                <MoreHorizontal size={16} />
              </div>
              <div className="sb-label">{showAll ? 'Show less' : 'More'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamspaceRows({ id }: { id: string }) {
  const t = useDoc(d => d.workspace.teamspaces.find(x => x.id === id), Object.is);
  const pages = useDoc(d => (d.workspace.teamspaces.find(x => x.id === id)?.pages || []).filter(p => d.pages[p] && !d.pages[p].trashed));
  const open = useOpen('ts-open:' + id) || (openState['ts-open:' + id] === undefined && id === 'ts1');
  if (!t) return null;
  return (
    <>
      <div className="sb-row" onClick={() => setOpen('ts-open:' + id, !open)} role="button" data-sb-page={undefined}>
        <div className="sb-icon">
          <span className="ws-icon ts-icon">{t.icon}</span>
          <div className={'sb-caret' + (open ? ' open' : '')}>
            <ChevronRight size={14} strokeWidth={2} />
          </div>
        </div>
        <div className="sb-label">{t.name}</div>
        <div className="sb-actions">
          <Tooltip label="Add a page">
            <div
              className="icon-btn"
              role="button"
              onClick={e => {
                e.stopPropagation();
                setOpen('ts-open:' + id, true);
                openPage(createPage({ section: id }));
              }}
            >
              <Plus size={16} />
            </div>
          </Tooltip>
        </div>
      </div>
      {open && pages.map((p, i) => <PageRow key={p} pageId={p} depth={1} section={id} parentId={null} index={i} />)}
      {open && pages.length === 0 && <div className="sb-empty" style={{ paddingLeft: 58 }}>No pages inside</div>}
    </>
  );
}

function useOpenSnapshot(key: string) {
  return !!openState[key];
}

export function WorkspaceIcon({ size = 22 }: { size?: number }) {
  const icon = useDoc(d => d.workspace.icon);
  const isEmoji = /\p{Extended_Pictographic}/u.test(icon);
  return (
    <span className={'ws-icon' + (isEmoji ? ' emoji' : '')} style={{ width: size, height: size }}>
      {icon}
    </span>
  );
}

export function WorkspaceSwitcherMenu({ anchor, onClose, placement = 'top-start' }: { anchor: Anchor; onClose: () => void; placement?: 'top-start' | 'bottom-start' }) {
  const ws = getDoc().workspace;
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} placement={placement}>
      <div className="menu-label" style={{ paddingTop: 10 }}>
        <span>{ws.userEmail}</span>
        <MoreHorizontal size={14} />
      </div>
      <Menu
        onClose={onClose}
        items={[
          { id: 'ws', icon: <WorkspaceIcon size={20} />, label: ws.name, right: <Check size={16} color="var(--icon-primary)" />, onSelect: () => {} },
          { id: 'settings', separatorBefore: true, icon: <Settings size={16} />, label: 'Settings', onSelect: () => setUi({ settingsOpen: true, settingsTab: 'preferences' }) },
          { id: 'people', icon: <Users size={16} />, label: 'People', onSelect: () => setUi({ settingsOpen: true, settingsTab: 'people' }) },
          { id: 'add', separatorBefore: true, icon: <UserPlus size={16} />, label: 'Add account', disabled: true },
          { id: 'out', icon: <LogOut size={16} />, label: 'Log out', disabled: true },
        ]}
      />
    </Popover>
  );
}

/** Floating button shown when the sidebar is collapsed. */
export function SidebarOpener() {
  const sbOpen = useSettings(s => s.sidebarOpen);
  if (sbOpen) return null;
  return (
    <Tooltip label="Open sidebar" shortcut={`${MOD}\\`}>
      <div
        className="icon-btn"
        role="button"
        style={{ width: 28, height: 28, color: 'var(--icon-primary)' }}
        onMouseEnter={() => setUi({ sidebarHover: true })}
        onClick={() => {
          setSettings({ sidebarOpen: true });
          setUi({ sidebarHover: false });
        }}
      >
        <SidebarIcon />
      </div>
    </Tooltip>
  );
}

function SidebarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
      <path d="M7.5 3.5v13" />
    </svg>
  );
}

export { Grid2x2, getUi };
