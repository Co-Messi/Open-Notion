import { expect } from 'vitest';
import type { Doc } from '../store/types';
import { isSafeId } from '../lib/own';
import { safeCover, safeHref, safeIcon, safeImageSrc, safeLinkUrl } from '../lib/url';

const INLINE_TAGS = new Set(['B', 'I', 'U', 'S', 'CODE', 'A', 'SPAN', 'BR']);

/** Parses stored inline html the way the editor does and returns every problem found. */
export function htmlProblems(html: string): string[] {
  const out: string[] = [];
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('*').forEach(el => {
    if (!INLINE_TAGS.has(el.tagName)) out.push(`tag ${el.tagName}`);
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) out.push(`handler ${a.name}`);
      if (a.name === 'href' && safeHref(a.value) !== a.value) out.push(`href ${a.value}`);
      if (a.name !== 'href' && a.name !== 'class') out.push(`attribute ${a.name}`);
    }
  });
  return out;
}

/** Every html field that is rendered as markup (everything except code source). */
export function markupFields(d: Doc): [string, string][] {
  const out: [string, string][] = [];
  for (const b of Object.values(d.blocks)) {
    if (b.type !== 'code') out.push([`block ${b.id}`, b.html]);
    (b.rows || []).forEach((row, i) => row.forEach((c, j) => out.push([`cell ${b.id}[${i}][${j}]`, c])));
  }
  for (const p of Object.values(d.pages)) for (const c of p.comments || []) if (c.html !== undefined) out.push([`comment ${c.id}`, c.html]);
  return out;
}

/** Structural and safety invariants the normalizer guarantees. */
export function expectDocInvariants(d: Doc) {
  for (const rec of [d.pages, d.blocks]) {
    expect(Object.getPrototypeOf(rec)).toBe(Object.prototype);
    for (const k of Object.keys(rec)) expect(isSafeId(k), k).toBe(true);
  }
  for (const [where, html] of markupFields(d)) expect(htmlProblems(html), where).toEqual([]);
  const reach = new Set<string>();
  for (const p of Object.values(d.pages)) {
    expect(p.id).toBe(Object.keys(d.pages).find(k => d.pages[k] === p));
    for (const c of p.content) {
      expect(d.blocks[c]?.parent, `content ${c} of ${p.id}`).toBe(p.id);
      reach.add(c);
    }
    if (p.icon !== undefined) expect(safeIcon(p.icon)).toBe(p.icon);
    if (p.cover !== undefined) expect(safeCover(p.cover)).toBe(p.cover);
    for (const r of p.rows || []) expect(d.pages[r]?.dbId).toBe(p.id);
    if (p.parentId !== null) expect(Object.hasOwn(d.pages, p.parentId)).toBe(true);
    for (const k of Object.keys(p.props || {})) expect(isSafeId(k.startsWith('~prev:') ? k.slice(6) : k), k).toBe(true);
  }
  for (const b of Object.values(d.blocks)) {
    for (const c of b.children) {
      expect(d.blocks[c]?.parent, `child ${c} of ${b.id}`).toBe(b.id);
      reach.add(c);
    }
    if (b.url !== undefined) {
      if (b.type === 'bookmark') expect(safeLinkUrl(b.url)).toBe(b.url);
      else if (b.type === 'image') expect(safeImageSrc(b.url)).toBe(b.url);
    }
    if (b.icon !== undefined) expect(safeIcon(b.icon)).toBe(b.icon);
  }
  expect(reach.size).toBe(Object.keys(d.blocks).length);
  // Every block is reachable from a page (no cycles hanging off nothing).
  const seen = new Set<string>();
  const stack = Object.values(d.pages).flatMap(p => p.content);
  while (stack.length) {
    const id = stack.pop()!;
    expect(seen.has(id), `block ${id} reached twice`).toBe(false);
    seen.add(id);
    stack.push(...d.blocks[id].children);
  }
  expect(seen.size).toBe(Object.keys(d.blocks).length);
  const all = [...d.workspace.privatePages, ...d.workspace.favorites, ...d.workspace.teamspaces.flatMap(t => t.pages), ...d.recent.map(r => r.id)];
  for (const id of all) expect(Object.hasOwn(d.pages, id), id).toBe(true);
}
