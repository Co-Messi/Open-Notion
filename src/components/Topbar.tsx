import { useState } from 'react';
import {
  Lock, ChevronDown, Star, Link2, MoreHorizontal, Copy, CornerUpRight, Trash2, ArrowDownToLine, ArrowUpFromLine,
  MoveHorizontal, Type, Undo2, Globe, ClipboardCopy, MessageSquare, Clock3, Users,
} from 'lucide-react';
import { useDoc, useUi, setUi, getDoc, showToast, undo } from '../store/store';
import { pagePath, pageTitle, openPage, toggleFavorite, duplicatePage, trashPage, updatePage } from '../store/actions';
import { PageIconView } from './PageIcon';
import { Popover, Menu, Switch, Tooltip, MOD, relTime, type Anchor, pressable } from './ui';
import { MovePagePopover, copyPageLink } from './PageMenus';
import { SidebarOpener, WorkspaceIcon } from './Sidebar';
import { exportPageMarkdown, pageToMarkdown } from '../lib/exporter';

export function Topbar() {
  const route = useUi(u => u.route);
  const pageId = route.name === 'page' ? route.pageId : null;
  return (
    <div className="topbar">
      <SidebarOpener />
      {pageId ? <PageTopbar pageId={pageId} /> : <StaticTopbar />}
    </div>
  );
}

function StaticTopbar() {
  const route = useUi(u => u.route);
  const label = route.name === 'home' ? 'Home' : route.name === 'chat' ? 'New AI chat' : route.name === 'meetings' ? 'Meetings' : 'Library';
  return (
    <div className="crumbs">
      <div className="crumb">
        <span className="t">{label}</span>
      </div>
    </div>
  );
}

function PageTopbar({ pageId }: { pageId: string }) {
  const page = useDoc(d => d.pages[pageId], Object.is);
  const pathIds = useDoc(() => pagePath(pageId).map(p => p.id));
  const fav = useDoc(d => d.workspace.favorites.includes(pageId));
  const inTeam = useDoc(d => {
    const root = pagePath(pageId)[0];
    return d.workspace.teamspaces.find(t => root && t.pages.includes(root.id))?.name || null;
  });
  const [menu, setMenu] = useState<Anchor>(null);
  const [share, setShare] = useState<Anchor>(null);
  if (!page) return null;
  // Collapse long paths like Notion: first … last two.
  let crumbs: (string | null)[] = pathIds;
  if (pathIds.length > 3) crumbs = [pathIds[0], null, ...pathIds.slice(-2)];
  return (
    <>
      <div className="crumbs">
        {crumbs.map((id, i) => (
          <span key={id ?? 'gap' + i} style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
            {i > 0 && <span className="crumb-sep">/</span>}
            {id ? <Crumb id={id} /> : <span className="crumb"><span className="t">…</span></span>}
          </span>
        ))}
      </div>
      <div {...pressable()} aria-haspopup="dialog" className="privacy" onClick={e => setShare(e.currentTarget.getBoundingClientRect())}>
        {inTeam ? <Users size={14} /> : <Lock size={13} />}
        <span>{inTeam || 'Private'}</span>
        <ChevronDown size={13} />
      </div>
      <div className="spacer" />
      <div className="tb-btn" onClick={e => setShare(e.currentTarget.getBoundingClientRect())} {...pressable()}>
        <Lock size={14} />
        Share
      </div>
      <Tooltip label="Copy link" shortcut={`${MOD}L`}>
        <div className="icon-btn" {...pressable()} onClick={() => copyPageLink(pageId)}>
          <Link2 size={17} strokeWidth={1.6} />
        </div>
      </Tooltip>
      <Tooltip label={fav ? 'Remove from Favorites' : 'Add to Favorites'}>
        <div className={'icon-btn' + (fav ? ' fav-on' : '')} {...pressable()} onClick={() => toggleFavorite(pageId)}>
          <Star size={17} strokeWidth={1.6} fill={fav ? 'currentColor' : 'none'} />
        </div>
      </Tooltip>
      <Tooltip label="Style, export, and more…">
        <div className="icon-btn" {...pressable()} onClick={e => setMenu(e.currentTarget.getBoundingClientRect())} style={menu ? { background: 'var(--hover)' } : undefined}>
          <MoreHorizontal size={18} />
        </div>
      </Tooltip>
      {menu && <PageActionsMenu pageId={pageId} anchor={menu} onClose={() => setMenu(null)} />}
      {share && <SharePopover pageId={pageId} anchor={share} onClose={() => setShare(null)} />}
    </>
  );
}

function Crumb({ id }: { id: string }) {
  const p = useDoc(d => d.pages[id], Object.is);
  if (!p) return null;
  return (
    <div className="crumb" onClick={() => openPage(id)} {...pressable()}>
      {(p.icon || p.isDatabase) && <PageIconView page={p} size={16} emojiSize={15} />}
      <span className="t">{pageTitle(p)}</span>
    </div>
  );
}

export function PageActionsMenu({ pageId, anchor, onClose }: { pageId: string; anchor: Anchor; onClose: () => void }) {
  const page = useDoc(d => d.pages[pageId], Object.is);
  const [move, setMove] = useState<Anchor>(null);
  const words = useWordCount(pageId);
  if (!page) return null;
  if (move) return <MovePagePopover pageId={pageId} anchor={move} onClose={onClose} />;
  const font = page.font || 'default';
  return (
    <Popover anchor={anchor} onClose={onClose} width={256} placement="bottom-end">
      <Menu
        onClose={onClose}
        search
        maxHeight={600}
        header={
          !page.isDatabase || !page.inline ? (
            <div className="font-picker">
              {(['default', 'serif', 'mono'] as const).map(f => (
                <button key={f} className={font === f ? 'on' : ''} onClick={() => updatePage(pageId, { font: f })}>
                  <span className="ag" style={{ fontFamily: f === 'serif' ? 'var(--font-serif)' : f === 'mono' ? 'var(--font-mono)' : 'var(--font-sans)' }}>
                    Ag
                  </span>
                  <span className="nm">{f === 'default' ? 'Default' : f === 'serif' ? 'Serif' : 'Mono'}</span>
                </button>
              ))}
            </div>
          ) : null
        }
        items={[
          { id: 'link', icon: <Link2 size={16} />, label: 'Copy link', right: `${MOD}L`, onSelect: () => copyPageLink(pageId) },
          {
            id: 'contents', icon: <ClipboardCopy size={16} />, label: 'Copy page contents',
            onSelect: () => {
              navigator.clipboard?.writeText(pageToMarkdown(pageId)).catch(() => {});
              showToast('Copied page contents');
            },
          },
          { id: 'dup', icon: <Copy size={16} />, label: 'Duplicate', right: `${MOD}D`, onSelect: () => openPage(duplicatePage(pageId)) },
          { id: 'move', icon: <CornerUpRight size={16} />, label: 'Move to', right: `${MOD}⇧P`, keepOpen: true, onSelect: () => setMove(anchor) },
          {
            id: 'trash', icon: <Trash2 size={16} />, label: 'Move to Trash', danger: true,
            onSelect: () => {
              const parent = page.dbId || page.parentId;
              trashPage(pageId);
              if (parent && getDoc().pages[parent]) openPage(parent);
              else location.hash = '#/home';
            },
          },
          {
            id: 'small', separatorBefore: true, icon: <Type size={16} />, label: 'Small text', keepOpen: true,
            right: <Switch on={!!page.smallText} />, onSelect: () => updatePage(pageId, { smallText: !page.smallText }),
          },
          {
            id: 'full', icon: <MoveHorizontal size={16} />, label: 'Full width', keepOpen: true,
            right: <Switch on={!!page.fullWidth} />, onSelect: () => updatePage(pageId, { fullWidth: !page.fullWidth }),
          },
          {
            id: 'lock', separatorBefore: true, icon: <Lock size={16} />, label: 'Lock page', keepOpen: true,
            right: <Switch on={!!page.locked} />, onSelect: () => updatePage(pageId, { locked: !page.locked }),
          },
          {
            id: 'comment', icon: <MessageSquare size={16} />, label: 'Add comment', right: `${MOD}⇧M`,
            onSelect: () => window.dispatchEvent(new CustomEvent('on:add-comment', { detail: pageId })),
          },
          { id: 'undo', separatorBefore: true, icon: <Undo2 size={16} />, label: 'Undo', right: `${MOD}Z`, onSelect: undo },
          { id: 'history', icon: <Clock3 size={16} />, label: 'Version history', disabled: true },
          {
            id: 'import', separatorBefore: true, icon: <ArrowDownToLine size={16} />, label: 'Import',
            onSelect: () => window.dispatchEvent(new CustomEvent('on:import', { detail: pageId })),
          },
          { id: 'export', icon: <ArrowUpFromLine size={16} />, label: 'Export', onSelect: () => exportPageMarkdown(pageId) },
          { id: 'publish', icon: <Globe size={16} />, label: 'Publish', disabled: true },
        ]}
        footer={
          <div className="menu-footer">
            Word count: {words.toLocaleString()}
            <br />
            Last edited by {getDoc().workspace.userName}
            <br />
            {new Date(page.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        }
      />
    </Popover>
  );
}

function useWordCount(pageId: string) {
  return useDoc(d => {
    const p = d.pages[pageId];
    if (!p) return 0;
    let n = 0;
    const walk = (ids: string[]) =>
      ids.forEach(id => {
        const b = d.blocks[id];
        if (!b) return;
        const t = b.html.replace(/<[^>]+>/g, ' ');
        n += t.split(/\s+/).filter(Boolean).length;
        walk(b.children);
      });
    walk(p.content);
    return n + (p.title ? p.title.split(/\s+/).filter(Boolean).length : 0);
  }, Object.is);
}

function SharePopover({ pageId, anchor, onClose }: { pageId: string; anchor: Anchor; onClose: () => void }) {
  const ws = getDoc().workspace;
  const [tab, setTab] = useState<'share' | 'publish'>('share');
  const [email, setEmail] = useState('');
  return (
    <Popover anchor={anchor} onClose={onClose} width={440} placement="bottom-end" className="share-pop">
      <div className="share-tabs">
        <div {...pressable()} aria-pressed={tab === 'share'} className={'ep-tab' + (tab === 'share' ? ' on' : '')} onClick={() => setTab('share')}>
          Share
        </div>
        <div {...pressable()} aria-pressed={tab === 'publish'} className={'ep-tab' + (tab === 'publish' ? ' on' : '')} onClick={() => setTab('publish')}>
          Publish
        </div>
      </div>
      {tab === 'share' ? (
        <div className="share-body">
          <div className="share-invite">
            <input className="text-input" placeholder="Email or group, separated by commas" value={email} onChange={e => setEmail(e.target.value)} />
            <button
              className="btn primary sm"
              disabled={!email}
              style={{ opacity: email ? 1 : 0.5 }}
              onClick={() => {
                showToast('Invites are not available in this local workspace');
                setEmail('');
              }}
            >
              Invite
            </button>
          </div>
          <div className="share-person">
            <span className="avatar lg">{ws.userName[0]}</span>
            <div className="grow">
              {ws.userName} <span className="sub">(You)</span>
              <div className="sub">{ws.userEmail}</div>
            </div>
            <span className="sub">Full access</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>General access</div>
          <div className="share-person">
            <span className="ws-icon" style={{ width: 24, height: 24 }}>
              <Lock size={13} />
            </span>
            <div className="grow">
              Only people invited
              <div className="sub">Only people invited can access</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="share-body" style={{ alignItems: 'center', textAlign: 'center', padding: '28px 20px' }}>
          <Globe size={32} color="var(--icon-tertiary)" />
          <div style={{ fontWeight: 500 }}>Publish to web</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publishing needs a server. This workspace runs entirely in your browser.</div>
        </div>
      )}
      <div className="share-footer">
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <WorkspaceIcon size={16} /> {ws.name}
        </span>
        <button className="btn secondary sm" onClick={() => copyPageLink(pageId)}>
          <Link2 size={14} /> Copy link
        </button>
      </div>
    </Popover>
  );
}
