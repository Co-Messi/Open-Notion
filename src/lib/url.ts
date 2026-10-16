/**
 * URL policy for everything that comes from user data: inline links, property values,
 * bookmarks, images, covers and icons. Data can arrive from typing, pasting, importing a
 * backup or old localStorage, so every consumer validates instead of trusting the store.
 */

/** Stored image references point at a blob in IndexedDB instead of embedding the bytes. */
export const IMAGE_REF_SCHEME = 'on-img:';
const IMAGE_REF_RE = /^on-img:[A-Za-z0-9_-]{1,64}$/;

const OUTBOUND_RE = /^(https?:|mailto:|tel:)/i;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=\s]*$/i;
// Characters that browsers strip or reinterpret inside URLs (controls, whitespace, backslash).
// Built from char codes so the source file never contains invisible characters.
const CONTROL_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']');

// Inline base64 images (stored by older versions, or kept when IndexedDB is unavailable)
// are far longer than any link, so they get their own ceiling.
const MAX_URL = 8192;
const MAX_DATA_IMAGE = 32 * 1024 * 1024;

function clean(raw: unknown, max = MAX_URL): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > max) return null;
  if (CONTROL_RE.test(s)) return null;
  return s;
}

/** True for a same origin path such as `/landing/x.webp`; rejects `//host` and `/\host`. */
function isLocalPath(s: string): boolean {
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && !s.includes('\\');
}

/**
 * Links that leave the app (window.open, property links, bookmarks): only http, https,
 * mailto and tel. Returns the trimmed URL or null.
 */
export function safeLinkUrl(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  if (s.includes('\\')) return null;
  return OUTBOUND_RE.test(s) ? s : null;
}

/**
 * Inline links inside rich text: outbound schemes, in app fragments (`#/p/...`) and same
 * origin paths. Protocol relative `//host` is rejected because it silently leaves the site.
 */
export function safeHref(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  if (s.startsWith('#')) return s;
  if (isLocalPath(s)) return s;
  return safeLinkUrl(s);
}

/** Like `safeHref`, but adds `https://` to bare hosts the way the link editor does. */
export function normalizeTypedLink(raw: string): string | null {
  const s = clean(raw);
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('#') || s.startsWith('/')) return safeHref(s);
  return safeHref('https://' + s);
}

export function isImageRef(raw: unknown): raw is string {
  return typeof raw === 'string' && IMAGE_REF_RE.test(raw);
}

/** Image sources: http(s), base64 data images, blob URLs, stored image refs and local paths. */
export function safeImageSrc(raw: unknown): string | null {
  const s = clean(raw, typeof raw === 'string' && /^\s*data:image\//i.test(raw) ? MAX_DATA_IMAGE : MAX_URL);
  if (!s) return null;
  if (IMAGE_REF_RE.test(s)) return s;
  if (/^https?:/i.test(s) && !s.includes('\\')) return s;
  if (/^blob:/i.test(s)) return s;
  if (DATA_IMAGE_RE.test(s)) return s;
  if (isLocalPath(s)) return s;
  return null;
}

// A CSS gradient or plain color with no url(), no escapes and no declaration breakouts.
const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\([#%.,\w\s()-]*\)$/i;
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

/** Page covers: an image source, or a gradient or color rendered locally. */
export function safeCover(raw: unknown): string | null {
  if (typeof raw === 'string' && /^\s*data:/i.test(raw)) return safeImageSrc(raw);
  const s = clean(raw);
  if (!s) return null;
  if (/url\(|\\|;|\{|\}|expression|@import|<|>|"|'/i.test(s)) return safeImageSrc(s);
  if (GRADIENT_RE.test(s) || COLOR_RE.test(s)) return s;
  return safeImageSrc(s);
}

/** True when a page or callout icon is an image rather than an emoji or short text. */
export function isImageIcon(icon: string | undefined | null): boolean {
  return !!icon && (IMAGE_REF_RE.test(icon) || /^(data:|https?:|blob:|\/)/i.test(icon));
}

/** Page and callout icons: an image source, or a short emoji or text glyph. */
export function safeIcon(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (isImageIcon(raw.trim())) return safeImageSrc(raw);
  const s = raw.trim();
  if (!s || s.length > 32 || /[<>]/.test(s) || CONTROL_RE.test(s)) return null;
  return s;
}

/** Opens an outbound link in a new tab without giving it a handle on this one. */
export function openExternal(raw: unknown): boolean {
  const url = safeLinkUrl(raw);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
