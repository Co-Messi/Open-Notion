import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { transact, breakCoalescing } from '../store/store';
import { txCreatePage, txInsertBlock, openPage } from '../store/actions';
import { markdownToBlocks } from '../lib/exporter';
import { PHOTOS, COVERS } from './CoverPicker';

interface Template {
  id: string;
  name: string;
  icon: string;
  desc: string;
  cover?: string;
  /** Markdown body, or a database view type for database templates. */
  body?: string;
  database?: 'board' | 'table' | 'gallery' | 'list' | 'calendar';
}

const TEMPLATES: Template[] = [
  {
    id: 'meeting', name: 'Meeting notes', icon: '🗒️', desc: 'Agenda, notes and action items for any meeting.', cover: COVERS[4].value,
    body: '## Agenda\n- Topic one\n- Topic two\n## Notes\nWrite notes here.\n## Action items\n- [ ] Follow up\n- [ ] Share notes',
  },
  {
    id: 'todo', name: 'To-do list', icon: '✅', desc: 'A simple checklist to get things done.',
    body: '## Today\n- [ ] First task\n- [ ] Second task\n## Later\n- [ ] Someday task',
  },
  {
    id: 'journal', name: 'Daily journal', icon: '📔', desc: 'Reflect on your day in a few prompts.', cover: PHOTOS[5].value,
    body: '> What am I grateful for today?\n\n## Highlights\n- \n## What I learned\n- \n## Tomorrow\n- [ ] ',
  },
  {
    id: 'doc', name: 'Product spec', icon: '📐', desc: 'Problem, goals, solution and open questions.', cover: COVERS[2].value,
    body: '## Problem\nWhat problem are we solving, and for whom?\n## Goals\n1. Goal one\n2. Goal two\n## Proposed solution\nDescribe the approach.\n## Open questions\n- Question',
  },
  { id: 'tasks', name: 'Task tracker', icon: '🎯', desc: 'Track work across statuses on a board.', database: 'board', cover: PHOTOS[9].value },
  { id: 'reading', name: 'Reading list', icon: '📚', desc: 'Books and articles in a gallery.', database: 'gallery', cover: PHOTOS[10].value },
  { id: 'events', name: 'Content calendar', icon: '🗓️', desc: 'Plan posts and events on a calendar.', database: 'calendar' },
  { id: 'wiki', name: 'Team wiki', icon: '📖', desc: 'A home for team knowledge.', cover: COVERS[11].value,
    body: '> Everything the team needs to know, in one place.\n\n## Getting started\n- Onboarding\n- Tools we use\n## How we work\n- Rituals\n- Decision making' },
];

function applyTemplate(t: Template) {
  let id = '';
  transact(tx => {
    id = txCreatePage(tx, {
      section: 'private', title: t.name, icon: t.icon,
      ...(t.database ? { isDatabase: true, dbViewType: t.database } : {}),
    });
    if (t.cover) tx.setPage(id, { cover: t.cover, coverPos: 50 });
    if (t.body) {
      const stack: string[] = [];
      for (const s of markdownToBlocks(t.body)) {
        const depth = (s as any).depth || 0;
        delete (s as any).depth;
        const parent = depth > 0 && stack[depth - 1] ? stack[depth - 1] : id;
        const bid = txInsertBlock(tx, { ...s, parent });
        stack[depth] = bid;
        stack.length = depth + 1;
      }
    }
  });
  breakCoalescing();
  openPage(id);
}

export function TemplatesModal() {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(TEMPLATES[0].id);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('on:templates', on);
    return () => window.removeEventListener('on:templates', on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (!open) return null;
  const t = TEMPLATES.find(x => x.id === sel)!;
  const blocks = t.body ? markdownToBlocks(t.body) : [];
  let num = 0;
  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div className="modal templates-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="tpl-nav">
          <div className="tpl-head">Templates</div>
          {TEMPLATES.map(x => (
            <div key={x.id} className={'tpl-item' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>
              <span className="tpl-icon">{x.icon}</span>
              <div>
                <div className="tpl-name">{x.name}</div>
                <div className="tpl-desc">{x.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="tpl-preview">
          <div className="tpl-bar">
            <span>Preview</span>
            <span style={{ flex: 1 }} />
            <button className="btn primary sm" onClick={() => { setOpen(false); applyTemplate(t); }}>
              Use template
            </button>
            <div className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setOpen(false)}>
              <X size={16} />
            </div>
          </div>
          <div className="tpl-page">
            {t.cover && <div className="tpl-cover" style={{ background: /^(https?:|\/)/.test(t.cover) ? `url("${t.cover}") center/cover` : t.cover }} />}
            <div className="tpl-body">
              <div className="tpl-page-icon" style={t.cover ? { marginTop: -30 } : undefined}>{t.icon}</div>
              <h1>{t.name}</h1>
              {t.database ? (
                <div className="tpl-db">
                  <div className="tpl-db-tabs">
                    <span className="on">{t.database[0].toUpperCase() + t.database.slice(1)}</span>
                  </div>
                  <div className={'tpl-db-grid tpl-' + t.database}>
                    {Array.from({ length: t.database === 'calendar' ? 14 : 6 }, (_, i) => (
                      <div key={i} className="tpl-db-cell">
                        <span />
                        <span />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                blocks.map((b, i) => {
                  num = b.type === 'numbered' ? num + 1 : 0;
                  const html = { __html: b.html || '' };
                  if (b.type === 'h2') return <h2 key={i} dangerouslySetInnerHTML={html} />;
                  if (b.type === 'quote') return <blockquote key={i} dangerouslySetInnerHTML={html} />;
                  if (b.type === 'todo') return <div key={i} className="tpl-li"><span className="tpl-box" /><span dangerouslySetInnerHTML={html} /></div>;
                  if (b.type === 'bulleted') return <div key={i} className="tpl-li"><span className="tpl-dot">•</span><span dangerouslySetInnerHTML={html} /></div>;
                  if (b.type === 'numbered') return <div key={i} className="tpl-li"><span className="tpl-dot">{num}.</span><span dangerouslySetInnerHTML={html} /></div>;
                  return <p key={i} dangerouslySetInnerHTML={html} />;
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
