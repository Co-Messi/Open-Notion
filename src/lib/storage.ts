/**
 * Guarded localStorage access. Browsers throw when site data is blocked (even on reading
 * `window.localStorage`) and when the quota is full; callers get a result instead of an
 * exception, plus the reason so the UI can say which one happened.
 */

export type StorageFailure = 'quota' | 'blocked' | 'unknown';
export type StorageResult = { ok: true } | { ok: false; reason: StorageFailure; error: unknown };

/** Tells a full quota apart from storage that is blocked or unavailable. */
export function classifyStorageError(e: unknown): StorageFailure {
  const err = e as { name?: string; code?: number } | null;
  const name = err?.name || '';
  const code = err?.code;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'quota';
  if (name === 'SecurityError' || code === 18 || name === 'InvalidAccessError') return 'blocked';
  return 'unknown';
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** False when the browser blocks site storage entirely (nothing can be saved). */
export function storageAvailable(): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.getItem('on:probe');
    return true;
  } catch {
    return false;
  }
}

/** Reads a key; returns null when it is missing or storage is unavailable. */
export function storageGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): StorageResult {
  const s = store();
  if (!s) return { ok: false, reason: 'blocked', error: new Error('localStorage is unavailable') };
  try {
    s.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: classifyStorageError(error), error };
  }
}

export function storageRemove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** Every key currently stored (empty when storage is unavailable). */
export function storageKeys(): string[] {
  const s = store();
  if (!s) return [];
  try {
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

/** Parses a JSON value from storage, falling back when it is missing or malformed. */
export function storageGetJson<T>(key: string, fallback: T): T {
  const raw = storageGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Human readable reason for a failed write, used by toasts and the unsaved banner. */
export function describeStorageFailure(reason: StorageFailure): string {
  if (reason === 'quota') return 'browser storage is full';
  if (reason === 'blocked') return 'this browser is blocking site storage';
  return 'the browser refused to save';
}
