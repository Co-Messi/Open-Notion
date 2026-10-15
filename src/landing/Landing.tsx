import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Blocks,
  Calendar,
  ChartGantt,
  Check,
  ChevronDown,
  CodeXml,
  Copy,
  GalleryVerticalEnd,
  Github,
  GripVertical,
  Hash,
  HardDrive,
  Menu,
  Minus,
  Moon,
  Pause,
  Play,
  SquareKanban,
  Star,
  Sun,
  Table2,
  Undo2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  ThemeContext,
  useReveal,
  useScrolled,
  usePrefersReducedMotion,
  useTheme,
  useThemeState,
} from './hooks';

const GITHUB = 'https://github.com/Co-Messi/Open-Notion';
const APP = '/app/';
const CLONE = 'git clone https://github.com/Co-Messi/Open-Notion.git && cd Open-Notion && npm install && npm run dev';

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function LogoMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`logo-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="logo-bg" x="4" y="4" width="120" height="120" rx="30" />
      <g className="logo-fg">
        <circle cx="36" cy="54" r="5.5" />
        <circle cx="51" cy="54" r="5.5" />
        <circle cx="36" cy="69" r="5.5" />
        <circle cx="51" cy="69" r="5.5" />
        <circle cx="36" cy="84" r="5.5" />
        <circle cx="51" cy="84" r="5.5" />
        <rect x="34" y="28" width="60" height="13" rx="6.5" />
        <rect x="64" y="49" width="30" height="10" rx="5" />
        <rect x="64" y="64" width="22" height="10" rx="5" opacity="0.7" />
        <rect x="64" y="79" width="30" height="10" rx="5" />
      </g>
    </svg>
  );
}

type ShotName =
  | 'board'
  | 'table'
  | 'timeline'
  | 'calendar'
  | 'gallery'
  | 'peek'
  | 'search'
  | 'slash'
  | 'toolbar';

const SHOT_SIZE: Record<ShotName, [number, number]> = {
  board: [1600, 900],
  table: [1600, 900],
  timeline: [1600, 900],
  calendar: [1600, 900],
  gallery: [1600, 900],
  peek: [1600, 1210],
  search: [1600, 891],
  slash: [1280, 1120],
  toolbar: [1576, 760],
};

/** A product screenshot that follows the page theme (light or dark capture). */
function Shot({
  name,
  alt,
  className,
  eager = false,
  style,
}: {
  name: ShotName;
  alt: string;
  className?: string;
  eager?: boolean;
  style?: CSSProperties;
}) {
  const theme = useTheme();
  const [w, h] = SHOT_SIZE[name];
  return (
    <img
      className={className}
      src={`/landing/${name}-${theme}.webp`}
      width={w}
      height={h}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      style={style}
    />
  );
}

function Button({
  href,
  children,
  variant = 'primary',
  size = 'md',
  external = false,
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  external?: boolean;
  className?: string;
}) {
  return (
    <a
      className={`btn btn-${variant} btn-${size} ${className}`}
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

function Chip({ icon: Icon, tone }: { icon: LucideIcon; tone: 'green' | 'orange' | 'blue' | 'purple' | 'red' }) {
  return (
    <span className={`chip chip-${tone}`} aria-hidden="true">
      <Icon size={20} strokeWidth={1.9} />
    </span>
  );
}

function SectionHead({ title, lede, center = false }: { title: ReactNode; lede?: ReactNode; center?: boolean }) {
  return (
    <div className={`section-head reveal${center ? ' is-center' : ''}`}>
      <h2 className="h2">{title}</h2>
      {lede && <p className="lede">{lede}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#databases', label: 'Databases' },
  { href: '#open-source', label: 'Open source' },
  { href: '#faq', label: 'FAQ' },
];

function ThemeToggle({ onToggle }: { onToggle: () => void }) {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onToggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? <Sun size={18} strokeWidth={1.8} /> : <Moon size={18} strokeWidth={1.8} />}
    </button>
  );
}

function Nav({ onToggleTheme }: { onToggleTheme: () => void }) {
  const scrolled = useScrolled();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 860) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <header className={`nav${scrolled || open ? ' is-scrolled' : ''}${open ? ' is-open' : ''}`}>
      <div className="nav-inner container">
        <a className="brand" href="#top" aria-label="OpenNotion home">
          <LogoMark size={28} />
          <span>OpenNotion</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map(link => (
            <a key={link.href} href={link.href} className="nav-link">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <a className="nav-link nav-github" href={GITHUB} target="_blank" rel="noopener noreferrer">
            <Github size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>GitHub</span>
          </a>
          <ThemeToggle onToggle={onToggleTheme} />
          <Button href={APP} size="sm" className="nav-cta">
            Open app
          </Button>
          <button
            type="button"
            className="icon-btn nav-menu-btn"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(v => !v)}
          >
            {open ? <X size={20} strokeWidth={1.8} /> : <Menu size={20} strokeWidth={1.8} />}
          </button>
        </div>
      </div>

      <div id="mobile-menu" className="mobile-menu" hidden={!open}>
        <nav className="container mobile-menu-inner" aria-label="Mobile">
          {NAV_LINKS.map(link => (
            <a key={link.href} href={link.href} className="mobile-link" onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a
            className="mobile-link"
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            GitHub
          </a>
          <div className="mobile-menu-cta">
            <Button href={APP} size="lg">
              Open OpenNotion
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function DemoVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const reduce = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);
  const userPaused = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Safari ignores the React `muted` prop for autoplay; set it on the element.
    video.muted = true;
    video.defaultMuted = true;
    if (reduce) {
      video.pause();
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !userPaused.current) video.play().catch(() => {});
        else if (!entry.isIntersecting) video.pause();
      },
      { threshold: 0.2 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [reduce]);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      video.play().catch(() => {});
    } else {
      userPaused.current = true;
      video.pause();
    }
  };

  return (
    <div className="window hero-window">
      <div className="window-bar">
        <span className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="window-title">
          <LogoMark size={14} />
          OpenNotion
        </span>
        <button
          type="button"
          className="window-action"
          onClick={toggle}
          aria-label={playing ? 'Pause the demo video' : 'Play the demo video'}
        >
          {playing ? <Pause size={14} strokeWidth={2} /> : <Play size={14} strokeWidth={2} />}
        </button>
      </div>
      <div className="window-body">
        <video
          ref={ref}
          className="hero-video"
          src="/landing/demo.mp4"
          poster="/landing/demo-poster.webp"
          width={1280}
          height={800}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Demo: creating a page with the slash menu, formatting text, dragging a board card and switching to dark mode"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container hero-copy">
        <h1 className="h1 hero-title">
          <span className="hero-line">Write, plan and organize.</span>{' '}
          <span className="hero-line">
            Open source, <span className="nowrap">in your browser.</span>
          </span>
        </h1>
        <p className="hero-sub">
          Pages, blocks and databases that live on your machine. No account, no server, MIT licensed.
        </p>
        <div className="cta-row">
          <Button href={APP} size="lg">
            Open OpenNotion
          </Button>
          <Button href={GITHUB} size="lg" variant="secondary" external>
            <Github size={18} strokeWidth={1.8} aria-hidden="true" />
            View on GitHub
          </Button>
        </div>
        <p className="hero-note">Free to use. Nothing to install. Your notes never leave your browser.</p>
      </div>
      <div className="container hero-media reveal">
        <DemoVideo />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

const VALUES = [
  {
    icon: HardDrive,
    tone: 'green' as const,
    title: 'Yours',
    body: 'Everything lives in your browser. There is no account to create and no server to trust. Download a full JSON backup whenever you like.',
  },
  {
    icon: Zap,
    tone: 'orange' as const,
    title: 'Instant',
    body: 'No spinners and no round trips. Pages open the moment you click, typing never lags, and once loaded it keeps working without a connection.',
  },
  {
    icon: Blocks,
    tone: 'blue' as const,
    title: 'Familiar',
    body: 'Blocks, the slash menu, Markdown shortcuts and databases with six views. If you have used a block editor before, you already know your way around.',
  },
];

function Values() {
  return (
    <section className="section" id="why" aria-labelledby="why-title">
      <div className="container">
        <div className="section-head reveal">
          <h2 className="h2" id="why-title">
            A workspace you actually own.
          </h2>
        </div>
        <div className="value-grid">
          {VALUES.map((v, i) => (
            <article key={v.title} className="value-card reveal" style={{ '--d': `${i * 70}ms` } as CSSProperties}>
              <Chip icon={v.icon} tone={v.tone} />
              <h3 className="h3">{v.title}</h3>
              <p>{v.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Write with blocks                                                   */
/* ------------------------------------------------------------------ */

const EDITOR_EXTRAS = [
  {
    icon: Hash,
    tone: 'purple' as const,
    title: 'Markdown shortcuts',
    body: 'Type # for a heading or [] for a checkbox and keep writing.',
  },
  {
    icon: GripVertical,
    tone: 'blue' as const,
    title: 'Drag and drop',
    body: 'Move any block by its handle, or drop it beside another to make columns.',
  },
  {
    icon: Undo2,
    tone: 'green' as const,
    title: 'Undo anything',
    body: 'Every edit can be undone, even splitting and merging blocks.',
  },
  {
    icon: CodeXml,
    tone: 'orange' as const,
    title: 'Code and tables',
    body: 'Syntax highlighting for over 20 languages, simple tables, images and bookmarks.',
  },
];

function WriteSection() {
  return (
    <section className="section" id="features" aria-labelledby="write-title">
      <div className="container">
        <div className="section-head reveal">
          <h2 className="h2" id="write-title">
            Write with blocks.
          </h2>
          <p className="lede">Every line is a block. Turn it into a heading, a checklist, a toggle or a database in a keystroke.</p>
        </div>

        <div className="bento">
          <article className="bento-card reveal">
            <div className="bento-copy">
              <p className="eyebrow">Slash menu</p>
              <h3 className="h3">Type / to add anything.</h3>
              <p className="muted">
                Headings, lists, toggles, callouts, quotes, code, images, bookmarks, tables, columns, subpages and
                databases.
              </p>
            </div>
            <div className="bento-visual">
              <Shot name="slash" alt="The slash menu listing block types such as text, headings, lists and callouts" className="shot shot-slash" />
            </div>
          </article>
          <article className="bento-card reveal" style={{ '--d': '80ms' } as CSSProperties}>
            <div className="bento-copy">
              <p className="eyebrow">Selection toolbar</p>
              <h3 className="h3">Format right where you type.</h3>
              <p className="muted">
                Bold, italic, underline, strikethrough, inline code, links and twenty colors, or turn the block into
                another type.
              </p>
            </div>
            <div className="bento-visual">
              <Shot name="toolbar" alt="The formatting toolbar floating above highlighted text" className="shot shot-toolbar" />
            </div>
          </article>
        </div>

        <ul className="mini-grid" role="list">
          {EDITOR_EXTRAS.map((x, i) => (
            <li key={x.title} className="mini-card reveal" style={{ '--d': `${i * 60}ms` } as CSSProperties}>
              <Chip icon={x.icon} tone={x.tone} />
              <h3 className="mini-title">{x.title}</h3>
              <p className="muted">{x.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Databases                                                           */
/* ------------------------------------------------------------------ */

const VIEWS: { id: ShotName; label: string; icon: LucideIcon; caption: string }[] = [
  { id: 'board', label: 'Board', icon: SquareKanban, caption: 'Group cards by status and drag them between columns.' },
  { id: 'table', label: 'Table', icon: Table2, caption: 'See every property at a glance in tidy rows and columns.' },
  { id: 'timeline', label: 'Timeline', icon: ChartGantt, caption: 'Plan dated work and drag bars across the weeks.' },
  { id: 'calendar', label: 'Calendar', icon: Calendar, caption: 'See rows on the days they happen and drag events to reschedule.' },
  { id: 'gallery', label: 'Gallery', icon: GalleryVerticalEnd, caption: 'Browse pages as cards with their covers up front.' },
];

const DB_FACTS = [
  { title: 'Six views', body: 'Table, board, list, gallery, calendar and timeline.' },
  { title: '13 property types', body: 'Text, numbers, selects, status, dates, people, checkboxes and more.' },
  { title: 'Filters and sorts', body: 'Each view keeps its own filters, sorts, grouping and visible properties.' },
  { title: 'Inline or full page', body: 'Drop a database into any page, or open it on its own.' },
];

function Databases() {
  const theme = useTheme();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (i: number) => {
    const next = (i + VIEWS.length) % VIEWS.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') select(active + 1);
    else if (e.key === 'ArrowLeft') select(active - 1);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(VIEWS.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <section className="section" id="databases" aria-labelledby="db-title">
      <div className="container">
        <div className="section-head reveal">
          <h2 className="h2" id="db-title">
            Organize with databases.
          </h2>
          <p className="lede">One set of rows, many ways to see them. Switch views without losing a thing.</p>
        </div>

        <div className="db-stage reveal">
          <div className="db-tabs" role="tablist" aria-label="Database views" onKeyDown={onKeyDown}>
            {VIEWS.map((v, i) => {
              const Icon = v.icon;
              const selected = i === active;
              return (
                <button
                  key={v.id}
                  ref={el => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`db-tab-${v.id}`}
                  aria-selected={selected}
                  aria-controls="db-panel"
                  tabIndex={selected ? 0 : -1}
                  className={`db-tab${selected ? ' is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                  {v.label}
                </button>
              );
            })}
          </div>
          <p className="db-caption" aria-live="polite">
            {VIEWS[active].caption}
          </p>

          <div className="db-frame" id="db-panel" role="tabpanel" aria-labelledby={`db-tab-${VIEWS[active].id}`}>
            <div className="db-images">
              {VIEWS.map((v, i) => (
                <img
                  key={v.id}
                  className={`db-image${i === active ? ' is-active' : ''}`}
                  src={`/landing/${v.id}-${theme}.webp`}
                  width={1600}
                  height={900}
                  alt={i === active ? `${v.label} view of a task database` : ''}
                  aria-hidden={i === active ? undefined : true}
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
          </div>
        </div>

        <dl className="facts">
          {DB_FACTS.map((f, i) => (
            <div key={f.title} className="fact reveal" style={{ '--d': `${i * 60}ms` } as CSSProperties}>
              <dt>{f.title}</dt>
              <dd>{f.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Alternating feature rows                                            */
/* ------------------------------------------------------------------ */

function FeatureRow({
  id,
  eyebrow,
  title,
  body,
  bullets,
  visual,
  flip = false,
  visualClass = '',
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  body: ReactNode;
  bullets: string[];
  visual: ReactNode;
  flip?: boolean;
  visualClass?: string;
}) {
  return (
    <div className={`row${flip ? ' is-flipped' : ''}`} id={id}>
      <div className="row-copy reveal">
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="h3-lg">{title}</h3>
        <p className="row-body">{body}</p>
        <ul className="checks" role="list">
          {bullets.map(b => (
            <li key={b}>
              <Check size={16} strokeWidth={2.2} aria-hidden="true" />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div className={`row-visual reveal ${visualClass}`} style={{ '--d': '90ms' } as CSSProperties}>
        {visual}
      </div>
    </div>
  );
}

function Rows() {
  return (
    <section className="section section-rows" aria-label="More features">
      <div className="container rows">
        <FeatureRow
          id="peek"
          eyebrow="Side peek"
          title="Open a row without losing your place."
          body="Click any card or row and it opens beside the view. Edit its properties, write notes underneath, and step through the rest with the arrows."
          bullets={['Edit every property in place', 'Full page content under the properties', 'Expand to a full page when you need room']}
          visual={<Shot name="peek" alt="A task opened in a side panel next to its board, showing status, assignee, due date and priority" className="shot shot-bleed" />}
          visualClass="is-bleed"
        />
        <FeatureRow
          id="search"
          flip
          eyebrow="Search"
          title={
            <>
              Find anything with <kbd>⌘K</kbd>.
            </>
          }
          body="Search titles and page content together, and preview the selected page before you open it."
          bullets={['Tabs with their own back and forward history', 'Favorites and a nested page tree in the sidebar', 'Trash with restore, and a library of every page']}
          visual={<Shot name="search" alt="Search results for the word launch with a live preview of the matching page" className="shot shot-search" />}
        />
        <FeatureRow
          id="themes"
          eyebrow="Light and dark"
          title="Easy on the eyes, day or night."
          body={
            <>
              Choose light, dark or follow your system, and switch any time with <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>L</kbd>. Every
              view is tuned for both.
            </>
          }
          bullets={['Icons and covers from emoji, gradients, photos or uploads', 'Serif and mono page fonts, small text and full width', 'Import Markdown and export any page as Markdown']}
          visual={
            <img
              className="shot"
              src="/landing/theme-split.webp"
              width={1600}
              height={1000}
              alt="The same page shown half in the light theme and half in the dark theme"
              loading="lazy"
              decoding="async"
            />
          }
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Open source                                                         */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={`copy-btn${copied ? ' is-copied' : ''}`}
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
      aria-label={copied ? 'Copied to clipboard' : 'Copy commands'}
    >
      {copied ? <Check size={14} strokeWidth={2.2} /> : <Copy size={14} strokeWidth={1.9} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function OpenSource() {
  return (
    <section className="section" id="open-source" aria-labelledby="oss-title">
      <div className="container">
        <div className="oss">
          <div className="oss-copy reveal">
            <p className="eyebrow">Open source, MIT licensed</p>
            <h2 className="h2" id="oss-title">
              Fork it, <span className="nowrap">self host it,</span> <span className="nowrap">make it yours.</span>
            </h2>
            <p className="lede">
              Read every line, change anything, and host your own copy on GitHub Pages, Vercel, Netlify, Cloudflare
              Pages or a plain web server. Each visitor gets a private workspace in their own browser.
            </p>
            <div className="cta-row is-left">
              <Button href={GITHUB} external>
                <Star size={17} strokeWidth={1.9} aria-hidden="true" />
                Star on GitHub
              </Button>
              <Button href={`${GITHUB}/blob/main/LICENSE`} variant="secondary" external>
                Read the license
              </Button>
            </div>
            <ul className="stack" role="list" aria-label="Built with">
              <li>React 19</li>
              <li>TypeScript</li>
              <li>Vite</li>
              <li>No backend</li>
            </ul>
          </div>

          <div className="terminal reveal" style={{ '--d': '90ms' } as CSSProperties}>
            <div className="terminal-bar">
              <span className="window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="terminal-title">Run it locally</span>
              <CopyButton text={CLONE} />
            </div>
            <pre className="terminal-body" tabIndex={0} aria-label="Commands to run OpenNotion locally">
              <code>
                <span className="t-line">
                  <span className="t-prompt">$</span> git clone https://github.com/Co-Messi/Open-Notion.git <span className="t-op">&amp;&amp;</span>
                </span>
                <span className="t-line">
                  <span className="t-indent" />cd Open-Notion <span className="t-op">&amp;&amp;</span>
                </span>
                <span className="t-line">
                  <span className="t-indent" />npm install <span className="t-op">&amp;&amp;</span>
                </span>
                <span className="t-line">
                  <span className="t-indent" />npm run dev
                </span>
                <span className="t-line t-gap" />
                <span className="t-line t-comment"># Then open http://localhost:5174</span>
                <span className="t-line t-comment"># A starter workspace is created on first launch</span>
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

type Mark = 'yes' | 'no' | 'plain';
const COMPARE: { label: string; ours: [Mark, string]; theirs: [Mark, string] }[] = [
  { label: 'Open source', ours: ['yes', 'MIT license'], theirs: ['no', 'No'] },
  { label: 'Price', ours: ['plain', 'Free'], theirs: ['plain', 'Free plan and paid plans'] },
  { label: 'Account required', ours: ['yes', 'Not needed'], theirs: ['plain', 'Yes'] },
  { label: 'Where your data lives', ours: ['plain', 'Your browser'], theirs: ['plain', "Notion's cloud"] },
  { label: 'Works offline', ours: ['yes', 'Yes, once loaded'], theirs: ['plain', 'Partially'] },
  { label: 'Self hosting', ours: ['yes', 'Any static host'], theirs: ['no', 'Not available'] },
  { label: 'Real time collaboration', ours: ['no', 'Not yet'], theirs: ['yes', 'Yes'] },
  { label: 'AI features', ours: ['no', 'No'], theirs: ['yes', 'Yes'] },
  { label: 'Integrations and API', ours: ['no', 'Not yet'], theirs: ['yes', 'Yes'] },
];

function Cell({ mark, text }: { mark: Mark; text: string }) {
  return (
    <span className={`cmp-cell is-${mark}`}>
      {mark === 'yes' && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
      {mark === 'no' && <Minus size={16} strokeWidth={2.4} aria-hidden="true" />}
      {text}
    </span>
  );
}

function Compare() {
  return (
    <section className="section" id="compare" aria-labelledby="compare-title">
      <div className="container">
        <SectionHead
          title={<span id="compare-title">How it compares.</span>}
          lede="OpenNotion is for people who want the block and database way of working in a tool they fully own. If your team needs live collaboration today, Notion is the better choice."
        />
        <div className="cmp-wrap reveal">
          <table className="cmp">
            <caption className="sr-only">OpenNotion compared with Notion</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                <th scope="col" className="cmp-ours">
                  <span className="cmp-head">
                    <LogoMark size={20} />
                    OpenNotion
                  </span>
                </th>
                <th scope="col">
                  <span className="cmp-head">Notion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(row => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td className="cmp-ours">
                    <Cell mark={row.ours[0]} text={row.ours[1]} />
                  </td>
                  <td>
                    <Cell mark={row.theirs[0]} text={row.theirs[1]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: 'Is OpenNotion affiliated with Notion?',
    a: (
      <>
        No. OpenNotion is an independent open source project. It is not affiliated with, endorsed by, or sponsored by
        Notion Labs, Inc. The name Notion appears here only to describe what this project is an alternative to.
      </>
    ),
  },
  {
    q: 'Where is my data stored?',
    a: (
      <>
        In your browser's local storage, on your device only. Nothing is sent to a server. Open{' '}
        <strong>Settings</strong>, then <strong>Import and export</strong>, to download a full JSON backup and restore
        it later or in another browser.
      </>
    ),
  },
  {
    q: 'Can I use it with my team?',
    a: (
      <>
        Not yet. Each browser has its own private workspace. An optional sync server for real time collaboration is on
        the roadmap.
      </>
    ),
  },
  {
    q: 'What is not working yet?',
    a: (
      <>
        AI chat, meetings, sharing and publishing appear in the interface so the layout feels complete, but they need a
        server, so for now they are placeholders. Everything else works right in your browser.
      </>
    ),
  },
  {
    q: 'How do I host my own copy?',
    a: (
      <>
        Run <code>npm run build</code> and serve the <code>dist</code> folder from any static host. There is no backend
        to run and no database to manage.
      </>
    ),
  },
  {
    q: 'What does it cost?',
    a: <>Nothing. OpenNotion is free and MIT licensed, so you can use it, change it and share it.</>,
  },
];

function FaqItem({ q, a, defaultOpen = false }: { q: string; a: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = q.toLowerCase().replace(/[^a-z]+/g, '_');
  return (
    <div className={`faq-item${open ? ' is-open' : ''}`}>
      <h3 className="faq-q">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`faq_${id}`}
          id={`faq_btn_${id}`}
          onClick={() => setOpen(v => !v)}
        >
          <span>{q}</span>
          <ChevronDown size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </h3>
      <div className="faq-a" id={`faq_${id}`} role="region" aria-labelledby={`faq_btn_${id}`}>
        <div className="faq-a-inner">
          <p>{a}</p>
        </div>
      </div>
    </div>
  );
}

function Faq() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="container faq">
        <div className="faq-side reveal">
          <h2 className="h2" id="faq-title">
            Questions, answered.
          </h2>
          <p className="lede">
            Something else on your mind?{' '}
            <a className="text-link" href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer">
              Open an issue on GitHub
            </a>
            .
          </p>
        </div>
        <div className="faq-list reveal" style={{ '--d': '80ms' } as CSSProperties}>
          {FAQS.map((f, i) => (
            <FaqItem key={f.q} q={f.q} a={f.a} defaultOpen={i === 0} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing band and footer                                             */
/* ------------------------------------------------------------------ */

function ClosingCta() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="container closing-inner reveal">
        <LogoMark size={56} className="closing-logo" />
        <h2 className="h2" id="closing-title">
          Your next page is one click away.
        </h2>
        <p className="lede">No sign up and no download. Open the app and start writing.</p>
        <div className="cta-row">
          <Button href={APP} size="lg">
            Open OpenNotion
          </Button>
          <Button href={GITHUB} size="lg" variant="secondary" external>
            <Github size={18} strokeWidth={1.8} aria-hidden="true" />
            View on GitHub
          </Button>
        </div>
      </div>
    </section>
  );
}

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Open the app', href: APP },
      { label: 'Features', href: '#features' },
      { label: 'Databases', href: '#databases' },
      { label: 'Compare', href: '#compare' },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'GitHub', href: GITHUB, external: true },
      { label: 'Roadmap', href: `${GITHUB}#roadmap`, external: true },
      { label: 'Contributing', href: `${GITHUB}#contributing`, external: true },
      { label: 'Report an issue', href: `${GITHUB}/issues`, external: true },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Quick start', href: `${GITHUB}#quick-start`, external: true },
      { label: 'Keyboard shortcuts', href: `${GITHUB}#keyboard-shortcuts`, external: true },
      { label: 'FAQ', href: '#faq' },
      { label: 'MIT license', href: `${GITHUB}/blob/main/LICENSE`, external: true },
    ],
  },
];

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <a className="brand brand-lg" href="#top" aria-label="OpenNotion, back to top">
              <LogoMark size={32} />
              <span>OpenNotion</span>
            </a>
            <p className="muted">An open source workspace that runs entirely in your browser.</p>
          </div>
          {FOOTER_COLUMNS.map(col => (
            <nav key={col.title} className="footer-col" aria-label={col.title}>
              <p className="footer-col-title">{col.title}</p>
              <ul role="list">
                {col.links.map(link => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...('external' in link && link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="footer-bottom">
          <p>© 2026 Brayden Siew. MIT licensed.</p>
          <p className="footer-legal">
            OpenNotion is an independent open source project and is not affiliated with, endorsed by, or sponsored by
            Notion Labs, Inc. Notion is a trademark of Notion Labs, Inc.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing() {
  const { theme, toggle } = useThemeState();
  useReveal();

  return (
    <ThemeContext.Provider value={theme}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav onToggleTheme={toggle} />
      <main id="main">
        <Hero />
        <Values />
        <WriteSection />
        <Databases />
        <Rows />
        <OpenSource />
        <Compare />
        <Faq />
        <ClosingCta />
      </main>
      <Footer />
    </ThemeContext.Provider>
  );
}
