/**
 * Image bytes live in IndexedDB, outside the localStorage doc (which only holds an
 * `on-img:<id>` reference). Records keep raw bytes plus the MIME type rather than Blob
 * objects, which clone reliably everywhere.
 *
 * Blobs are never deleted when a block or page goes away: the undo history, the Trash and
 * the rolling safety copy may still point at them. Garbage collection is a known gap.
 */
import { recordError } from '../lib/diagnostics';

const DB_NAME = 'opennotion';
const STORE = 'images';
const VERSION = 1;

export interface StoredImage {
  id: string;
  type: string;
  bytes: ArrayBuffer;
  size: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        recordError('images', req.error ?? 'IndexedDB failed to open');
        resolve(null);
      };
      req.onblocked = () => {
        recordError('images', 'IndexedDB open was blocked by another tab');
      };
    } catch (e) {
      recordError('images', e);
      resolve(null);
    }
  });
  return dbPromise;
}

/** True when image bytes can be kept in IndexedDB (false in some private modes). */
export async function imageStoreAvailable(): Promise<boolean> {
  return (await open()) !== null;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Writes images in one transaction; resolves only once they are committed. */
export async function putImages(records: StoredImage[]): Promise<void> {
  if (!records.length) return;
  const db = await open();
  if (!db) throw new Error('Image storage is unavailable');
  const tx = db.transaction(STORE, 'readwrite');
  const os = tx.objectStore(STORE);
  for (const r of records) os.put(r);
  await done(tx);
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as StoredImage | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Ids that are already stored, out of `ids`. */
export async function existingImageIds(ids: string[]): Promise<Set<string>> {
  const db = await open();
  const out = new Set<string>();
  if (!db || !ids.length) return out;
  const os = db.transaction(STORE, 'readonly').objectStore(STORE);
  await Promise.all(
    ids.map(
      id =>
        new Promise<void>(resolve => {
          const req = os.getKey(id);
          req.onsuccess = () => {
            if (req.result !== undefined) out.add(id);
            resolve();
          };
          req.onerror = () => resolve();
        }),
    ),
  );
  return out;
}

/** Number of stored images and their total size in bytes (for diagnostics). */
export async function imageStats(): Promise<{ count: number; bytes: number } | null> {
  const db = await open();
  if (!db) return null;
  return new Promise(resolve => {
    let count = 0;
    let bytes = 0;
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve({ count, bytes });
      count++;
      bytes += (c.value as StoredImage).size || 0;
      c.continue();
    };
    req.onerror = () => resolve(null);
  });
}
