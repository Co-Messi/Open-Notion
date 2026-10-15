/**
 * Motion timings measured from the Notion desktop app (7.37): side peek and sidebar 200ms ease,
 * menus and popovers 200ms ease, tooltips 50ms ease-out. The CSS uses the same numbers; these
 * copies drive the timeout fallbacks.
 */
export const MOTION = { panel: 200, menu: 200, tooltip: 50 } as const;

/** Extra time a fallback timer waits past a transition, for browsers that never fire transitionend. */
const SLACK = 60;

/**
 * True when motion should be skipped. Environments without matchMedia (jsdom) have no layout or
 * animation either, so they count as reduced motion and close everything at once.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/**
 * Calls done once: when el finishes its own transition of prop (bubbling child transitions are
 * ignored), or after ms plus a little slack if transitionend never arrives. Returns a cancel.
 */
export function afterTransition(el: Element | null, prop: string, ms: number, done: () => void): () => void {
  let over = false;
  const stop = () => {
    over = true;
    window.clearTimeout(timer);
    el?.removeEventListener('transitionend', onEnd);
  };
  const finish = () => {
    if (over) return;
    stop();
    done();
  };
  const onEnd = (e: Event) => {
    if (e.target === el && (e as TransitionEvent).propertyName === prop) finish();
  };
  el?.addEventListener('transitionend', onEnd);
  const timer = window.setTimeout(finish, ms + SLACK);
  return stop;
}

/** Marks a copy of an element that is playing its exit animation. Queries for live layers skip it. */
export const EXITING_CLASS = 'is-exiting';

/**
 * Plays the exit animation of an element that React is about to remove: a static copy takes
 * its place, gets the is-exiting class (the CSS holds the animation), and is removed when the
 * animation ends or after ms plus slack. The copy is inert, hidden from assistive technology and
 * has no ids, so focus, Escape handling and aria references only ever see the live UI.
 *
 * Call it from a layout effect cleanup or a ref cleanup, which React runs before it detaches the
 * element. Nothing happens under reduced motion, or when the element stays in the document.
 */
export function playExit(el: HTMLElement | null, ms: number) {
  if (!el || !el.isConnected || prefersReducedMotion()) return;
  const parent = el.parentNode;
  const next = el.nextSibling;
  const copy = el.cloneNode(true) as HTMLElement;
  // Cloning keeps structure, so the nth element of one tree is the nth of the other. Carry over
  // what a clone loses (scroll offsets) and re-apply inline styles through CSSOM, which a strict
  // style-src policy always allows.
  const from = [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))];
  const to = [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))];
  const scrolled: [HTMLElement, number, number][] = [];
  from.forEach((src, i) => {
    const dst = to[i];
    if (!dst) return;
    if (src.scrollTop || src.scrollLeft) scrolled.push([dst, src.scrollTop, src.scrollLeft]);
    if (src.style && dst.style && dst.style.cssText !== src.style.cssText) dst.style.cssText = src.style.cssText;
    dst.removeAttribute('id');
  });
  copy.classList.add(EXITING_CLASS);
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  // React removes the element right after this call returns, inside the same commit.
  queueMicrotask(() => {
    if (el.isConnected || !parent || !parent.isConnected) return;
    parent.insertBefore(copy, next && next.parentNode === parent ? next : null);
    for (const [node, top, left] of scrolled) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    let timer = 0;
    const remove = () => {
      window.clearTimeout(timer);
      copy.remove();
    };
    copy.addEventListener('animationend', e => e.target === copy && remove());
    timer = window.setTimeout(remove, ms + SLACK);
  });
}
