import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Plus, GripVertical, PanelRight, ChevronDown } from 'lucide-react';
import { setRowProp, openPage } from '../store/actions';
import type { Page, Property } from '../store/types';
import { Popover, Menu, type MenuItemDef, pressable } from '../components/ui';
import { PropIcon, PropValue, CellEditor, isEditable } from './cells';
import { PropertyMenu, AddPropertyMenu } from './menus';
import { visibleProps, isEmptyValue, rawValue, fmtNumber } from './logic';
import { setPropertyWidth, moveRow, addRowAt } from './dbActions';
import { patchView } from './filters';
import { TitleEditor, RowMenu, RowIcon, startPointerDrag, type ViewProps } from './shared';

const ADD_COL = 34;
export const colWidth = (p: Property) => p.width || (p.type === 'title' ? 280 : 200);

export function TableView(vp: ViewProps) {
  const { dbId, view, rows, schema, defaults, editingTitle, setEditingTitle, startFilter } = vp;
  const props = visibleProps(schema, view);
  const [resize, setResize] = useState<{ id: string; w: number } | null>(null);
  const [propMenu, setPropMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [addProp, setAddProp] = useState<DOMRect | null>(null);
  const [editor, setEditor] = useState<{ rowId: string; propId: string; rect: DOMRect } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; rect: DOMRect } | null>(null);
  const [drag, setDrag] = useState<{ rowId: string; index: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const widthOf = (p: Property) => (resize && resize.id === p.id ? resize.w : colWidth(p));
  const total = props.reduce((s, p) => s + widthOf(p), 0) + ADD_COL;
  const wrap = !!view.wrapCells;

  const newRow = (after?: string) => {
    const id = addRowAt(dbId, { ...defaults }, after ? { after } : {});
    setEditingTitle(id);
  };

  const startResize = (e: RPointerEvent, p: Property) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const w0 = colWidth(p);
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.max(p.type === 'title' ? 100 : 60, Math.round(w0 + ev.clientX - sx));
      setResize({ id: p.id, w });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('db-col-resizing');
      if (w !== w0) setPropertyWidth(dbId, p.id, w);
      setResize(null);
    };
    document.body.classList.add('db-col-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startRowDrag = (e: RPointerEvent, row: Page) => {
    const handle = e.currentTarget as HTMLElement;
    const indexAt = (y: number) => {
      const els = Array.from(bodyRef.current?.querySelectorAll('.db-tr') || []) as HTMLElement[];
      let i = els.length;
      for (let k = 0; k < els.length; k++) {
        const r = els[k].getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          i = k;
          break;
        }
      }
      return i;
    };
    startPointerDrag(e, {
      onStart: ev => setDrag({ rowId: row.id, index: indexAt(ev.clientY) }),
      onMove: ev => setDrag({ rowId: row.id, index: indexAt(ev.clientY) }),
      onEnd: ev => {
        const i = indexAt(ev.clientY);
        setDrag(null);
        const target = rows[i];
        if (target?.id === row.id || rows[i - 1]?.id === row.id) return;
        if (target) moveRow(dbId, row.id, { before: target.id });
        else if (rows.length) moveRow(dbId, row.id, { after: rows[rows.length - 1].id });
      },
      onClick: () => {
        const r = handle.getBoundingClientRect();
        setRowMenu({ rowId: row.id, rect: r });
      },
    });
  };

  const openEditor = (row: Page, p: Property, el: HTMLElement) => {
    if (p.type === 'title') {
      setEditingTitle(row.id);
      return;
    }
    if (p.type === 'checkbox') {
      setRowProp(row.id, p.id, !rawValue(row, p));
      return;
    }
    if (!isEditable(p.type)) return;
    setEditor({ rowId: row.id, propId: p.id, rect: el.getBoundingClientRect() });
  };

  const dropTop = (() => {
    if (!drag || !bodyRef.current) return null;
    const els = Array.from(bodyRef.current.querySelectorAll('.db-tr')) as HTMLElement[];
    const base = bodyRef.current.getBoundingClientRect().top;
    if (!els.length) return 0;
    if (drag.index >= els.length) return els[els.length - 1].getBoundingClientRect().bottom - base;
    return els[drag.index].getBoundingClientRect().top - base;
  })();

  return (
    <div className="db-table-scroll">
      <div className={'db-table' + (wrap ? ' wrap' : '')} style={{ width: total }}>
        <div className="db-thead">
          {props.map(p => (
            <div
              key={p.id}
              className="db-th"
              style={{ width: widthOf(p) }}
              {...pressable()}
              onClick={e => setPropMenu({ id: p.id, rect: e.currentTarget.getBoundingClientRect() })}
            >
              <span className="db-th-icon"><PropIcon type={p.type} /></span>
              <span className="db-th-name">{p.name}</span>
              <span className="db-resizer" onPointerDown={e => startResize(e, p)} onClick={e => e.stopPropagation()} />
            </div>
          ))}
          <div className="db-th db-th-add" style={{ width: ADD_COL }} {...pressable()} onClick={e => setAddProp(e.currentTarget.getBoundingClientRect())}>
            <Plus size={16} />
          </div>
        </div>
        <div className="db-tbody" ref={bodyRef}>
          {rows.map(row => (
            <div
              key={row.id}
              className={'db-tr' + (drag?.rowId === row.id ? ' dragging' : '')}
              data-row-id={row.id}
              onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                setRowMenu({ rowId: row.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
              }}
            >
              <div className="db-row-actions">
                <span className="db-ra-btn" {...pressable()} aria-label="Add a row below" title="Click to add below" onClick={() => newRow(row.id)}>
                  <Plus size={16} />
                </span>
                <span className="db-ra-btn grip" {...pressable(e => setRowMenu({ rowId: row.id, rect: e.currentTarget.getBoundingClientRect() }))} aria-label="Row menu" aria-haspopup="menu" title="Drag to move. Click to open menu" onPointerDown={e => startRowDrag(e, row)}>
                  <GripVertical size={14} />
                </span>
              </div>
              {props.map(p => (
                <div {...pressable()}
                  key={p.id}
                  className={'db-td t-' + p.type + (editor && editor.rowId === row.id && editor.propId === p.id ? ' editing' : '')}
                  style={{ width: widthOf(p) }}
                  onClick={e => openEditor(row, p, e.currentTarget)}
                >
                  {p.type === 'title' ? (
                    <div className="db-title-cell">
                      <RowIcon page={row} />
                      {editingTitle === row.id ? (
                        <TitleEditor rowId={row.id} onDone={() => setEditingTitle(null)} />
                      ) : (
                        <span className="db-title-text">{row.title}</span>
                      )}
                      {editingTitle !== row.id && (
                        <span
                          className="db-open-btn"
                          {...pressable()}
                          onClick={e => {
                            e.stopPropagation();
                            openPage(row.id, { peek: true });
                          }}
                        >
                          <PanelRight size={12} /> Open
                        </span>
                      )}
                    </div>
                  ) : (
                    <PropValue row={row} prop={p} mode="table" />
                  )}
                </div>
              ))}
              <div className="db-td db-td-pad" style={{ width: ADD_COL }} />
            </div>
          ))}
          {drag && dropTop !== null && <div className="db-drop-line" style={{ top: dropTop - 2 }} />}
        </div>
        <div className="db-new-row" {...pressable()} onClick={() => newRow()}>
          <Plus size={16} /> New page
        </div>
        <CalcRow {...vp} props={props} widthOf={widthOf} />
      </div>

      {propMenu && (
        <PropertyMenu
          dbId={dbId}
          propId={propMenu.id}
          view={view}
          anchor={propMenu.rect}
          onClose={() => setPropMenu(null)}
          onFilter={id => startFilter(id)}
        />
      )}
      {addProp && <AddPropertyMenu dbId={dbId} anchor={addProp} onClose={() => setAddProp(null)} />}
      {editor && (() => {
        const prop = schema.find(p => p.id === editor.propId);
        return prop ? <CellEditor dbId={dbId} rowId={editor.rowId} prop={prop} rect={editor.rect} onClose={() => setEditor(null)} /> : null;
      })()}
      {rowMenu && <RowMenu rowId={rowMenu.rowId} rect={rowMenu.rect} onClose={() => setRowMenu(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calculations                                                        */
/* ------------------------------------------------------------------ */

type CalcId = 'none' | 'count' | 'values' | 'empty' | 'not_empty' | 'pct_empty' | 'pct_not_empty' | 'sum' | 'avg' | 'min' | 'max' | 'checked' | 'unchecked';

const CALC_LABEL: Record<CalcId, string> = {
  none: 'None', count: 'Count all', values: 'Count values', empty: 'Count empty', not_empty: 'Count not empty',
  pct_empty: 'Percent empty', pct_not_empty: 'Percent not empty', sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max',
  checked: 'Checked', unchecked: 'Unchecked',
};
const CALC_SHORT: Record<CalcId, string> = {
  none: '', count: 'Count', values: 'Values', empty: 'Empty', not_empty: 'Not empty', pct_empty: 'Empty', pct_not_empty: 'Not empty',
  sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', checked: 'Checked', unchecked: 'Unchecked',
};

function calcOptions(p: Property): CalcId[] {
  const base: CalcId[] = ['none', 'count', 'values', 'empty', 'not_empty', 'pct_empty', 'pct_not_empty'];
  if (p.type === 'number') return [...base, 'sum', 'avg', 'min', 'max'];
  if (p.type === 'checkbox') return ['none', 'count', 'checked', 'unchecked'];
  return base;
}

function computeCalc(id: CalcId, rows: Page[], p: Property): string {
  const n = rows.length;
  const empty = rows.filter(r => isEmptyValue(r, p)).length;
  const pct = (x: number) => (n ? `${Math.round((x / n) * 1000) / 10}%` : '0%');
  const nums = rows.filter(r => !isEmptyValue(r, p)).map(r => Number(rawValue(r, p)));
  const fmt = (x: number) => fmtNumber(Math.round(x * 100) / 100, p.numberFormat);
  switch (id) {
    case 'count': return String(n);
    case 'values': return String(n - empty);
    case 'empty': return String(empty);
    case 'not_empty': return String(n - empty);
    case 'pct_empty': return pct(empty);
    case 'pct_not_empty': return pct(n - empty);
    case 'sum': return fmt(nums.reduce((a, b) => a + b, 0));
    case 'avg': return nums.length ? fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : '';
    case 'min': return nums.length ? fmt(Math.min(...nums)) : '';
    case 'max': return nums.length ? fmt(Math.max(...nums)) : '';
    case 'checked': return String(rows.filter(r => !!rawValue(r, p)).length);
    case 'unchecked': return String(rows.filter(r => !rawValue(r, p)).length);
    default: return '';
  }
}

function CalcRow({ dbId, view, rows, props, widthOf }: ViewProps & { props: Property[]; widthOf: (p: Property) => number }) {
  const calcs: Record<string, CalcId> = ((view as any).calcs as Record<string, CalcId>) || {};
  const [menu, setMenu] = useState<{ propId: string; rect: DOMRect } | null>(null);
  const prop = menu ? props.find(p => p.id === menu.propId) : null;
  return (
    <div className="db-calc-row">
      {props.map(p => {
        const c = calcs[p.id] || 'none';
        return (
          <div
            key={p.id}
            className={'db-calc' + (c !== 'none' ? ' set' : '') + (p.type === 'number' ? ' num' : '')}
            style={{ width: widthOf(p) }}
            {...pressable()}
            onClick={e => setMenu({ propId: p.id, rect: e.currentTarget.getBoundingClientRect() })}
          >
            {c === 'none' ? (
              <span className="db-calc-hint">Calculate <ChevronDown size={12} /></span>
            ) : (
              <>
                <span className="db-calc-label">{CALC_SHORT[c]}</span>
                <span className="db-calc-val">{computeCalc(c, rows, p)}</span>
              </>
            )}
          </div>
        );
      })}
      {menu && prop && (
        <Popover anchor={menu.rect} onClose={() => setMenu(null)} width={220}>
          <Menu
            onClose={() => setMenu(null)}
            items={calcOptions(prop).map((id): MenuItemDef => ({
              id,
              label: CALC_LABEL[id],
              right: (calcs[prop.id] || 'none') === id ? '✓' : undefined,
              separatorBefore: id === 'count' || id === 'sum',
              onSelect: () => patchView(dbId, view.id, v => ({ calcs: { ...((v as any).calcs || {}), [prop.id]: id } }) as any),
            }))}
          />
        </Popover>
      )}
    </div>
  );
}
