import { useRef, useState } from 'react';
import { Popover, type Anchor } from './ui';
import { showToast } from '../store/store';

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
const U = (id: string) => `https://images.unsplash.com/${id}?w=1600&q=80&auto=format&fit=crop`;
export const PHOTOS: { name: string; value: string }[] = [
  { name: 'Mountains', value: U('photo-1506905925346-21bda4d32df4') },
  { name: 'Valley', value: U('photo-1469474968028-56623f02e42e') },
  { name: 'Lake', value: U('photo-1501785888041-af3ef285b470') },
  { name: 'Hills', value: U('photo-1497436072909-60f360e1d4b1') },
  { name: 'Night sky', value: U('photo-1519681393784-d120267933ba') },
  { name: 'Forest', value: U('photo-1441974231531-c6227db76b6e') },
  { name: 'Beach', value: U('photo-1507525428034-b723cf961d3e') },
  { name: 'Woods', value: U('photo-1470071459604-3b5ec3a7fe05') },
  { name: 'Code', value: U('photo-1517694712202-14dd9538aa97') },
  { name: 'Desk', value: U('photo-1484480974693-6ca0a78fb36b') },
  { name: 'Books', value: U('photo-1456513080510-7bf3a84b82f8') },
  { name: 'Library', value: U('photo-1481627834876-b7833e8f5570') },
  { name: 'Ocean', value: U('photo-1518837695005-2083093ee35b') },
  { name: 'Peaks', value: U('photo-1454496522488-7a8e488e8606') },
  { name: 'Coast', value: U('photo-1500964757637-c85e8a162699') },
  { name: 'Shore', value: U('photo-1494500764479-0c8f2919a3d8') },
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
    <Popover anchor={anchor} onClose={onClose} className="cover-picker" placement="bottom-end">
      <div className="ep-tabs">
        {(['gallery', 'upload', 'link'] as const).map(t => (
          <div key={t} className={'ep-tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
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
              <div key={c.name} className="cover-swatch" title={c.name} style={{ background: c.value }} onClick={() => onPick(c.value)} />
            ))}
          </div>
          <div className="ep-cat" style={{ padding: '4px 14px 0' }}>Photos</div>
          <div className="cover-grid">
            {PHOTOS.map(c => (
              <div
                key={c.name}
                className="cover-swatch"
                title={c.name}
                style={{ backgroundImage: `url("${c.value.replace('w=1600', 'w=400')}")` }}
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
              if (!f) return;
              if (f.size > 3 * 1024 * 1024) {
                showToast('Image is too large (max 3 MB)');
                return;
              }
              const r = new FileReader();
              r.onload = () => onPick(String(r.result));
              r.readAsDataURL(f);
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
