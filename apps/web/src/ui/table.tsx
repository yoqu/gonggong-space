import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../lib/cx'
import { ContextMenu } from './context-menu'
import { useControlled } from './controlled'
import { Icon } from './icon'
import type { MenuItem } from './menu'
import { PullDownButton } from './pulldown'
import './disclosure.css'
import './table.css'

type RowId = string | number

export interface TableRow {
  id: RowId
  children?: readonly TableRow[]
}

export interface TableColumn<R extends TableRow = TableRow> {
  key: string
  title: ReactNode
  /** Columns without a width share the remaining space. */
  width?: number | string
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  sortValue?: (row: R) => string | number
  render?: (row: R) => ReactNode
  secondary?: boolean
  mono?: boolean
}

export interface TableSort {
  key: string
  dir: 'asc' | 'desc'
}

export interface TableProps<R extends TableRow = TableRow> {
  columns: TableColumn<R>[]
  rows: readonly R[]
  selection?: RowId[]
  defaultSelection?: RowId[]
  onSelectionChange?: (ids: RowId[]) => void
  multiple?: boolean
  sort?: TableSort | null
  defaultSort?: TableSort
  onSortChange?: (sort: TableSort) => void
  /** false when the server sorts. */
  sortRows?: boolean
  defaultExpanded?: RowId[]
  onOpen?: (row: R) => void
  /** Row actions: a trailing「操作」pull-down per row, also shown on right-click; empty hides it for that row. */
  rowActions?: (row: R) => MenuItem[]
  onRowAction?: (value: string, row: R) => void
  alternating?: boolean
  density?: 'regular' | 'compact'
  /** Force the focused selection style (demo only). */
  active?: boolean
  emptyText?: ReactNode
  height?: number | string
  maxHeight?: number | string
  className?: string
  style?: CSSProperties
  'aria-label': string
}

const field = (row: TableRow, key: string) => (row as unknown as Record<string, unknown>)[key]

/** macOS list / outline view: sortable header, multi-select, tree rows, sticky header, row-alt striping. */
export function Table<R extends TableRow = TableRow>({
  columns,
  rows,
  selection,
  defaultSelection = [],
  onSelectionChange,
  multiple = true,
  sort,
  defaultSort,
  onSortChange,
  sortRows = true,
  defaultExpanded = [],
  onOpen,
  rowActions,
  onRowAction,
  alternating = true,
  density = 'regular',
  active,
  emptyText = '没有项目',
  height,
  maxHeight,
  className,
  style,
  'aria-label': ariaLabel,
}: TableProps<R>) {
  const [sel, setSelState] = useControlled(selection, defaultSelection)
  const [order, setOrder] = useControlled<TableSort | null>(sort, defaultSort ?? null)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [menuRow, setMenuRow] = useState<R | null>(null)
  const anchor = useRef<RowId | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const isTree = rows.some((r) => r.children?.length)
  const template = [
    ...columns.map((c) => (typeof c.width === 'number' ? `${c.width}px` : (c.width ?? 'minmax(0, 1fr)'))),
    ...(rowActions ? [`${ACTIONS_WIDTH}px`] : []),
  ].join(' ')

  const compare = (a: R, b: R) => {
    if (!order) return 0
    const col = columns.find((c) => c.key === order.key)
    const va = col?.sortValue ? col.sortValue(a) : field(a, order.key)
    const vb = col?.sortValue ? col.sortValue(b) : field(b, order.key)
    const r =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va ?? '').localeCompare(String(vb ?? ''), 'zh-Hans-CN', { numeric: true })
    return order.dir === 'desc' ? -r : r
  }

  const visible: { row: R; level: number }[] = []
  const walk = (list: readonly R[], level: number) => {
    const sorted = order && sortRows ? [...list].sort(compare) : list
    for (const row of sorted) {
      visible.push({ row, level })
      if (row.children && expanded.includes(row.id)) walk(row.children as readonly R[], level + 1)
    }
  }
  walk(rows, 1)
  const ids = visible.map((v) => v.row.id)

  const setSel = (next: RowId[]) => {
    setSelState(next)
    onSelectionChange?.(next)
  }
  const selectOne = (id: RowId) => {
    setSel([id])
    anchor.current = id
  }
  const toggleExpand = (id: RowId, open: boolean) => {
    if (expanded.includes(id) === open) return
    setExpanded(open ? [...expanded, id] : expanded.filter((x) => x !== id))
  }

  const onRowMouseDown = (e: MouseEvent, id: RowId) => {
    if (e.button !== 0) return
    if (multiple && (e.metaKey || e.ctrlKey)) {
      setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
      anchor.current = id
    } else if (multiple && e.shiftKey && anchor.current != null) {
      const b = ids.indexOf(id)
      const a = ids.includes(anchor.current) ? ids.indexOf(anchor.current) : b
      setSel(ids.slice(Math.min(a, b), Math.max(a, b) + 1))
    } else selectOne(id)
  }

  const last = sel.at(-1)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the selection moves
  useEffect(() => {
    if (last == null || !ref.current?.contains(document.activeElement)) return
    ref.current
      .querySelector(`[data-row-id="${String(last).replace(/"/g, '')}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [sel])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed in a row's action button or its menu belong to them.
    if (e.target !== e.currentTarget) return
    const i = last == null ? -1 : ids.indexOf(last)
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const row = i >= 0 ? (visible[i] as (typeof visible)[number]).row : null
      if (row && rowActions?.(row).length) setMenuRow(row)
      else e.stopPropagation()
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      const n =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? ids.length - 1
            : e.key === 'ArrowDown'
              ? Math.min(ids.length - 1, i + 1)
              : Math.max(0, i - 1)
      const id = ids[n]
      if (id == null) return
      if (multiple && e.shiftKey) {
        const a = ids.indexOf(anchor.current ?? id)
        const range = ids.slice(Math.min(a, n), Math.max(a, n) + 1)
        setSel(n < a ? range.reverse() : range)
      } else selectOne(id)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && isTree && i >= 0) {
      e.preventDefault()
      const v = visible[i] as (typeof visible)[number]
      const open = expanded.includes(v.row.id)
      if (e.key === 'ArrowRight') {
        if (v.row.children) toggleExpand(v.row.id, true)
      } else if (v.row.children && open) toggleExpand(v.row.id, false)
      else {
        const parent = visible.slice(0, i).findLast((p) => p.level < v.level)
        if (parent) selectOne(parent.row.id)
      }
    } else if (e.key === 'a' && (e.metaKey || e.ctrlKey) && multiple) {
      e.preventDefault()
      setSel([...ids])
    } else if (e.key === 'Enter' && i >= 0 && onOpen) {
      e.preventDefault()
      onOpen((visible[i] as (typeof visible)[number]).row)
    }
  }

  const align = (a?: TableColumn['align']) => a && a !== 'left' && `ui-align-${a}`

  const table = (
    // biome-ignore lint/a11y/noStaticElementInteractions: role is grid or treegrid, chosen at runtime
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is grid or treegrid, chosen at runtime
    <div
      ref={ref}
      role={isTree ? 'treegrid' : 'grid'}
      aria-label={ariaLabel}
      aria-multiselectable={multiple}
      tabIndex={0}
      className={cx(
        'ui-table',
        active && 'ui-table--active',
        density === 'compact' && 'ui-table--compact',
        !alternating && 'ui-table--plain',
        className,
      )}
      style={{ height, maxHeight, ...style }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        // Only a row with actions opens the context menu; elsewhere the event never reaches it.
        const el = (e.target as Element).closest('[data-row-id]')
        const row =
          el && ref.current?.contains(el)
            ? visible.find((v) => String(v.row.id) === el.getAttribute('data-row-id'))?.row
            : undefined
        if (!row || !rowActions?.(row).length) return e.stopPropagation()
        selectOne(row.id)
        ref.current?.focus()
        setMenuRow(row)
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: div rows are CSS grid tracks under a sticky header */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: the grid owns focus */}
      <div className="ui-table__head" role="row" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => {
          const dir = order?.key === c.key ? order.dir : null
          return (
            // biome-ignore lint/a11y/useSemanticElements: div rows are CSS grid tracks under a sticky header
            // biome-ignore lint/a11y/useFocusableInteractive: the grid owns focus; headers sort by pointer like NSTableView
            // biome-ignore lint/a11y/useKeyWithClickEvents: the grid owns focus; headers sort by pointer like NSTableView
            <div
              key={c.key}
              role="columnheader"
              aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}
              className={cx(
                'ui-table__th',
                c.sortable && 'ui-table__th--sortable',
                dir && 'ui-table__th--sorted',
                align(c.align),
              )}
              onClick={
                c.sortable
                  ? () => {
                      const next: TableSort = { key: c.key, dir: dir === 'asc' ? 'desc' : 'asc' }
                      setOrder(next)
                      onSortChange?.(next)
                    }
                  : undefined
              }
            >
              <span>{c.title}</span>
              {dir ? <Icon name={dir === 'asc' ? 'chevron-up' : 'chevron-down'} weight={2} /> : null}
            </div>
          )
        })}
        {rowActions ? (
          // biome-ignore lint/a11y/useSemanticElements: div rows are CSS grid tracks under a sticky header
          // biome-ignore lint/a11y/useFocusableInteractive: the grid owns focus
          <div role="columnheader" aria-label="操作" className="ui-table__th" />
        ) : null}
      </div>
      {visible.length ? (
        // biome-ignore lint/a11y/useSemanticElements: div rows are CSS grid tracks under a sticky header
        <div className="ui-table__body" role="rowgroup">
          {visible.map(({ row, level }, idx) => {
            const open = expanded.includes(row.id)
            return (
              // biome-ignore lint/a11y/useSemanticElements: div rows are CSS grid tracks under a sticky header
              // biome-ignore lint/a11y/useFocusableInteractive: the grid owns focus; arrow keys move the selection
              <div
                key={row.id}
                data-row-id={row.id}
                role="row"
                aria-selected={sel.includes(row.id)}
                aria-level={isTree ? level : undefined}
                aria-expanded={row.children ? open : undefined}
                className={cx('ui-table__row', idx % 2 === 1 && 'ui-table__row--alt')}
                style={{ gridTemplateColumns: template }}
                onMouseDown={(e) => onRowMouseDown(e, row.id)}
                onDoubleClick={() => onOpen?.(row)}
              >
                {columns.map((c, ci) => {
                  const value = c.render ? c.render(row) : field(row, c.key)
                  const cell = <span className="ui-table__cell">{(value ?? '--') as ReactNode}</span>
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: div rows are CSS grid tracks under a sticky header
                    // biome-ignore lint/a11y/useFocusableInteractive: the grid owns focus; cells are not focus stops
                    <div
                      key={c.key}
                      role="gridcell"
                      className={cx(
                        'ui-table__td',
                        align(c.align),
                        c.secondary && 'ui-table__td--secondary',
                        c.mono && 'ui-table__td--mono',
                      )}
                    >
                      {ci === 0 && isTree ? (
                        <span className="ui-table__tree" style={{ paddingLeft: (level - 1) * 16 }}>
                          {row.children ? (
                            <button
                              type="button"
                              tabIndex={-1}
                              className={cx('ui-disclosure', open && 'ui-disclosure--open')}
                              aria-label={open ? '折叠' : '展开'}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={() => toggleExpand(row.id, !open)}
                            >
                              <Icon name="chevron-right" weight={2} />
                            </button>
                          ) : (
                            <span className="ui-disclosure-spacer" />
                          )}
                          {cell}
                        </span>
                      ) : (
                        cell
                      )}
                    </div>
                  )
                })}
                {rowActions ? (
                  <ActionsCell items={rowActions(row)} onSelect={(v) => onRowAction?.(v, row)} />
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ui-table__empty">{emptyText}</div>
      )}
    </div>
  )

  if (!rowActions) return table
  return (
    <ContextMenu
      className="ui-table-ctx"
      items={menuRow ? rowActions(menuRow) : []}
      onSelect={(v) => menuRow && onRowAction?.(v, menuRow)}
    >
      {table}
    </ContextMenu>
  )
}

const ACTIONS_WIDTH = 32

function ActionsCell({ items, onSelect }: { items: MenuItem[]; onSelect: (value: string) => void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: div rows are CSS grid tracks under a sticky header
    // biome-ignore lint/a11y/useFocusableInteractive: the action button is the focus stop
    <div
      role="gridcell"
      className="ui-table__td ui-table__actions"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {items.length ? (
        <PullDownButton
          icon="more"
          aria-label="操作"
          variant="plain"
          size="small"
          align="end"
          portal
          indicator={false}
          items={items}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  )
}
