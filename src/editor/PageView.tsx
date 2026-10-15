import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Smile, Image as ImageIcon, MessageSquare, Lock, FileText, Table2, KanbanSquare, LayoutGrid, ListTree, CalendarDays, ArrowDownToLine, ArrowUp } from 'lucide-react';
import { usePage, transact, getDoc, breakCoalescing, setUi, showToast, undo, redo } from '../store/store';
import { updatePage, txInsertBlock, txInitDatabase, uid } from '../store/actions';
import { BlockChildren } from './BlockView';
import { focusBlock } from './controller';
import { startRubberBand, watchCrossBlockDrag } from './selection';
import { EmojiPicker, randomEmoji } from '../components/EmojiPicker';
import { CoverPicker, COVERS } from '../components/CoverPicker';
import { setCaret, caretOffset } from './caret';
import { PageProperties, DatabaseFull } from '../database/DatabaseView';
import { importMarkdownIntoPage } from '../lib/exporter';
import { relTime } from '../components/ui';
import { sanitizeInline } from '../lib/html';
import { handleInlineLinkClick } from './Editable';

export function PageView({ pageId, peek = false }: { pageId: string; peek?: boolean }) {
  const page = usePage(pageId);
  const scopeRef = useRef<HTMLDivElement>(null);
  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null);
  const [coverPicker, setCoverPicker] = useState<DOMRect | null>(null);
  const [repositioning, setRepositioning] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [quote, setQuote] = useState('');

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d === 'string' && d !== pageId) return;
      setCommenting(true);
      // The quote is plain text; it is stored as text and rendered as React text.
      setQuote(typeof d === 'object' && typeof d?.quote === 'string' ? d.quote : '');
    };
    const onImport = (e: Event) => {
      if ((e as CustomEvent).detail !== pageId) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return;
        f.text().then(t => importMarkdownIntoPage(pageId, t));
      };
      input.click();
    };
    window.addEventListener('on:add-comment', on);
    window.addEventListener('on:import', onImport);
    return () => {
      window.removeEventListener('on:add-comment', on);
      window.removeEventListener('on:import', onImport);
    };
  }, [pageId]);

  if (!page) {
    return (
      <div className="empty-view">
        <h2>This page couldn’t be found</h2>
        <div>It may have been deleted permanently.</div>
      </div>
    );
  }

  const readOnly = !!page.locked;
  const hasIcon = !!page.icon;
  const hasCover = !!page.cover;
  const cls =
    'page' +
    (page.font === 'serif' ? ' font-serif' : page.font === 'mono' ? ' font-mono' : '') +
    (page.smallText ? ' small-text' : '') +
    (page.fullWidth || (page.isDatabase && !page.inline) ? ' full-width' : '');

  const focusEnd = () => {
    const d = getDoc();
    const p = d.pages[pageId];
    if (!p || readOnly || p.isDatabase) return;
    const lastId = p.content[p.content.length - 1];
    const last = lastId ? d.blocks[lastId] : null;
    if (last && last.type === 'text' && !last.html && last.children.length === 0) {
      focusBlock(last.id, 'end');
      return;
    }
    let nid = '';
    transact(tx => {
      nid = txInsertBlock(tx, { parent: pageId, type: 'text', html: '' });
    });
    breakCoalescing();
    focusBlock(nid, 'start');
  };

  return (
    <div
      className={cls}
      data-editor-scope={pageId}
      ref={scopeRef}
      onMouseDown={e => {
        const t = e.target as HTMLElement;
        if (t.closest('.editable, .page-title, input, textarea, button, .page-icon, .page-controls, .cover, .db, .block-gutter, .page-props, .page-comments, .code-wrap, .simple-table-wrap, [role=button], [role=checkbox], .page-link, .image-block')) {
          watchCrossBlockDrag(e);
          return;
        }
        if (t.closest('.click-below')) {
          e.preventDefault();
          startRubberBand(e, scopeRef.current!, () => focusEnd());
          return;
        }
        e.preventDefault();
        startRubberBand(e, scopeRef.current!, ev => {
          // Clicking beside a block places the caret at the nearest end of that block.
          const blocks = Array.from(scopeRef.current!.querySelectorAll('.editable[data-editable-id]')) as HTMLElement[];
          const hit = blocks.find(b => {
            const r = b.getBoundingClientRect();
            return ev.clientY >= r.top && ev.clientY <= r.bottom;
          });
          if (hit) {
            const r = hit.getBoundingClientRect();
            focusBlock(hit.dataset.editableId!, ev.clientX < r.left ? 'start' : 'end');
          }
        });
      }}
    >
      {hasCover && (
        <Cover
          pageId={pageId}
          readOnly={readOnly}
          repositioning={repositioning}
          setRepositioning={setRepositioning}
          onChange={r => setCoverPicker(r)}
        />
      )}
      <div className="page-inner">
        <div className="page-column">
          <div className={'page-header' + (hasIcon ? ' has-icon' : '') + (hasCover ? ' has-cover' : '')}>
            {hasIcon && (
              <div
                className="page-icon"
                role="button"
                onClick={e => !readOnly && setIconPicker(e.currentTarget.getBoundingClientRect())}
                style={peek ? { marginTop: hasCover ? undefined : 40 } : undefined}
              >
                {page.icon!.startsWith('data:') || page.icon!.startsWith('http') ? <img src={page.icon} alt="" /> : page.icon}
              </div>
            )}
            {!readOnly && (
              <div className="page-controls" style={peek && !hasIcon && !hasCover ? { marginTop: 40 } : undefined}>
                {!hasIcon && (
                  <button onClick={() => updatePage(pageId, { icon: randomEmoji() })}>
                    <Smile size={16} /> Add icon
                  </button>
                )}
                {!hasCover && (
                  <button onClick={() => updatePage(pageId, { cover: COVERS[Math.floor(Math.random() * 8)].value, coverPos: 50 })}>
                    <ImageIcon size={16} /> Add cover
                  </button>
                )}
                {!page.isDatabase && (
                  <button onClick={() => setCommenting(true)}>
                    <MessageSquare size={16} /> Add comment
                  </button>
                )}
              </div>
            )}
            {readOnly && <div style={{ height: hasIcon || hasCover ? 8 : peek ? 40 : 80 }} />}
            <Title pageId={pageId} readOnly={readOnly} />
            {page.locked && (
              <div className="page-locked-banner">
                <Lock size={12} /> Page is locked.{' '}
                <span className="btn-link" style={{ fontSize: 12 }} onClick={() => updatePage(pageId, { locked: false })}>
                  Unlock
                </span>
              </div>
            )}
            {page.dbId && <PageProperties pageId={pageId} />}
            {(commenting || (page.comments && page.comments.length > 0)) && (
              <Comments pageId={pageId} open={commenting} quote={quote} onDone={() => setCommenting(false)} />
            )}
          </div>
          {page.isDatabase && !page.inline ? (
            <DatabaseFull dbId={pageId} />
          ) : (
            <div className="page-content">
              {page.content.length === 0 && !readOnly ? (
                <EmptyPageStarter pageId={pageId} onEmpty={focusEnd} />
              ) : (
                <BlockChildren ids={page.content} depth={0} readOnly={readOnly} />
              )}
            </div>
          )}
        </div>
        {!page.isDatabase && <div className="click-below" style={{ height: peek ? 120 : '30vh', cursor: 'text' }} />}
      </div>
      {iconPicker && (
        <EmojiPicker
          anchor={iconPicker}
          onClose={() => setIconPicker(null)}
          onPick={emoji => {
            updatePage(pageId, { icon: emoji });
            setIconPicker(null);
          }}
          onRemove={() => {
            updatePage(pageId, { icon: undefined });
            setIconPicker(null);
          }}
        />
      )}
      {coverPicker && (
        <CoverPicker
          anchor={coverPicker}
          onClose={() => setCoverPicker(null)}
          onPick={value => updatePage(pageId, { cover: value, coverPos: 50 })}
          onRemove={() => {
            updatePage(pageId, { cover: undefined });
            setCoverPicker(null);
          }}
        />
      )}
    </div>
  );
}

function Cover({
  pageId, readOnly, repositioning, setRepositioning, onChange,
}: { pageId: string; readOnly: boolean; repositioning: boolean; setRepositioning: (v: boolean) => void; onChange: (r: DOMRect) => void }) {
  const page = usePage(pageId)!;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(page.coverPos ?? 50);
  useEffect(() => setPos(page.coverPos ?? 50), [page.coverPos]);
  const isImage = /^(data:|https?:|url\()/.test(page.cover || '');
  const bg = isImage ? `url("${page.cover!.replace(/^url\(["']?|["']?\)$/g, '')}")` : page.cover;
  return (
    <div
      ref={ref}
      className={'cover' + (repositioning ? ' repositioning' : '')}
      style={{
        backgroundImage: bg && (bg.startsWith('url') || bg.includes('gradient')) ? bg : undefined,
        backgroundColor: bg && !bg.startsWith('url') && !bg.includes('gradient') ? bg : undefined,
        backgroundPosition: `center ${pos}%`,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
      }}
      onMouseDown={e => {
        if (!repositioning) return;
        e.preventDefault();
        const sy = e.clientY;
        const p0 = pos;
        const h = ref.current!.offsetHeight;
        const move = (ev: MouseEvent) => setPos(Math.max(0, Math.min(100, p0 - ((ev.clientY - sy) / h) * 100)));
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    >
      {repositioning && <div className="cover-hint">Drag image to reposition</div>}
      {!readOnly && (
        <div className={'cover-actions' + (repositioning ? ' show' : '')}>
          {repositioning ? (
            <>
              <button
                onClick={() => {
                  updatePage(pageId, { coverPos: pos });
                  setRepositioning(false);
                }}
              >
                Save position
              </button>
              <button
                onClick={() => {
                  setPos(page.coverPos ?? 50);
                  setRepositioning(false);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={e => onChange((e.currentTarget.parentElement as HTMLElement).getBoundingClientRect())}>Change cover</button>
              {isImage && <button onClick={() => setRepositioning(true)}>Reposition</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Title({ pageId, readOnly }: { pageId: string; readOnly: boolean }) {
  const page = usePage(pageId)!;
  const ref = useRef<HTMLHeadingElement>(null);
  const committed = useRef<string | null>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || composing.current) return;
    if (page.title === committed.current) return;
    if (el.textContent !== page.title) {
      const focused = document.activeElement === el;
      const off = focused ? caretOffset(el) : null;
      el.textContent = page.title;
      if (focused && off !== null) setCaret(el, off);
    }
    committed.current = page.title;
  }, [page.title]);

  // New, empty pages focus the title.
  useEffect(() => {
    const p = getDoc().pages[pageId];
    if (p && !p.title && p.content.length === 0 && !p.isDatabase && Date.now() - p.createdAt < 3000) {
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [pageId]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const t = (el.textContent || '').replace(/\n/g, ' ');
    committed.current = t;
    if (getDoc().pages[pageId]?.title !== t) updatePage(pageId, { title: t }, 'title:' + pageId);
  };

  const enter = () => {
    const el = ref.current!;
    const off = caretOffset(el) ?? (el.textContent || '').length;
    const text = el.textContent || '';
    const before = text.slice(0, off);
    const after = text.slice(off);
    let nid = '';
    transact(tx => {
      if (after) tx.setPage(pageId, { title: before });
      const p = tx.page(pageId);
      const first = p.content[0] ? tx.block(p.content[0]) : null;
      if (!after && first && first.type === 'text' && !first.html) {
        nid = first.id;
        return;
      }
      nid = txInsertBlock(tx, { parent: pageId, type: 'text', html: after.replace(/&/g, '&amp;').replace(/</g, '&lt;') }, 0);
    });
    breakCoalescing();
    focusBlock(nid, 'start');
  };

  return (
    <h1
      ref={ref}
      className="page-title"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-title={pageId}
      data-nav=""
      data-placeholder={page.isDatabase ? 'Untitled' : 'New page'}
      spellCheck
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={() => {
        composing.current = false;
        commit();
      }}
      onInput={e => {
        if (composing.current || (e.nativeEvent as InputEvent).isComposing) return;
        commit();
      }}
      onBlur={commit}
      onPaste={e => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n/g, ' '));
      }}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          if (page.isDatabase) return;
          enter();
        } else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && caretOffset(ref.current!) === (ref.current!.textContent || '').length)) {
          const scope = ref.current!.closest('[data-editor-scope]');
          const first = scope?.querySelector('.page-content [data-editable-id]') as HTMLElement | null;
          if (first) {
            e.preventDefault();
            focusBlock(first.dataset.editableId!, 'start');
          }
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
      }}
    />
  );
}

function EmptyPageStarter({ pageId, onEmpty }: { pageId: string; onEmpty: () => void }) {
  const toDb = (view: 'table' | 'board' | 'list' | 'gallery' | 'calendar') => {
    transact(tx => {
      txInitDatabase(tx, pageId, view, false);
    });
  };
  const items: [React.ReactNode, string, () => void][] = [
    [<FileText size={16} />, 'Empty page', onEmpty],
    [<Table2 size={16} />, 'Table', () => toDb('table')],
    [<KanbanSquare size={16} />, 'Board', () => toDb('board')],
    [<ListTree size={16} />, 'List', () => toDb('list')],
    [<LayoutGrid size={16} />, 'Gallery', () => toDb('gallery')],
    [<CalendarDays size={16} />, 'Calendar', () => toDb('calendar')],
    [<ArrowDownToLine size={16} />, 'Import', () => window.dispatchEvent(new CustomEvent('on:import', { detail: pageId }))],
  ];
  return (
    <div className="starter">
      <div className="starter-hint" onClick={onEmpty}>
        Press <span className="kbd">Enter</span> to continue with an empty page, or pick a template.
      </div>
      <div className="starter-grid">
        {items.map(([icon, label, fn]) => (
          <button key={label} className="starter-item" onClick={fn}>
            {icon}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Comments({ pageId, open, quote, onDone }: { pageId: string; open: boolean; quote: string; onDone: () => void }) {
  const page = usePage(pageId)!;
  const [text, setText] = useState('');
  const name = getDoc().workspace.userName;
  const add = () => {
    if (!text.trim()) return;
    // Stored as plain text and rendered as React text, so a quoted block can never become markup.
    const comment = { id: uid(), text: text.trim(), ...(quote ? { quote } : {}), createdAt: Date.now(), author: name };
    transact(tx => tx.setPage(pageId, { comments: [...(tx.page(pageId).comments || []), comment] }));
    setText('');
    showToast('Comment added');
    onDone();
  };
  return (
    <div className="page-comments" onMouseDown={e => e.stopPropagation()}>
      {(page.comments || []).map(c => (
        <div className="comment" key={c.id}>
          <span className="avatar lg">{c.author[0]}</span>
          <div style={{ flex: 1 }}>
            <span className="who">{c.author}</span>
            <span className="when">{relTime(c.createdAt)}</span>
            {c.text !== undefined ? (
              <div>
                {c.quote && <i>“{c.quote}” </i>}
                {c.text}
              </div>
            ) : (
              // Legacy comments stored html; it is sanitized again at render time, and its links
              // open in a new tab instead of navigating the app away.
              <div onClick={e => handleInlineLinkClick(e, false)} dangerouslySetInnerHTML={{ __html: sanitizeInline(c.html || '') }} />
            )}
          </div>
          <span
            className="icon-btn"
            style={{ width: 24, height: 24, fontSize: 12, color: 'var(--text-tertiary)' }}
            role="button"
            onClick={() => transact(tx => tx.setPage(pageId, { comments: (tx.page(pageId).comments || []).filter(x => x.id !== c.id) }))}
          >
            ✕
          </span>
        </div>
      ))}
      {open && (
        <div className="comment-input">
          <span className="avatar lg">{name[0]}</span>
          <input
            autoFocus
            placeholder={quote ? `Comment on “${quote.slice(0, 40)}”…` : 'Add a comment…'}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') add();
              if (e.key === 'Escape') onDone();
            }}
            onBlur={() => !text && onDone()}
          />
          <span className="icon-btn" role="button" style={{ width: 24, height: 24, borderRadius: 12, background: text ? 'var(--blue)' : 'var(--theme-gray-tint-2)', color: '#fff' }} onMouseDown={e => e.preventDefault()} onClick={add}>
            <ArrowUp size={14} />
          </span>
        </div>
      )}
    </div>
  );
}

export { setUi };
