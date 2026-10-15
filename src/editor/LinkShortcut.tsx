import { LinkEditor } from './InlineToolbar';

/** Cmd+K link editor opened from the keyboard. */
export function LinkEditorFor({ anchor, blockId, onClose }: { anchor: DOMRect; blockId: string; onClose: () => void }) {
  return <LinkEditor anchor={anchor} blockId={blockId} onClose={onClose} />;
}
