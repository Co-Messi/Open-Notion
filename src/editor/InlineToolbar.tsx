import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Underline, Strikethrough, Code, Link2, ChevronDown, MessageSquare, MoreHorizontal } from 'lucide-react';
import { observable } from './controller';
import { getDoc, transact } from '../store/store';
import { sanitizeInline, COLOR_SENTINELS } from '../lib/html';
import { selectionOffsets, setCaret } from './caret';
import { Popover, Menu, Tooltip, MOD } from '../components/ui';
import { TurnIntoMenu, BLOCK_TYPE_LABEL, ColorMenu } from './BlockMenu';
import type { ColorName } from '../store/types';
import { attrSel } from '../lib/dom';
import { normalizeTypedLink } from '../lib/url';

interface TBState {
  rect: DOMRect;
  blockId: string;
}
const state = observable<TBState | null>(null);

export const inlineToolbarState = {
  refresh() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (state.get() && !keepOpen) state.set(null);
      return;
    }
    const r = sel.getRangeAt(0);
    const host = (r.commonAncestorContainer instanceof HTMLElement ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest(
      '.editable',
    ) as HTMLElement | null;
    if (!host || !host.dataset.editableId || !host.isContentEditable) {
      if (!keepOpen) state.set(null);
      return;
    }
    if (!r.toString().trim()) {
      if (!keepOpen) state.set(null);
      return;
    }
    const rects = r.getClientRects();
    const first = rects[0] || r.getBoundingClientRect();
    state.set({ rect: first, blockId: host.dataset.editableId });
  },
  hide() {
    state.set(null);
  },
};
let keepOpen = false;

const SENTINEL_FOR: Record<string, string> = Object.fromEntries(Object.entries(COLOR_SENTINELS).map(([hex, name]) => [name, hex]));

function exec(cmd: string, value?: string) {
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand(cmd, false, value);
}

function commitHost(blockId: string) {
  const el = document.querySelector(attrSel('data-editable-id', blockId)) as HTMLElement | null;
  if (!el) return;
  const offs = selectionOffsets(el);
  const clean = sanitizeInline(el.innerHTML);
  transact(tx => tx.setBlock(blockId, { html: clean }));
  // The editable rewrites its DOM from the sanitized html; restore the selection afterwards.
  requestAnimationFrame(() => {
    if (offs) {
      el.focus();
      setCaret(el, offs[0], offs[1]);
    }
    inlineToolbarState.refresh();
  });
}

export function applyMark(blockId: string, mark: 'bold' | 'italic' | 'underline' | 'strike' | 'code') {
  if (mark === 'code') {
    toggleCode(blockId);
  } else {
    exec(mark === 'strike' ? 'strikeThrough' : mark);
  }
  commitHost(blockId);
}

function toggleCode(_blockId: string) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const anc = (r.commonAncestorContainer instanceof HTMLElement ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest('code');
  if (anc) {
    // Unwrap
    const parent = anc.parentNode!;
    while (anc.firstChild) parent.insertBefore(anc.firstChild, anc);
    parent.removeChild(anc);
    return;
  }
  exec('fontName', 'nc-code');
}

export function applyColor(blockId: string, color: ColorName, background: boolean) {
  const hex = SENTINEL_FOR[color] || SENTINEL_FOR['default'];
  if (background) exec('hiliteColor', hex);
  else exec('foreColor', hex);
  commitHost(blockId);
}

export function applyLink(blockId: string, url: string | null) {
  if (!url) exec('unlink');
  else exec('createLink', url);
  commitHost(blockId);
}

function activeMarks(): Record<string, boolean> {
  const q = (c: string) => {
    try {
      return document.queryCommandState(c);
    } catch {
      return false;
    }
  };
  const sel = window.getSelection();
  let code = false;
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    const n = r.commonAncestorContainer instanceof HTMLElement ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    code = !!n?.closest('code');
  }
  return { bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'), code };
}

export function InlineToolbar() {
  const s = state.use();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -999, top: -999 });
  const [sub, setSub] = useState<null | { kind: 'turn' | 'color' | 'link' | 'more'; rect: DOMRect }>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let t: number | undefined;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => inlineToolbarState.refresh(), 60);
    };
    document.addEventListener('selectionchange', on);
    const onScroll = () => state.get() && inlineToolbarState.refresh();
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('selectionchange', on);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!s || !ref.current) return;
    const w = ref.current.offsetWidth;
    let left = s.rect.left;
    let top = s.rect.top - 40 - 4;
    if (top < 50) top = s.rect.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ left, top });
  }, [s]);

  useEffect(() => {
    if (!s) setSub(null);
    force(x => x + 1);
  }, [s]);

  if (!s) return null;
  const block = getDoc().blocks[s.blockId];
  if (!block) return null;
  const marks = activeMarks();
  const btn = (key: keyof typeof marks, icon: React.ReactNode, label: string, sc: string) => (
    <Tooltip label={label} shortcut={sc}>
      <div
        className={'itb' + (marks[key] ? ' on' : '')}
        onMouseDown={e => {
          e.preventDefault();
          applyMark(s.blockId, key as any);
        }}
      >
        {icon}
      </div>
    </Tooltip>
  );
  const open = (kind: 'turn' | 'color' | 'link' | 'more') => (e: React.MouseEvent) => {
    e.preventDefault();
    keepOpen = true;
    setSub({ kind, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  };
  const closeSub = () => {
    keepOpen = false;
    setSub(null);
    // The block may have changed size (e.g. turned into a heading); re-anchor the toolbar.
    requestAnimationFrame(() => requestAnimationFrame(() => inlineToolbarState.refresh()));
  };

  return createPortal(
    <>
      <div ref={ref} className="inline-toolbar" style={pos} onMouseDown={e => e.preventDefault()}>
        <div className="itb" onMouseDown={open('turn')}>
          {BLOCK_TYPE_LABEL[block.type] || 'Text'}
          <ChevronDown size={12} className="chev" />
        </div>
        <div className="sep" />
        <Tooltip label="Add link" shortcut={`${MOD}K`}>
          <div className="itb" onMouseDown={open('link')}>
            <Link2 size={16} />
          </div>
        </Tooltip>
        <Tooltip label="Comment" shortcut={`${MOD}⇧M`}>
          <div
            className="itb"
            onMouseDown={e => {
              e.preventDefault();
              const text = window.getSelection()?.toString() || '';
              window.dispatchEvent(new CustomEvent('on:add-comment', { detail: { quote: text } }));
            }}
          >
            <MessageSquare size={16} />
          </div>
        </Tooltip>
        <div className="sep" />
        {btn('bold', <Bold size={16} strokeWidth={2.4} />, 'Bold', `${MOD}B`)}
        {btn('italic', <Italic size={16} />, 'Italicize', `${MOD}I`)}
        {btn('underline', <Underline size={16} />, 'Underline', `${MOD}U`)}
        {btn('strike', <Strikethrough size={16} />, 'Strike-through', `${MOD}⇧S`)}
        {btn('code', <Code size={16} />, 'Mark as code', `${MOD}E`)}
        <div className="sep" />
        <Tooltip label="Text color">
          <div className="itb" onMouseDown={open('color')}>
            <span style={{ fontWeight: 500, fontSize: 15, textDecoration: 'underline', textUnderlineOffset: 2 }}>A</span>
            <ChevronDown size={12} className="chev" />
          </div>
        </Tooltip>
        <div className="itb" onMouseDown={open('more')}>
          <MoreHorizontal size={16} />
        </div>
      </div>
      {sub?.kind === 'turn' && (
        <Popover anchor={sub.rect} onClose={closeSub} width={240}>
          <TurnIntoMenu ids={[s.blockId]} onClose={closeSub} />
        </Popover>
      )}
      {sub?.kind === 'color' && (
        <Popover anchor={sub.rect} onClose={closeSub} width={220}>
          <ColorMenu
            onClose={closeSub}
            onPick={(c, bg) => {
              applyColor(s.blockId, c, bg);
              closeSub();
            }}
          />
        </Popover>
      )}
      {sub?.kind === 'link' && <LinkEditor anchor={sub.rect} blockId={s.blockId} onClose={closeSub} />}
      {sub?.kind === 'more' && (
        <Popover anchor={sub.rect} onClose={closeSub} width={220}>
          <Menu
            onClose={closeSub}
            items={[
              { id: 'clear', label: 'Clear formatting', onSelect: () => { exec('removeFormat'); commitHost(s.blockId); } },
              { id: 'copy', label: 'Copy', right: `${MOD}C`, onSelect: () => document.execCommand('copy') },
            ]}
          />
        </Popover>
      )}
    </>,
    document.body,
  );
}

export function LinkEditor({ anchor, blockId, onClose }: { anchor: DOMRect; blockId: string; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const saved = useRef<Range | null>(null);
  useEffect(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) saved.current = sel.getRangeAt(0).cloneRange();
    const n = saved.current?.commonAncestorContainer;
    const a = (n instanceof HTMLElement ? n : n?.parentElement)?.closest('a');
    if (a) setUrl(a.getAttribute('href') || '');
  }, []);
  const apply = (v: string | null) => {
    const sel = window.getSelection();
    const el = document.querySelector(attrSel('data-editable-id', blockId)) as HTMLElement | null;
    el?.focus();
    if (saved.current && sel) {
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
    const href = v?.trim() ? normalizeTypedLink(v) : null;
    if (v?.trim() && !href) {
      onClose();
      return;
    }
    applyLink(blockId, href);
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={320}>
      <div className="link-editor">
        <input
          className="text-input"
          autoFocus
          placeholder="Paste link or search pages"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply(url);
            }
          }}
        />
        {url && (
          <div className="menu" style={{ padding: 0 }}>
            <div className="menu-item active" style={{ margin: 0 }} onMouseDown={e => e.preventDefault()} onClick={() => apply(url)}>
              <span className="mi-icon">
                <Link2 size={16} />
              </span>
              <span className="mi-text">{url}</span>
              <span className="mi-right">Link</span>
            </div>
            <div className="menu-item danger" style={{ margin: 0 }} onClick={() => apply(null)}>
              <span className="mi-text">Remove link</span>
            </div>
          </div>
        )}
      </div>
    </Popover>
  );
}
