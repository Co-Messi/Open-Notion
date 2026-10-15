/**
 * Local only diagnostics: a small ring buffer of recent errors that the Settings panel can
 * show and copy. Nothing here is ever sent anywhere.
 */

export interface DiagnosticEntry {
  at: number;
  source: string;
  message: string;
}

const MAX = 50;
const entries: DiagnosticEntry[] = [];
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
