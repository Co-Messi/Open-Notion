import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { transact, getDoc, getUi } from '../store/store';
import { sanitizeInline } from '../lib/html';
import { openExternal, safeHref } from '../lib/url';
import { caretOffset, setCaret, selectionOffsets } from './caret';
import { tryMarkdown, maybeOpenSlash, exitFormatting, clearExitFormatting } from './ops';
import { slashState, clearBlockSelection } from './controller';
import { handlePaste } from './clipboard';
import { inlineToolbarState } from './InlineToolbar';

/**
 * Opens an inline link's target without ever navigating this tab away: in app links
 * (`#/...`) change the route, everything else opens in a new tab with noopener.
 */
export function openInlineHref(raw: string | null) {
  const href = safeHref(raw);
  if (!href) return;
  if (href.startsWith('#/')) {
    location.hash = href;
    return;
  }
  if (href.startsWith('#')) return;
  openExternal(new URL(href, location.href).href);
}

/**
 * Click handling for links inside rich text. In an editable block a plain click only places
 * the caret and Cmd or Ctrl click opens the link. In a locked (read only) block the browser
 * would follow the link in this tab, so every click is intercepted and opened safely instead.
 */
export function handleInlineLinkClick(e: MouseEvent<HTMLElement>, editable: boolean) {
  const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || !e.currentTarget.contains(a)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (editable && !mod) return;
  e.preventDefault();
  openInlineHref(a.getAttribute('href'));
}

interface Props {
  blockId: string;
  html: string;
  placeholder?: string;
  /** Show placeholder even when not focused (e.g. empty headings). */
  alwaysPlaceholder?: boolean;
  className?: string;
  readOnly?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>, el: HTMLDivElement) => void;
  style?: React.CSSProperties;
}

/**
 * A contentEditable bound to a block's html.
 * The DOM is the source of truth while typing; the store is only written back into the DOM
 * when it changes from outside (undo, merges, turn-into). IME composition is never interrupted.
 */
export function Editable({ blockId, html, placeholder, alwaysPlaceholder, className = '', readOnly, onKeyDown, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const committed = useRef<string | null>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (composing.current) return;
    if (html === committed.current) return;
    // Stored html is sanitized on the way in; sanitizing again here keeps the live DOM safe even
    // if something unsanitized ever reaches the store.
    const safe = sanitizeInline(html);
    if (el.innerHTML !== safe) {
      const focused = document.activeElement === el;
      const off = focused ? caretOffset(el) : null;
      el.innerHTML = safe;
      if (focused && off !== null) setCaret(el, off);
    }
    committed.current = html;
    el.dataset.empty = String(isEmpty(el));
  }, [html]);

  const commitRef = useRef<() => void>(() => {});
  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeInline(el.innerHTML);
    // Keep the DOM in the same normalized form as the store (e.g. execCommand's <font> tags
    // become color classes) so formatting displays and toggles correctly.
    if (el.innerHTML !== clean && !composing.current) {
      const offs = document.activeElement === el ? selectionOffsets(el) : null;
      el.innerHTML = clean;
      if (offs) setCaret(el, offs[0], offs[1]);
    }
    el.dataset.empty = String(isEmpty(el));
    committed.current = clean;
    const cur = getDoc().blocks[blockId];
    if (cur && cur.html !== clean) {
      transact(tx => tx.setBlock(blockId, { html: clean }), { key: 'type:' + blockId });
    }
  };
  commitRef.current = commit;

  // Native beforeinput (React's onBeforeInput is a legacy polyfill without inputType).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBefore = (ne: InputEvent) => {
      // After a markdown shortcut closes an inline mark, keep typing outside of it.
      const mark = exitFormatting;
      if (!mark) return;
      clearExitFormatting();
      if (ne.inputType !== 'insertText' || !ne.data || !mark.isConnected || composing.current) return;
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      const atMarkEnd =
        (r.startContainer === mark.parentNode && r.startContainer.childNodes[r.startOffset - 1] === mark) ||
        (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset === 0 && r.startContainer.previousSibling === mark) ||
        (mark.contains(r.startContainer) && r.startOffset === (r.startContainer.textContent || '').length);
      if (!atMarkEnd) return;
      ne.preventDefault();
      const next = mark.nextSibling;
      let tn: Text;
      if (next && next.nodeType === Node.TEXT_NODE) {
        tn = next as Text;
        tn.insertData(0, ne.data);
      } else {
        tn = document.createTextNode(ne.data);
        mark.parentNode!.insertBefore(tn, next);
      }
      const nr = document.createRange();
      nr.setStart(tn, ne.data.length);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      commitRef.current();
    };
    el.addEventListener('beforeinput', onBefore);
    return () => el.removeEventListener('beforeinput', onBefore);
  }, []);

  return (
    <div
      ref={ref}
      className={'editable ' + className + (alwaysPlaceholder ? ' always-ph' : '')}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      data-editable-id={blockId}
      data-nav=""
      data-placeholder={placeholder}
      style={style}
      onFocus={() => clearBlockSelection()}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        commit();
      }}
      onInput={e => {
        const native = e.nativeEvent as InputEvent;
        if (composing.current || native.isComposing) {
          const el = ref.current;
          if (el) el.dataset.empty = String(isEmpty(el));
          return;
        }
        const el = ref.current!;
        if (native.inputType === 'insertText') {
          if (tryMarkdown(el, blockId, native.data)) return;
          maybeOpenSlash(el, blockId, native.data);
        }
        commit();
        if (slashState.get()?.blockId === blockId) window.dispatchEvent(new Event('on:slash-input'));
      }}
      onClick={e => handleInlineLinkClick(e, !readOnly)}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return;
        onKeyDown?.(e, ref.current!);
      }}
      onPaste={e => handlePaste(e, blockId, ref.current!, commit)}
      onMouseUp={() => setTimeout(() => inlineToolbarState.refresh(), 0)}
      onKeyUp={e => {
        if (e.shiftKey || e.key === 'a') setTimeout(() => inlineToolbarState.refresh(), 0);
      }}
      onBlur={() => {
        if (!composing.current) commit();
        if (getUi().selectedBlocks.length === 0) setTimeout(() => inlineToolbarState.refresh(), 0);
      }}
    />
  );
}

function isEmpty(el: HTMLElement) {
  const t = el.textContent || '';
  return t.length === 0 && !el.querySelector('img');
}
