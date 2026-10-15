import { useRef, useState } from 'react';
import { Popover, type Anchor, pressable } from './ui';
import { showToast } from '../store/store';
import { ImageError, ingestImage } from '../lib/images';
import { recordError } from '../lib/diagnostics';

export const COVERS: { name: string; value: string }[] = [
  { name: 'Peach', value: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { name: 'Mint', value: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)' },
  { name: 'Lavender', value: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
  { name: 'Dusk', value: 'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)' },
  { name: 'Sky', value: 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)' },
  { name: 'Sorbet', value: 'linear-gradient(120deg, #f093fb 0%, #f5576c 100%)' },
  { name: 'Lagoon', value: 'linear-gradient(120deg, #43e97b 0%, #38f9d7 100%)' },
  { name: 'Ocean', value: 'linear-gradient(120deg, #4facfe 0%, #00f2fe 100%)' },
  { name: 'Sand', value: 'linear-gradient(180deg, #fdfbfb 0%, #ebedee 100%)' },
  { name: 'Ember', value: 'linear-gradient(120deg, #ff9a9e 0%, #fecfef 100%)' },
  { name: 'Aurora', value: 'radial-gradient(circle at 20% 30%, #7f7fd5 0%, #86a8e7 45%, #91eae4 100%)' },
  { name: 'Night', value: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)' },
];
/** Small illustrations shipped with the app (public/covers). Nothing is fetched from another site. */
const L = (file: string) => `/covers/${file}.webp`;
export const PHOTOS: { name: string; value: string }[] = [
  { name: 'Mountains', value: L('mountains') },
  { name: 'Valley', value: L('valley') },
  { name: 'Lake', value: L('lake') },
  { name: 'Hills', value: L('hills') },
  { name: 'Night sky', value: L('night-sky') },
  { name: 'Forest', value: L('forest') },
  { name: 'Beach', value: L('beach') },
  { name: 'Woods', value: L('woods') },
  { name: 'Code', value: L('code') },
  { name: 'Desk', value: L('desk') },
  { name: 'Books', value: L('books') },
  { name: 'Library', value: L('library') },
  { name: 'Ocean', value: L('ocean') },
  { name: 'Peaks', value: L('peaks') },
  { name: 'Coast', value: L('coast') },
  { name: 'Shore', value: L('shore') },
];
const SOLIDS: { name: string; value: string }[] = [
  { name: 'Red', value: '#e16259' },
  { name: 'Yellow', value: '#dfab01' },
  { name: 'Blue', value: '#0b6e99' },
  { name: 'Beige', value: '#e9e5e3' },
];

export function CoverPicker({ anchor, onClose, onPick, onRemove }: { anchor: Anchor; onClose: () => void; onPick: (v: string) => void; onRemove: () => void }) {
  const [tab, setTab] = useState<'gallery' | 'upload' | 'link'>('gallery');
  const [url, setUrl] = useState('');
  const file = useRef<HTMLInputElement>(null);
  return (
    <Popover anchor={anchor} onClose={onClose} className="cover-picker" placement="bottom-end" label="Change cover">
      <div className="ep-tabs">
        {(['gallery', 'upload', 'link'] as const).map(t => (
          <div {...pressable()} key={t} className={'ep-tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
            {t === 'gallery' ? 'Gallery' : t === 'upload' ? 'Upload' : 'Link'}
          </div>
        ))}
        <span className="grow" />
        <button className="btn ghost sm" style={{ color: 'var(--text-secondary)', fontWeight: 400 }} onClick={onRemove}>
          Remove
        </button>
      </div>
      {tab === 'gallery' && (
        <div style={{ overflowY: 'auto' }}>
          <div className="ep-cat" style={{ padding: '10px 14px 0' }}>Color & Gradient</div>
          <div className="cover-grid">
            {[...SOLIDS, ...COVERS].map(c => (
              <div key={c.name} className="cover-swatch" {...pressable()} title={c.name} style={{ background: c.value }} onClick={() => onPick(c.value)} />
            ))}
          </div>
          <div className="ep-cat" style={{ padding: '4px 14px 0' }}>Images</div>
          <div className="cover-grid">
            {PHOTOS.map(c => (
              <div
                key={c.name}
                className="cover-swatch" {...pressable()}
                title={c.name}
                style={{ backgroundImage: `url("${c.value}")` }}
                onClick={() => onPick(c.value)}
              />
            ))}
          </div>
        </div>
      )}
      {tab === 'upload' && (
        <div className="ep-upload">
          <button className="btn secondary" onClick={() => file.current?.click()}>
            Upload file
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
              ingestImage(f)
                .then(onPick)
                .catch(err => {
                  recordError('images', err);
                  showToast(err instanceof ImageError ? err.message : 'Could not use that image');
                });
            }}
          />
          <div style={{ textAlign: 'center' }}>Images wider than 1500 pixels work best.</div>
        </div>
      )}
      {tab === 'link' && (
        <div className="ep-upload">
          <input className="text-input" autoFocus placeholder="Paste an image link…" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && url.trim() && onPick(url.trim())} />
          <button className="btn primary" style={{ alignSelf: 'center', width: 240 }} onClick={() => url.trim() && onPick(url.trim())}>
            Submit
          </button>
        </div>
      )}
    </Popover>
  );
}
