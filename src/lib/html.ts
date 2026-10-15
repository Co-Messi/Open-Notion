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

/** Converts simple inline markdown (bold, italic, code, strike, links) to the inline subset. */
export function inlineMarkdownToHtml(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^_]+)__/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

/** Inline html to markdown for export. */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const rec = (n: Node): string => {
    let out = '';
    n.childNodes.forEach(c => {
      if (c.nodeType === Node.TEXT_NODE) out += c.textContent;
      else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as HTMLElement;
        const inner = rec(el);
        switch (el.tagName) {
          case 'B': out += `**${inner}**`; break;
          case 'I': out += `*${inner}*`; break;
          case 'S': out += `~~${inner}~~`; break;
          case 'CODE': out += '`' + inner + '`'; break;
          case 'A': out += `[${inner}](${el.getAttribute('href') || ''})`; break;
          case 'BR': out += '\n'; break;
          default: out += inner;
        }
      }
    });
    return out;
  };
  return rec(tpl.content);
}
