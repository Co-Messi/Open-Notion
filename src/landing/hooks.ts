import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Namespaced so it never collides with the workspace app's own `on:` keys. */
const THEME_KEY = 'opennotion.landing.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readSystemTheme(): Theme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Light by default, follows the system until the visitor picks a theme with the
 * nav toggle, then remembers that pick. The inline script in index.html applies
 * a stored pick before first paint; this hook keeps React and the DOM in step.
 */
export function useThemeState() {
  const [stored, setStored] = useState<Theme | null>(readStoredTheme);
  const [system, setSystem] = useState<Theme>(readSystemTheme);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (stored) root.setAttribute('data-theme', stored);
    else root.removeAttribute('data-theme');
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => {
      const dark = stored ? stored === 'dark' : meta.media.includes('dark');
      meta.content = dark ? '#191919' : '#ffffff';
    });
  }, [stored]);

  const theme: Theme = stored ?? system;

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setStored(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: the choice simply lasts for this visit */
    }
  }, [theme]);

  return { theme, toggle };
}

export const ThemeContext = createContext<Theme>('light');
export const useTheme = () => useContext(ThemeContext);

/** Adds `is-in` to every `.reveal` element as it scrolls into view. */
export function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export function useScrolled(offset = 4) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > offset);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [offset]);
  return scrolled;
}

export function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduce;
}
