import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

export interface Choice {
  id: string;
  label: string;
  kind?: 'primary' | 'danger' | 'secondary';
}

interface Request {
  title: string;
  body: ReactNode;
  choices: Choice[];
  resolve: (id: string | null) => void;
}

let current: Request | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

/** Asks the user to pick one of `choices`. Resolves to its id, or null when dismissed. */
export function askChoice(opts: { title: string; body: ReactNode; choices: Choice[] }): Promise<string | null> {
  current?.resolve(null);
  return new Promise(resolve => {
    current = {
      ...opts,
      resolve: id => {
        current = null;
        notify();
        resolve(id);
      },
    };
    notify();
  });
}

/** A yes or no question. The confirm button is the default action. */
export async function confirmDialog(opts: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  const id = await askChoice({
    title: opts.title,
    body: opts.body,
    choices: [
      { id: 'cancel', label: 'Cancel', kind: 'secondary' },
      { id: 'ok', label: opts.confirmLabel, kind: opts.danger ? 'danger' : 'primary' },
    ],
  });
  return id === 'ok';
}

/** Renders the open dialog, if any. Mounted once at the root (works on the recovery screen too). */
export function DialogHost() {
  const req = useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const defaultBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!req) return;
    defaultBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        req.resolve(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req]);
  if (!req) return null;
  return (
    <div className="modal-overlay light confirm-overlay" onMouseDown={() => req.resolve(null)}>
      <div className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={e => e.stopPropagation()}>
        <div id="confirm-title" className="confirm-title">
          {req.title}
        </div>
        <div className="confirm-body">{req.body}</div>
        <div className="confirm-actions">
          {req.choices.map((c, i) => (
            <button
              key={c.id}
              ref={i === req.choices.length - 1 ? defaultBtn : undefined}
              className={'btn sm ' + (c.kind || 'secondary')}
              onClick={() => req.resolve(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
