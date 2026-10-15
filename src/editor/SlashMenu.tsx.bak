import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { slashState, editableFor } from './controller';
import { slashItems, type SlashItem } from './BlockMenu';
import { caretOffset, setCaret } from './caret';
import { transact } from '../store/store';
import { sanitizeInline } from '../lib/html';
import { splitAtSelection } from './caret';

function readQuery(): { q: string; valid: boolean } {
  const s = slashState.get();
  if (!s) return { q: '', valid: false };
  const el = editableFor(s.blockId);
  if (!el || document.activeElement !== el) return { q: '', valid: false };
  const off = caretOffset(el);
  const text = el.textContent || '';
  if (off === null || off <= s.start || text[s.start] !== '/') return { q: '', valid: false };
  return { q: text.slice(s.start + 1, off), valid: true };
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
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -999, top: -999 });
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
        e.stopPropagation();
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
    setPos({ left, top });
  }, [s, results.length]);

  useEffect(() => {
    listRef.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!s || results.length === 0) return null;
  let last = '';
  return createPortal(
    <div ref={boxRef} className="popover" style={{ ...pos, width: 324 }} onMouseDown={e => e.preventDefault()}>
      <div className="menu" ref={listRef} style={{ maxHeight: 340 }}>
        {results.map((item, idx) => {
          const head = !q && item.section !== last ? item.section : q && idx === 0 ? 'Results' : null;
          last = item.section;
          return (
            <div key={item.id}>
              {head && <div className="menu-label">{head}</div>}
              <div
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
          esc <span style={{ marginLeft: 4 }}>Close menu</span>
        </span>
      </div>
    </div>,
    document.body,
  );
}
