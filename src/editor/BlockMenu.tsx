import type { ReactNode } from 'react';
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered, SquareCheck, ChevronRight, Quote, MessageSquareQuote, Minus,
  Code2, Image, FileText, Table, Link2, Copy, Trash2, CornerUpRight, MessageSquare, RefreshCcw, Palette, Bookmark,
  Table2, KanbanSquare, LayoutGrid, ListTree, CalendarDays, ArrowUpRight,
} from 'lucide-react';
import { Menu, Popover, MOD, type MenuItemDef } from '../components/ui';
import { getDoc, getUi, showToast, transact, breakCoalescing } from '../store/store';
import {
  turnInto, setBlockColor, deleteBlocks, duplicateBlocks, OPTION_COLORS, txTurnInto, txCreatePage, openPage, txInsertColumns,
  pageOfBlockIn, txSyncOwnedPages,
} from '../store/actions';
import type { Block, BlockType, ColorName } from '../store/types';
import { htmlToText } from '../lib/html';
import { TEXTUAL_TYPES } from './ops';
import { selectBlocks, focusBlock } from './controller';
import { useState } from 'react';
import { MoveBlocksPopover } from './MoveBlocks';
import { openInNewTab } from '../store/tabs';

export const BLOCK_TYPE_LABEL: Partial<Record<BlockType, string>> = {
  text: 'Text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', bulleted: 'Bulleted list', numbered: 'Numbered list',
  todo: 'To-do list', toggle: 'Toggle list', quote: 'Quote', callout: 'Callout', code: 'Code', page: 'Page', divider: 'Divider',
  image: 'Image', database: 'Database', table: 'Table', bookmark: 'Web bookmark',
};

export const TYPE_ICON: Partial<Record<BlockType, ReactNode>> = {
  text: <Type size={16} />,
  h1: <Heading1 size={16} />,
  h2: <Heading2 size={16} />,
  h3: <Heading3 size={16} />,
  bulleted: <List size={16} />,
  numbered: <ListOrdered size={16} />,
  todo: <SquareCheck size={16} />,
  toggle: <ToggleIcon />,
  quote: <Quote size={16} />,
  callout: <MessageSquareQuote size={16} />,
  code: <Code2 size={16} />,
  page: <FileText size={16} />,
  divider: <Minus size={16} />,
  image: <Image size={16} />,
  table: <Table size={16} />,
  bookmark: <Bookmark size={16} />,
};

function ColumnsIcon({ n }: { n: number }) {
  const w = 14 / n;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={1 + i * w + 0.6} y="2.5" width={w - 1.2} height="11" rx="1.5" />
      ))}
    </svg>
  );
}

function ToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5 5 6.75 2.5 9" />
      <path d="M8 6.75h5.5M8 11h5.5" />
    </svg>
  );
}

const TURN_INTO: BlockType[] = ['text', 'h1', 'h2', 'h3', 'page', 'bulleted', 'numbered', 'todo', 'toggle', 'code', 'quote', 'callout'];

export function TurnIntoMenu({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const cur = getDoc().blocks[ids[0]]?.type;
  return (
    <Menu
      onClose={onClose}
      search
      searchPlaceholder="Turn into…"
      items={TURN_INTO.map((t, i) => ({
        id: t,
        section: i === 0 ? 'Turn into' : undefined,
        icon: TYPE_ICON[t],
        label: BLOCK_TYPE_LABEL[t]!,
        right: cur === t ? <CheckMark /> : undefined,
        onSelect: () => {
          if (t === 'page') return turnIntoPage(ids[0]);
          turnInto(ids, t);
          breakCoalescing();
        },
      }))}
    />
  );
}

/** Plain text of a block: code blocks hold raw source, every other block holds sanitized html. */
export function blockPlainText(b: Block): string {
  return b.type === 'code' ? b.html || '' : htmlToText(b.html || '');
}

/** Converts a block (with its text and children) into a sub-page. */
export function turnIntoPage(blockId: string) {
  const d = getDoc();
  const b = d.blocks[blockId];
  // Only text and code blocks become pages; a page block already is one.
  if (!b || (!TEXTUAL_TYPES.includes(b.type) && b.type !== 'code')) return;
  const pageOf = pageOfBlockIn(d, blockId);
  if (!pageOf || d.pages[pageOf].isDatabase) return;
  transact(tx => {
    const title = blockPlainText(b).replace(/\s*\n\s*/g, ' ').trim();
    const pid = txCreatePage(tx, { parentId: pageOf, replaceBlockId: blockId, title });
    // Children become the page content; sub pages among them now live in the new page.
    const kids = b.children;
    kids.forEach(k => (tx.blocks[k] = { ...tx.blocks[k], parent: pid }));
    tx.setPage(pid, { content: kids });
    kids.forEach(k => txSyncOwnedPages(tx, k));
  });
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--icon-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

const COLOR_LABEL: Record<ColorName, string> = {
  default: 'Default', gray: 'Gray', brown: 'Brown', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue',
  purple: 'Purple', pink: 'Pink', red: 'Red',
};

export function ColorMenu({ onPick, onClose, current }: { onPick: (c: ColorName, bg: boolean) => void; onClose: () => void; current?: string }) {
  const items: MenuItemDef[] = [
    ...OPTION_COLORS.map((c, i) => ({
      id: 't-' + c,
      section: i === 0 ? 'Text color' : undefined,
      icon: (
        <span className="swatch" style={{ color: c === 'default' ? 'var(--text-primary)' : `var(--color-${c})` }}>
          A
        </span>
      ),
      label: COLOR_LABEL[c] + (c === 'default' ? ' text' : ' text'),
      keywords: c,
      right: current === c ? <CheckMark /> : undefined,
      onSelect: () => onPick(c, false),
    })),
    ...OPTION_COLORS.map((c, i) => ({
      id: 'b-' + c,
      section: i === 0 ? 'Background color' : undefined,
      separatorBefore: i === 0,
      icon: <span className="swatch" style={{ background: c === 'default' ? 'transparent' : `var(--bgcolor-${c})` }} />,
      label: COLOR_LABEL[c] + ' background',
      keywords: c + ' background',
      right: current === c + '_background' ? <CheckMark /> : undefined,
      onSelect: () => onPick(c, true),
    })),
  ];
  return <Menu onClose={onClose} items={items} maxHeight={420} />;
}

/** Menu opened from the ⋮⋮ handle (or right click) on blocks. */
export function BlockActionsMenu({ ids, anchor, onClose }: { ids: string[]; anchor: DOMRect | { x: number; y: number }; onClose: () => void }) {
  const d = getDoc();
  const first = d.blocks[ids[0]];
  const [move, setMove] = useState(false);
  if (!first) return null;
  if (move) return <MoveBlocksPopover ids={ids} anchor={anchor} onClose={onClose} />;
  const label = ids.length > 1 ? `${ids.length} blocks` : BLOCK_TYPE_LABEL[first.type] || 'Block';
  // Page blocks and column layouts are structure: turning them into text would orphan a page.
  const textual = ids.every(id => !['divider', 'image', 'page', 'database', 'table', 'bookmark', 'columns', 'column'].includes(d.blocks[id]?.type));
  const items: MenuItemDef[] = [];
  if (textual) {
    items.push({
      id: 'turn', section: label, icon: <RefreshCcw size={16} />, label: 'Turn into', right: <ChevronRight size={14} />,
      submenu: () => <div style={{ width: 240 }}><TurnIntoMenu ids={ids} onClose={onClose} /></div>,
    });
  }
  items.push({
    id: 'color', section: textual ? undefined : label, icon: <Palette size={16} />, label: 'Color', right: <ChevronRight size={14} />,
    submenu: () => (
      <div style={{ width: 220 }}>
        <ColorMenu
          current={first.color}
          onClose={onClose}
          onPick={(c, bg) => {
            setBlockColor(ids, c === 'default' ? undefined : bg ? (`${c}_background` as const) : c);
            onClose();
          }}
        />
      </div>
    ),
  });
  items.push(
    {
      id: 'link', separatorBefore: true, icon: <Link2 size={16} />, label: 'Copy link to block', right: `${MOD}⌥L`,
      onSelect: () => {
        const pid = getDoc().pages[first.parent] ? first.parent : '';
        navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/p/${pid || ''}?b=${first.id}`).catch(() => {});
        showToast('Copied link to block');
      },
    },
    {
      id: 'dup', icon: <Copy size={16} />, label: 'Duplicate', right: `${MOD}D`,
      onSelect: () => {
        const n = duplicateBlocks(ids);
        selectBlocks(n);
      },
    },
    { id: 'move', icon: <CornerUpRight size={16} />, label: 'Move to', right: `${MOD}⇧P`, keepOpen: true, onSelect: () => setMove(true) },
    { id: 'del', icon: <Trash2 size={16} />, label: 'Delete', right: 'Del', danger: true, onSelect: () => deleteBlocks(ids) },
  );
  if ((first.type === 'page' || first.type === 'database') && first.pageId) {
    items.push({ id: 'open', separatorBefore: true, icon: <ArrowUpRight size={16} />, label: 'Open in new tab', onSelect: () => openInNewTab(first.pageId!) });
  }
  items.push({
    id: 'comment', separatorBefore: true, icon: <MessageSquare size={16} />, label: 'Comment', right: `${MOD}⇧M`,
    onSelect: () => window.dispatchEvent(new CustomEvent('on:add-comment', { detail: { quote: blocksText(ids) } })),
  });
  return (
    <Popover anchor={anchor} onClose={onClose} width={265} placement="left-start">
      <Menu
        onClose={onClose}
        search
        items={items}
        footer={
          <div className="menu-footer">
            Last edited by {d.workspace.userName}
            <br />
            {new Date(first.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        }
      />
    </Popover>
  );
}

/** Plain text quoted by "Comment": never parsed into live elements, stored and shown as text. */
export function blocksText(ids: string[]) {
  const d = getDoc();
  return ids
    .map(id => {
      const b = d.blocks[id];
      if (!b) return '';
      if (b.pageId && (b.type === 'page' || b.type === 'database')) return d.pages[b.pageId]?.title || '';
      return blockPlainText(b);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

/* ------------------------------------------------------------------ */
/* Slash menu catalogue                                                */
/* ------------------------------------------------------------------ */

export interface SlashItem {
  id: string;
  label: string;
  section: string;
  icon: ReactNode;
  shortcut?: string;
  keywords?: string;
  desc?: string;
  run: (blockId: string) => void;
}

function convertOrInsert(blockId: string, type: BlockType, extra: Record<string, any> = {}) {
  let target = blockId;
  transact(tx => {
    const b = tx.block(blockId);
    const empty = !b.html || b.html === '<br>';
    if (empty && b.type !== 'code') {
      txTurnInto(tx, blockId, type);
      tx.setBlock(blockId, extra);
    } else {
      const list = tx.siblings(blockId);
      const nb = { id: '', type, html: '', children: [], parent: b.parent, createdAt: Date.now(), ...extra };
      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      tx.blocks[id] = { ...nb, id } as any;
      const l = [...list];
      l.splice(l.indexOf(blockId) + 1, 0, id);
      tx.setSiblings(b.parent, l);
      target = id;
    }
  });
  breakCoalescing();
  return target;
}

export function slashItems(): SlashItem[] {
  const basic = (type: BlockType, label: string, shortcut?: string, keywords = '', extra: Record<string, any> = {}): SlashItem => ({
    id: type,
    label,
    section: 'Basic blocks',
    icon: TYPE_ICON[type],
    shortcut,
    keywords,
    run: blockId => {
      const id = convertOrInsert(blockId, type, extra);
      if (type === 'divider') {
        let nid = '';
        transact(tx => {
          const list = tx.siblings(id);
          const idx = list.indexOf(id);
          const next = tx.blocks[list[idx + 1]];
          if (next && next.type === 'text' && !next.html) {
            nid = next.id;
            return;
          }
          const b = { id: Math.random().toString(36).slice(2, 12), type: 'text' as BlockType, html: '', children: [], parent: tx.block(id).parent, createdAt: Date.now() };
          tx.blocks[b.id] = b;
          const l = [...list];
          l.splice(idx + 1, 0, b.id);
          tx.setSiblings(b.parent, l);
          nid = b.id;
        }, 'none');
        focusBlock(nid, 'start');
      } else if (type === 'image') {
        // The image block mounts on the next render; ask it to open its picker once it listens.
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('on:image-picker', { detail: id })));
      } else {
        focusBlock(id, 'end');
      }
    },
  });
  const db = (view: 'table' | 'board' | 'gallery' | 'list' | 'calendar', label: string, icon: ReactNode): SlashItem => ({
    id: 'db-' + view,
    label,
    section: 'Database',
    icon,
    keywords: 'database inline ' + view,
    run: blockId => {
      transact(tx => {
        const b = tx.block(blockId);
        const pageOf = tx.pageOfBlock(blockId);
        const empty = !b.html || b.html === '<br>';
        txCreatePage(tx, {
          parentId: pageOf, isDatabase: true, inline: true, dbViewType: view,
          ...(empty && b.parent === pageOf ? { replaceBlockId: blockId } : { afterBlockId: blockId }),
        });
      });
      breakCoalescing();
    },
  });
  const items: SlashItem[] = [
    basic('text', 'Text', '', 'plain paragraph'),
    basic('h1', 'Heading 1', '#', 'title big h1'),
    basic('h2', 'Heading 2', '##', 'subtitle h2'),
    basic('h3', 'Heading 3', '###', 'h3'),
    basic('bulleted', 'Bulleted list', '-', 'unordered ul bullet'),
    basic('numbered', 'Numbered list', '1.', 'ordered ol number'),
    basic('todo', 'To-do list', '[]', 'checkbox task todo', { checked: false }),
    basic('toggle', 'Toggle list', '>', 'collapse expand', { open: true }),
    {
      id: 'page', label: 'Page', section: 'Basic blocks', icon: TYPE_ICON.page, keywords: 'subpage new page',
      run: (blockId: string) => {
        let pid = '';
        transact(tx => {
          const b = tx.block(blockId);
          const pageOf = tx.pageOfBlock(blockId);
          const empty = !b.html || b.html === '<br>';
          pid = txCreatePage(tx, { parentId: pageOf, ...(empty ? { replaceBlockId: blockId } : { afterBlockId: blockId }) });
        });
        breakCoalescing();
        openPage(pid);
      },
    },
    basic('callout', 'Callout', '', 'note tip info', { icon: '💡' }),
    basic('quote', 'Quote', '"', 'citation blockquote'),
    {
      id: 'table', label: 'Table', section: 'Basic blocks', icon: TYPE_ICON.table, keywords: 'simple table grid',
      run: (blockId: string) => {
        convertOrInsert(blockId, 'table', { rows: [['', '', ''], ['', '', ''], ['', '', '']], headerRow: true });
      },
    },
    basic('divider', 'Divider', '---', 'line separator hr'),
    ...[2, 3, 4].map(n => ({
      id: 'cols' + n, label: `${n} columns`, section: 'Layout', icon: <ColumnsIcon n={n} />, keywords: 'columns layout side by side',
      run: (blockId: string) => {
        let first = '';
        transact(tx => {
          const b = tx.block(blockId);
          const list = tx.siblings(blockId);
          const empty = !b.html || b.html === '<br>';
          const idx = list.indexOf(blockId) + (empty ? 0 : 1);
          first = txInsertColumns(tx, b.parent, idx, n);
          if (empty && b.type === 'text' && b.children.length === 0) {
            tx.setSiblings(b.parent, tx.childList(b.parent).filter(x => x !== blockId));
            delete tx.blocks[blockId];
          }
        });
        breakCoalescing();
        focusBlock(first, 'start');
      },
    })),
    {
      id: 'linkpage', label: 'Link to page', section: 'Basic blocks', icon: <ArrowUpRight size={16} />, keywords: 'reference mention',
      run: (blockId: string) => window.dispatchEvent(new CustomEvent('on:link-page', { detail: blockId })),
    },
    basic('image', 'Image', '', 'picture photo upload', {}),
    basic('code', 'Code', '```', 'snippet program', { language: 'javascript' }),
    {
      id: 'bookmark', label: 'Web bookmark', section: 'Media', icon: TYPE_ICON.bookmark, keywords: 'url link embed',
      run: (blockId: string) => window.dispatchEvent(new CustomEvent('on:bookmark', { detail: convertOrInsert(blockId, 'bookmark') })),
    },
    db('table', 'Table view', <Table2 size={16} />),
    db('board', 'Board view', <KanbanSquare size={16} />),
    db('gallery', 'Gallery view', <LayoutGrid size={16} />),
    db('list', 'List view', <ListTree size={16} />),
    db('calendar', 'Calendar view', <CalendarDays size={16} />),
    ...OPTION_COLORS.filter(c => c !== 'default').flatMap(c => [
      {
        id: 'color-' + c, label: COLOR_LABEL[c], section: 'Colors', keywords: 'color text ' + c,
        icon: <span className="swatch" style={{ color: `var(--color-${c})`, width: 20, height: 20 }}>A</span>,
        run: (blockId: string) => {
          setBlockColor([blockId], c);
          focusBlock(blockId, 'end');
        },
      },
      {
        id: 'bg-' + c, label: COLOR_LABEL[c] + ' background', section: 'Colors', keywords: 'background highlight ' + c,
        icon: <span className="swatch" style={{ background: `var(--bgcolor-${c})`, width: 20, height: 20 }} />,
        run: (blockId: string) => {
          setBlockColor([blockId], `${c}_background` as const);
          focusBlock(blockId, 'end');
        },
      },
    ]),
  ];
  return items.map(i => (i.section === 'Basic blocks' && ['image', 'code'].includes(i.id) ? { ...i, section: 'Media' } : i));
}

export const blockSelectionIds = () => getUi().selectedBlocks;
