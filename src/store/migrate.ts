/**
 * Versioned migrations for the stored workspace. Each step takes the plain JSON of version
 * N and returns version N + 1. Steps run before normalizeDoc, so they only need to reshape
 * data; validation and repair stay in one place.
 *
 * Version history:
 * - 1: the original shape (the key was already `on:doc:v2`, the data said version 1).
 * - 2: same record shape. Around the doc: the visit history lives under its own key
 *   (`on:recent:v1`, the doc keeps a copy for older builds), images may be `on-img:<id>`
 *   references to IndexedDB blobs, and the stored string starts with a `rev` field used to
 *   detect writes from other tabs. Those parts need storage access and are handled by the
 *   store; the step itself only bumps the number.
 */

export const DOC_VERSION = 2;

type Json = Record<string, unknown>;
const STEPS: Record<number, (d: Json) => Json> = {
  1: d => ({ ...d, version: 2 }),
};

export interface Migrated {
  value: unknown;
  /** Version the data was stored with (1 when it did not say). */
  from: number;
  /** Written by a newer build: load it read only so nothing is lost by saving it back. */
  future: boolean;
}

export function migrateDoc(raw: unknown): Migrated {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { value: raw, from: 0, future: false };
  const r = raw as Json;
  const from = typeof r.version === 'number' && Number.isInteger(r.version) && r.version >= 1 ? r.version : 1;
  if (from > DOC_VERSION) return { value: raw, from, future: true };
  let cur: Json = r;
  for (let v = from; v < DOC_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`No migration from version ${v}`);
    cur = step(cur);
  }
  return { value: cur, from, future: false };
}
