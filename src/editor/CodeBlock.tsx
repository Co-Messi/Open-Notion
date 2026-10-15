import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, WrapText } from 'lucide-react';
import type { Block } from '../store/types';
import { transact, getDoc, breakCoalescing, undo, redo, showToast } from '../store/store';
import { txInsertAfter, txTurnInto } from '../store/actions';
import { highlight, LANGUAGES } from '../lib/highlight';
import { focusBlock, neighbor, selectBlocks } from './controller';
import { Popover, Menu } from '../components/ui';

export function CodeBlock({ block, readOnly }: { block: Block; readOnly?: boolean }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [langMenu, setLangMenu] = useState<DOMRect | null>(null);
  const [wrap, setWrap] = useState(false);
  const code = block.html || '';
  const html = useMemo(() => highlight(code, block.language || 'plain text'), [code, block.language]);

  useLayoutEffect(() => {
    const el = ta.current;
    if (el && el.value !== code) el.value = code;
  }, [code]);

  const commit = (v: string) => {
    if (getDoc().blocks[block.id]?.html !== v) transact(tx => tx.setBlock(block.id, { html: v }), { key: 'type:' + block.id });
  };

  return (
    <div className="code-wrap" onMouseDown={e => e.stopPropagation()}>
      <div className="code-head">
        <button onMouseDown={e => e.preventDefault()} onClick={e => setLangMenu(e.currentTarget.getBoundingClientRect())}>
          {cap(block.language || 'plain text')}
          <ChevronDown size={12} />
        </button>
        <span style={{ display: 'flex', gap: 2 }}>
          <button onMouseDown={e => e.preventDefault()} onClick={() => setWrap(!wrap)} title="Wrap code">
            <WrapText size={13} />
          </button>
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              navigator.clipboard?.writeText(code).catch(() => {});
              showToast('Copied to clipboard');
            }}
          >
            <Copy size={13} /> Copy
          </button>
        </span>
      </div>
      <div className={'code-area' + (wrap ? ' wrap' : '')}>
        <pre aria-hidden dangerouslySetInnerHTML={{ __html: html + '\n' }} />
        <textarea
          ref={ta}
          data-editable-id={block.id}
          data-nav=""
          spellCheck={false}
          aria-label={'Code' + (block.language ? ', ' + block.language : '')}
          readOnly={readOnly}
          defaultValue={code}
          onChange={e => commit(e.target.value)}
          onKeyDown={e => {
            const el = e.currentTarget;
            const mod = e.metaKey || e.ctrlKey;
            if (e.nativeEvent.isComposing) return;
            if (mod && e.key.toLowerCase() === 'z') {
              e.preventDefault();
              if (e.shiftKey) redo();
              else undo();
              return;
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              const s = el.selectionStart;
              const v = el.value;
              if (e.shiftKey) {
                const lineStart = v.lastIndexOf('\n', s - 1) + 1;
                if (v.slice(lineStart, lineStart + 2) === '  ') {
                  el.value = v.slice(0, lineStart) + v.slice(lineStart + 2);
                  el.selectionStart = el.selectionEnd = Math.max(lineStart, s - 2);
                }
              } else {
                el.setRangeText('  ', s, el.selectionEnd, 'end');
              }
              commit(el.value);
              return;
            }
            if (e.key === 'Enter' && !mod && !e.shiftKey) {
              // Keep indentation of the current line.
              e.preventDefault();
              const s = el.selectionStart;
              const lineStart = el.value.lastIndexOf('\n', s - 1) + 1;
              const indent = el.value.slice(lineStart).match(/^[ \t]*/)?.[0] || '';
              el.setRangeText('\n' + indent, s, el.selectionEnd, 'end');
              commit(el.value);
              return;
            }
            if (e.key === 'Enter' && mod) {
              e.preventDefault();
              let nid = '';
              transact(tx => {
                nid = txInsertAfter(tx, block.id, { type: 'text', html: '' });
              });
              breakCoalescing();
              focusBlock(nid, 'start');
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              selectBlocks([block.id]);
              return;
            }
            if (e.key === 'Backspace' && el.value === '' ) {
              e.preventDefault();
              transact(tx => txTurnInto(tx, block.id, 'text'));
              focusBlock(block.id, 'start');
              return;
            }
            if (e.key === 'ArrowUp' && el.selectionStart === el.selectionEnd && !el.value.slice(0, el.selectionStart).includes('\n')) {
              const prev = neighbor(el, -1);
              if (prev) {
                e.preventDefault();
                if (prev.dataset.editableId) focusBlock(prev.dataset.editableId, 'end');
                else prev.focus();
              }
            }
            if (e.key === 'ArrowDown' && el.selectionStart === el.selectionEnd && !el.value.slice(el.selectionEnd).includes('\n')) {
              const next = neighbor(el, 1);
              if (next?.dataset.editableId) {
                e.preventDefault();
                focusBlock(next.dataset.editableId, 'start');
              }
            }
          }}
        />
      </div>
      {langMenu && (
        <Popover anchor={langMenu} onClose={() => setLangMenu(null)} width={220}>
          <Menu
            onClose={() => setLangMenu(null)}
            search
            searchPlaceholder="Search for a language…"
            maxHeight={300}
            items={LANGUAGES.map(l => ({
              id: l,
              label: cap(l),
              right: (block.language || 'plain text') === l ? '✓' : undefined,
              onSelect: () => transact(tx => tx.setBlock(block.id, { language: l })),
            }))}
          />
        </Popover>
      )}
    </div>
  );
}

function cap(s: string) {
  const special: Record<string, string> = { javascript: 'JavaScript', typescript: 'TypeScript', css: 'CSS', html: 'HTML', json: 'JSON', sql: 'SQL', 'c++': 'C++', 'c#': 'C#', php: 'PHP', yaml: 'YAML' };
  return special[s] || s.charAt(0).toUpperCase() + s.slice(1);
}
