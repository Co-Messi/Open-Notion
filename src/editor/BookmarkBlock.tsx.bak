import { useEffect, useRef, useState } from 'react';
import { Globe, Link2 } from 'lucide-react';
import type { Block } from '../store/types';
import { transact } from '../store/store';
import { Popover } from '../components/ui';

export function BookmarkBlock({ block }: { block: Block }) {
  const [edit, setEdit] = useState<DOMRect | null>(null);
  const [url, setUrl] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === block.id && ref.current) setEdit(ref.current.getBoundingClientRect());
    };
    window.addEventListener('on:bookmark', on);
    return () => window.removeEventListener('on:bookmark', on);
  }, [block.id]);

  if (!block.url) {
    return (
      <>
        <div ref={ref} className="image-placeholder" onClick={e => setEdit(e.currentTarget.getBoundingClientRect())}>
          <Link2 size={18} strokeWidth={1.5} /> Add a web bookmark
        </div>
        {edit && (
          <Popover anchor={edit} onClose={() => setEdit(null)} width={Math.max(360, edit.width)}>
            <div className="ep-upload">
              <input
                className="text-input"
                autoFocus
                placeholder="Paste in https://…"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && url.trim()) {
                    const u = /^https?:/.test(url.trim()) ? url.trim() : 'https://' + url.trim();
                    transact(tx => tx.setBlock(block.id, { url: u }));
                    setEdit(null);
                  }
                }}
              />
              <div style={{ textAlign: 'center' }}>Create a visual bookmark from a link.</div>
            </div>
          </Popover>
        )}
      </>
    );
  }
  let host = block.url;
  try {
    host = new URL(block.url).hostname;
  } catch {
    /* keep raw */
  }
  return (
    <div className="bookmark" onClick={() => window.open(block.url, '_blank', 'noopener')}>
      <div className="bm-text">
        <div className="bm-title">{host}</div>
        <div className="bm-url" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={12} /> {block.url}
        </div>
      </div>
    </div>
  );
}
