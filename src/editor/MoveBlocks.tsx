import { Menu, Popover } from '../components/ui';
import { getDoc, transact, showToast } from '../store/store';
import { pageTitle, txMoveBlock, moveBlockProblem, ownedPagesIn, isPageWithin, isTrashedDeep, pageOfBlockIn } from '../store/actions';
import type { Page } from '../store/types';
import { PageIconView } from '../components/PageIcon';

/** Moves blocks to the end of a page. Refused moves (into a database, or a page into itself) show a toast. */
export function moveBlocksToPage(ids: string[], pageId: string): boolean {
  const d = getDoc();
  const target = d.pages[pageId];
  if (!target) return false;
  const problems = ids.map(id => moveBlockProblem(d, id, pageId));
  const movable = ids.filter((_, i) => !problems[i]);
  if (!movable.length) {
    const why = problems.find(p => p && p !== 'missing');
    if (why) showToast(why);
    return false;
  }
  let moved = 0;
  transact(tx => {
    movable.forEach(id => {
      if (txMoveBlock(tx, id, pageId, tx.page(pageId).content.length)) moved++;
    });
  });
  if (!moved) return false;
  showToast(moved < ids.length ? `Moved ${moved} of ${ids.length} blocks to ${pageTitle(target)}` : `Moved to ${pageTitle(target)}`);
  return true;
}

/**
 * Pages offered by "Move to": live pages that are not databases or rows, not the page the
 * blocks are on, and not a page that one of the blocks owns (or anything inside it).
 */
export function moveTargetPages(ids: string[]): Page[] {
  const d = getDoc();
  const current = d.blocks[ids[0]] ? pageOfBlockIn(d, ids[0]) : '';
  const owned = ids.flatMap(id => ownedPagesIn(d, id));
  return Object.values(d.pages).filter(
    p => !p.isDatabase && !p.dbId && p.id !== current && !isTrashedDeep(d, p.id) && !owned.some(o => isPageWithin(d, p.id, o)),
  );
}

export function MoveBlocksPopover({ ids, anchor, onClose }: { ids: string[]; anchor: DOMRect | { x: number; y: number }; onClose: () => void }) {
  const pages = moveTargetPages(ids)
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
