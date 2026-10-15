/**
 * Images: ingest (downscale, store in IndexedDB, return an `on-img:<id>` reference), render
 * time resolution of references to URLs, and conversion between inline data URLs and
 * stored blobs for migration, export and import.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { Doc } from '../store/types';
import { existingImageIds, getImage, imageStoreAvailable, putImages, type StoredImage } from '../store/blobs';
import { IMAGE_REF_SCHEME, isImageRef, safeCover, safeImageSrc } from './url';
import { recordError } from './diagnostics';

/** Originals above this are refused outright (they are downscaled below it). */
export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
/** Long edge of stored photos. */
export const MAX_EDGE = 2000;
/** Long edge of page icons. */
export const ICON_EDGE = 512;
/** Images under this size and edge are stored as they are. */
const REENCODE_OVER_BYTES = 1.5 * 1024 * 1024;
/** Without IndexedDB, small images stay inline in the doc. */
const INLINE_FALLBACK_MAX_BYTES = 1024 * 1024;

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

export const refId = (ref: string) => ref.slice(IMAGE_REF_SCHEME.length);
export const toRef = (id: string) => IMAGE_REF_SCHEME + id;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return 'u' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('');
}

/** Stable id for an inline image, so a repeated migration reuses the same blob. */
export function contentId(dataUrl: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < dataUrl.length; i++) {
    const c = dataUrl.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'h' + (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + dataUrl.length.toString(36);
}

/* ------------------------------------------------------------------ */
/* Bytes and data URLs                                                 */
/* ------------------------------------------------------------------ */

const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,/i;

export function isDataImage(v: unknown): v is string {
  return typeof v === 'string' && DATA_URL_RE.test(v) && safeImageSrc(v) !== null;
}

export function dataUrlToBytes(url: string): { type: string; bytes: Uint8Array } | null {
  const m = DATA_URL_RE.exec(url);
  if (!m || !safeImageSrc(url)) return null;
  try {
    const bin = atob(url.slice(m[0].length).replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { type: m[1].toLowerCase(), bytes };
  } catch {
    return null;
  }
}

export function bytesToDataUrl(type: string, bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${type};base64,${btoa(bin)}`;
}

async function blobBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}

/* ------------------------------------------------------------------ */
/* Ingest                                                              */
/* ------------------------------------------------------------------ */

/**
 * Downscales large photos to `maxEdge` and re-encodes them. SVG and GIF are kept as they
 * are (vectors and animations would be lost). JPEG stays JPEG; other formats become WebP,
 * which keeps transparency. Falls back to the original wherever the browser cannot help.
 */
async function downscale(file: Blob, maxEdge: number): Promise<Blob> {
  const type = file.type;
  if (type === 'image/svg+xml' || type === 'image/gif') return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= REENCODE_OVER_BYTES) {
    bmp.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    return file;
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const outType = type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const out = await new Promise<Blob | null>(res => canvas.toBlob(res, outType, outType === 'image/jpeg' ? 0.86 : 0.9));
  if (!out) return file;
  if (scale === 1 && out.size >= file.size) return file;
  return out;
}

/**
 * Stores an image and returns the value to keep in the doc: an `on-img:` reference, or a
 * small inline data URL when IndexedDB is unavailable. Throws ImageError with a message
 * meant for a toast.
 */
export async function ingestImage(file: Blob, opts: { maxEdge?: number } = {}): Promise<string> {
  if (!file.type.startsWith('image/')) throw new ImageError('That file is not an image.');
  if (file.size > MAX_ORIGINAL_BYTES) throw new ImageError('Image is too large (max 25 MB).');
  const blob = await downscale(file, opts.maxEdge ?? MAX_EDGE);
  const type = blob.type || file.type;
  const bytes = await blobBytes(blob);
  if (await imageStoreAvailable()) {
    const id = randomId();
    try {
      await putImages([{ id, type, bytes, size: bytes.byteLength, createdAt: Date.now() }]);
    } catch (e) {
      recordError('images', e);
      throw new ImageError('Could not store the image: browser storage is full.');
    }
    return toRef(id);
  }
  if (bytes.byteLength > INLINE_FALLBACK_MAX_BYTES) throw new ImageError('This browser cannot store large images here. Try a smaller image.');
  return bytesToDataUrl(type, new Uint8Array(bytes));
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

type Resolved = { url: string | null; state: 'loading' | 'ready' | 'missing' };
const cache = new Map<string, Resolved>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  listeners.forEach(l => l());
}

function toUrl(rec: StoredImage): string {
  const blob = new Blob([rec.bytes], { type: rec.type });
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') return URL.createObjectURL(blob);
  return bytesToDataUrl(rec.type, new Uint8Array(rec.bytes));
}

function load(id: string) {
  if (cache.has(id)) return;
  cache.set(id, { url: null, state: 'loading' });
  getImage(id)
    .then(rec => {
      cache.set(id, rec ? { url: toUrl(rec), state: 'ready' } : { url: null, state: 'missing' });
      notify();
    })
    .catch(e => {
      recordError('images', e);
      cache.set(id, { url: null, state: 'missing' });
      notify();
    });
}

export interface ImageSource {
  /** A URL an <img> or CSS url() can use, or null. */
  src: string | null;
  state: 'ready' | 'loading' | 'missing' | 'invalid';
}

/** Synchronous view of a stored value: refs resolve from the cache, other values are validated. */
export function peekImageSrc(value: string | null | undefined): ImageSource {
  if (!value) return { src: null, state: 'invalid' };
  if (isImageRef(value)) {
    const e = cache.get(refId(value));
    return e ? { src: e.url, state: e.state } : { src: null, state: 'loading' };
  }
  const safe = safeImageSrc(value);
  return safe ? { src: safe, state: 'ready' } : { src: null, state: 'invalid' };
}

/** Resolves a stored image value (ref, data URL, http) to something renderable. */
export function useImageSrc(value: string | null | undefined): ImageSource {
  useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  const ref = value && isImageRef(value) ? refId(value) : null;
  useEffect(() => {
    if (ref) load(ref);
  }, [ref]);
  return peekImageSrc(value);
}

/** Resolves a ref once (for export and tests). */
export async function readImageAsDataUrl(ref: string): Promise<string | null> {
  if (!isImageRef(ref)) return null;
  const rec = await getImage(refId(ref));
  return rec ? bytesToDataUrl(rec.type, new Uint8Array(rec.bytes)) : null;
}

const cssUrl = (src: string) => `url("${src.replace(/["\\\n\r]/g, c => encodeURIComponent(c))}")`;

/** True when a cover is an image (stored, inline or remote) rather than a gradient or color. */
export function isImageCover(cover: string | undefined | null): boolean {
  if (!cover) return false;
  const s: string = cover.trim();
  return /^(data:|https?:|blob:|\/)/i.test(s) || isImageRef(s);
}

/**
 * CSS for a page cover: `backgroundImage` for images (resolved refs included), `background`
 * for gradients and colors. Values that fail the cover policy render nothing.
 */
export function useCoverStyle(cover: string | undefined | null): { style: CSSProperties; isImage: boolean } {
  const image = isImageCover(cover);
  const resolved = useImageSrc(image ? cover : null);
  if (!cover) return { style: {}, isImage: false };
  if (image) return { style: resolved.src ? { backgroundImage: cssUrl(resolved.src) } : {}, isImage: true };
  const safe = safeCover(cover);
  if (!safe) return { style: {}, isImage: false };
  return { style: /gradient\(/i.test(safe) ? { backgroundImage: safe } : { backgroundColor: safe }, isImage: false };
}

/* ------------------------------------------------------------------ */
/* Doc wide helpers (migration, export, import)                        */
/* ------------------------------------------------------------------ */

type ImageVisitor = (value: string) => string;

/** Applies `fn` to every image valued field. Returns the same doc when nothing changed. */
export function mapDocImages(doc: Doc, fn: ImageVisitor): Doc {
  let blocks = doc.blocks;
  let pages = doc.pages;
  for (const id of Object.keys(doc.blocks)) {
    const b = doc.blocks[id];
    const url = b.url !== undefined ? fn(b.url) : undefined;
    const icon = b.icon !== undefined ? fn(b.icon) : undefined;
    if (url !== b.url || icon !== b.icon) {
      if (blocks === doc.blocks) blocks = { ...doc.blocks };
      blocks[id] = { ...b, ...(url !== undefined ? { url } : {}), ...(icon !== undefined ? { icon } : {}) };
    }
  }
  for (const id of Object.keys(doc.pages)) {
    const p = doc.pages[id];
    const icon = p.icon !== undefined ? fn(p.icon) : undefined;
    const cover = p.cover !== undefined ? fn(p.cover) : undefined;
    if (icon !== p.icon || cover !== p.cover) {
      if (pages === doc.pages) pages = { ...doc.pages };
      pages[id] = { ...p, ...(icon !== undefined ? { icon } : {}), ...(cover !== undefined ? { cover } : {}) };
    }
  }
  return blocks === doc.blocks && pages === doc.pages ? doc : { ...doc, blocks, pages };
}

function collect(doc: Doc, test: (v: string) => boolean): string[] {
  const out = new Set<string>();
  mapDocImages(doc, v => {
    if (test(v)) out.add(v);
    return v;
  });
  return [...out];
}

export const collectInlineImages = (doc: Doc) => collect(doc, isDataImage);
export const collectImageRefs = (doc: Doc) => collect(doc, isImageRef);

/**
 * Moves inline data URL images into IndexedDB. The blobs are committed before this
 * resolves, so the caller can then rewrite the doc. Returns null when IndexedDB is
 * unavailable (the images stay inline).
 */
export async function storeInlineImages(urls: string[]): Promise<Map<string, string> | null> {
  if (!urls.length) return new Map();
  if (!(await imageStoreAvailable())) return null;
  const map = new Map<string, string>();
  const records: StoredImage[] = [];
  const ids = urls.map(contentId);
  const have = await existingImageIds(ids);
  urls.forEach((url, i) => {
    const decoded = dataUrlToBytes(url);
    if (!decoded) return;
    const id = ids[i];
    map.set(url, toRef(id));
    if (!have.has(id)) {
      const bytes = decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer;
      records.push({ id, type: decoded.type, bytes, size: bytes.byteLength, createdAt: Date.now() });
    }
  });
  await putImages(records);
  return map;
}

/**
 * Stores the images that came with a backup under their original ids. Refs whose bytes
 * cannot be stored become inline data URLs again, so nothing in the backup is lost.
 */
export async function restoreImages(doc: Doc, images: Record<string, unknown>): Promise<Doc> {
  const refs = collectImageRefs(doc);
  const usable = new Map<string, string>();
  for (const ref of refs) {
    const id = refId(ref);
    const v = Object.hasOwn(images, id) ? images[id] : undefined;
    if (isDataImage(v)) usable.set(ref, v);
  }
  if (!usable.size) return doc;
  if (await imageStoreAvailable()) {
    const records: StoredImage[] = [];
    for (const [ref, url] of usable) {
      const decoded = dataUrlToBytes(url)!;
      const bytes = decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer;
      records.push({ id: refId(ref), type: decoded.type, bytes, size: bytes.byteLength, createdAt: Date.now() });
      cache.delete(refId(ref));
    }
    try {
      await putImages(records);
      notify();
      return doc;
    } catch (e) {
      recordError('images', e);
    }
  }
  return mapDocImages(doc, v => usable.get(v) ?? v);
}
