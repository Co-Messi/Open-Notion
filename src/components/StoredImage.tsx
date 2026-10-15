import type { CSSProperties, ReactNode } from 'react';
import { useCoverStyle, useImageSrc } from '../lib/images';

/**
 * An image from user data: resolves `on-img:` references to blob URLs and validates every
 * other source. While loading, or when the blob is gone, it keeps the same box empty.
 */
export function StoredImg({ src, alt = '', className, style, draggable }: { src: string | null | undefined; alt?: string; className?: string; style?: CSSProperties; draggable?: boolean }) {
  const r = useImageSrc(src);
  if (!r.src) {
    return <span className={'stored-img-empty' + (className ? ' ' + className : '')} style={style} title={r.state === 'missing' ? 'Image unavailable' : undefined} />;
  }
  return <img src={r.src} alt={alt} className={className} style={style} draggable={draggable} />;
}

/** A box painted with a page cover (stored image, remote image, gradient or color). */
export function CoverBox({ cover, className, style, children }: { cover: string | null | undefined; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const c = useCoverStyle(cover);
  const image = c.isImage ? { backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : {};
  return (
    <div className={className} style={{ ...image, ...c.style, ...style }}>
      {children}
    </div>
  );
}
