import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Block } from '../store/types';
import { transact, showToast } from '../store/store';
import { Popover } from '../components/ui';
import { selectBlocks } from './controller';
import { ImageError, ingestImage, useImageSrc } from '../lib/images';
import { safeImageSrc } from '../lib/url';
import { recordError } from '../lib/diagnostics';

export function ImageBlock({ block, readOnly }: { block: Block; readOnly?: boolean }) {
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const img = useImageSrc(block.url);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === block.id && holder.current) setPicker(holder.current.getBoundingClientRect());
    };
    window.addEventListener('on:image-picker', on);
    return () => window.removeEventListener('on:image-picker', on);
  }, [block.id]);

  if (!block.url) {
    return (
      <>
        <div
          ref={holder}
          className="image-placeholder"
          onClick={e => !readOnly && setPicker(e.currentTarget.getBoundingClientRect())}
        >
          <ImageIcon size={20} strokeWidth={1.5} />
          Add an image
        </div>
        {picker && <ImagePicker anchor={picker} onClose={() => setPicker(null)} onPick={url => transact(tx => tx.setBlock(block.id, { url }))} />}
      </>
    );
  }

  const startResize = (side: 'l' | 'r') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = e.clientX;
    const w0 = frame.current!.offsetWidth;
    const max = (frame.current!.parentElement as HTMLElement).offsetWidth;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start) * (side === 'r' ? 2 : -2);
      const w = Math.max(80, Math.min(max, w0 + dx));
      frame.current!.style.width = w + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const w = frame.current!.offsetWidth;
      transact(tx => tx.setBlock(block.id, { width: w }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="image-block">
      <div ref={frame} className="image-frame" style={{ width: block.width || '100%' }} onClick={() => selectBlocks([block.id])}>
        {img.src ? (
          <img src={img.src} alt={block.caption || ''} draggable={false} />
        ) : (
          <div className="image-unavailable">
            {img.state === 'loading' ? '' : (
              <>
                <ImageIcon size={18} strokeWidth={1.5} /> {img.state === 'missing' ? 'Image unavailable in this browser' : 'This image link is not allowed'}
              </>
            )}
          </div>
        )}
        {!readOnly && (
          <>
            <div className="image-handle l" onPointerDown={startResize('l')} />
            <div className="image-handle r" onPointerDown={startResize('r')} />
          </>
        )}
      </div>
      {(block.caption || !readOnly) && (
        <div
          className="image-caption"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          data-placeholder="Add a caption…"
          style={{ width: block.width || '100%' }}
          onBlur={e => {
            const t = e.currentTarget.textContent || '';
            if (t !== (block.caption || '')) transact(tx => tx.setBlock(block.id, { caption: t }));
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLElement).blur();
            }
          }}
        >
          {block.caption}
        </div>
      )}
    </div>
  );
}

export function ImagePicker({ anchor, onClose, onPick, title = 'Upload' }: { anchor: DOMRect; onClose: () => void; onPick: (url: string) => void; title?: string }) {
  const [tab, setTab] = useState<'upload' | 'link'>('upload');
  const [url, setUrl] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const pickLink = () => {
    const safe = safeImageSrc(url.trim());
    if (!safe) {
      showToast('That link cannot be used as an image');
      return;
    }
    onPick(safe);
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={Math.max(360, Math.min(540, anchor.width))}>
      <div className="ep-tabs">
        <div className={'ep-tab' + (tab === 'upload' ? ' on' : '')} onClick={() => setTab('upload')}>
          {title}
        </div>
        <div className={'ep-tab' + (tab === 'link' ? ' on' : '')} onClick={() => setTab('link')}>
          Embed link
        </div>
      </div>
      {tab === 'upload' ? (
        <div className="ep-upload">
          <button className="btn secondary" onClick={() => file.current?.click()}>
            Upload file
          </button>
          <div style={{ textAlign: 'center' }}>Large images are resized and kept in this browser.</div>
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
                .then(ref => {
                  onPick(ref);
                  onClose();
                })
                .catch(err => {
                  recordError('images', err);
                  showToast(err instanceof ImageError ? err.message : 'Could not add the image');
                });
            }}
          />
        </div>
      ) : (
        <div className="ep-upload">
          <input
            className="text-input"
            autoFocus
            placeholder="Paste the image link…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && url.trim()) pickLink();
            }}
          />
          <button
            className="btn primary"
            style={{ alignSelf: 'center', width: 240 }}
            disabled={!url.trim()}
            onClick={pickLink}
          >
            Embed image
          </button>
          <div style={{ textAlign: 'center' }}>Works with any image from the web.</div>
        </div>
      )}
    </Popover>
  );
}
