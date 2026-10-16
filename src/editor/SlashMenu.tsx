import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { slashState, editableFor } from './controller';
import { slashItems, type SlashItem } from './BlockMenu';
import { caretOffset, setCaret } from './caret';
import { transact } from '../store/store';
import { sanitizeInline } from '../lib/html';
import { splitAtSelection } from './caret';
import { SLASH_CHARS, asciiShortcut } from './ops';
import { MOTION, playExit } from '../lib/motion';

function readQuery(): { q: string; valid: boolean } {
  const s = slashState.get();
  if (!s) return { q: '', valid: false };
  const el = editableFor(s.blockId);
  if (!el || document.activeElement !== el) return { q: '', valid: false };
  const off = caretOffset(el);
  const text = el.textContent || '';
  if (off === null || off <= s.start || !SLASH_CHARS.includes(text[s.start])) return { q: '', valid: false };
  // Full width letters typed with a CJK input method match like their ASCII forms.
  return { q: asciiShortcut(text.slice(s.start + 1, off)), valid: true };
}

function score(item: SlashItem, q: string): number {
  if (!q) return 1;
  const l = item.label.toLowerCase();
  const query = q.toLowerCase();
  if (l.startsWith(query)) return 3;
  if (l.split(/\s+/).some(w => w.startsWith(query))) return 2;
  if ((item.keywords || '').toLowerCase().split(/\s+/).some(w => w.startsWith(query))) return 1.5;
  if (l.includes(query)) return 1;
  return 0;
}

export function SlashMenu() {
  const s = slashState.use();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const missRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: -999, top: -999, transformOrigin: '0% 0%' });
  // The box leaves with the menu exit animation; React runs a ref cleanup before it detaches the node.
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    boxRef.current = el;
    if (!el) return;
    return () => {
      boxRef.current = null;
      playExit(el, MOTION.menu);
    };
  }, []);
  const all = useMemo(() => slashItems(), []);

  const results = useMemo(() => {
    if (!q) return all.filter(i => i.section !== 'Colors');
    return all
      .map(i => ({ i, s: score(i, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.i);
  }, [q, all]);

  useEffect(() => {
    setQ('');
    setActive(0);
    missRef.current = 0;
  }, [s]);

  useEffect(() => {
    if (!s) return;
    const onInput = () => {
      const r = readQuery();
      if (!r.valid) {
        slashState.set(null);
        return;
      }
      setQ(r.q);
      setActive(0);
    };
    const onSel = () => {
      requestAnimationFrame(() => {
        if (!slashState.get()) return;
        if (!readQuery().valid) slashState.set(null);
      });
    };
    window.addEventListener('on:slash-input', onInput);
    document.addEventListener('selectionchange', onSel);
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) slashState.set(null);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('on:slash-input', onInput);
      document.removeEventListener('selectionchange', onSel);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [s]);

  // Close when nothing matches for a while (Notion closes after a few unmatched keystrokes).
  useEffect(() => {
    if (!s) return;
    if (results.length === 0) {
      missRef.current++;
      if (missRef.current > 3 || /\s$/.test(q)) slashState.set(null);
    } else missRef.current = 0;
  }, [results.length, q, s]);

  const choose = (item: SlashItem) => {
    const st = slashState.get();
    if (!st) return;
    const el = editableFor(st.blockId);
    slashState.set(null);
    if (el) {
      // Remove "/query" from the block text.
      const off = caretOffset(el) ?? st.start + 1 + q.length;
      setCaret(el, st.start, off);
      const [before, after] = splitAtSelection(el);
      const html = sanitizeInline(before + after);
      // Sanitized just above: the editable shows exactly what the store will hold.
      el.innerHTML = html;
      transact(tx => tx.setBlock(st.blockId, { html }), 'push');
    }
    item.run(st.blockId);
  };

  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        setActive(a => (a + 1) % Math.max(1, results.length));
      } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        setActive(a => (a - 1 + results.length) % Math.max(1, results.length));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (!results.length) return;
        e.preventDefault();
        e.stopPropagation();
        choose(results[active]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Only the slash menu closes; other layers keep their own Escape.
        e.stopImmediatePropagation();
        slashState.set(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useLayoutEffect(() => {
    if (!s || !boxRef.current) return;
    const h = boxRef.current.offsetHeight;
    const w = boxRef.current.offsetWidth;
    let top = s.rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, s.rect.top - h - 6);
    let left = s.rect.left - 2;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    // Scale from the corner nearest the caret: below and left aligned, or flipped above it.
    setPos({ left, top, transformOrigin: `${left + w <= s.rect.left ? '100%' : '0%'} ${top < s.rect.top ? '100%' : '0%'}` });
  }, [s, results.length]);

  useEffect(() => {
    listRef.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // The caret stays in the editable, so the highlighted option is exposed through it.
  const activeId = results[active] ? 'slash-opt-' + results[active].id : undefined;
  useEffect(() => {
    const el = s ? editableFor(s.blockId) : null;
    if (!el || !activeId) return;
    el.setAttribute('aria-controls', 'slash-listbox');
    el.setAttribute('aria-activedescendant', activeId);
    return () => {
      el.removeAttribute('aria-controls');
      el.removeAttribute('aria-activedescendant');
    };
  }, [s, activeId]);

  if (!s || results.length === 0) return null;
  let last = '';
  return createPortal(
    <div ref={attachBox} className="popover" style={{ ...pos, width: 324 }} onMouseDown={e => e.preventDefault()}>
      <div className="menu" ref={listRef} id="slash-listbox" role="listbox" aria-label="Insert a block" style={{ maxHeight: 340 }}>
        {results.map((item, idx) => {
          const head = !q && item.section !== last ? item.section : q && idx === 0 ? 'Results' : null;
          last = item.section;
          return (
            <div key={item.id} role="presentation">
              {head && <div className="menu-label" role="presentation">{head}</div>}
              <div
                id={'slash-opt-' + item.id}
                role="option"
                aria-selected={idx === active}
                className={'menu-item' + (idx === active ? ' active' : '')}
                onMouseMove={() => idx !== active && setActive(idx)}
                onClick={() => choose(item)}
              >
                <span className="mi-icon">{item.icon}</span>
                <span className="mi-text">{item.label}</span>
                {item.shortcut && <span className="mi-right">{item.shortcut}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="menu-footer" style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 14px' }}>
        <span>Type '/' on the page</span>
        <span>
          esc <span style={{ marginInlineStart: 4 }}>Close menu</span>
        </span>
      </div>
    </div>,
    document.body,
  );
}
