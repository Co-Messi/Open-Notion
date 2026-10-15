import { useMemo, useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { Popover, Tooltip, type Anchor, pressable } from './ui';
import { EMOJI_CATEGORIES } from '../lib/emojiData';
import { showToast } from '../store/store';
import { ICON_EDGE, ImageError, ingestImage } from '../lib/images';
import { safeImageSrc } from '../lib/url';
import { recordError } from '../lib/diagnostics';

const RECENT_KEY = 'on:recent-emoji';
function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}
function pushRecent(e: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recent().filter(x => x !== e)].slice(0, 24)));
  } catch {
    /* ignore */
  }
}

const ALL = EMOJI_CATEGORIES.flatMap(([, items]) => items);

export function randomEmoji(): string {
  const pool = EMOJI_CATEGORIES.filter(([c]) => c !== 'Symbols').flatMap(([, items]) => items);
  return pool[Math.floor(Math.random() * pool.length)][0];
}

export function EmojiPicker({
  anchor, onClose, onPick, onRemove, allowUpload = true,
}: { anchor: Anchor; onClose: () => void; onPick: (emoji: string) => void; onRemove?: () => void; allowUpload?: boolean }) {
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const [q, setQ] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const pick = (e: string) => {
    pushRecent(e);
    onPick(e);
  };
  const filtered = useMemo(() => {
    if (!q.trim()) return null;
    const words = q.toLowerCase().trim().split(/\s+/);
    return ALL.filter(([, name]) => words.every(w => name.includes(w))).slice(0, 240);
  }, [q]);
  const rec = recent();

  return (
    <Popover anchor={anchor} onClose={onClose} className="emoji-picker" placement="bottom-start">
      <div className="ep-tabs">
        <div {...pressable()} className={'ep-tab' + (tab === 'emoji' ? ' on' : '')} onClick={() => setTab('emoji')}>
          Emoji
        </div>
        {allowUpload && (
          <div {...pressable()} className={'ep-tab' + (tab === 'upload' ? ' on' : '')} onClick={() => setTab('upload')}>
            Upload
          </div>
        )}
        <span className="grow" />
        {onRemove && (
          <button className="btn ghost sm" style={{ color: 'var(--text-secondary)', fontWeight: 400 }} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {tab === 'emoji' ? (
        <>
          <div className="ep-search">
            <input
              className="text-input"
              autoFocus
              placeholder="Filter…"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && filtered && filtered[0]) {
                  e.preventDefault();
                  pick(filtered[0][0]);
                }
              }}
            />
            <Tooltip label="Random">
              <div {...pressable()} className="icon-btn" style={{ width: 28, height: 28, boxShadow: 'inset 0 0 0 1px var(--border-translucent)' }} onClick={() => pick(randomEmoji())}>
                <Shuffle size={15} />
              </div>
            </Tooltip>
          </div>
          <div className="ep-grid">
            {filtered ? (
              <>
                <div className="ep-cat">{filtered.length ? 'Results' : 'No results'}</div>
                <div className="ep-cells">
                  {filtered.map(([e, name]) => (
                    <div {...pressable()} key={e} className="ep-cell" title={name} onClick={() => pick(e)}>
                      {e}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                {rec.length > 0 && (
                  <>
                    <div className="ep-cat">Recent</div>
                    <div className="ep-cells">
                      {rec.map(e => (
                        <div {...pressable()} key={'r' + e} className="ep-cell" onClick={() => pick(e)}>
                          {e}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {EMOJI_CATEGORIES.map(([cat, items]) => (
                  <div key={cat}>
                    <div className="ep-cat">{cat}</div>
                    <div className="ep-cells">
                      {items.map(([e, name]) => (
                        <div {...pressable()} key={e} className="ep-cell" title={name} onClick={() => pick(e)}>
                          {e}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="ep-upload">
          <button className="btn secondary" onClick={() => file.current?.click()}>
            Upload an image
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              ingestImage(f, { maxEdge: ICON_EDGE })
                .then(onPick)
                .catch(err => {
                  recordError('images', err);
                  showToast(err instanceof ImageError ? err.message : 'Could not use that image');
                });
            }}
          />
          <div style={{ textAlign: 'center' }}>Recommended size is 280 × 280 pixels</div>
          <input className="text-input" placeholder="Or paste an image link…" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => {
              if (e.key !== 'Enter' || !url.trim()) return;
              const safe = safeImageSrc(url.trim());
              if (safe) onPick(safe);
              else showToast('That link cannot be used as an image');
            }} />
        </div>
      )}
    </Popover>
  );
}
