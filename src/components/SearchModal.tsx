import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, PanelRight, Link2, ArrowUpRight, SlidersHorizontal, CaseSensitive, User, FileText, Plus, ChevronDown } from 'lucide-react';
import { getDoc, setUi, useUi } from '../store/store';
import { openPage, pageTitle, pagePath, createPage, isTrashedDeep } from '../store/actions';
import { htmlToText } from '../lib/html';
import { PageIconView } from './PageIcon';
import { CoverBox } from './StoredImage';
import { SearchIcon, Tooltip, pressable, useDialog } from './ui';
import { copyPageLink } from './PageMenus';
import type { Page } from '../store/types';
import { openInNewTab } from '../store/tabs';

interface Result {
  page: Page;
  snippet?: string;
  score: number;
  group: string;
}

/*
 * Parsing block html through a template element is the slow part of search. Blocks are
 * immutable strings, so the plain text of each html string is cached across keystrokes. The
 * cache is cleared when it grows past a bound, which keeps memory flat for huge workspaces.
 */
const textCache = new Map<string, string>();
const TEXT_CACHE_MAX = 20000;
function cachedText(html: string): string {
  let t = textCache.get(html);
  if (t === undefined) {
    if (textCache.size >= TEXT_CACHE_MAX) textCache.clear();
    t = htmlToText(html);
    textCache.set(html, t);
  }
  return t;
}

function pageText(p: Page): string {
  const d = getDoc();
  const out: string[] = [];
  const walk = (ids: string[]) =>
    ids.forEach(id => {
      const b = d.blocks[id];
      if (!b) return;
      if (b.html) out.push(b.type === 'code' ? b.html : cachedText(b.html));
      walk(b.children);
    });
  walk(p.content);
  return out.join('\n');
}

function groupFor(t: number): string {
  const days = (Date.now() - t) / 86400000;
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return 'Past week';
  if (days < 30) return 'Past 30 days';
  return 'Older';
}

function highlightMatch(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function SearchModal() {
  const open = useUi(u => u.searchOpen);
  if (!open) return null;
  return <SearchInner />;
}

function SearchInner() {
  const [q, setQ] = useState('');
  const [titleOnly, setTitleOnly] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId();
  const ws = getDoc().workspace;
  const close = () => setUi({ searchOpen: false });
  useDialog(box, close);

  const results: Result[] = useMemo(() => {
    const d = getDoc();
    const query = q.trim().toLowerCase();
    const pages = Object.values(d.pages).filter(p => !isTrashedDeep(d, p.id));
    if (!query) {
      const seen = new Set<string>();
      const rec = d.recent.filter(r => !isTrashedDeep(d, r.id)).map(r => {
        seen.add(r.id);
        return { page: d.pages[r.id], score: 0, group: groupFor(r.at) };
      });
      const rest = pages
        .filter(p => !seen.has(p.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20)
        .map(p => ({ page: p, score: 0, group: groupFor(p.updatedAt) }));
      return [...rec, ...rest].slice(0, 30);
    }
    const out: Result[] = [];
    for (const p of pages) {
      const title = pageTitle(p).toLowerCase();
      let score = 0;
      let snippet: string | undefined;
      if (title === query) score = 100;
      else if (title.startsWith(query)) score = 80;
      else if (title.includes(query)) score = 60;
      else if (query.split(/\s+/).every(w => title.includes(w))) score = 40;
      if (!titleOnly) {
        const text = pageText(p);
        const i = text.toLowerCase().indexOf(query);
        if (i >= 0) {
          score = Math.max(score, 20);
          const start = Math.max(0, text.lastIndexOf('\n', i) + 1);
          snippet = text.slice(start, start + 140).split('\n')[0];
        }
      }
      if (score > 0) out.push({ page: p, score: score + Math.min(5, (p.updatedAt / 1e12) % 5), snippet, group: 'Best matches' });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 40);
  }, [q, titleOnly]);

  useEffect(() => setActive(0), [q, titleOnly]);
  useEffect(() => {
    listRef.current?.querySelector('.search-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (r: Result | undefined, peek = false) => {
    if (!r) return;
    close();
    openPage(r.page.id, { peek });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) {
        if (e.metaKey || e.ctrlKey) {
          close();
          openInNewTab(results[active].page.id);
        }
        else go(results[active]);
      } else if (q.trim()) {
        close();
        openPage(createPage({ section: 'private', title: q.trim() }));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l' && results[active]) {
      e.preventDefault();
      copyPageLink(results[active].page.id);
    }
  };

  const sel = results[active];
  let lastGroup = '';
  return (
    <div className="modal-overlay light search-overlay" onMouseDown={close}>
      <div ref={box} className="modal search-modal" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={e => e.stopPropagation()}>
        <div className="search-input-row">
          <SearchIcon size={18} />
          <input
            autoFocus
            placeholder={`Search or ask a question in ${ws.name}…`}
            aria-label="Search pages"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={uid + '-results'}
            aria-activedescendant={sel ? uid + '-opt-' + sel.page.id : undefined}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="search-filters">
          <span className={'chip' + (titleOnly ? ' on' : '')} {...pressable()} aria-pressed={titleOnly} onClick={() => setTitleOnly(!titleOnly)}>
            <CaseSensitive size={16} /> Title only
          </span>
          <span className="chip">
            <User size={14} /> Created by <ChevronDown size={12} />
          </span>
          <span className="chip">
            <FileText size={14} /> In <ChevronDown size={12} />
          </span>
          <span className="chip">
            <Plus size={14} /> Filter
          </span>
        </div>
        <div className="search-body">
          <div className="search-results" ref={listRef} id={uid + '-results'} tabIndex={-1} role="listbox" aria-label="Results">
            {results.length === 0 && (
              <div className="search-empty">
                No results for “{q}”.
                <br />
                <span className="btn-link" {...pressable()} onClick={() => go({ page: getDoc().pages[createPage({ section: 'private', title: q.trim() })], score: 0, group: '' })}>
                  Create “{q}” as a new page
                </span>
              </div>
            )}
            {results.map((r, i) => {
              const showGroup = r.group !== lastGroup;
              lastGroup = r.group;
              const path = pagePath(r.page.id)
                .slice(0, -1)
                .map(p => pageTitle(p))
                .join(' / ');
              return (
                <div key={r.page.id} role="presentation">
                  {showGroup && <div className="search-group-label" role="presentation">{r.group}</div>}
                  <div
                    id={uid + '-opt-' + r.page.id}
                    role="option"
                    aria-selected={i === active}
                    className={'search-item' + (i === active ? ' active' : '')}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={e => go(r, e.altKey)}
                  >
                    <span className="si-icon">
                      <PageIconView page={r.page} size={18} />
                    </span>
                    <div className="si-main">
                      <div className="si-title">
                        {highlightMatch(pageTitle(r.page), q.trim())}
                        {path && <span className="si-path"> — {path}</span>}
                      </div>
                      {r.snippet && <div className="si-snippet">{highlightMatch(r.snippet, q.trim())}</div>}
                    </div>
                    <span className="si-enter">
                      <CornerDownLeft size={14} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {sel && <Preview page={sel.page} onOpen={() => go(sel)} onPeek={() => go(sel, true)} />}
        </div>
        <div className="search-footer">
          <span>
            <b>↑↓</b>Select
          </span>
          <span>
            <b>↵</b>Open
          </span>
          <span>
            <b>⌘↵</b>Open in new tab
          </span>
          <span>
            <b>⌘L</b>Copy link
          </span>
          <span style={{ flex: 1 }} />
          <SlidersHorizontal size={14} />
        </div>
      </div>
    </div>
  );
}

function Preview({ page, onOpen, onPeek }: { page: Page; onOpen: () => void; onPeek: () => void }) {
  const text = useMemo(() => pageText(page).slice(0, 1200), [page]);
  return (
    <div className="search-preview">
      <CoverBox className="sp-cover" cover={page.cover} />
      <div className="sp-actions">
        <Tooltip label="Open in side peek">
          <div className="icon-btn" {...pressable()} onClick={onPeek}>
            <PanelRight size={14} />
          </div>
        </Tooltip>
        <Tooltip label="Copy link">
          <div className="icon-btn" {...pressable()} onClick={() => copyPageLink(page.id)}>
            <Link2 size={14} />
          </div>
        </Tooltip>
        <Tooltip label="Open">
          <div className="icon-btn" {...pressable()} onClick={onOpen}>
            <ArrowUpRight size={14} />
          </div>
        </Tooltip>
      </div>
      <div className="sp-body">
        {page.icon && <div className="sp-icon"><PageIconView page={page} size={36} emojiSize={36} /></div>}
        <div className="sp-title">{pageTitle(page)}</div>
        <div className="sp-text">{page.isDatabase ? `${(page.rows || []).length} pages in this database` : text || 'Empty page'}</div>
      </div>
    </div>
  );
}
