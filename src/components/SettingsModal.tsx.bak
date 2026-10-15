import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Bell, Settings as Gear, Users, Keyboard, ChevronDown, Download, Upload, RotateCcw, PanelLeft, Check } from 'lucide-react';
import { useUi, setUi, useSettings, setSettings, useDoc, transact, replaceDoc, showToast, getDoc } from '../store/store';
import { Popover, Menu, Switch, type Anchor } from './ui';
import { WorkspaceIcon } from './Sidebar';
import { EmojiPicker } from './EmojiPicker';
import { exportWorkspaceJson, importMarkdownAsPage } from '../lib/exporter';
import { createSeed } from '../store/seed';
import { openPage } from '../store/actions';
import type { Doc } from '../store/types';

export function SettingsModal() {
  const open = useUi(u => u.settingsOpen);
  const tab = useUi(u => u.settingsTab);
  const ws = useDoc(d => d.workspace, Object.is);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.popover')) setUi({ settingsOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const close = () => setUi({ settingsOpen: false });
  const nav = (id: string, icon: React.ReactNode, label: string) => (
    <div className={'nav-item' + (tab === id ? ' on' : '')} onClick={() => setUi({ settingsTab: id })}>
      {icon}
      {label}
    </div>
  );
  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal settings-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="settings-nav">
          <div className="nav-label">Account</div>
          <div className="settings-user">
            <span className="avatar lg">{ws.userName[0]}</span>
            <div>
              <div className="nm">{ws.userName}</div>
              <div className="em">{ws.userEmail}</div>
            </div>
          </div>
          {nav('preferences', <SlidersHorizontal size={16} />, 'Preferences')}
          {nav('notifications', <Bell size={16} />, 'Notifications')}
          {nav('shortcuts', <Keyboard size={16} />, 'Keyboard shortcuts')}
          {nav('sidebar', <PanelLeft size={16} />, 'Sidebar')}
          <div className="nav-label" style={{ marginTop: 12 }}>Workspace</div>
          {nav('general', <Gear size={16} />, 'General')}
          {nav('people', <Users size={16} />, 'People')}
          {nav('data', <Download size={16} />, 'Import & export')}
        </div>
        <div className="settings-content">
          {tab === 'preferences' && <Preferences />}
          {tab === 'notifications' && <Notifications />}
          {tab === 'shortcuts' && <Shortcuts />}
          {tab === 'sidebar' && <SidebarSettings />}
          {tab === 'general' && <General />}
          {tab === 'people' && <People />}
          {tab === 'data' && <DataSettings />}
        </div>
      </div>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Select({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const [a, setA] = useState<Anchor>(null);
  return (
    <>
      <div className="select-btn" onClick={e => setA(e.currentTarget.getBoundingClientRect())}>
        {options.find(o => o[0] === value)?.[1]}
        <ChevronDown size={14} />
      </div>
      {a && (
        <Popover anchor={a} onClose={() => setA(null)} width={220} placement="bottom-end">
          <Menu
            onClose={() => setA(null)}
            items={options.map(([v, l]) => ({ id: v, label: l, right: v === value ? <Check size={14} /> : undefined, onSelect: () => onChange(v) }))}
          />
        </Popover>
      )}
    </>
  );
}

function Preferences() {
  const theme = useSettings(s => s.theme);
  const start = useSettings(s => s.startPage);
  return (
    <>
      <h2>Preferences</h2>
      <Row title="Appearance" desc="Customize how the app looks on your device.">
        <Select value={theme} options={[['system', 'Use system setting'], ['light', 'Light'], ['dark', 'Dark']]} onChange={v => setSettings({ theme: v as any })} />
      </Row>
      <h3>Language & Time</h3>
      <Row title="Language" desc="Change the language used in the user interface.">
        <Select value="en" options={[['en', 'English (US)']]} onChange={() => {}} />
      </Row>
      <Row title="Start week on Monday" desc="This will change how all calendars in your app look.">
        <Switch on={localStorage.getItem('on:week-monday') === '1'} onChange={v => { localStorage.setItem('on:week-monday', v ? '1' : '0'); showToast('Saved'); setUi({}); }} />
      </Row>
      <h3>Desktop app</h3>
      <Row title="Open on start" desc="Choose what to show when the app opens.">
        <Select value={start} options={[['last', 'Last visited page'], ['home', 'Home']]} onChange={v => setSettings({ startPage: v as any })} />
      </Row>
    </>
  );
}

function Notifications() {
  return (
    <>
      <h2>Notifications</h2>
      <Row title="Mobile push notifications" desc="Receive push notifications on mentions and comments.">
        <Switch on={false} />
      </Row>
      <Row title="Email notifications" desc="Notifications need an account server; this workspace is local only." />
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Search', '⌘K / ⌘P'],
  ['New page', '⌘N'],
  ['Toggle sidebar', '⌘\\'],
  ['Toggle dark mode', '⌘⇧L'],
  ['Undo / Redo', '⌘Z / ⌘⇧Z'],
  ['Bold / Italic / Underline', '⌘B / ⌘I / ⌘U'],
  ['Strikethrough', '⌘⇧S'],
  ['Inline code', '⌘E'],
  ['Add link', '⌘K (with selection)'],
  ['Indent / Outdent', 'Tab / ⇧Tab'],
  ['Select block', 'Esc'],
  ['Duplicate block', '⌘D'],
  ['Move block', '⌘⇧↑ / ⌘⇧↓'],
  ['Turn into text / heading 1-3', '⌘⌥0 / ⌘⌥1-3'],
  ['Turn into to-do / bullet / number / toggle / code / page', '⌘⌥4-9'],
  ['Toggle to-do or open toggle', '⌘↵'],
  ['Soft line break', '⇧↵'],
  ['Slash commands', '/'],
];

function Shortcuts() {
  return (
    <>
      <h2>Keyboard shortcuts</h2>
      {SHORTCUTS.map(([a, b]) => (
        <Row key={a} title={a}>
          <span className="kbd" style={{ fontSize: 12, padding: '2px 6px' }}>{b}</span>
        </Row>
      ))}
      <h3>Markdown</h3>
      {[
        ['# / ## / ###', 'Headings'], ['- or *', 'Bulleted list'], ['1.', 'Numbered list'], ['[]', 'To-do'], ['>', 'Toggle list'],
        ['"', 'Quote'], ['```', 'Code block'], ['---', 'Divider'], ['**text**', 'Bold'], ['*text*', 'Italic'], ['`text`', 'Inline code'], ['~text~', 'Strikethrough'],
      ].map(([k, v]) => (
        <Row key={k} title={v}>
          <span className="kbd" style={{ fontSize: 12, padding: '2px 6px' }}>{k}</span>
        </Row>
      ))}
    </>
  );
}

function SidebarSettings() {
  const width = useSettings(s => s.sidebarWidth);
  return (
    <>
      <h2>Sidebar</h2>
      <Row title="Sidebar width" desc="Drag the sidebar edge to resize, or reset it here.">
        <button className="btn secondary sm" onClick={() => setSettings({ sidebarWidth: 300 })}>
          Reset ({width}px)
        </button>
      </Row>
      <Row title="Show sidebar" desc="Toggle with ⌘\\">
        <Switch on={useSettings(s => s.sidebarOpen)} onChange={v => setSettings({ sidebarOpen: v })} />
      </Row>
    </>
  );
}

function General() {
  const ws = useDoc(d => d.workspace, Object.is);
  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null);
  return (
    <>
      <h2>Workspace settings</h2>
      <Row title="Name" desc="You can use your organization or company name.">
        <input
          className="text-input"
          style={{ width: 240 }}
          value={ws.name}
          onChange={e => transact(tx => tx.setWorkspace({ name: e.target.value }), { key: 'ws-name' })}
        />
      </Row>
      <Row title="Icon" desc="Upload an image or pick an emoji.">
        <div className="icon-btn" style={{ width: 40, height: 40, boxShadow: 'inset 0 0 0 1px var(--border-translucent)' }} onClick={e => setIconPicker(e.currentTarget.getBoundingClientRect())}>
          <WorkspaceIcon size={28} />
        </div>
      </Row>
      <Row title="Your name">
        <input className="text-input" style={{ width: 240 }} value={ws.userName} onChange={e => transact(tx => tx.setWorkspace({ userName: e.target.value || ' ' }), { key: 'ws-user' })} />
      </Row>
      {iconPicker && (
        <EmojiPicker
          anchor={iconPicker}
          allowUpload={false}
          onClose={() => setIconPicker(null)}
          onPick={e => {
            transact(tx => tx.setWorkspace({ icon: e }));
            setIconPicker(null);
          }}
          onRemove={() => {
            transact(tx => tx.setWorkspace({ icon: ws.name[0]?.toUpperCase() || 'W' }));
            setIconPicker(null);
          }}
        />
      )}
    </>
  );
}

function People() {
  const ws = useDoc(d => d.workspace, Object.is);
  return (
    <>
      <h2>People</h2>
      <div className="set-row">
        <div className="share-person" style={{ flex: 1 }}>
          <span className="avatar lg">{ws.userName[0]}</span>
          <div className="grow">
            {ws.userName}
            <div className="sub">{ws.userEmail}</div>
          </div>
          <span className="sub">Workspace owner</span>
        </div>
      </div>
      <div className="set-desc">Inviting members needs a sync server. Everything in this workspace is stored in your browser.</div>
    </>
  );
}

function DataSettings() {
  const json = useRef<HTMLInputElement>(null);
  const md = useRef<HTMLInputElement>(null);
  return (
    <>
      <h2>Import & export</h2>
      <Row title="Export all workspace content" desc="Download every page as a single JSON backup.">
        <button className="btn secondary sm" onClick={exportWorkspaceJson}>
          <Download size={14} /> Export
        </button>
      </Row>
      <Row title="Restore from backup" desc="Replace this workspace with a JSON backup. You can undo this.">
        <button className="btn secondary sm" onClick={() => json.current?.click()}>
          <Upload size={14} /> Import JSON
        </button>
        <input
          ref={json}
          type="file"
          accept="application/json"
          hidden
          onChange={e => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then(t => {
              try {
                const d = JSON.parse(t) as Doc;
                if (!d.pages || !d.blocks || !d.workspace) throw new Error('bad');
                replaceDoc(d);
                showToast('Workspace restored');
              } catch {
                showToast('That file is not a workspace backup');
              }
            });
          }}
        />
      </Row>
      <Row title="Import Markdown" desc="Create a new private page from a .md file.">
        <button className="btn secondary sm" onClick={() => md.current?.click()}>
          <Upload size={14} /> Import
        </button>
        <input
          ref={md}
          type="file"
          accept=".md,.markdown,.txt"
          hidden
          onChange={e => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then(t => {
              const id = importMarkdownAsPage(f.name, t);
              setUi({ settingsOpen: false });
              openPage(id);
            });
          }}
        />
      </Row>
      <h3>Danger zone</h3>
      <Row title="Reset workspace" desc="Replace everything with the starter content. You can undo this with ⌘Z.">
        <button
          className="btn danger sm"
          onClick={() => {
            const cur = getDoc();
            void cur;
            replaceDoc(createSeed());
            setUi({ settingsOpen: false });
            location.hash = '#/home';
            showToast('Workspace reset. Press ⌘Z to undo.');
          }}
        >
          <RotateCcw size={14} /> Reset
        </button>
      </Row>
    </>
  );
}
