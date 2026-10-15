import { useEffect, useState } from 'react';
import { Popover, Menu } from '../components/ui';
import { getDoc, transact, breakCoalescing } from '../store/store';
import { pageTitle, txInsertAfter } from '../store/actions';
import { PageIconView } from '../components/PageIcon';
import { attrSel } from '../lib/dom';

/** "Link to page" picker opened from the slash menu. */
export function LinkToPagePicker() {
  const [state, setState] = useState<{ blockId: string; rect: DOMRect } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const blockId = (e as CustomEvent).detail as string;
      const el = document.querySelector('.block' + attrSel('data-block-id', blockId)) as HTMLElement | null;
      setState({ blockId, rect: el?.getBoundingClientRect() || new DOMRect(300, 300, 0, 0) });
    };
    window.addEventListener('on:link-page', on);
    return () => window.removeEventListener('on:link-page', on);
  }, []);
  if (!state) return null;
  const d = getDoc();
  const pages = Object.values(d.pages)
    .filter(p => !p.trashed && !p.dbId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 80);
  const close = () => setState(null);
  return (
    <Popover anchor={state.rect} onClose={close} width={320}>
      <Menu
        onClose={close}
        search
        searchPlaceholder="Link to page…"
        items={pages.map((p, i) => ({
          id: p.id,
          section: i === 0 ? 'Pages' : undefined,
          icon: <PageIconView page={p} size={16} />,
          label: pageTitle(p),
          keywords: p.title,
          onSelect: () => {
            transact(tx => {
              const b = tx.block(state.blockId);
              if (!b) return;
              const empty = !b.html || b.html === '<br>';
              const patch = { type: (p.isDatabase ? 'database' : 'page') as 'page' | 'database', pageId: p.id, isLink: true, html: '' };
              if (empty) tx.setBlock(state.blockId, patch);
              else txInsertAfter(tx, state.blockId, patch);
            });
            breakCoalescing();
          },
        }))}
      />
    </Popover>
  );
}
