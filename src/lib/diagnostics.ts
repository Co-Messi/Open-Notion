/**
 * Local only diagnostics: a small ring buffer of recent errors that the Settings panel can
 * show and copy. Nothing here is ever sent anywhere. The last few entries are also kept in
 * this browser (scrubbed and size capped), so a crash followed by a reload still leaves a
 * trace to look at.
 */
import { storageGetJson, storageSet } from './storage';

export interface DiagnosticEntry {
  at: number;
  source: string;
  message: string;
}

const MAX = 50;
/** Entries kept across reloads, and the storage key that holds them. */
export const STORED_MAX = 20;
export const DIAGNOSTICS_KEY = 'on:diagnostics:v1';
const MAX_MESSAGE = 300;
const MAX_SOURCE = 40;

/**
 * Everything between the first and the last `q` goes. With `lone`, a single `q` without a
 * partner also drops the rest of the text after it.
 */
function cutQuoted(s: string, q: string, lone: boolean): string {
  const first = s.indexOf(q);
  if (first < 0) return s;
  const last = s.lastIndexOf(q);
  if (last === first) return lone ? s.slice(0, first + 1) + '…' : s;
  return s.slice(0, first + 1) + '…' + s.slice(last);
}

/**
 * Error text without quoted fragments, which could contain note content. A JSON parse error
 * quotes the text it failed on, and that text can itself contain quotes, so everything from
 * the first quote to the last quote of each kind goes (an unpaired double quote or backtick
 * drops the rest of the message; a lone apostrophe is ordinary English). Capped in length.
 */
export function scrubMessage(message: string): string {
  return cutQuoted(cutQuoted(cutQuoted(message, '"', true), '`', true), "'", false).slice(0, MAX_MESSAGE);
}

function scrubbed(e: DiagnosticEntry): DiagnosticEntry {
  return { at: e.at, source: e.source.slice(0, MAX_SOURCE), message: scrubMessage(e.message) };
}

function loadStored(): DiagnosticEntry[] {
  const raw = storageGetJson<unknown>(DIAGNOSTICS_KEY, null);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is DiagnosticEntry => !!e && typeof e === 'object' && typeof e.at === 'number' && typeof e.source === 'string' && typeof e.message === 'string')
    .slice(-STORED_MAX)
    .map(scrubbed);
}

/** Writes the last entries, scrubbed. A failed write only loses the trace; it is never reported. */
function persist() {
  storageSet(DIAGNOSTICS_KEY, JSON.stringify(entries.slice(-STORED_MAX).map(scrubbed)));
}

const entries: DiagnosticEntry[] = loadStored();
const listeners = new Set<() => void>();

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Records an error (or a notable event) with where it came from. */
export function recordError(source: string, error: unknown): void {
  entries.push({ at: Date.now(), source, message: messageOf(error).slice(0, 500) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  persist();
  listeners.forEach(l => l());
}

export function getRecentErrors(): readonly DiagnosticEntry[] {
  return entries;
}

export function subscribeDiagnostics(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let installed = false;
/** Captures uncaught errors and unhandled rejections into the ring buffer. */
export function installGlobalErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', e => recordError('window.error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', e => recordError('unhandledrejection', e.reason));
}
