import { getDoc, transact, showToast } from '../store/store';
import { htmlToMarkdown, inlineMarkdownToHtml, htmlToText, escapeMdText, escapeMdUrl } from './html';
import { pageTitle, txInsertBlock, txCreatePage } from '../store/actions';
import type { Block, BlockType, Doc, Page, Property } from '../store/types';
import { DOC_VERSION, migrateDoc } from '../store/migrate';
import { normalizeDoc, NotADocError } from '../store/normalize';
import { LAST_BACKUP_KEY } from '../store/persist';
import { collectImageRefs, readImageAsDataUrl, refId, restoreImages } from './images';
import { storageSet } from './storage';
import { recordError } from './diagnostics';

export function pageToMarkdown(pageId: string): string {
  const d = getDoc();
  const p = d.pages[pageId];
  if (!p) return '';
  const lines: string[] = [`# ${p.icon ? p.icon + ' ' : ''}${escapeMdText(pageTitle(p), false)}`, ''];
  const cell = (text: string) => text.replace(/\|/g, '\\|');
  const walk = (ids: string[], depth: number) => {
    let n = 0;
    for (const id of ids) {
      const b = d.blocks[id];
      if (!b) continue;
      const ind = '    '.repeat(depth);
      const md = htmlToMarkdown(b.html);
      n = b.type === 'numbered' ? n + 1 : 0;
      switch (b.type) {
        case 'h1': lines.push(`# ${md}`); break;
        case 'h2': lines.push(`## ${md}`); break;
        case 'h3': lines.push(`### ${md}`); break;
        case 'bulleted': lines.push(`${ind}- ${md}`); break;
        case 'numbered': lines.push(`${ind}${n}. ${md}`); break;
        case 'todo': lines.push(`${ind}- [${b.checked ? 'x' : ' '}] ${md}`); break;
        case 'toggle': lines.push(`${ind}- ${md}`); break;
        case 'quote': lines.push(`> ${md}`); break;
        case 'callout': lines.push(`> ${b.icon || ''} ${md}`); break;
        case 'divider': lines.push('---'); break;
        case 'code': {
          // A fence longer than any backtick run inside the code keeps the block intact.
          const fence = '`'.repeat(Math.max(3, ...(b.html.match(/`+/g) || []).map(r => r.length + 1)));
          lines.push(fence + (b.language && b.language !== 'plain text' ? b.language : ''), b.html, fence);
          break;
        }
        case 'image': lines.push(`![${escapeMdText(b.caption || '', false)}](${escapeMdUrl(b.url || '')})`); break;
        case 'page':
        case 'database': {
          const sp = b.pageId ? d.pages[b.pageId] : undefined;
          lines.push(`[${escapeMdText(pageTitle(sp), false)}](#/p/${b.pageId})`);
          break;
        }
        case 'table':
          (b.rows || []).forEach((r, i) => {
            lines.push('| ' + r.map(c => cell(htmlToMarkdown(c))).join(' | ') + ' |');
            if (i === 0) lines.push('|' + r.map(() => ' --- ').join('|') + '|');
          });
          break;
        default: lines.push(ind + md);
      }
      if (b.children.length) walk(b.children, b.type === 'bulleted' || b.type === 'numbered' || b.type === 'todo' || b.type === 'toggle' ? depth + 1 : depth);
    }
  };
  walk(p.content, 0);
  if (p.isDatabase) {
    const schema = p.schema || [];
    lines.push('| ' + schema.map(s => cell(escapeMdText(s.name, false))).join(' | ') + ' |', '|' + schema.map(() => ' --- ').join('|') + '|');
    (p.rows || []).forEach(rid => {
      const r = d.pages[rid];
      if (!r || r.trashed) return;
      lines.push(
        '| ' +
          schema
            .map(s => cell(escapeMdText(rowCell(s, r), false)))
            .join(' | ') +
          ' |',
      );
    });
  }
  return lines.join('\n');
}

function rowCell(s: Property, r: Page): string {
  if (s.type === 'title') return pageTitle(r);
  const v = r.props?.[s.id];
  if (v == null) return '';
  if (s.type === 'select' || s.type === 'status') return s.options?.find(o => o.id === v)?.name || '';
  if (s.type === 'multi_select') return (v as string[]).map(x => s.options?.find(o => o.id === x)?.name).filter(Boolean).join(', ');
  if (s.type === 'date') return v.start || '';
  if (s.type === 'checkbox') return v ? 'Yes' : 'No';
  return String(v);
}

function download(name: string, text: string, type = 'text/markdown') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportPageMarkdown(pageId: string) {
  const p = getDoc().pages[pageId];
  download(`${(pageTitle(p) || 'Untitled').replace(/[\\/:*?"<>|]/g, '_')}.md`, pageToMarkdown(pageId));
}

/* ------------------------------------------------------------------ */
/* JSON backups                                                        */
/* ------------------------------------------------------------------ */

/**
 * A backup is self contained: the workspace plus the bytes of every stored image it
 * references, keyed by image id. Import also accepts the plain doc JSON of older exports.
 */
export const BACKUP_FORMAT = 'opennotion-backup';

export interface WorkspaceBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  exportedAt: string;
  doc: Doc;
  images: Record<string, string>;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Builds a backup of `doc` with its images embedded as data URLs. */
export async function buildWorkspaceBackup(doc: Doc = getDoc()): Promise<{ json: string; images: number; missing: number }> {
  const images: Record<string, string> = {};
  let missing = 0;
  for (const ref of collectImageRefs(doc)) {
    const data = await readImageAsDataUrl(ref);
    if (data) images[refId(ref)] = data;
    else missing++;
  }
  // The visit history is browsing data, not content; it is left out of backups.
  const backup: WorkspaceBackup = { format: BACKUP_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), doc: { ...doc, version: DOC_VERSION, recent: [] }, images };
  return { json: JSON.stringify(backup, null, 2), images: Object.keys(images).length, missing };
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Downloads a complete backup and records the backup date. Resolves to false on failure. */
export async function exportWorkspaceJson(): Promise<boolean> {
  try {
    const r = await buildWorkspaceBackup();
    download(`opennotion-backup-${stamp()}.json`, r.json, 'application/json');
    storageSet(LAST_BACKUP_KEY, String(Date.now()));
    window.dispatchEvent(new Event('on:backup-made'));
    if (r.missing) showToast(`Backup downloaded. ${r.missing} image${r.missing === 1 ? ' was' : 's were'} missing from this browser.`);
    return true;
  } catch (e) {
    recordError('export', e);
    showToast('Could not build the backup');
    return false;
  }
}

/** Downloads text as a file (raw data from the recovery screen and the crash screen). */
export function downloadText(name: string, text: string, type = 'application/json') {
  download(name, text, type);
}

/**
 * Reads a backup file: the current format (doc plus images) or an older plain doc. The
 * result is migrated and normalized, and its images are stored before it resolves.
 */
export async function parseWorkspaceBackup(text: string): Promise<Doc> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('That file is not valid JSON.');
  }
  let raw: unknown = parsed;
  let images: Record<string, unknown> | null = null;
  if (parsed && typeof parsed === 'object' && (parsed as { format?: unknown }).format === BACKUP_FORMAT) {
    const b = parsed as { doc?: unknown; images?: unknown };
    raw = b.doc;
    images = b.images && typeof b.images === 'object' && !Array.isArray(b.images) ? (b.images as Record<string, unknown>) : {};
  }
  const m = migrateDoc(raw);
  if (m.future) throw new BackupError('This backup was made by a newer version of OpenNotion.');
  let doc: Doc;
  try {
    doc = normalizeDoc(m.value);
  } catch (e) {
    if (e instanceof NotADocError) throw new BackupError('That file is not a workspace backup.');
    throw e;
  }
  return images ? restoreImages(doc, images) : doc;
}

/** Parses markdown into block specs. */
export function markdownToBlocks(md: string): Partial<Block>[] {
  const out: (Partial<Block> & { depth?: number })[] = [];
  // Indent widths of the list items that are currently open, outermost first. A deeper indent
  // opens a level, a shallower one closes levels, whatever the indent unit is (2, 3 or 4).
  let openIndents: number[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\t/g, '    ');
    const indent = line.match(/^ */)?.[0].length || 0;
    const t = line.trim();
    const fenceOpen = /^(`{3,})(.*)$/.exec(t);
    if (fenceOpen) {
      const fenceLen = fenceOpen[1].length;
      const lang = fenceOpen[2].trim() || 'plain text';
      const closer = new RegExp('^`{' + fenceLen + ',}\\s*$');
      const code: string[] = [];
      i++;
      while (i < lines.length && !closer.test(lines[i].trim())) code.push(lines[i++]);
      i++;
      openIndents = [];
      out.push({ type: 'code', html: code.join('\n'), language: lang });
      continue;
    }
    i++;
    if (!t) continue;
    let type: BlockType = 'text';
    let text = t;
    let checked: boolean | undefined;
    let m: RegExpMatchArray | null;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      openIndents = [];
      out.push({ type: 'divider', html: '' });
      continue;
    } else if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
      type = (['h1', 'h2', 'h3'] as BlockType[])[m[1].length - 1];
      text = m[2];
    } else if ((m = t.match(/^[-*+]\s+\[( |x|X)?\]\s*(.*)$/))) {
      type = 'todo';
      checked = (m[1] || '').toLowerCase() === 'x';
      text = m[2];
    } else if ((m = t.match(/^[-*+](?:\s+(.*))?$/))) {
      type = 'bulleted';
      text = m[1] || '';
    } else if ((m = t.match(/^\d+[.)](?:\s+(.*))?$/))) {
      type = 'numbered';
      text = m[1] || '';
    } else if ((m = t.match(/^>\s?(.*)$/))) {
      type = 'quote';
      text = m[1];
    } else if ((m = t.match(/^!\[((?:[^\]\\]|\\.)*)\]\(((?:[^)\\\s]|\\.)+)\)$/))) {
      openIndents = [];
      out.push({ type: 'image', url: m[2].replace(/\\(.)/g, '$1'), caption: m[1].replace(/\\(.)/g, '$1'), html: '' });
      continue;
    }
    let depth = 0;
    if (type === 'bulleted' || type === 'numbered' || type === 'todo') {
      while (openIndents.length && openIndents[openIndents.length - 1] > indent) openIndents.pop();
      if (!openIndents.length || openIndents[openIndents.length - 1] < indent) openIndents.push(indent);
      depth = openIndents.length - 1;
    } else {
      openIndents = [];
    }
    out.push({ type, html: inlineMarkdownToHtml(text), checked, depth });
  }
  return out;
}

/** Inserts parsed specs under `pageId`, nesting list items by their depth. */
function insertSpecs(tx: Parameters<typeof txInsertBlock>[0], pageId: string, specs: (Partial<Block> & { depth?: number })[]) {
  const stack: string[] = [];
  for (const s of specs) {
    const { depth: d, ...spec } = s;
    const depth = Math.min(d || 0, stack.length);
    const parent = depth > 0 ? stack[depth - 1] : pageId;
    const id = txInsertBlock(tx, { ...spec, parent });
    stack[depth] = id;
    stack.length = depth + 1;
  }
}

export function importMarkdownIntoPage(pageId: string, md: string) {
  const specs = markdownToBlocks(md);
  transact(tx => insertSpecs(tx, pageId, specs));
  showToast(`Imported ${specs.length} blocks`);
}

export function importMarkdownAsPage(name: string, md: string): string {
  let id = '';
  const specs = markdownToBlocks(md);
  let title = name.replace(/\.(md|markdown|txt)$/i, '');
  if (specs[0]?.type === 'h1') {
    title = htmlToText(specs[0].html || '');
    specs.shift();
  }
  transact(tx => {
    id = txCreatePage(tx, { section: 'private', title });
    insertSpecs(tx, id, specs);
  });
  return id;
}
