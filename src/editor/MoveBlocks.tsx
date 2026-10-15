import { Menu, Popover } from '../components/ui';
import { getDoc, transact, showToast } from '../store/store';
import { pageTitle, txMoveBlock } from '../store/actions';
import { PageIconView } from '../components/PageIcon';

export function moveBlocksToPage(ids: string[], pageId: string) {
  transact(tx => {
    ids.forEach(id => txMoveBlock(tx, id, pageId, tx.page(pageId).content.length));
  });
  showToast(`Moved to ${pageTitle(getDoc().pages[pageId])}`);
}

export function MoveBlocksPopover({ ids, anchor, onClose }: { ids: string[]; anchor: DOMRect | { x: number; y: number }; onClose: () => void }) {
  const d = getDoc();
  const current = d.blocks[ids[0]] ? findPage(ids[0]) : '';
  const pages = Object.values(d.pages)
    .filter(p => !p.trashed && !p.isDatabase && !p.dbId && p.id !== current)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 60);
  return (
    <Popover anchor={anchor} onClose={onClose} width={320}>
      <Menu
        onClose={onClose}
        search
        searchPlaceholder="Move blocks to…"
        items={pages.map((p, i) => ({
          id: p.id,
          section: i === 0 ? 'Suggested' : undefined,
          icon: <PageIconView page={p} size={16} />,
          label: pageTitle(p),
          keywords: p.title,
          onSelect: () => moveBlocksToPage(ids, p.id),
        }))}
      />
    </Popover>
  );
}

function findPage(blockId: string): string {
  const d = getDoc();
  let b = d.blocks[blockId];
  let guard = 0;
  while (b && guard++ < 500) {
    if (d.pages[b.parent]) return b.parent;
    b = d.blocks[b.parent];
  }
  return '';
}
