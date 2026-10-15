import { useEffect, useRef, type RefObject } from 'react';

/**
 * Popovers render hidden for their first frame while they measure, so `autoFocus`
 * lands on an invisible element and is lost. Focus once the element is visible.
 */
export function useFocusLater(ref: RefObject<HTMLElement | null>, caretEnd = true) {
  useEffect(() => {
    let tries = 0;
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el && getComputedStyle(el).visibility === 'visible') {
        el.focus({ preventScroll: true });
        if (caretEnd && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          const n = el.value.length;
          try {
            el.setSelectionRange(n, n);
          } catch {
            /* number inputs do not support selection */
          }
        }
        return;
      }
      if (tries++ < 20) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Drop inside a Popover that contains a searchable Menu to focus its search box. */
export function FocusMenuSearch() {
  const marker = useRef<HTMLSpanElement>(null);
  const target = useRef<HTMLElement | null>(null);
  useEffect(() => {
    target.current = (marker.current?.closest('.popover')?.querySelector('.menu-search input, input.text-input') as HTMLElement) || null;
  }, []);
  useFocusLater(target);
  return <span ref={marker} hidden />;
}
