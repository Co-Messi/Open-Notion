import { useEffect, useRef, useState } from 'react';
import { ChevronsRight, Maximize2, ChevronUp, ChevronDown, MoreHorizontal, MessageCircle, CalendarDays } from 'lucide-react';
import { Sidebar, expandSidebarTo } from './components/Sidebar';
import { Topbar, PageActionsMenu } from './components/Topbar';
import { Home } from './components/Home';
import { SearchModal } from './components/SearchModal';
import { SettingsModal } from './components/SettingsModal';
import { TrashPopover } from './components/TrashPopover';
import { PageView } from './editor/PageView';
import { SlashMenu } from './editor/SlashMenu';
import { InlineToolbar } from './editor/InlineToolbar';
import { LinkToPagePicker } from './editor/LinkToPage';
import { installSelectionKeys } from './editor/selection';
import { useUi, useSettings, setUi, setSettings, getUi, getDoc, undo, redo, getSettings, useDoc } from './store/store';
import { createPage, openPage, visitPage, pageTitle, duplicatePage } from './store/actions';
import type { Route } from './store/store';
import { Tooltip, MOD } from './components/ui';
import { focusBlock } from './editor/controller';
import { TabBar } from './components/TabBar';
import { TemplatesModal } from './components/Templates';
import { onHashChange, back as tabBack, forward as tabForward, newTab } from './store/tabs';
import { attrSel } from './lib/dom';
import { isSafeId, own } from './lib/own';
import { parseHash } from './store/route';
import { storageGet, storageSet } from './lib/storage';
import { isImageIcon } from './lib/url';
import { StoredImg } from './components/StoredImage';
import { pressable } from './components/ui';

function useTheme() {
  const theme = useSettings(s => s.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    document.body.classList.toggle('dark', dark);
  }, [dark]);
  return dark;
}

export function App() {
  useTheme();
  const route = useUi(u => u.route);

  useEffect(() => {
    installSelectionKeys();
    const apply = () => {
      onHashChange();
      const r = parseHash();
      if ((r.name === 'page' && !own(getDoc().pages, r.pageId)) || (r.name !== 'page' && /^#\/?p\//.test(location.hash))) {
        location.replace('#/home');
        return;
      }
      setUi({ route: r, selectedBlocks: [], peekRowId: null });
      if (r.name === 'page') {
        visitPage(r.pageId);
        expandSidebarTo(r.pageId);
        const blockId = new URLSearchParams(location.hash.split('?')[1] || '').get('b');
        if (blockId && isSafeId(blockId)) setTimeout(() => {
          const el = document.querySelector('.block' + attrSel('data-block-id', blockId));
          el?.scrollIntoView({ block: 'center' });
          if (el) setUi({ selectedBlocks: [blockId] });
        }, 50);
      }
    };
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      const last = getDoc().recent?.[0]?.id;
      const lastPage = own(getDoc().pages, last);
      if (getSettings().startPage === 'last' && lastPage && !lastPage.trashed) location.hash = `#/p/${lastPage.id}`;
      else location.hash = '#/home';
    }
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // Document title
  const title = useDoc(d => (route.name === 'page' ? (d.pages[route.pageId]?.icon && !isImageIcon(d.pages[route.pageId]!.icon) ? d.pages[route.pageId]!.icon + ' ' : '') + pageTitle(d.pages[route.pageId]) : route.name === 'home' ? 'Home' : route.name === 'chat' ? 'New AI chat' : route.name === 'meetings' ? 'Meetings' : 'Library'), Object.is);
  useEffect(() => {
    document.title = title;
  }, [title]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && getUi().peekRowId && !getUi().selectedBlocks.length && !document.querySelector('.popover:not(.is-exiting), .modal-overlay')) {
        const ae = document.activeElement as HTMLElement | null;
        if (!ae || !(ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
          setUi({ peekRowId: null });
          return;
        }
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const ae = document.activeElement as HTMLElement | null;
      const editing = !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if ((k === 'k' && !editing) || (k === 'k' && editing && window.getSelection()?.isCollapsed)) {
        e.preventDefault();
        setUi({ searchOpen: !getUi().searchOpen });
      } else if (e.key === '\\' || e.code === 'Backslash') {
        e.preventDefault();
        setSettings({ sidebarOpen: !getSettings().sidebarOpen });
      } else if (k === 'l' && e.shiftKey) {
        e.preventDefault();
        const dark = document.body.classList.contains('theme-dark');
        setSettings({ theme: dark ? 'light' : 'dark' });
      } else if ((k === 'n' || (e.altKey && e.code === 'KeyN')) && !e.shiftKey) {
        e.preventDefault();
        openPage(createPage({ section: 'private' }));
      } else if (k === 'z' && !editing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === ',') {
        e.preventDefault();
        setUi({ settingsOpen: true, settingsTab: 'preferences' });
      } else if (k === '[') {
        e.preventDefault();
        tabBack();
      } else if (k === ']') {
        e.preventDefault();
        tabForward();
      } else if ((k === 't' || e.code === 'KeyT') && e.altKey) {
        e.preventDefault();
        newTab();
      } else if (k === 'd' && !editing && !getUi().selectedBlocks.length && getUi().route.name === 'page') {
        e.preventDefault();
        const r = getUi().route;
        if (r.name === 'page') openPage(duplicatePage(r.pageId));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-shell">
      <TabBar />
    <div className="app">
      <Sidebar />
      <main className="main">
        <Topbar />
        {route.name === 'home' && <Home />}
        {route.name === 'page' && (
          <div className="frame" key={route.pageId}>
            <PageView pageId={route.pageId} />
          </div>
        )}
        {route.name === 'chat' && <ChatView />}
        {route.name === 'meetings' && <MeetingsView />}
        {route.name === 'library' && <LibraryView />}
        <SidePeek />
      </main>
      <SearchModal />
      <SettingsModal />
      <TrashPopover />
      <SlashMenu />
      <InlineToolbar />
      <LinkToPagePicker />
      <TemplatesModal />
      <Toast />
    </div>
    </div>
  );
}

export function Toast() {
  const t = useUi(u => u.toast);
  // The live region stays mounted so a message that appears later is announced.
  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-toast-live style={{ position: 'fixed', left: 0, bottom: 0, width: 0, height: 0 }}>
      {t && <div className="toast">{t}</div>}
    </div>
  );
}

function ChatView() {
  return (
    <div className="frame">
      <div className="empty-view">
        <MessageCircle size={36} color="var(--icon-tertiary)" />
        <h2>AI chat isn’t available</h2>
        <div>This is a local workspace without an AI backend. Everything else runs in your browser, and an open tab keeps working without a connection.</div>
      </div>
    </div>
  );
}

function MeetingsView() {
  return (
    <div className="frame">
      <div className="empty-view">
        <CalendarDays size={36} color="var(--icon-tertiary)" />
        <h2>Meetings</h2>
        <div>Calendar connections and AI meeting notes need an account server, so they are not available here.</div>
      </div>
    </div>
  );
}

function LibraryView() {
  const pages = useDoc(d =>
    Object.values(d.pages)
      .filter(p => !p.trashed && !p.dbId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(p => p.id),
  );
  const all = useDoc(d => d.pages, Object.is);
  return (
    <div className="frame">
      <div className="library">
        <h1>Library</h1>
        {pages.map(id => {
          const p = all[id];
          return (
            <div {...pressable()} key={id} className="lib-row" onClick={() => openPage(id)}>
              <span style={{ width: 20, display: 'flex', justifyContent: 'center', color: 'var(--icon-secondary)' }}>{isImageIcon(p.icon) ? <StoredImg src={p.icon} style={{ width: 18, height: 18, objectFit: 'cover', borderRadius: 3 }} /> : p.icon || (p.isDatabase ? '▦' : '📄')}</span>
              <span className="grow">{pageTitle(p)}</span>
              <span className="muted">Edited {new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidePeek() {
  const rowId = useUi(u => u.peekRowId);
  const page = useDoc(d => (rowId ? d.pages[rowId] : undefined), Object.is);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [width, setWidth] = useState(() => Number(storageGet('on:peek-w')) || 560);
  const widthRef = useRef(width);
  widthRef.current = width;
  if (!rowId || !page) return null;
  const db = page.dbId ? getDoc().pages[page.dbId] : undefined;
  const stored = (db?.rows || []).filter(r => !getDoc().pages[r]?.trashed);
  const shown = Array.from(new Set(
    (Array.from(document.querySelectorAll('.frame [data-row-id]')) as HTMLElement[]).map(e => e.dataset.rowId!).filter(r => stored.includes(r)),
  ));
  const rows = shown.includes(rowId) ? shown : stored;
  const idx = rows.indexOf(rowId);
  const close = () => setUi({ peekRowId: null });
  return (
    <div className="side-peek" role="complementary" aria-label="Side peek" style={{ width }} onKeyDown={e => e.key === 'Escape' && !(e.target as HTMLElement).isContentEditable && close()}>
      <div
        className="peek-resizer"
        onPointerDown={e => {
          e.preventDefault();
          const sx = e.clientX;
          const w0 = width;
          const move = (ev: PointerEvent) => setWidth(Math.max(380, Math.min(window.innerWidth - 300, w0 + (sx - ev.clientX))));
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            storageSet('on:peek-w', String(widthRef.current));
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
      <div className="peek-top">
        <Tooltip label="Close" shortcut="Esc">
          <div {...pressable()} className="icon-btn" onClick={close}>
            <ChevronsRight size={18} />
          </div>
        </Tooltip>
        <Tooltip label="Open as full page">
          <div {...pressable()} className="icon-btn" onClick={() => openPage(rowId)}>
            <Maximize2 size={15} />
          </div>
        </Tooltip>
        <div {...pressable()} aria-label="Previous page" aria-disabled={idx <= 0} className="icon-btn" style={{ opacity: idx > 0 ? 1 : 0.4 }} onClick={() => idx > 0 && setUi({ peekRowId: rows[idx - 1] })}>
          <ChevronUp size={18} />
        </div>
        <div {...pressable()} aria-label="Next page" aria-disabled={idx >= rows.length - 1} className="icon-btn" style={{ opacity: idx < rows.length - 1 ? 1 : 0.4 }} onClick={() => idx < rows.length - 1 && setUi({ peekRowId: rows[idx + 1] })}>
          <ChevronDown size={18} />
        </div>
        <span style={{ flex: 1 }} />
        <div {...pressable()} aria-label="More actions" className="icon-btn" onClick={e => setMenu(e.currentTarget.getBoundingClientRect())}>
          <MoreHorizontal size={18} />
        </div>
      </div>
      <div className="peek-scroll" key={rowId}>
        <PageView pageId={rowId} peek />
      </div>
      {menu && <PageActionsMenu pageId={rowId} anchor={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

export { focusBlock, MOD };
