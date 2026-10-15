import { useRef, useState } from 'react';
import { getRecoveryInfo, leaveRecovery } from '../store/store';
import { createSeed } from '../store/seed';
import { BackupError, parseWorkspaceBackup } from '../lib/exporter';
import { recordError } from '../lib/diagnostics';
import { formatBytes } from '../lib/backup';
import { askChoice, confirmDialog } from './ConfirmDialog';
import { downloadRawData } from './workspaceFlows';

/**
 * Shown instead of the app when the stored workspace cannot be read. Nothing is written
 * until the user picks a way out; the unreadable data stays under its own key.
 */
export function RecoveryScreen() {
  const info = getRecoveryInfo();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const preserved = !!info?.preservedKey;

  /** When no copy could be kept, the user must download the data or accept losing it. */
  const guardOverwrite = async (): Promise<boolean> => {
    if (preserved) return true;
    const c = await askChoice({
      title: 'The unreadable data was not copied',
      body: 'Browser storage is too full to keep a copy, so continuing will replace it. Download it first?',
      choices: [
        { id: 'cancel', label: 'Cancel', kind: 'secondary' },
        { id: 'go', label: 'Replace without a copy', kind: 'danger' },
        { id: 'download', label: 'Download, then continue', kind: 'primary' },
      ],
    });
    if (c === 'download') downloadRawData();
    return c === 'download' || c === 'go';
  };

  const startFresh = async () => {
    const ok = await confirmDialog({
      title: 'Start with a fresh workspace?',
      body: preserved ? 'A new starter workspace replaces the unreadable one. The unreadable data stays in this browser and can be downloaded from Settings, Storage.' : 'A new starter workspace replaces the unreadable one.',
      confirmLabel: 'Start fresh',
      danger: true,
    });
    if (ok && (await guardOverwrite())) leaveRecovery(createSeed());
  };

  const importBackup = async (text: string) => {
    try {
      const doc = await parseWorkspaceBackup(text);
      if (await guardOverwrite()) leaveRecovery(doc);
    } catch (e) {
      recordError('import', e);
      setMessage(e instanceof BackupError ? e.message : 'That file could not be imported.');
    }
  };

  return (
    <div className="recovery-screen">
      <div className="recovery-card">
        <h1>Your workspace could not be opened</h1>
        <p>
          {info?.reason || 'The saved data could not be read.'} Nothing has been changed or deleted.{' '}
          {preserved ? 'A copy of the saved data is kept in this browser.' : 'Download the saved data before doing anything else.'}
        </p>
        <div className="recovery-actions">
          <button className="btn primary" onClick={downloadRawData}>
            Download saved data
          </button>
          <button className="btn secondary" onClick={() => file.current?.click()}>
            Import a backup
          </button>
          <button className="btn secondary" onClick={startFresh}>
            Start fresh
          </button>
        </div>
        {message && <p className="recovery-error">{message}</p>}
        <p className="recovery-detail">
          Saved data: {formatBytes(info?.rawChars ?? 0)}
          {info?.preservedKey ? `, copy kept as ${info.preservedKey}` : ''}
        </p>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) f.text().then(importBackup);
          }}
        />
      </div>
    </div>
  );
}
