/**
 * The stored format of the workspace and the small keys around it. No module state here:
 * the store owns when to read and write, this file owns what the bytes look like.
 */
import type { Doc } from './types';
import { DOC_VERSION, migrateDoc } from './migrate';
import { normalizeDocWithReport, normalizeRecent, type NormalizeReport } from './normalize';
import { storageGet, storageGetJson, storageKeys, storageSet, type StorageResult } from '../lib/storage';
import { recordError } from '../lib/diagnostics';

export const DOC_KEY = 'on:doc:v2';
export const RECENT_KEY = 'on:recent:v1';
/**
 * Unreadable data found on load, kept verbatim, one copy per distinct value. Copies are never
 * deleted automatically: only the user deletes them (Settings, Storage) after downloading.
 */
export const CORRUPT_PREFIX = 'on:doc:corrupt:';
/** The stored string as it was before load time repairs (one rolling copy). */
export const REPAIRED_KEY = 'on:doc:repaired';
/** The workspace as it was before the last Reset, Import or Restore (one rolling copy). */
export const BACKUP_KEY = 'on:doc:backup';
export const BACKUP_META_KEY = 'on:doc:backup:meta';
export const INSTALLED_KEY = 'on:installed-at';
export const LAST_BACKUP_KEY = 'on:backup:last';

const REV_RE = /^\{"rev":"([A-Za-z0-9_-]{1,64})"/;

/** Random revision id written at the start of every stored doc. */
export function newRev(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('');
}

/**
 * Serializes the doc with its revision as the very first field, so a write can be checked
 * against storage by reading a short prefix instead of parsing the whole document.
 */
export function serializeDoc(doc: Doc, rev: string): string {
  const body = JSON.stringify({ ...doc, version: DOC_VERSION });
  return '{"rev":' + JSON.stringify(rev) + ',' + body.slice(1);
}

/** The revision of a stored doc string, or null when it has none (older builds). */
export function readRev(raw: string | null): string | null {
  if (!raw) return null;
  return REV_RE.exec(raw.slice(0, 100))?.[1] ?? null;
}

export interface ParsedDoc {
  doc: Doc;
  report: NormalizeReport;
  from: number;
  future: boolean;
}

/** JSON, then versioned migrations, then the normalizer. Throws when the data is unreadable. */
export function parseStoredDoc(raw: string): ParsedDoc {
  const json: unknown = JSON.parse(raw);
  const m = migrateDoc(json);
  const { doc, report } = normalizeDocWithReport(m.value);
  return { doc, report, from: m.from, future: m.future };
}

/** Keeps unreadable data under its own key. Returns the key, or null when it could not be kept. */
export function preserveCorrupt(raw: string): string | null {
  const keys = storageKeys().filter(k => k.startsWith(CORRUPT_PREFIX)).sort();
  for (const k of keys) if (storageGet(k) === raw) return k;
  const key = CORRUPT_PREFIX + Date.now();
  const r = storageSet(key, raw);
  if (!r.ok) {
    recordError('load', `Could not keep a copy of unreadable data (${r.reason})`);
    return null;
  }
  return key;
}

export function corruptCopies(): { key: string; at: number; chars: number }[] {
  return storageKeys()
    .filter(k => k.startsWith(CORRUPT_PREFIX))
    .sort()
    .map(key => ({ key, at: Number(key.slice(CORRUPT_PREFIX.length)) || 0, chars: storageGet(key)?.length ?? 0 }));
}

export function readRecent(pages: Doc['pages']): Doc['recent'] | null {
  const raw = storageGetJson<unknown>(RECENT_KEY, null);
  return Array.isArray(raw) ? normalizeRecent(raw, pages) : null;
}

export function writeRecent(recent: Doc['recent']): StorageResult {
  return storageSet(RECENT_KEY, JSON.stringify(recent));
}

export interface BackupMeta {
  at: number;
  reason: string;
  chars: number;
}

/** Writes the one rolling safety copy. */
export function writeBackup(doc: Doc, reason: string): StorageResult {
  const json = JSON.stringify({ ...doc, version: DOC_VERSION });
  const r = storageSet(BACKUP_KEY, json);
  if (r.ok) storageSet(BACKUP_META_KEY, JSON.stringify({ at: Date.now(), reason, chars: json.length } satisfies BackupMeta));
  return r;
}

export function readBackupMeta(): BackupMeta | null {
  if (storageGet(BACKUP_KEY) === null) return null;
  const m = storageGetJson<Partial<BackupMeta> | null>(BACKUP_META_KEY, null);
  return { at: typeof m?.at === 'number' ? m.at : 0, reason: typeof m?.reason === 'string' ? m.reason : '', chars: typeof m?.chars === 'number' ? m.chars : 0 };
}

export function readLastBackupAt(): number | null {
  const n = Number(storageGet(LAST_BACKUP_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}
