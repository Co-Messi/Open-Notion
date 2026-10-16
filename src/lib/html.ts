/** Inline rich text helpers. Block text is stored as a small, sanitized HTML subset. */

import { safeHref } from './url';

const ALLOWED = new Set(['B', 'I', 'U', 'S', 'CODE', 'A', 'SPAN', 'BR']);
const RENAME: Record<string, string> = { STRONG: 'B', EM: 'I', STRIKE: 'S', DEL: 'S', INS: 'U' };

export const COLOR_SENTINELS: Record<string, string> = {
  // execCommand('foreColor') sentinels -> text color class
  '#010101': 'gray', '#010102': 'brown', '#010103': 'orange', '#010104': 'yellow', '#010105': 'green',
  '#010106': 'blue', '#010107': 'purple', '#010108': 'pink', '#010109': 'red', '#01010a': 'default',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sentinelToColor(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (COLOR_SENTINELS[v]) return COLOR_SENTINELS[v];
  const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const hex = '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
    if (COLOR_SENTINELS[hex]) return COLOR_SENTINELS[hex];
  }
  return null;
}

/** Sanitizes arbitrary HTML into the inline subset used by blocks. */
export function sanitizeInline(html: string): string {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out = document.createElement('div');
  walk(tpl.content, out);
  pruneEmpty(out);
  let res = out.innerHTML;
  // A lone trailing <br> is a contentEditable artifact.
  if (res === '<br>') res = '';
  return res;
}

/** Removes inline wrappers that contain no text (left behind by splits and execCommand). */
function pruneEmpty(root: Element) {
  root.querySelectorAll('b, i, u, s, code, a, span').forEach(el => {
    if (!el.textContent && !el.querySelector('br')) el.remove();
  });
  // Merge adjacent identical wrappers (<b>a</b><b>b</b> -> <b>ab</b>).
  root.querySelectorAll('b, i, u, s, code, span').forEach(el => {
    const prev = el.previousSibling;
    if (prev && prev.nodeType === 1 && (prev as Element).tagName === el.tagName && (prev as Element).className === el.className && (prev as Element).getAttribute('href') === el.getAttribute('href')) {
      while (el.firstChild) prev.appendChild(el.firstChild);
      el.remove();
    }
  });
}

interface WalkCtx {
  /** Inside a "default text color" command: drop text color classes. */
  clearText?: boolean;
  /** Inside a "default background" command: drop background classes. */
  clearBg?: boolean;
}

/** Text and background color classes for an element (classes, legacy attributes or execCommand sentinels). */
function colorsOf(el: HTMLElement, ctx: WalkCtx): { text: string | null; bg: string | null; clearText: boolean; clearBg: boolean } {
  let text: string | null = null;
  let bg: string | null = null;
  el.classList?.forEach(c => {
    if (/^c-[a-z]+$/.test(c)) text = c;
    if (/^bg-[a-z]+$/.test(c)) bg = c;
  });
  const fc = sentinelToColor(el.getAttribute('color')) || sentinelToColor(el.style?.color || null);
  const bc = sentinelToColor(el.style?.backgroundColor || null);
  let clearText = !!ctx.clearText;
  let clearBg = !!ctx.clearBg;
  if (fc === 'default') {
    text = null;
    clearText = true;
  } else if (fc) {
    text = 'c-' + fc;
    clearText = true; // nested older colors are replaced by this one
  }
  if (bc === 'default') {
    bg = null;
    clearBg = true;
  } else if (bc) {
    bg = 'bg-' + bc;
    clearBg = true;
  }
  if (ctx.clearText && !fc) text = null;
  if (ctx.clearBg && !bc) bg = null;
  return { text, bg, clearText, clearBg };
}

function walk(src: Node, dst: Node, ctx: WalkCtx = {}) {
  src.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      dst.appendChild(document.createTextNode(node.textContent || ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    let tag = RENAME[el.tagName] || el.tagName;
    // Chrome sometimes emits styled spans for bold/italic, and <font> for colors.
    if (tag === 'SPAN' || tag === 'FONT') {
      const fw = el.style?.fontWeight;
      const fs = el.style?.fontStyle;
      const td = el.style?.textDecoration || el.style?.textDecorationLine || '';
      let target: Node = dst;
      const wrap = (t: string) => {
        const w = document.createElement(t);
        target.appendChild(w);
        target = w;
      };
      if (fw === 'bold' || Number(fw) >= 600) wrap('b');
      if (fs === 'italic') wrap('i');
      if (td.includes('line-through')) wrap('s');
      if (td.includes('underline')) wrap('u');
      if (el.getAttribute('face') === 'nc-code') wrap('code');
      const c = colorsOf(el, ctx);
      const cls = [c.text, c.bg].filter(Boolean).join(' ');
      if (cls) {
        const sp = document.createElement('span');
        sp.className = cls;
        target.appendChild(sp);
        target = sp;
      }
      walk(el, target, { clearText: c.clearText, clearBg: c.clearBg });
      return;
    }
    if (tag === 'DIV' || tag === 'P' || tag === 'LI') {
      // Block-level wrappers inside a single block become line breaks.
      if (dst.childNodes.length && dst.lastChild?.nodeName !== 'BR') dst.appendChild(document.createElement('br'));
      walk(el, dst, ctx);
      return;
    }
    if (!ALLOWED.has(tag)) {
      walk(el, dst, ctx);
      return;
    }
    const clean = document.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = safeHref(el.getAttribute('href'));
      if (href) clean.setAttribute('href', href);
    }
    dst.appendChild(clean);
    if (tag === 'BR') return;
    // Colors applied directly on formatting elements (e.g. a background on a link).
    const c = el.style && (el.style.color || el.style.backgroundColor) ? colorsOf(el, ctx) : null;
    if (c && (c.text || c.bg)) {
      const sp = document.createElement('span');
      sp.className = [c.text, c.bg].filter(Boolean).join(' ');
      clean.appendChild(sp);
      walk(el, sp, { clearText: c.clearText, clearBg: c.clearBg });
    } else {
      walk(el, clean, ctx);
    }
  });
}

export function htmlToText(html: string): string {
  if (!html) return '';
  if (!/[<&]/.test(html)) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
  return tpl.content.textContent || '';
}

export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

/*
 * Markdown round trip choices (export is htmlToMarkdown, import is inlineMarkdownToHtml):
 * - Text is escaped with backslashes: \ * _ ` [ ] ~ < and, at the start of a line, # > - + and
 *   "1." style markers. Import removes the backslash again.
 * - Underline has no Markdown syntax, so it is exported as the raw tag <u>...</u> and read back.
 * - Colors are exported as <span class="c-red bg-yellow">...</span>. Renderers that strip
 *   classes still show the text, and import maps the span back to the color classes.
 * - A line break inside a block is exported as <br>, because a bare newline would end the
 *   block (and break list items) on import.
 * - In links, ( ) and backslashes inside the URL are escaped and spaces are percent encoded.
 * - Bold and italic that touch each other use different marker characters (** with _ and
 *   __ with *) so the runs stay unambiguous.
 */

const MD_ESCAPE_RE = /[\\*_`[\]~<]/g;

export function escapeMdText(text: string, lineStart: boolean): string {
  let out = text.replace(MD_ESCAPE_RE, c => '\\' + c);
  if (lineStart) {
    out = out.replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s|$)|-{3,}\s*$)/, '$1\\$2');
    out = out.replace(/^(\s*\d+)([.)])(?=\s|$)/, '$1\\$2');
  }
  return out;
}

export function escapeMdUrl(url: string): string {
  return url.replace(/[\\()]/g, c => '\\' + c).replace(/\s/g, c => encodeURIComponent(c)).replace(/</g, '%3C').replace(/>/g, '%3E');
}

function codeSpan(text: string): string {
  const runs = text.match(/`+/g) || [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  const fence = '`'.repeat(longest + 1);
  const spaced = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '');
  const pad = spaced ? ' ' : '';
  return fence + pad + text + pad + fence;
}

/** Inline html to markdown for export. */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  let lineStart = true;
  const isBold = (n: Node | null) => !!n && n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'B';
  const rec = (n: Node): string => {
    let out = '';
    n.childNodes.forEach(c => {
      if (c.nodeType === Node.TEXT_NODE) {
        const t = c.textContent || '';
        if (!t) return;
        out += escapeMdText(t, lineStart);
        if (t.trim()) lineStart = false;
      } else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as HTMLElement;
        switch (el.tagName) {
          case 'B': {
            const inner = rec(el);
            const m = /^\*|\*$/.test(inner) ? '__' : '**';
            out += `${m}${inner}${m}`;
            break;
          }
          case 'I': {
            const inner = rec(el);
            const m = /^\*|\*$/.test(inner) || isBold(el.previousSibling) || isBold(el.nextSibling) ? '_' : '*';
            out += `${m}${inner}${m}`;
            break;
          }
          case 'S': out += `~~${rec(el)}~~`; break;
          case 'U': out += `<u>${rec(el)}</u>`; break;
          case 'CODE': {
            const raw = el.textContent || '';
            if (raw) lineStart = false;
            out += raw ? codeSpan(raw) : '';
            break;
          }
          case 'A': out += `[${rec(el)}](${escapeMdUrl(el.getAttribute('href') || '')})`; break;
          case 'BR':
            out += '<br>';
            lineStart = true;
            break;
          case 'SPAN': {
            const cls = (el.getAttribute('class') || '').split(/\s+/).filter(x => /^(c|bg)-[a-z]+$/.test(x));
            const inner = rec(el);
            out += cls.length ? `<span class="${cls.join(' ')}">${inner}</span>` : inner;
            break;
          }
          default: out += rec(el);
        }
      }
    });
    return out;
  };
  return rec(tpl.content);
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** End of the emphasis run that closes at `from` or later: a run of exactly n marker chars. */
function findEmphasisClose(s: string, ch: string, n: number, from: number): number {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end >= 0) {
        i = end + run.length - 1;
        continue;
      }
    }
    if (c === ch) {
      let r = 1;
      while (s[i + r] === ch) r++;
      if (r === n) return i;
      // "**a *b***": the last two markers close the bold, the first closes the italic.
      if (n === 2 && r === 3) return i + 1;
      i += r - 1;
    }
  }
  return -1;
}

/** Converts inline markdown to the inline html subset. See the choices listed above. */
export function inlineMarkdownToHtml(text: string): string {
  const parse = (s: string): string => {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1])) {
        out += escapeHtml(s[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '`') {
        const run = /^`+/.exec(s.slice(i))![0];
        const end = s.indexOf(run, i + run.length);
        if (end > 0) {
          let code = s.slice(i + run.length, end);
          if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
          out += `<code>${escapeHtml(code)}</code>`;
          i = end + run.length;
          continue;
        }
        out += run;
        i += run.length;
        continue;
      }
      if (ch === '<') {
        const rest = s.slice(i);
        const sp = /^<span class="((?:c|bg)-[a-z]+(?: (?:c|bg)-[a-z]+)*)">/.exec(rest);
        const u = /^<u>/i.test(rest);
        const br = /^<br\s*\/?>/i.exec(rest);
        if (u) {
          const end = s.toLowerCase().indexOf('</u>', i + 3);
          if (end > 0) {
            out += `<u>${parse(s.slice(i + 3, end))}</u>`;
            i = end + 4;
            continue;
          }
        } else if (sp) {
          const end = s.indexOf('</span>', i + sp[0].length);
          if (end > 0) {
            out += `<span class="${sp[1]}">${parse(s.slice(i + sp[0].length, end))}</span>`;
            i = end + 7;
            continue;
          }
        } else if (br) {
          out += '<br>';
          i += br[0].length;
          continue;
        }
        out += '&lt;';
        i++;
        continue;
      }
      if (ch === '*' || ch === '_' || ch === '~') {
        let run = 1;
        while (s[i + run] === ch) run++;
        let done = false;
        for (let k = Math.min(run, 3); k >= 1 && !done; k--) {
          if (ch === '~' && k !== 2) continue;
          const bodyStart = i + k;
          if (bodyStart >= s.length || /\s/.test(s[bodyStart])) continue;
          if (ch === '_' && isWordChar(s[i - 1])) continue;
          const end = findEmphasisClose(s, ch, k, bodyStart);
          if (end <= bodyStart || /\s/.test(s[end - 1])) continue;
          if (ch === '_' && isWordChar(s[end + k])) continue;
          const body = parse(s.slice(bodyStart, end));
          out += ch === '~' ? `<s>${body}</s>` : k === 3 ? `<b><i>${body}</i></b>` : k === 2 ? `<b>${body}</b>` : `<i>${body}</i>`;
          i = end + k;
          done = true;
        }
        if (done) continue;
        out += escapeHtml(ch);
        i++;
        continue;
      }
      if (ch === '[') {
        let depth = 0;
        let close = -1;
        for (let j = i; j < s.length; j++) {
          if (s[j] === '\\') {
            j++;
            continue;
          }
          if (s[j] === '[') depth++;
          else if (s[j] === ']' && --depth === 0) {
            close = j;
            break;
          }
        }
        if (close > i + 1 && s[close + 1] === '(') {
          let k = close + 2;
          let url = '';
          let ok = false;
          while (k < s.length) {
            if (s[k] === '\\' && k + 1 < s.length) {
              url += s[k + 1];
              k += 2;
              continue;
            }
            if (s[k] === ')') {
              ok = true;
              break;
            }
            if (/\s/.test(s[k])) break;
            url += s[k++];
          }
          const href = ok ? safeHref(url) : null;
          if (href) {
            out += `<a href="${escapeHtml(href)}">${parse(s.slice(i + 1, close))}</a>`;
            i = k + 1;
            continue;
          }
        }
      }
      out += escapeHtml(ch);
      i++;
    }
    return out;
  };
  return parse(text);
}
