/** DOM helpers that are safe with ids from user data. */

/** CSS.escape with a fallback for environments that lack it (jsdom, very old browsers). */
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  // Escape everything outside [A-Za-z0-9_-] as a code point escape; always valid inside quotes.
  return Array.from(String(value))
    .map(ch => (/[A-Za-z0-9_-]/.test(ch) ? ch : '\\' + ch.codePointAt(0)!.toString(16) + ' '))
    .join('');
}

/** `[name="value"]` with the value escaped. */
export function attrSel(name: string, value: string): string {
  return `[${name}="${cssEscape(value)}"]`;
}
