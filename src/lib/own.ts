/**
 * Safe lookups for ids that come from outside the store: the URL hash, `recent`, in app
 * tabs, the clipboard and imported files. Records are plain objects, so `pages['constructor']`
 * would otherwise return Object.prototype.constructor.
 */

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A well formed id that cannot collide with prototype members. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id) && !FORBIDDEN.has(id);
}

/** `rec[id]` only when `id` is an own key; never walks the prototype chain. */
export function own<T>(rec: Record<string, T> | null | undefined, id: unknown): T | undefined {
  if (!rec || typeof id !== 'string' || FORBIDDEN.has(id)) return undefined;
  return Object.hasOwn(rec, id) ? rec[id] : undefined;
}

/** True when `id` is an own key of `rec`. */
export function hasOwnId(rec: Record<string, unknown> | null | undefined, id: unknown): id is string {
  return own(rec, id) !== undefined;
}
