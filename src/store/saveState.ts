import { useSyncExternalStore } from 'react';
import type { StorageFailure } from '../lib/storage';

/**
 * Persistence status shared between the store (writer) and the UI (unsaved banner,
 * read only banner, diagnostics panel). Kept separate from the doc so status changes
 * never create undo steps or trigger saves.
 */
export type SaveStatus =
  /** Everything in memory is on disk. */
  | 'saved'
  /** Local edits are waiting for the debounced write. */
  | 'pending'
  /** The last write threw; edits exist only in memory. */
  | 'failed'
  /** Writes are disabled: another tab saved newer data, or stored data needs recovery. */
  | 'readonly';

export interface SaveState {
  status: SaveStatus;
  /** Why the last write failed (only with status 'failed'). */
  failure: StorageFailure | null;
  /** Why writes are disabled (only with status 'readonly'). */
  readonlyReason: 'other-tab' | 'recovery' | null;
  /** Time of the last successful write of the doc. */
  lastSavedAt: number | null;
  /** Size in characters of the last serialized doc. */
  docChars: number;
}

let state: SaveState = { status: 'saved', failure: null, readonlyReason: null, lastSavedAt: null, docChars: 0 };
const listeners = new Set<() => void>();

export const getSaveState = (): SaveState => state;

export function setSaveState(patch: Partial<SaveState>): void {
  const next = { ...state, ...patch };
  if ((Object.keys(next) as (keyof SaveState)[]).every(k => Object.is(next[k], state[k]))) return;
  state = next;
  listeners.forEach(l => l());
}

export function subscribeSaveState(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(subscribeSaveState, getSaveState, getSaveState);
}
