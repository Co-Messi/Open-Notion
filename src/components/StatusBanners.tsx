import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CloudOff, HardDriveDownload, X } from 'lucide-react';
import { useSaveState } from '../store/saveState';
import { isDirty, reloadFromStorage, retrySave, showToast } from '../store/store';
import { describeStorageFailure } from '../lib/storage';
import { exportWorkspaceJson } from '../lib/exporter';
import { backupReminderDue, isSafari, snoozeBackupReminder } from '../lib/backup';
import { confirmDialog } from './ConfirmDialog';

function Banner({ tone, icon, children, actions, onDismiss }: { tone: 'error' | 'warn' | 'info'; icon: ReactNode; children: ReactNode; actions: ReactNode; onDismiss?: () => void }) {
  return (
    <div className={'status-banner ' + tone} role={tone === 'info' ? 'status' : 'alert'}>
      <span className="sb-icon">{icon}</span>
      <div className="sb-text">{children}</div>
      <div className="sb-actions">{actions}</div>
      {onDismiss && (
        <button className="sb-close" aria-label="Dismiss" onClick={onDismiss}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function useBackupReminder(): [boolean, () => void] {
  const [due, setDue] = useState(() => backupReminderDue());
  useEffect(() => {
    const check = () => setDue(backupReminderDue());
    window.addEventListener('on:backup-made', check);
    const t = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      window.removeEventListener('on:backup-made', check);
      window.clearInterval(t);
    };
  }, []);
  return [due, () => setDue(backupReminderDue())];
}

/**
 * Persistent save and sync status: unsaved changes after a failed write, a read only tab,
 * data from a newer version, and the occasional backup reminder.
 */
export function StatusBanners() {
  const s = useSaveState();
  const [reminder, recheck] = useBackupReminder();
  let banner: ReactNode = null;

  if (s.status === 'failed') {
    banner = (
      <Banner
        tone="error"
        icon={<CloudOff size={16} />}
        actions={
          <>
            <button className="btn sm secondary" onClick={() => retrySave() && showToast('Saved')}>
              Retry
            </button>
            <button className="btn sm primary" onClick={() => exportWorkspaceJson()}>
              Export backup
            </button>
          </>
        }
      >
        <b>Not saved.</b> {s.failure ? `Saving failed: ${describeStorageFailure(s.failure)}.` : 'Saving failed.'} Your latest changes exist only in this tab, so export a backup before closing it.
      </Banner>
    );
  } else if (s.status === 'readonly' && s.readonlyReason === 'other-tab') {
    banner = (
      <Banner
        tone="warn"
        icon={<AlertTriangle size={16} />}
        actions={
          <>
            <button className="btn sm secondary" onClick={() => exportWorkspaceJson()}>
              Export this tab
            </button>
            <button
              className="btn sm primary"
              onClick={async () => {
                const ok = !isDirty() || (await confirmDialog({ title: 'Discard the changes in this tab?', body: 'This tab has changes that were never saved. Reloading replaces them with the newer data from the other tab. Export this tab first to keep them.', confirmLabel: 'Reload', danger: true }));
                if (ok && !reloadFromStorage()) location.reload();
              }}
            >
              Reload
            </button>
          </>
        }
      >
        <b>Read only.</b> This workspace was changed in another tab, so this tab stopped saving to avoid overwriting newer data.
      </Banner>
    );
  } else if (s.status === 'readonly' && s.readonlyReason === 'newer-version') {
    banner = (
      <Banner tone="warn" icon={<AlertTriangle size={16} />} actions={<button className="btn sm primary" onClick={() => location.reload()}>Reload</button>}>
        <b>Read only.</b> This workspace was saved by a newer version of OpenNotion. Reload the page to get the latest version.
      </Banner>
    );
  } else if (reminder) {
    banner = (
      <Banner
        tone="info"
        icon={<HardDriveDownload size={16} />}
        onDismiss={() => {
          snoozeBackupReminder(7);
          recheck();
        }}
        actions={
          <>
            <button
              className="btn sm secondary"
              onClick={() => {
                snoozeBackupReminder(3);
                recheck();
              }}
            >
              Later
            </button>
            <button className="btn sm primary" onClick={() => exportWorkspaceJson()}>
              Download backup
            </button>
          </>
        }
      >
        <b>Back up your notes.</b> They live only in this browser.
        {isSafari() ? ' Safari can delete site data after 7 days without a visit.' : ' A downloaded backup keeps them safe if browser data is cleared.'}
      </Banner>
    );
  }

  useEffect(() => {
    document.body.classList.toggle('has-status-banner', !!banner);
    return () => document.body.classList.remove('has-status-banner');
  }, [!!banner]);

  return banner ? <div className="status-banners">{banner}</div> : null;
}
