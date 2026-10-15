import { useState } from 'react';
import { ArrowUp, ArrowDown, EyeOff, WrapText, Copy, Trash2, ListFilter, Settings2, Hash, Check } from 'lucide-react';
import { useDoc } from '../store/store';
import { addProperty, updateView } from '../store/actions';
import type { PropType, DbView } from '../store/types';
import { Popover, Menu, Switch, type Anchor, type MenuItemDef } from '../components/ui';
import { PropIcon } from './cells';
import { TYPE_LABEL, ADDABLE_TYPES } from './logic';
import { FocusMenuSearch } from './focus';
import { renameProperty, changePropertyType, duplicateProperty, deleteProperty, togglePropHidden, setNumberFormat } from './dbActions';

export function TypeList({ current, onPick, onClose }: { current?: PropType; onPick: (t: PropType) => void; onClose: () => void }) {
  const items: MenuItemDef[] = ADDABLE_TYPES.map(t => ({
    id: t,
    label: TYPE_LABEL[t],
    icon: <PropIcon type={t} size={16} />,
    right: current === t ? <Check size={14} /> : undefined,
    onSelect: () => onPick(t),
  }));
  return (
    <>
      <FocusMenuSearch />
      <Menu items={items} onClose={onClose} search searchPlaceholder="Search for a property type…" maxHeight={420} />
    </>
  );
}

/** Menu for picking the type of a new property. */
export function AddPropertyMenu({ dbId, anchor, onClose, onAdded }: { dbId: string; anchor: Anchor; onClose: () => void; onAdded?: (id: string) => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <div className="menu-label" style={{ paddingTop: 10 }}>Select type</div>
      <TypeList
        onClose={onClose}
        onPick={t => {
          const id = addProperty(dbId, t);
          onAdded?.(id);
        }}
      />
    </Popover>
  );
}

interface PropertyMenuProps {
  dbId: string;
  propId: string;
  view?: DbView;
  anchor: Anchor;
  onClose: () => void;
  onFilter?: (propId: string) => void;
}

/** Header / property-name menu: rename, change type, sort, filter, hide, delete. */
export function PropertyMenu({ dbId, propId, view, anchor, onClose, onFilter }: PropertyMenuProps) {
  const prop = useDoc(d => d.pages[dbId]?.schema?.find(p => p.id === propId), Object.is);
  const [name, setName] = useState(prop?.name || '');
  if (!prop) return null;
  const isTitle = prop.type === 'title';

  const sortBy = (dir: 'asc' | 'desc') => {
    if (!view) return;
    const rest = view.sorts.filter(s => s.propId !== propId);
    updateView(dbId, view.id, { sorts: [{ id: Math.random().toString(36).slice(2, 10), propId, dir }, ...rest] });
  };

  const items: MenuItemDef[] = [];
  items.push({
    id: 'type',
    label: 'Edit property',
    icon: <Settings2 size={16} />,
    right: !isTitle ? <span className="db-mi-type">{TYPE_LABEL[prop.type]}</span> : undefined,
    disabled: isTitle,
    submenu: () => (
      <div style={{ width: 240 }}>
        <TypeList
          current={prop.type}
          onClose={onClose}
          onPick={t => changePropertyType(dbId, propId, t)}
        />
      </div>
    ),
  });
  if (prop.type === 'number') {
    items.push({
      id: 'numfmt',
      label: 'Number format',
      icon: <Hash size={16} />,
      submenu: () => (
        <div style={{ width: 200 }}>
          <Menu
            onClose={onClose}
            items={(['number', 'percent', 'dollar', 'euro'] as const).map(f => ({
              id: f,
              label: f === 'number' ? 'Number' : f === 'percent' ? 'Percent' : f === 'dollar' ? 'US dollar' : 'Euro',
              right: (prop.numberFormat || 'number') === f ? <Check size={14} /> : undefined,
              onSelect: () => setNumberFormat(dbId, propId, f),
            }))}
          />
        </div>
      ),
    });
  }
  if (view) {
    if (onFilter) {
      items.push({ id: 'filter', label: 'Filter', icon: <ListFilter size={16} />, separatorBefore: true, onSelect: () => onFilter(propId) });
    }
    items.push({ id: 'asc', label: 'Sort ascending', icon: <ArrowUp size={16} />, separatorBefore: !onFilter, onSelect: () => sortBy('asc') });
    items.push({ id: 'desc', label: 'Sort descending', icon: <ArrowDown size={16} />, onSelect: () => sortBy('desc') });
    if (!isTitle) {
      items.push({
        id: 'hide',
        label: 'Hide in view',
        icon: <EyeOff size={16} />,
        onSelect: () => togglePropHidden(dbId, view.id, propId, true),
      });
    }
    if (view.type === 'table') {
      items.push({
        id: 'wrap',
        label: 'Wrap column',
        icon: <WrapText size={16} />,
        keepOpen: true,
        right: <Switch on={!!view.wrapCells} />,
        onSelect: () => updateView(dbId, view.id, { wrapCells: !view.wrapCells }),
      });
    }
  }
  if (!isTitle) {
    items.push({ id: 'dup', label: 'Duplicate property', icon: <Copy size={16} />, separatorBefore: true, onSelect: () => duplicateProperty(dbId, propId) });
    items.push({ id: 'del', label: 'Delete property', icon: <Trash2 size={16} />, danger: true, onSelect: () => deleteProperty(dbId, propId) });
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <FocusMenuSearch />
      <Menu
        items={items}
        onClose={onClose}
        header={
          <div className="db-prop-rename">
            <span className="db-prop-rename-icon">
              <PropIcon type={prop.type} size={16} />
            </span>
            <input
              className="text-input"
              autoFocus
              value={name}
              onChange={e => {
                setName(e.target.value);
                renameProperty(dbId, propId, e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key.startsWith('Arrow')) {
                  e.stopPropagation();
                  if (e.key === 'Enter') onClose();
                }
              }}
            />
          </div>
        }
      />
    </Popover>
  );
}
