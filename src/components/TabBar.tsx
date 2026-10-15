import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, House, MessageCircle, CalendarDays, Library, ChevronDown } from 'lucide-react';
import { useTabs, currentHash, switchTab, newTab, closeTab, back, forward, canBack, canForward, moveTab, type Tab } from '../store/tabs';
import { useDoc, useSettings, setSettings } from '../store/store';
import { pageTitle } from '../store/actions';
import { PageIconView } from './PageIcon';
import { Tooltip, MOD, type Anchor } from './ui';
import { WorkspaceIcon, WorkspaceSwitcherMenu } from './Sidebar';

function useTabLabel(tab: Tab) {
  const hash = currentHash(tab);
  const pageId = hash.startsWith('#/p/') ? hash.slice(4).split('?')[0] : null;
  const page = useDoc(d => (pageId ? d.pages[pageId] : undefined), Object.is);
  if (pageId) return { icon: <PageIconView page={page} size={16} emojiSize={14} />, label: page ? pageTitle(page) : 'Page not found' };
  if (hash === '#/chat') return { icon: <MessageCircle size={15} />, label: 'New AI chat' };
  if (hash === '#/meetings') return { icon: <CalendarDays size={15} />, label: 'Meetings' };
  if (hash === '#/library') return { icon: <Library size={15} />, label: 'Library' };
  return { icon: <House size={15} />, label: 'Home' };
}

function TabItem({ tab, active, index }: { tab: Tab; active: boolean; index: number }) {
  const { icon, label } = useTabLabel(tab);
  return (
    <div
      className={'tab' + (active ? ' active' : '')}
      role="tab"
      aria-selected={active}
      title={label}
      onMouseDown={e => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id);
          return;
        }
        if (e.button !== 0 || (e.target as HTMLElement).closest('.tab-close')) return;
        switchTab(tab.id);
        // Drag to reorder
        const sx = e.clientX;
        const strip = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const w = (e.currentTarget as HTMLElement).offsetWidth;
        const move = (ev: MouseEvent) => {
          if (Math.abs(ev.clientX - sx) < 6) return;
          const to = Math.floor((ev.clientX - strip.left) / w);
          if (to !== index) moveTab(tab.id, to);
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    >
      <span className="tab-icon">{icon}</span>
      <span className="tab-label">{label}</span>
      <span
        className="tab-close"
        role="button"
        aria-label="Close tab"
        onClick={e => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
      >
        <X size={13} />
      </span>
    </div>
  );
}

export function TabBar() {
  const { tabs, active } = useTabs();
  const sidebarWidth = useSettings(s => s.sidebarWidth);
  const sidebarOpen = useSettings(s => s.sidebarOpen);
  const wsName = useDoc(d => d.workspace.name);
  const [switcher, setSwitcher] = useState<Anchor>(null);
  return (
    <div className="tabbar">
      <div className="tabbar-left" style={{ width: sidebarOpen ? sidebarWidth : 'auto' }}>
        <div className="tb-ws" role="button" onClick={e => setSwitcher(e.currentTarget.getBoundingClientRect())}>
          <WorkspaceIcon size={20} />
          <span className="tb-ws-name">{wsName}</span>
          <ChevronDown size={13} className="tb-ws-chev" />
        </div>
      </div>
      <div className="tabbar-nav">
        <Tooltip label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} shortcut={`${MOD}\\`}>
          <div className="icon-btn" role="button" onClick={() => setSettings({ sidebarOpen: !sidebarOpen })}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
              <path d="M7.5 3.5v13" />
            </svg>
          </div>
        </Tooltip>
        <Tooltip label="Go back" shortcut={`${MOD}[`}>
          <div className={'icon-btn' + (canBack() ? '' : ' disabled')} role="button" onClick={back}>
            <ChevronLeft size={18} />
          </div>
        </Tooltip>
        <Tooltip label="Go forward" shortcut={`${MOD}]`}>
          <div className={'icon-btn' + (canForward() ? '' : ' disabled')} role="button" onClick={forward}>
            <ChevronRight size={18} />
          </div>
        </Tooltip>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((t, i) => (
          <TabItem key={t.id} tab={t} active={t.id === active} index={i} />
        ))}
        <Tooltip label="New tab" shortcut={`${MOD}T`}>
          <div className="icon-btn tab-new" role="button" onClick={() => newTab()}>
            <Plus size={18} />
          </div>
        </Tooltip>
      </div>
      {switcher && <WorkspaceSwitcherMenu anchor={switcher} onClose={() => setSwitcher(null)} placement="bottom-start" />}
    </div>
  );
}
