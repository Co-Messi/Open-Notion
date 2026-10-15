import { isSafeId } from '../lib/own';
import type { Route } from './store';

/** Parses the URL hash. Page ids are validated so `#/p/constructor` cannot reach the store. */
export function parseHash(hash: string = location.hash): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h.startsWith('p/')) {
    let id = h.slice(2).split('?')[0];
    try {
      id = decodeURIComponent(id);
    } catch {
      return { name: 'home' };
    }
    return isSafeId(id) ? { name: 'page', pageId: id } : { name: 'home' };
  }
  if (h === 'chat') return { name: 'chat' };
  if (h === 'meetings') return { name: 'meetings' };
  if (h === 'library') return { name: 'library' };
  return { name: 'home' };
}
