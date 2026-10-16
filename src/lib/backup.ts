/**
 * Backup nudges and the browser storage facts shown in Settings. All local: nothing here
 * leaves the browser.
 */
import { INSTALLED_KEY, readLastBackupAt } from '../store/persist';
import { storageGet, storageSet } from './storage';

const DAY = 86_400_000;
const SNOOZE_KEY = 'on:backup:snooze';
/** Remind after this long without a downloaded backup. */
export const BACKUP_REMINDER_DAYS = 7;

/** Safari (macOS and iOS) deletes script written site data after 7 days of use without a visit. */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android)\//.test(ua);
}

export function backupReminderDue(now = Date.now()): boolean {
  const installed = Number(storageGet(INSTALLED_KEY)) || now;
  const since = readLastBackupAt() ?? installed;
  const snoozed = Number(storageGet(SNOOZE_KEY)) || 0;
  return now - since > BACKUP_REMINDER_DAYS * DAY && now > snoozed;
}

export function snoozeBackupReminder(days: number) {
  storageSet(SNOOZE_KEY, String(Date.now() + days * DAY));
}

export interface StorageFacts {
  usage: number | null;
  quota: number | null;
  /** True when the browser promised not to evict this site's data; null when unknown. */
  persisted: boolean | null;
}

export async function storageFacts(): Promise<StorageFacts> {
  const out: StorageFacts = { usage: null, quota: null, persisted: null };
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      out.usage = est.usage ?? null;
      out.quota = est.quota ?? null;
    }
  } catch {
    /* unsupported */
  }
  try {
    const p = await navigator.storage?.persisted?.();
    if (typeof p === 'boolean') out.persisted = p;
  } catch {
    /* unsupported */
  }
  return out;
}

/** Asks for persistent storage. Resolves to the result, or null when the browser has no API. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const r = await navigator.storage?.persist?.();
    return typeof r === 'boolean' ? r : null;
  } catch {
    return null;
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatWhen(ms: number | null | undefined): string {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
