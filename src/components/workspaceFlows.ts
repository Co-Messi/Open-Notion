/**
 * User flows that replace or rescue the whole workspace, shared by Settings, the banners,
 * the recovery screen and the crash screen.
 */
import type { Doc } from '../store/types';
import { backupCurrentDoc, canEdit, getDoc, imageMigrationIdle, replaceDoc, showToast } from '../store/store';
import { CORRUPT_PREFIX, DOC_KEY, corruptCopies, readBackupMeta } from '../store/persist';
import { DOC_VERSION } from '../store/migrate';
import { getSaveState } from '../store/saveState';
import { describeStorageFailure, storageGet, storageKeys, storageRemove } from '../lib/storage';
import { downloadText, exportWorkspaceJson } from '../lib/exporter';
import { collectImageRefs, collectInlineImages } from '../lib/images';
import { imageStats } from '../store/blobs';
import { getRecentErrors, scrubMessage } from '../lib/diagnostics';
import { readLastBackupAt } from '../store/persist';
import { storageFacts } from '../lib/backup';
import { askChoice, confirmDialog } from './ConfirmDialog';

const day = () => new Date().toISOString().slice(0, 10);

/**
 * Replaces the workspace after a confirmation, keeping the current one in the rolling
 * safety slot first. When that copy cannot be stored, offers a download instead.
 */
export async function replaceWorkspace(next: Doc, what: 'reset' | 'import' | 'restore'): Promise<boolean> {
  if (!canEdit()) {
    showToast('This tab is read only. Reload it first.');
    return false;
  }
  const title = what === 'reset' ? 'Reset this workspace?' : what === 'import' ? 'Replace this workspace with the backup?' : 'Restore the safety copy?';
  const ok = await confirmDialog({
    title,
    body: 'Everything in this workspace will be replaced. A copy of the current workspace is kept in this browser first (Settings, Storage), and you can undo with ⌘Z until you reload.',
    confirmLabel: what === 'reset' ? 'Reset workspace' : 'Replace workspace',
    danger: true,
  });
  if (!ok) return false;
  const copy = backupCurrentDoc(what === 'reset' ? 'Reset' : what === 'import' ? 'Import' : 'Restore');
  if (!copy.ok) {
    const choice = await askChoice({
      title: 'No safety copy could be kept',
      body: `The browser refused to store a copy of the current workspace (${describeStorageFailure(copy.reason)}). Download a backup before continuing?`,
      choices: [
        { id: 'cancel', label: 'Cancel', kind: 'secondary' },
        { id: 'continue', label: 'Continue without a copy', kind: 'danger' },
        { id: 'download', label: 'Download, then continue', kind: 'primary' },
      ],
    });
    if (choice === 'download') {
      if (!(await exportWorkspaceJson())) return false;
    } else if (choice !== 'continue') return false;
  }
  return replaceDoc(next);
}

/** The safety copy kept before the last Reset, Import or Restore. */
export function readSafetyCopy(): { doc: unknown; meta: NonNullable<ReturnType<typeof readBackupMeta>> } | null {
  const meta = readBackupMeta();
  const raw = storageGet('on:doc:backup');
  if (!meta || raw === null) return null;
  try {
    return { doc: JSON.parse(raw), meta };
  } catch {
    return null;
  }
}

/** Downloads exactly what is stored under the workspace key (or the in memory copy). */
export function downloadRawData() {
  const raw = storageGet(DOC_KEY);
  downloadText(`opennotion-raw-${day()}.json`, raw ?? JSON.stringify({ ...getDoc(), version: DOC_VERSION }));
}

export function downloadStoredKey(key: string) {
  const raw = storageGet(key);
  if (raw !== null) downloadText(`opennotion-${key.replace(/[^a-z0-9]+/gi, '-')}.json`, raw);
}

/**
 * Frees the space of one copy of unreadable data, after a confirmation that says the data
 * will be gone. Copies are only ever deleted here, by the user. Returns true when deleted.
 */
export async function deleteKeptCopy(key: string): Promise<boolean> {
  if (!key.startsWith(CORRUPT_PREFIX) || storageGet(key) === null) return false;
  const ok = await confirmDialog({
    title: 'Delete this copy?',
    body: 'The unreadable data in this copy will be gone for good, and nothing can bring it back. Download it first if you might need it.',
    confirmLabel: 'Delete copy',
    danger: true,
  });
  if (!ok) return false;
  storageRemove(key);
  showToast('Copy deleted');
  return storageGet(key) === null;
}

/** Facts for the diagnostics panel and the Copy diagnostics button. Never includes note content. */
export async function diagnosticsReport() {
  await imageMigrationIdle();
  const d = getDoc();
  const s = getSaveState();
  const facts = await storageFacts();
  const images = await imageStats();
  const keys = storageKeys()
    .filter(k => k.startsWith('on:'))
    .sort()
    .map(k => ({ key: k, chars: storageGet(k)?.length ?? 0 }));
  return {
    app: 'OpenNotion',
    generatedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    save: {
      status: s.status,
      failure: s.failure,
      readonlyReason: s.readonlyReason,
      lastSavedAt: s.lastSavedAt ? new Date(s.lastSavedAt).toISOString() : null,
      docChars: s.docChars || (storageGet(DOC_KEY)?.length ?? 0),
    },
    doc: {
      pages: Object.keys(d.pages).length,
      blocks: Object.keys(d.blocks).length,
      storedImageRefs: collectImageRefs(d).length,
      inlineImages: collectInlineImages(d).length,
    },
    images,
    storage: facts,
    lastBackupAt: readLastBackupAt() ? new Date(readLastBackupAt()!).toISOString() : null,
    unreadableCopies: corruptCopies().map(c => ({ key: c.key, at: c.at, chars: c.chars })),
    keys,
    errors: getRecentErrors().map(e => ({ at: new Date(e.at).toISOString(), source: e.source, message: scrubMessage(e.message) })),
  };
}
