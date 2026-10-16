import { useState } from 'react';
import {
  Star, StarOff, Link2, Copy, PenLine, CornerUpRight, Trash2, ArrowUpRight, PanelRight, FileText, Lock,
} from 'lucide-react';
import { Menu, Popover, type Anchor, MOD, relTime } from './ui';
import { getDoc, useDoc, showToast } from '../store/store';
import {
  toggleFavorite, duplicatePage, trashPage, movePage, openPage, pageTitle, childPagesOf,
} from '../store/actions';
import { PageIconView } from './PageIcon';
import { openInNewTab } from '../store/tabs';

export function copyPageLink(id: string) {
  const url = `${location.origin}${location.pathname}#/p/${id}`;
  navigator.clipboard?.writeText(url).catch(() => {});
  showToast('Copied link to clipboard');
}

/** The "..." menu on sidebar rows. */
export function SidebarPageMenu({ pageId, anchor, onClose, onRename }: { pageId: string; anchor: Anchor; onClose: () => void; onRename: () => void }) {
  const fav = useDoc(d => d.workspace.favorites.includes(pageId));
  const page = useDoc(d => d.pages[pageId], Object.is);
  const [moveAnchor, setMoveAnchor] = useState<Anchor>(null);
  if (!page) return null;
  if (moveAnchor) {
    return <MovePagePopover pageId={pageId} anchor={moveAnchor} onClose={onClose} />;
  }
  return (
    <Popover anchor={anchor} onClose={onClose} width={265} placement="bottom-start">
      <Menu
        onClose={onClose}
        search
        searchPlaceholder="Search actions…"
        items={[
          { id: 'fav', icon: fav ? <StarOff size={16} /> : <Star size={16} />, label: fav ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => toggleFavorite(pageId) },
          { id: 'sep', separatorBefore: true, icon: <Link2 size={16} />, label: 'Copy link', onSelect: () => copyPageLink(pageId) },
          { id: 'dup', icon: <Copy size={16} />, label: 'Duplicate', onSelect: () => duplicatePage(pageId) },
          { id: 'ren', icon: <PenLine size={16} />, label: 'Rename', right: `${MOD}⇧R`, onSelect: onRename },
          {
            id: 'move', icon: <CornerUpRight size={16} />, label: 'Move to', right: `${MOD}⇧P`, keepOpen: true,
            onSelect: () => setMoveAnchor(anchor),
          },
          { id: 'trash', icon: <Trash2 size={16} />, label: 'Move to Trash', danger: true, onSelect: () => trashPage(pageId) },
          { id: 'tab', separatorBefore: true, icon: <ArrowUpRight size={16} />, label: 'Open in new tab', right: `${MOD}⇧↵`, onSelect: () => openInNewTab(pageId) },
          ...(page.dbId ? [{ id: 'peek', icon: <PanelRight size={16} />, label: 'Open in side peek', right: '⌥Click', onSelect: () => openPage(pageId, { peek: true }) }] : []),
        ]}
        footer={
          <div className="menu-footer">
            Last edited by {getDoc().workspace.userName}
            <br />
            {new Date(page.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        }
      />
    </Popover>
  );
}

/** "Move page to" picker. */
export function MovePagePopover({ pageId, anchor, onClose }: { pageId: string; anchor: Anchor; onClose: () => void }) {
  const d = getDoc();
  const [q, setQ] = useState('');
  // Candidate targets: every non-trashed, non-row page that is not the page itself or its descendant.
  // Iterative walk with a visited set, so even a corrupted cyclic tree cannot overflow the stack.
  const descendants = new Set<string>();
  const stack = [pageId];
  while (stack.length) {
    const id = stack.pop()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    stack.push(...childPagesOf(d, id));
  }
  const candidates = Object.values(d.pages)
    .filter(p => !p.trashed && !p.dbId && !p.isDatabase && !descendants.has(p.id))
    .filter(p => pageTitle(p).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);
  return (
    <Popover anchor={anchor} onClose={onClose} width={340}>
      <Menu
        onClose={onClose}
        search
        searchPlaceholder="Move page to…"
        items={[
          { id: 'private', section: 'Private', icon: <Lock size={16} />, label: 'Private pages', keywords: 'private', onSelect: () => movePage(pageId, { section: 'private' }) },
          ...d.workspace.teamspaces.map(t => ({
            id: 'ts-' + t.id, section: 'Teamspaces', icon: <span style={{ fontSize: 15 }}>{t.icon}</span>, label: t.name,
            onSelect: () => movePage(pageId, { section: t.id }),
          })),
          ...candidates.map(p => ({
            id: p.id, section: 'Pages', icon: <PageIconView page={p} size={16} />, label: pageTitle(p), keywords: p.title,
            onSelect: () => movePage(pageId, { pageId: p.id }),
          })),
        ].filter(i => !q || (typeof i.label === 'string' && i.label.toLowerCase().includes(q.toLowerCase())))}
      />
    </Popover>
  );
}

export function LastEdited({ t }: { t: number }) {
  return <span>{relTime(t)}</span>;
}

export const DocIcon = FileText;
