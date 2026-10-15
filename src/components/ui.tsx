import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { attrSel } from '../lib/dom';

export type Anchor = DOMRect | { x: number; y: number; width?: number; height?: number } | HTMLElement | null;

function rectOf(a: Anchor): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  if (!a) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  if (a instanceof HTMLElement) return a.getBoundingClientRect();
  if ('left' in a) return a as DOMRect;
  const w = a.width || 0;
  const h = a.height || 0;
  return { left: a.x, top: a.y, right: a.x + w, bottom: a.y + h, width: w, height: h };
}

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start' | 'left-start' | 'bottom-center' | 'center';

interface PopoverProps {
  anchor: Anchor;
  onClose: () => void;
  placement?: Placement;
  offset?: number;
  width?: number;
  className?: string;
  children: ReactNode;
  /** Keep focus in the page (used by editor menus that must not steal focus). */
  noFocusTrap?: boolean;
  /** Clicking the layer behind the popover closes it. */
  closeOnOutside?: boolean;
  /** Transparent layer that blocks clicks outside (Notion behaviour). */
  layer?: boolean;
  style?: React.CSSProperties;
}

export function Popover({
  anchor,
  onClose,
  placement = 'bottom-start',
  offset = 4,
  width,
  className = '',
  children,
  closeOnOutside = true,
  layer = true,
  style,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = rectOf(anchor);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = r.left;
      let top = r.bottom + offset;
      if (placement === 'bottom-end') left = r.right - w;
      if (placement === 'bottom-center') left = r.left + r.width / 2 - w / 2;
      if (placement === 'top-start') top = r.top - h - offset;
      if (placement === 'right-start') {
        left = r.right + offset;
        top = r.top - 6;
        if (left + w > vw - 8) left = r.left - w - offset;
      }
      if (placement === 'left-start') {
        left = r.left - w - offset;
        top = r.top;
      }
      if (placement === 'center') {
        left = vw / 2 - w / 2;
        top = Math.max(60, vh / 2 - h / 2 - 60);
      }
      if (placement.startsWith('bottom') && top + h > vh - 8 && r.top - h - offset > 8) top = r.top - h - offset;
      if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
      if (top < 8) top = 8;
      if (left + w > vw - 8) left = vw - w - 8;
      if (left < 8) left = 8;
      setPos({ left, top });
    };
    place();
    // autoFocus fires while the popover is still hidden on its first frame; focus once it is placed.
    requestAnimationFrame(() => {
      const af = el.querySelector('input:not([type=file]), textarea') as HTMLElement | null;
      if (af && !el.contains(document.activeElement)) af.focus();
    });
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, placement, offset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return createPortal(
    <>
      {layer && (
        <div
          className="popover-layer"
          onMouseDown={e => {
            e.preventDefault();
            if (closeOnOutside) closeRef.current();
          }}
          onContextMenu={e => {
            e.preventDefault();
            closeRef.current();
          }}
        />
      )}
      <div
        ref={ref}
        className={'popover ' + className}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, visibility: pos ? 'visible' : 'hidden', ...style }}
        onMouseDown={e => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Menu with keyboard navigation                                       */
/* ------------------------------------------------------------------ */

export interface MenuItemDef {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  desc?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Section heading shown before the item. */
  section?: string;
  separatorBefore?: boolean;
  keepOpen?: boolean;
  keywords?: string;
  submenu?: () => ReactNode;
}

interface MenuProps {
  items: MenuItemDef[];
  onClose: () => void;
  search?: boolean;
  searchPlaceholder?: string;
  header?: ReactNode;
  footer?: ReactNode;
  maxHeight?: number;
  autoFocusSearch?: boolean;
}

export function Menu({ items, onClose, search, searchPlaceholder = 'Search actions…', header, footer, maxHeight = 520, autoFocusSearch = true }: MenuProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [sub, setSub] = useState<{ id: string; rect: DOMRect } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = q
    ? items.filter(i => {
        const text = (typeof i.label === 'string' ? i.label : '') + ' ' + (i.keywords || '');
        return text.toLowerCase().includes(q.toLowerCase());
      })
    : items;
  const selectable = filtered.filter(i => !i.disabled);

  useEffect(() => setActive(0), [q]);

  const choose = (item: MenuItemDef, el?: HTMLElement) => {
    if (item.disabled) return;
    if (item.submenu) {
      const rect = (el || listRef.current?.querySelector(attrSel('data-mid', item.id)))?.getBoundingClientRect();
      if (rect) setSub({ id: item.id, rect });
      return;
    }
    item.onSelect?.();
    if (!item.keepOpen) onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sub) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(a => (a + 1) % Math.max(1, selectable.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(a => (a - 1 + selectable.length) % Math.max(1, selectable.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = selectable[active];
        if (it) choose(it);
      } else if (e.key === 'ArrowRight') {
        const it = selectable[active];
        if (it?.submenu) {
          e.preventDefault();
          choose(it);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const el = listRef.current?.querySelector('.menu-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastSection: string | undefined;
  const subItem = sub ? items.find(i => i.id === sub.id) : null;
  return (
    <>
      {search && (
        <div className="menu-search icon">
          <SearchIcon size={14} />
          <input autoFocus={autoFocusSearch} value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder} />
        </div>
      )}
      {header}
      <div className="menu" ref={listRef} style={{ maxHeight }}>
        {filtered.length === 0 && <div className="menu-empty">No results</div>}
        {filtered.map(item => {
          const idx = selectable.indexOf(item);
          const showSection = item.section && item.section !== lastSection;
          lastSection = item.section ?? lastSection;
          return (
            <React.Fragment key={item.id}>
              {item.separatorBefore && !q && <div className="menu-sep" />}
              {showSection && !q && <div className="menu-label">{item.section}</div>}
              <div
                data-mid={item.id}
                className={
                  'menu-item' +
                  (idx === active ? ' active' : '') +
                  (item.danger ? ' danger' : '') +
                  (item.disabled ? ' disabled' : '') +
                  (item.desc ? ' tall' : '')
                }
                onMouseMove={() => idx >= 0 && idx !== active && setActive(idx)}
                onMouseDown={e => e.preventDefault()}
                onClick={e => choose(item, e.currentTarget)}
              >
                {item.icon !== undefined && <span className="mi-icon">{item.icon}</span>}
                <div className="mi-text">
                  {item.label}
                  {item.desc && <div className="mi-desc">{item.desc}</div>}
                </div>
                {item.right !== undefined && <span className="mi-right">{item.right}</span>}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {footer}
      {sub && subItem?.submenu && (
        <Popover anchor={sub.rect} placement="right-start" onClose={() => setSub(null)}>
          {subItem.submenu()}
        </Popover>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function Switch({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  return (
    <span
      className={'switch' + (on ? ' on' : '')}
      role="switch"
      aria-checked={on}
      onClick={e => {
        e.stopPropagation();
        onChange?.(!on);
      }}
    />
  );
}

let tipTimer: number | undefined;
export function Tooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: React.ReactElement<any> }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const show = (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => setRect(target.getBoundingClientRect()), 500);
  };
  const hide = () => {
    window.clearTimeout(tipTimer);
    setRect(null);
  };
  const child = React.cloneElement(children, {
    onMouseEnter: (e: React.MouseEvent) => {
      show(e);
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hide();
      children.props.onMouseLeave?.(e);
    },
    onMouseDown: (e: React.MouseEvent) => {
      hide();
      children.props.onMouseDown?.(e);
    },
  });
  return (
    <>
      {child}
      {rect &&
        createPortal(
          <TooltipBubble rect={rect} label={label} shortcut={shortcut} />,
          document.body,
        )}
    </>
  );
}

function TooltipBubble({ rect, label, shortcut }: { rect: DOMRect; label: string; shortcut?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -999, top: -999 });
  useLayoutEffect(() => {
    const el = ref.current!;
    let left = rect.left + rect.width / 2 - el.offsetWidth / 2;
    let top = rect.bottom + 6;
    if (top + el.offsetHeight > window.innerHeight - 4) top = rect.top - el.offsetHeight - 6;
    left = Math.max(6, Math.min(left, window.innerWidth - el.offsetWidth - 6));
    setPos({ left, top });
  }, [rect]);
  return (
    <div ref={ref} className="tooltip" style={pos}>
      {label}
      {shortcut && <span className="sc">{shortcut}</span>}
    </div>
  );
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.8" />
      <path d="M10.6 10.6 14 14" />
    </svg>
  );
}

/** Formats a timestamp like Notion's "Edited" labels, in the user's locale. */
export function relTime(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  const loc = typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined;
  const english = !loc || /^en(-|$)/i.test(loc);
  if (s < 60) return english ? 'Just now' : rtf(loc, 0, 'second');
  const m = Math.floor(s / 60);
  if (m < 60) return rtf(loc, -m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return rtf(loc, -h, 'hour');
  const d = Math.floor(h / 24);
  if (d < 7) return rtf(loc, -d, 'day');
  return new Date(t).toLocaleDateString(loc, { month: 'short', day: 'numeric', year: 'numeric' });
}

function rtf(loc: string | undefined, n: number, unit: Intl.RelativeTimeFormatUnit): string {
  try {
    return new Intl.RelativeTimeFormat(loc, { numeric: 'auto', style: 'narrow' }).format(n, unit);
  } catch {
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' }).format(n, unit);
  }
}

export function useHotkey(handler: (e: KeyboardEvent) => void, deps: any[] = []) {
  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';
