import { Clock3, BookOpen, CalendarDays, Plus, FileText } from 'lucide-react';
import { useDoc, getDoc } from '../store/store';
import { createPage, openPage, pageTitle, isTrashedDeep } from '../store/actions';
import { PageIconView } from './PageIcon';
import { relTime } from './ui';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Home() {
  const recent = useDoc(d => d.recent.filter(r => !isTrashedDeep(d, r.id)).slice(0, 12));
  const name = useDoc(d => d.workspace.userName.split(' ')[0]);
  return (
    <div className="frame">
      <div className="home">
        <h1>{name && name !== 'You' ? `${greeting()}, ${name}` : greeting()}</h1>
        <section className="home-section">
          <div className="home-section-title">
            <Clock3 size={14} /> Recently visited
          </div>
          <div className="recent-row">
            {recent.map(r => (
              <RecentCard key={r.id} id={r.id} at={r.at} />
            ))}
            <div
              className="recent-card"
              onClick={() => {
                const id = createPage({ section: 'private' });
                openPage(id);
              }}
            >
              <div className="rc-top" />
              <div className="rc-icon">
                <Plus size={22} strokeWidth={1.5} />
              </div>
              <div className="rc-body">
                <div className="rc-title placeholder">New page</div>
              </div>
            </div>
          </div>
        </section>
        <section className="home-section">
          <div className="home-section-title">
            <BookOpen size={14} /> Learn
          </div>
          <div className="learn-row">
            <LearnCard art={<ArtShortcuts />} title="Keyboard shortcuts that save hours" meta="3m read" page="Getting Started" />
            <LearnCard art={<ArtSlash />} title="Types of content blocks" meta="5m read" page="Getting Started" />
            <LearnCard art={<ArtBoard />} title="Build your first database" meta="4m read" page="Task List" />
          </div>
        </section>
        <section className="home-section">
          <div className="home-section-title">
            <CalendarDays size={14} /> Upcoming events
          </div>
          <UpcomingEvents />
        </section>
      </div>
    </div>
  );
}

function RecentCard({ id, at }: { id: string; at: number }) {
  const p = useDoc(d => d.pages[id], Object.is);
  if (!p) return null;
  const cover = p.cover && !/^(data:|https?:)/.test(p.cover) ? p.cover : p.cover ? `url("${p.cover}") center/cover` : undefined;
  return (
    <div className="recent-card" onClick={() => openPage(id)}>
      <div className="rc-top" style={cover ? { background: cover } : undefined} />
      <div className="rc-icon">{p.icon ? <PageIconView page={p} size={26} emojiSize={26} /> : <FileText size={26} strokeWidth={1.4} />}</div>
      <div className="rc-body">
        <div className="rc-title">{pageTitle(p)}</div>
        <div className="rc-meta">
          <span className="avatar">{getDoc().workspace.userName[0]}</span>
          {relTime(at)}
        </div>
      </div>
    </div>
  );
}

function LearnCard({ art, title, meta, page }: { art: React.ReactNode; title: string; meta: string; page: string }) {
  return (
    <div
      className="learn-card"
      onClick={() => {
        const p = Object.values(getDoc().pages).find(x => x.title === page && !x.trashed);
        if (p) openPage(p.id);
      }}
    >
      <div className="lc-art">{art}</div>
      <div className="lc-body">
        <div className="lc-title">{title}</div>
        <div className="lc-meta">
          <BookOpen size={12} /> {meta}
        </div>
      </div>
    </div>
  );
}

function UpcomingEvents() {
  // Pull dated rows from any database (e.g. the Task List calendar) as "events".
  const events = useDoc(d => {
    const out: { id: string; title: string; date: string }[] = [];
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    for (const p of Object.values(d.pages)) {
      if (!p.isDatabase || p.trashed) continue;
      const dateProp = p.schema?.find(s => s.type === 'date');
      if (!dateProp) continue;
      for (const rid of p.rows || []) {
        const r = d.pages[rid];
        const v = r?.props?.[dateProp.id];
        if (r && !r.trashed && v?.start && String(v.start).slice(0, 10) >= today) out.push({ id: rid, title: pageTitle(r), date: String(v.start) });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  }, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  return (
    <div className="events-card">
      <div className="ev-left">
        <CalendarDays size={22} color="var(--icon-secondary)" />
        <b>See your upcoming events</b>
        Dated items from your databases show up here.
      </div>
      <div className="ev-list">
        {events.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No upcoming events</div>}
        {events.map(e => (
          <div key={e.id} className="ev-item" style={{ cursor: 'pointer' }} onClick={() => openPage(e.id, { peek: true })}>
            <div className="bar" />
            <div>
              <div>{e.title}</div>
              <div className="when">
                {new Date(e.date.length > 10 ? e.date : e.date + 'T00:00:00').toLocaleString(undefined, e.date.length > 10 ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtShortcuts() {
  return (
    <div className="art art-keys">
      {[['⌘', 'K'], ['⌘', '\\'], ['⌘', '⇧', 'L'], ['/']].map((keys, i) => (
        <div key={i} className="art-keyrow">
          {keys.map(k => (
            <span key={k} className="art-key">{k}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function ArtSlash() {
  const items: [string, string][] = [['T', 'Text'], ['H1', 'Heading 1'], ['☐', 'To-do list'], ['▸', 'Toggle list'], ['❝', 'Quote']];
  return (
    <div className="art art-slash">
      <div className="art-line">
        <span className="art-caret">/</span>
      </div>
      <div className="art-menu">
        <div className="art-menu-label">Basic blocks</div>
        {items.map(([ic, label], i) => (
          <div key={label} className={'art-menu-item' + (i === 0 ? ' on' : '')}>
            <span className="art-ic">{ic}</span>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtBoard() {
  const cols: [string, string, number][] = [['Not started', 'default', 2], ['In progress', 'blue', 1], ['Done', 'green', 2]];
  return (
    <div className="art art-board">
      {cols.map(([name, color, n]) => (
        <div key={name} className={'art-col art-' + color}>
          <span className={'art-pill art-pill-' + color}>{name}</span>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="art-card">
              <span />
              <span />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
