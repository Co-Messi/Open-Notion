/** Caret and text-offset utilities for contentEditable blocks. A <br> counts as one character. */

export function getRange(): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0);
}

/** Text offset of (node, offset) inside root. */
export function offsetOf(root: Node, node: Node, offset: number): number {
  let pos = 0;
  let done = false;
  const visit = (n: Node) => {
    if (done) return;
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) {
        pos += offset;
      } else {
        for (let i = 0; i < offset && i < n.childNodes.length; i++) pos += lengthOf(n.childNodes[i]);
      }
      done = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) pos += (n.textContent || '').length;
    else if (n.nodeName === 'BR') pos += 1;
    else n.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  if (!done && node === root) {
    pos = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i++) pos += lengthOf(root.childNodes[i]);
  }
  return pos;
}

export function lengthOf(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return (n.textContent || '').length;
  if (n.nodeName === 'BR') return 1;
  let s = 0;
  n.childNodes.forEach(c => (s += lengthOf(c)));
  return s;
}

/** Finds the DOM position for a text offset. */
export function positionAt(root: Node, target: number): { node: Node; offset: number } {
  let remaining = target;
  let result: { node: Node; offset: number } | null = null;
  const visit = (n: Node): boolean => {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent || '').length;
      if (remaining <= len) {
        result = { node: n, offset: remaining };
        return true;
      }
      remaining -= len;
      return false;
    }
    if (n.nodeName === 'BR') {
      if (remaining === 0) {
        const parent = n.parentNode!;
        result = { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) };
        return true;
      }
      remaining -= 1;
      if (remaining === 0) {
        const parent = n.parentNode!;
        result = { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) + 1 };
        return true;
      }
      return false;
    }
    for (const c of Array.from(n.childNodes)) if (visit(c)) return true;
    return false;
  };
  for (const c of Array.from(root.childNodes)) if (visit(c)) break;
  return result || { node: root, offset: root.childNodes.length };
}

export function caretOffset(el: HTMLElement): number | null {
  const r = getRange();
  if (!r || !el.contains(r.startContainer)) return null;
  return offsetOf(el, r.startContainer, r.startOffset);
}

export function selectionOffsets(el: HTMLElement): [number, number] | null {
  const r = getRange();
  if (!r || !el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  return [offsetOf(el, r.startContainer, r.startOffset), offsetOf(el, r.endContainer, r.endOffset)];
}

export function setCaret(el: HTMLElement, offset: number | 'start' | 'end', end?: number) {
  const len = lengthOf(el);
  const o = offset === 'start' ? 0 : offset === 'end' ? len : Math.max(0, Math.min(offset, len));
  const a = positionAt(el, o);
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  if (end !== undefined) {
    const b = positionAt(el, Math.max(0, Math.min(end, len)));
    r.setEnd(b.node, b.offset);
  } else r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

export function isCollapsed(): boolean {
  const s = window.getSelection();
  return !s || s.isCollapsed;
}

export function atStart(el: HTMLElement): boolean {
  const r = getRange();
  if (!r || !r.collapsed) return false;
  return caretOffset(el) === 0;
}

export function atEnd(el: HTMLElement): boolean {
  const r = getRange();
  if (!r || !r.collapsed) return false;
  return caretOffset(el) === lengthOf(el);
}

export function caretRect(): DOMRect | null {
  const r = getRange();
  if (!r) return null;
  const rr = r.cloneRange();
  rr.collapse(true);
  let rect = rr.getClientRects()[0];
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.x === 0)) {
    // Empty line: insert a temporary marker.
    const span = document.createElement('span');
    span.textContent = String.fromCharCode(0x200b);
    rr.insertNode(span);
    rect = span.getBoundingClientRect();
    const parent = span.parentNode;
    span.remove();
    parent?.normalize();
  }
  return rect || null;
}

function lineBox(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  return { top: r.top + parseFloat(cs.paddingTop), bottom: r.bottom - parseFloat(cs.paddingBottom), lh };
}

export function onFirstLine(el: HTMLElement): boolean {
  if (!el.textContent) return true;
  const c = caretRect();
  if (!c) return true;
  const b = lineBox(el);
  return c.top < b.top + b.lh * 0.8;
}

export function onLastLine(el: HTMLElement): boolean {
  if (!el.textContent) return true;
  const c = caretRect();
  if (!c) return true;
  const b = lineBox(el);
  return c.bottom > b.bottom - b.lh * 0.8;
}

/** Places the caret at a given x on the first or last line of el. */
export function placeAtX(el: HTMLElement, x: number, line: 'first' | 'last') {
  const r = el.getBoundingClientRect();
  const b = lineBox(el);
  const y = line === 'first' ? b.top + b.lh / 2 : b.bottom - b.lh / 2;
  const cx = Math.max(r.left + 1, Math.min(x, r.right - 1));
  const doc = document as any;
  let range: Range | null = null;
  if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(cx, y);
  else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(cx, y);
    if (p) {
      range = document.createRange();
      range.setStart(p.offsetNode, p.offset);
    }
  }
  if (range && el.contains(range.startContainer)) {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    range.collapse(true);
    sel.addRange(range);
  } else {
    setCaret(el, line === 'first' ? 'start' : 'end');
  }
}

function serialize(frag: DocumentFragment): string {
  const d = document.createElement('div');
  d.appendChild(frag);
  return d.innerHTML;
}

/** Splits the editable's HTML at the selection: [before, after] (selected content is dropped). */
export function splitAtSelection(el: HTMLElement): [string, string] {
  const r = getRange();
  if (!r || !el.contains(r.startContainer)) return [el.innerHTML, ''];
  const before = document.createRange();
  before.setStart(el, 0);
  before.setEnd(r.startContainer, r.startOffset);
  const after = document.createRange();
  after.setStart(r.endContainer, r.endOffset);
  after.setEnd(el, el.childNodes.length);
  return [serialize(before.cloneContents()), serialize(after.cloneContents())];
}

/** Plain text before the caret. */
export function textBeforeCaret(el: HTMLElement): string {
  const r = getRange();
  if (!r || !el.contains(r.startContainer)) return '';
  const pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString();
}

/** Deletes `count` characters immediately before the caret. */
export function deleteBeforeCaret(el: HTMLElement, count: number) {
  const off = caretOffset(el);
  if (off === null) return;
  setCaret(el, off - count, off);
  document.execCommand('delete');
}

export function plainLength(html: string): number {
  const d = document.createElement('div');
  d.innerHTML = html;
  return lengthOf(d);
}
