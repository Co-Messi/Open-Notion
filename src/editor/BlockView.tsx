import { memo, useState, type KeyboardEvent } from 'react';
import { Plus, GripVertical, ChevronRight, Image as ImageIcon, Check } from 'lucide-react';
import { useBlock, useDoc, useUi, transact, getUi, undo, redo, breakCoalescing } from '../store/store';
import type { Block } from '../store/types';
import { Editable } from './Editable';
import {
  handleEnter, handleBackspaceAtStart, handleDeleteAtEnd, indentBlocks, duplicateAndFocus, moveBlockBy,
} from './ops';
import { atStart, atEnd, onFirstLine, onLastLine, caretRect, caretOffset, isCollapsed } from './caret';
import { focusBlock, neighbor, selectBlocks, slashState } from './controller';
import { applyMark } from './InlineToolbar';
import { BlockActionsMenu, turnIntoPage } from './BlockMenu';
import { openPage, pageTitle, txInsertAfter, txInsertBlock, turnInto } from '../store/actions';
import { PageIconView } from '../components/PageIcon';
import { EmojiPicker } from '../components/EmojiPicker';
import { StoredImg } from '../components/StoredImage';
import { isImageIcon } from '../lib/url';
import { CodeBlock } from './CodeBlock';
import { ImageBlock } from './ImageBlock';
import { TableBlock } from './TableBlock';
import { BookmarkBlock } from './BookmarkBlock';
import { startBlockDrag } from './dnd';
import { InlineDatabase } from '../database/DatabaseView';
import { LinkEditorFor } from './LinkShortcut';
import { attrSel } from '../lib/dom';

const PLACEHOLDER: Partial<Record<Block['type'], string>> = {
  text: "Write something, or press '/' for commands…",
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bulleted: 'List',
  numbered: 'List',
  todo: 'To-do',
  toggle: 'Toggle',
  quote: 'Empty quote',
  callout: 'Type something…',
};

interface Props {
  id: string;
  depth: number;
  /** 1-based index among consecutive numbered siblings. */
  number?: number;
  readOnly?: boolean;
}

export const BlockView = memo(function BlockView({ id, depth, number, readOnly }: Props) {
  const b = useBlock(id);
  const selected = useUi(u => u.selectedBlocks.includes(id));
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState<DOMRect | { x: number; y: number } | null>(null);
  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null);
  const [linkEditor, setLinkEditor] = useState<DOMRect | null>(null);
  if (!b) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, el: HTMLDivElement) => {
    const mod = e.metaKey || e.ctrlKey;
    if (slashState.get() && ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.key)) return;
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault();
      handleEnter(el, id);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && !mod) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      if (b.type === 'todo') transact(tx => tx.setBlock(id, { checked: !b.checked }));
      if (b.type === 'toggle') transact(tx => tx.setBlock(id, { open: !b.open }), 'none');
      return;
    }
    if (e.key === 'Backspace' && !mod && isCollapsed() && atStart(el)) {
      if (handleBackspaceAtStart(el, id)) e.preventDefault();
      return;
    }
    if (e.key === 'Delete' && isCollapsed() && atEnd(el)) {
      if (handleDeleteAtEnd(el, id)) e.preventDefault();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      indentBlocks([id], e.shiftKey, { id, offset: caretOffset(el) });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      selectBlocks([id]);
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !mod && !e.altKey && onFirstLine(el)) {
      const prev = neighbor(el, -1);
      if (prev) {
        e.preventDefault();
        const x = caretRect()?.left ?? 0;
        focusEl(prev, { x, line: 'last' });
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !mod && !e.altKey && onLastLine(el)) {
      const next = neighbor(el, 1);
      if (next) {
        e.preventDefault();
        const x = caretRect()?.left ?? 0;
        focusEl(next, { x, line: 'first' });
      }
      return;
    }
    if (e.key === 'ArrowLeft' && !e.shiftKey && !mod && atStart(el)) {
      const prev = neighbor(el, -1);
      if (prev) {
        e.preventDefault();
        focusEl(prev, 'end');
      }
      return;
    }
    if (e.key === 'ArrowRight' && !e.shiftKey && !mod && atEnd(el)) {
      const next = neighbor(el, 1);
      if (next) {
        e.preventDefault();
        focusEl(next, 'start');
      }
      return;
    }
    if (e.key === 'ArrowUp' && e.shiftKey && onFirstLine(el) && isCollapsed()) {
      e.preventDefault();
      selectBlocks([id]);
      return;
    }
    if (e.key === 'ArrowDown' && e.shiftKey && onLastLine(el) && isCollapsed()) {
      e.preventDefault();
      selectBlocks([id]);
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (k === 'y' && !e.metaKey) {
      e.preventDefault();
      redo();
      return;
    }
    if (k === 'b' && !e.shiftKey) {
      e.preventDefault();
      applyMark(id, 'bold');
    } else if (k === 'i' && !e.shiftKey) {
      e.preventDefault();
      applyMark(id, 'italic');
    } else if (k === 'u' && !e.shiftKey) {
      e.preventDefault();
      applyMark(id, 'underline');
    } else if (k === 's' && e.shiftKey) {
      e.preventDefault();
      applyMark(id, 'strike');
    } else if (k === 'e' && !e.shiftKey) {
      e.preventDefault();
      applyMark(id, 'code');
    } else if (k === 'k' && !e.shiftKey && !isCollapsed()) {
      e.preventDefault();
      const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      if (r) setLinkEditor(r);
    } else if (k === 'd' && !e.shiftKey) {
      e.preventDefault();
      duplicateAndFocus(id);
    } else if (k === 'a' && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.toString().length >= (el.textContent || '').length && (el.textContent || '').length >= 0 && !isCollapsed()) {
        e.preventDefault();
        const scope = el.closest('[data-editor-scope]');
        const all = Array.from(scope?.querySelectorAll(':scope .block[data-block-id]') || []).map(n => (n as HTMLElement).dataset.blockId!);
        selectBlocks(all);
      }
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey) {
      e.preventDefault();
      const off = caretOffset(el);
      moveBlockBy(id, e.key === 'ArrowUp' ? -1 : 1);
      focusBlock(id, off ?? 'end');
    } else if (e.altKey && /^Digit[0-9]$/.test(e.code)) {
      e.preventDefault();
      const map: Record<string, Block['type'] | 'page'> = {
        Digit0: 'text', Digit1: 'h1', Digit2: 'h2', Digit3: 'h3', Digit4: 'todo', Digit5: 'bulleted', Digit6: 'numbered', Digit7: 'toggle', Digit8: 'code', Digit9: 'page',
      };
      const t = map[e.code];
      if (t === 'page') turnIntoPage(id);
      else {
        turnInto([id], t);
        breakCoalescing();
        focusBlock(id, 'end');
      }
    }
  };

  const openMenuFromHandle = (rect: DOMRect) => {
    const sel = getDocSelection();
    const ids = sel.includes(id) ? sel : [id];
    if (!sel.includes(id)) selectBlocks([id]);
    setMenu(rect);
    return ids;
  };

  const addBelow = (alt: boolean) => {
    let nid = '';
    transact(tx => {
      if (alt) {
        nid = txInsertBlock(tx, { parent: b.parent, type: 'text', html: '' }, tx.siblings(id).indexOf(id));
      } else {
        const cur = tx.block(id);
        const next = tx.siblings(id)[tx.siblings(id).indexOf(id) + 1];
        const nextB = next ? tx.block(next) : null;
        if (nextB && nextB.type === 'text' && !nextB.html && nextB.children.length === 0) nid = nextB.id;
        else nid = txInsertAfter(tx, id, { type: 'text', html: '' });
        void cur;
      }
    });
    breakCoalescing();
    focusBlock(nid, 'start');
    // Open the slash menu like Notion does after clicking "+".
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(attrSel('data-editable-id', nid)) as HTMLElement | null;
        if (el && !el.textContent) {
          document.execCommand('insertText', false, '/');
        }
      }),
    );
  };

  const gutterTop = b.type === 'h1' ? 12 : b.type === 'h2' ? 6 : b.type === 'h3' ? 3 : b.type === 'callout' ? 14 : b.type === 'quote' ? 4 : b.type === 'code' ? 4 : b.type === 'divider' ? -5 : 0;

  const color = b.color || 'default';
  const [prefix, body] = renderContent();
  const hasChildrenArea =
    b.children.length > 0 && b.type !== 'page' && b.type !== 'database' && b.type !== 'columns' && b.type !== 'column' && (b.type !== 'toggle' || b.open);
  const showGutter = !readOnly && b.type !== 'columns' && b.type !== 'column';

  /** Returns [prefix, body]. The editable always sits in the same slot so a type change keeps the DOM node (and focus). */
  function renderContent(): [React.ReactNode, React.ReactNode] {
    const editable = (
      <Editable
        blockId={id}
        html={b!.html}
        placeholder={PLACEHOLDER[b!.type]}
        readOnly={readOnly}
        onKeyDown={onKeyDown}
      />
    );
    switch (b!.type) {
      case 'bulleted':
        return [<div key="m" className={'marker bullet l' + (depth % 3)} />, editable];
      case 'numbered':
        return [
          <div key="m" className="marker number">
            <span>{formatNumber(number || 1, depth)}.</span>
          </div>,
          editable,
        ];
      case 'todo':
        return [
          <div key="m" className="marker">
            <div
              className={'checkbox' + (b!.checked ? ' checked' : '')}
              role="checkbox"
              aria-checked={!!b!.checked}
              onMouseDown={e => e.preventDefault()}
              onClick={() => !readOnly && transact(tx => tx.setBlock(id, { checked: !b!.checked }))}
            >
              {b!.checked && <Check size={12} strokeWidth={3} />}
            </div>
          </div>,
          editable,
        ];
      case 'toggle':
        return [
          <div key="m" className="marker">
            <div
              className={'toggle-btn' + (b!.open ? ' open' : '')}
              role="button"
              aria-expanded={!!b!.open}
              onMouseDown={e => e.preventDefault()}
              onClick={() => transact(tx => tx.setBlock(id, { open: !b!.open }), 'none')}
            >
              <TriangleIcon />
            </div>
          </div>,
          editable,
        ];
      case 'callout':
        return [
          <div
            key="m"
            className="callout-icon"
            onMouseDown={e => e.preventDefault()}
            onClick={e => !readOnly && setIconPicker(e.currentTarget.getBoundingClientRect())}
          >
            {isImageIcon(b!.icon) ? <StoredImg src={b!.icon} className="callout-icon-img" /> : b!.icon || '💡'}
          </div>,
          editable,
        ];
      case 'divider':
        return [null, <div key="divider" className="divider" onClick={() => selectBlocks([id])} />];
      case 'code':
        return [null, <CodeBlock key="code" block={b!} readOnly={readOnly} />];
      case 'image':
        return [null, <ImageBlock key="image" block={b!} readOnly={readOnly} />];
      case 'table':
        return [null, <TableBlock key="table" block={b!} readOnly={readOnly} />];
      case 'bookmark':
        return [null, <BookmarkBlock key="bookmark" block={b!} />];
      case 'page':
        return [null, <PageLink key="page" pageId={b!.pageId!} isLink={b!.isLink} />];
      case 'database':
        return [null, <DatabaseBlock key="db" dbId={b!.pageId!} blockId={id} isLink={b!.isLink} />];
      case 'columns':
        return [null, <ColumnList key="cols" ids={b!.children} depth={depth} readOnly={readOnly} />];
      default:
        return [null, editable];
    }
  }

  return (
    <div
      className={
        'block t-' + b.type + (selected ? ' selected' : '') + (b.type === 'todo' && b.checked ? ' done' : '') + (hasChildrenArea ? ' has-children' : '')
      }
      data-block-id={id}
      data-color={color}
      onMouseEnter={e => {
        e.stopPropagation();
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('.editable') && !getDocSelection().includes(id)) return;
        e.preventDefault();
        e.stopPropagation();
        openMenuFromHandle(new DOMRect(e.clientX, e.clientY, 0, 0));
      }}
    >
      <div className="block-row">
        {showGutter && (
          <div className={'block-gutter' + (hover || menu ? ' visible' : '')} style={{ top: gutterTop }} onMouseDown={e => e.preventDefault()}>
            <div className="g-btn" title="Click to add below. Option-click to add a block above" role="button" onClick={e => addBelow(e.altKey)}>
              <Plus size={18} strokeWidth={1.5} />
            </div>
            <div
              className="g-btn drag"
              role="button"
              title="Drag to move. Click to open menu"
              onPointerDown={e => {
                const handleEl = e.currentTarget as HTMLElement;
                startBlockDrag(e, id, () => openMenuFromHandle(handleEl.getBoundingClientRect()));
              }}
            >
              <GripVertical size={16} strokeWidth={1.5} />
            </div>
          </div>
        )}
        {prefix}
        {body}
      </div>
      {b.type === 'toggle' && b.open && b.children.length === 0 && !readOnly && (
        <div className="block-children">
          <div
            className="toggle-empty"
            onClick={() => {
              let nid = '';
              transact(tx => {
                nid = txInsertBlock(tx, { parent: id, type: 'text', html: '' });
              });
              focusBlock(nid, 'start');
            }}
          >
            Empty toggle. Click or drop blocks inside.
          </div>
        </div>
      )}
      {hasChildrenArea && <BlockChildren ids={b.children} depth={depth + 1} readOnly={readOnly} />}
      {menu && (
        <BlockActionsMenu
          ids={getDocSelection().includes(id) ? getDocSelection() : [id]}
          anchor={menu}
          onClose={() => setMenu(null)}
        />
      )}
      {iconPicker && (
        <EmojiPicker
          anchor={iconPicker}
          onClose={() => setIconPicker(null)}
          onPick={emoji => {
            transact(tx => tx.setBlock(id, { icon: emoji || '💡' }));
            setIconPicker(null);
          }}
        />
      )}
      {linkEditor && <LinkEditorFor anchor={linkEditor} blockId={id} onClose={() => setLinkEditor(null)} />}
    </div>
  );
});

function getDocSelection(): string[] {
  return getUi().selectedBlocks;
}

function focusEl(el: HTMLElement, pos: 'start' | 'end' | { x: number; line: 'first' | 'last' }) {
  const id = el.dataset.editableId;
  if (id) {
    focusBlock(id, pos);
    return;
  }
  // Page title
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(pos === 'start');
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Inline databases render in place; full-page databases render as a link like other sub-pages. */
function DatabaseBlock({ dbId, blockId, isLink }: { dbId: string; blockId: string; isLink?: boolean }) {
  const inline = useDoc(d => !!d.pages[dbId]?.inline);
  if (!inline) return <PageLink pageId={dbId} isLink={isLink} />;
  return <InlineDatabase dbId={dbId} blockId={blockId} isLink={isLink} />;
}

function ColumnList({ ids, depth, readOnly }: { ids: string[]; depth: number; readOnly?: boolean }) {
  const cols = useDoc(d => ids.map(i => d.blocks[i]));
  return (
    <div className="column-list">
      {cols.map(c =>
        c ? (
          <div key={c.id} className="column" data-column-id={c.id}>
            <BlockChildren ids={c.children} depth={depth} readOnly={readOnly} flat />
          </div>
        ) : null,
      )}
    </div>
  );
}

export function BlockChildren({ ids, depth, readOnly, flat }: { ids: string[]; depth: number; readOnly?: boolean; flat?: boolean }) {
  // Numbered lists restart after any non-numbered block.
  const types = useDoc(d => ids.map(i => d.blocks[i]?.type));
  let n = 0;
  return (
    <div className={depth > 0 && !flat ? 'block-children' : 'block-list'}>
      {ids.map((cid, i) => {
        n = types[i] === 'numbered' ? n + 1 : 0;
        return <BlockView key={cid} id={cid} depth={depth} number={n || undefined} readOnly={readOnly} />;
      })}
    </div>
  );
}

function formatNumber(n: number, depth: number): string {
  const lvl = depth % 3;
  if (lvl === 1) {
    let s = '';
    let x = n;
    while (x > 0) {
      x--;
      s = String.fromCharCode(97 + (x % 26)) + s;
      x = Math.floor(x / 26);
    }
    return s;
  }
  if (lvl === 2) {
    const r: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let x = n;
    let s = '';
    for (const [v, t] of r) while (x >= v) {
      s += t;
      x -= v;
    }
    return s;
  }
  return String(n);
}

function TriangleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <path d="M4 2.2v7.6c0 .4.5.7.8.4l4.4-3.8c.3-.2.3-.6 0-.8L4.8 1.8c-.3-.3-.8 0-.8.4Z" />
    </svg>
  );
}

function PageLink({ pageId, isLink }: { pageId: string; isLink?: boolean }) {
  const p = useDoc(d => d.pages[pageId], Object.is);
  if (!p || p.trashed) {
    return (
      <div className="page-link" style={{ color: 'var(--text-tertiary)' }}>
        <span className="pl-icon">
          <ImageIcon size={16} style={{ display: 'none' }} />
        </span>
        <span>{p?.trashed ? 'Page moved to trash' : 'Deleted page'}</span>
      </div>
    );
  }
  return (
    <div className="page-link" onClick={e => openPage(pageId, { peek: e.altKey })} role="link">
      <span className="pl-icon">
        <PageIconView page={p} size={18} emojiSize={17} />
      </span>
      {isLink && <ChevronRight size={12} style={{ marginLeft: -4, color: 'var(--icon-tertiary)' }} />}
      <span className="pl-title">{pageTitle(p)}</span>
    </div>
  );
}

