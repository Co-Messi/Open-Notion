import { FileText, Database, Table2 } from 'lucide-react';
import type { Page } from '../store/types';
import { useDoc } from '../store/store';

/** A page's icon (emoji, image, or the default document glyph). */
export function PageIconView({ page, size = 18, emojiSize }: { page: Page | undefined; size?: number; emojiSize?: number }) {
  const hasContent = useDoc(d => (page ? page.content.some(b => d.blocks[b] && (d.blocks[b].html || d.blocks[b].type !== 'text')) : false), Object.is);
  if (!page) return <FileText size={size} strokeWidth={1.5} />;
  if (page.icon) {
    if (page.icon.startsWith('data:') || page.icon.startsWith('http')) {
      return <img src={page.icon} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 3 }} />;
    }
    return (
      <span className="emoji" style={{ fontSize: emojiSize ?? size - 2, lineHeight: 1 }}>
        {page.icon}
      </span>
    );
  }
  if (page.isDatabase) return page.inline ? <Table2 size={size} strokeWidth={1.5} /> : <Database size={size} strokeWidth={1.5} />;
  return hasContent ? <FileText size={size} strokeWidth={1.5} /> : <FileBlank size={size} />;
}

function FileBlank({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}
