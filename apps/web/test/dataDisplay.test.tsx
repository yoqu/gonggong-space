import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  Disclosure,
  Divider,
  EmptyState,
  Form,
  FormActions,
  FormRow,
  GroupBox,
  GroupRow,
  Kbd,
  LevelIndicator,
  PathControl,
  Skeleton,
  Table,
  type TableColumn,
} from '../src/ui'

interface File {
  id: string
  name: string
  size?: number
  children?: File[]
}

const columns: TableColumn<File>[] = [
  { key: 'name', title: '名称', sortable: true },
  { key: 'size', title: '大小', width: 80, align: 'right', sortable: true, secondary: true },
]
const flat: File[] = [
  { id: 'b', name: 'Beta', size: 2 },
  { id: 'a', name: 'Alpha', size: 3 },
  { id: 'c', name: 'Gamma' },
]
const tree: File[] = [
  { id: 'd', name: '设计稿', children: [{ id: 'f1', name: '图标.pdf', size: 1 }] },
  { id: 'e', name: '周报', size: 4 },
]

const rowNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.firstElementChild?.textContent)
const row = (name: string) => screen.getByText(name).closest('[role="row"]') as HTMLElement

describe('Table', () => {
  it('renders a named grid with column headers and alternating rows', () => {
    render(<Table aria-label="文稿" columns={columns} rows={flat} />)
    const grid = screen.getByRole('grid', { name: '文稿' })
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['名称', '大小'])
    expect(row('Alpha').className).toContain('ui-table__row--alt')
    expect(grid.getAttribute('aria-multiselectable')).toBe('true')
  })

  it('shows -- for empty values and the empty text without rows', () => {
    const { rerender } = render(<Table aria-label="t" columns={columns} rows={flat} />)
    expect(within(row('Gamma')).getByText('--')).toBeTruthy()
    rerender(<Table aria-label="t" columns={columns} rows={[]} emptyText="没有文稿" />)
    expect(screen.getByText('没有文稿')).toBeTruthy()
  })

  it('sorts by a header click, toggling direction', () => {
    const onSortChange = vi.fn()
    render(<Table aria-label="t" columns={columns} rows={flat} onSortChange={onSortChange} />)
    const header = screen.getByRole('columnheader', { name: '名称' })
    expect(header.getAttribute('aria-sort')).toBe('none')
    fireEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(rowNames()).toEqual(['Alpha', 'Beta', 'Gamma'])
    fireEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(rowNames()).toEqual(['Gamma', 'Beta', 'Alpha'])
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', dir: 'desc' })
  })

  it('leaves order to the server when sortRows is false', () => {
    render(
      <Table
        aria-label="t"
        columns={columns}
        rows={flat}
        sort={{ key: 'name', dir: 'asc' }}
        sortRows={false}
      />,
    )
    expect(rowNames()).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('selects with click, ⌘-click and ⇧-click', () => {
    const onSelectionChange = vi.fn()
    render(<Table aria-label="t" columns={columns} rows={flat} onSelectionChange={onSelectionChange} />)
    fireEvent.mouseDown(row('Beta'))
    expect(row('Beta').getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseDown(row('Gamma'), { metaKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b', 'c'])
    fireEvent.mouseDown(row('Beta'))
    fireEvent.mouseDown(row('Gamma'), { shiftKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b', 'a', 'c'])
  })

  it('selects a single row when multiple is false', () => {
    render(<Table aria-label="t" columns={columns} rows={flat} multiple={false} />)
    fireEvent.mouseDown(row('Beta'))
    fireEvent.mouseDown(row('Gamma'), { metaKey: true })
    expect(row('Beta').getAttribute('aria-selected')).toBe('false')
    expect(row('Gamma').getAttribute('aria-selected')).toBe('true')
  })

  it('moves, extends and selects all from the keyboard, Enter opens', () => {
    const onOpen = vi.fn()
    const onSelectionChange = vi.fn()
    render(
      <Table
        aria-label="t"
        columns={columns}
        rows={flat}
        onOpen={onOpen}
        onSelectionChange={onSelectionChange}
      />,
    )
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b'])
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b', 'a'])
    fireEvent.keyDown(grid, { key: 'End' })
    expect(onSelectionChange).toHaveBeenLastCalledWith(['c'])
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(flat[2])
    fireEvent.keyDown(grid, { key: 'a', metaKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b', 'a', 'c'])
  })

  it('opens a row on double click', () => {
    const onOpen = vi.fn()
    render(<Table aria-label="t" columns={columns} rows={flat} onOpen={onOpen} />)
    fireEvent.doubleClick(row('Alpha'))
    expect(onOpen).toHaveBeenCalledWith(flat[1])
  })

  it('expands and collapses tree rows with the arrow keys and the triangle', () => {
    render(<Table aria-label="t" columns={columns} rows={tree} defaultSelection={['d']} />)
    const grid = screen.getByRole('treegrid')
    expect(row('设计稿').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('图标.pdf')).toBeNull()
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(row('设计稿').getAttribute('aria-expanded')).toBe('true')
    expect(row('图标.pdf').getAttribute('aria-level')).toBe('2')
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(row('图标.pdf').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    expect(row('设计稿').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    expect(screen.queryByText('图标.pdf')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(screen.getByText('图标.pdf')).toBeTruthy()
  })
})

describe('LevelIndicator', () => {
  it('reports capacity as a meter and colors past the thresholds', () => {
    render(<LevelIndicator aria-label="储存空间" max={256} value={210} warning={200} critical={240} />)
    const meter = screen.getByRole('meter', { name: '储存空间' })
    expect(meter.getAttribute('aria-valuenow')).toBe('210')
    expect(meter.className).toContain('ui-level--warning')
  })

  it('renders capacity parts with a legend', () => {
    render(
      <LevelIndicator
        aria-label="储存空间"
        max={100}
        value={60}
        parts={[
          { value: 40, color: 'var(--system-blue)', label: '应用程序' },
          { value: 20, color: 'var(--system-gray)', label: '系统数据' },
        ]}
      />,
    )
    expect(screen.getByText('应用程序')).toBeTruthy()
    expect(screen.getByRole('meter').children).toHaveLength(2)
  })

  it('lights the discrete segments in proportion', () => {
    render(<LevelIndicator kind="discrete" aria-label="磁盘" value={96} critical={90} segments={10} />)
    const meter = screen.getByRole('meter', { name: '磁盘' })
    expect(meter.querySelectorAll('.on')).toHaveLength(10)
    expect(meter.className).toContain('ui-level--critical')
  })

  it('edits a rating with arrows, digits and clicks', () => {
    const onChange = vi.fn()
    render(
      <LevelIndicator kind="rating" editable defaultValue={3} onChange={onChange} aria-label="会议评分" />,
    )
    const slider = screen.getByRole('slider')
    expect(slider.getAttribute('aria-valuenow')).toBe('3')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(4)
    fireEvent.keyDown(slider, { key: '1' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.click(slider.querySelectorAll('svg')[4] as SVGElement)
    expect(onChange).toHaveBeenLastCalledWith(5)
  })

  it('shows a read-only rating as an image', () => {
    render(<LevelIndicator kind="rating" value={4} aria-label="评分" />)
    expect(screen.getByRole('img', { name: '评分：4 / 5' })).toBeTruthy()
  })
})

describe('PathControl', () => {
  const items = ['根', '用户', 'yoqu', '文稿', '报告', '季度.key'].map((label, i) => ({ id: `p${i}`, label }))

  it('marks the current location and selects ancestors', () => {
    const onSelect = vi.fn()
    render(<PathControl items={items.slice(0, 3)} onSelect={onSelect} />)
    const nav = screen.getByRole('navigation', { name: '路径' })
    expect(within(nav).getByRole('button', { name: 'yoqu' }).getAttribute('aria-current')).toBe('location')
    fireEvent.click(within(nav).getByRole('button', { name: '用户' }))
    expect(onSelect).toHaveBeenCalledWith('p1')
  })

  it('folds middle levels into a menu beyond maxItems', () => {
    const onSelect = vi.fn()
    render(<PathControl items={items} onSelect={onSelect} />)
    expect(screen.queryByRole('button', { name: '用户' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示上层文件夹' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '用户' }))
    expect(onSelect).toHaveBeenCalledWith('p1')
  })
})

describe('Form', () => {
  it('lays out labels with a full-width colon and hints', () => {
    const onSubmit = vi.fn()
    render(
      <Form aria-label="账户设置" onSubmit={onSubmit}>
        <FormRow label="显示名称" hint="用于登录。">
          <input aria-label="显示名称" />
        </FormRow>
        <FormRow label="语言" colon={false}>
          <span />
        </FormRow>
        <FormActions>
          <button type="submit">保存</button>
        </FormActions>
      </Form>,
    )
    const form = screen.getByRole('form', { name: '账户设置' })
    expect(within(form).getByText('显示名称：')).toBeTruthy()
    expect(within(form).getByText('语言')).toBeTruthy()
    expect(within(form).getByText('用于登录。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSubmit).toHaveBeenCalled()
  })
})

describe('Disclosure', () => {
  it('toggles content, announcing the state and hiding the summary when open', () => {
    const onToggle = vi.fn()
    render(
      <Disclosure title="高级" summary="3 项设置" onToggle={onToggle}>
        硬件加速
      </Disclosure>,
    )
    const head = screen.getByRole('button', { name: /高级/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('3 项设置')).toBeTruthy()
    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(head.getAttribute('aria-controls') ?? '')?.textContent).toBe('硬件加速')
    expect(screen.queryByText('3 项设置')).toBeNull()
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})

describe('Divider', () => {
  it('renders horizontal, labelled and vertical separators', () => {
    render(
      <>
        <Divider />
        <Divider label="或者" />
        <Divider vertical />
      </>,
    )
    const seps = screen.getAllByRole('separator')
    expect(seps).toHaveLength(3)
    expect(seps[1]?.textContent).toBe('或者')
    expect(seps[2]?.getAttribute('aria-orientation')).toBe('vertical')
  })
})

describe('EmptyState', () => {
  it('shows the default message icon, title, description and action', () => {
    const { container } = render(
      <EmptyState
        title="选择一个会话"
        description="从左侧列表选择会话。"
        action={<button type="button">新建群组</button>}
      />,
    )
    expect(container.querySelector('.ui-empty__icon svg')).toBeTruthy()
    expect(screen.getByText('选择一个会话')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建群组' })).toBeTruthy()
  })

  it('drops the icon with icon={false} and supports compact', () => {
    const { container } = render(<EmptyState title="没有项目" icon={false} compact />)
    expect(container.querySelector('.ui-empty__icon')).toBeNull()
    expect(container.firstElementChild?.className).toContain('ui-empty--compact')
  })
})

describe('Skeleton', () => {
  it('announces loading and repeats the requested shape', () => {
    const { container } = render(<Skeleton variant="conversation" count={4} />)
    const status = screen.getByRole('status', { name: '正在载入' })
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('.ui-skel__conv')).toHaveLength(4)
  })

  it('puts every third message on the self side', () => {
    const { container } = render(<Skeleton variant="message" count={3} label="正在载入消息" />)
    expect(screen.getByRole('status', { name: '正在载入消息' })).toBeTruthy()
    expect(container.querySelectorAll('.ui-skel__msg--self')).toHaveLength(1)
  })
})

describe('Kbd', () => {
  it('renders one key cap per key', () => {
    const { container, rerender } = render(<Kbd keys={['⌘', '⇧', 'N']} />)
    expect([...container.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌘', '⇧', 'N'])
    rerender(<Kbd>Enter</Kbd>)
    expect(container.querySelectorAll('kbd')).toHaveLength(1)
  })
})

describe('GroupRow', () => {
  it('turns a clickable row into a button with value and chevron', () => {
    const onClick = vi.fn()
    render(
      <GroupBox>
        <GroupRow label="墙纸" value="金门大桥" onClick={onClick} />
        <GroupRow label="退出群" destructive onClick={onClick} />
      </GroupBox>,
    )
    const btn = screen.getByRole('button', { name: /墙纸/ })
    expect(btn.textContent).toContain('金门大桥')
    expect(btn.querySelector('svg')).toBeTruthy()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
    const danger = screen.getByRole('button', { name: '退出群' })
    expect(danger.className).toContain('ui-group__row--danger')
    expect(danger.querySelector('svg')).toBeNull()
  })

  it('lifts the value width cap only for wide values', () => {
    render(
      <GroupBox>
        <GroupRow label="模型" value="claude-opus-4-1-20250805" wideValue />
        <GroupRow label="并发上限" value={2} />
      </GroupBox>,
    )
    expect(screen.getByText('claude-opus-4-1-20250805').className).toContain('ui-group__value--wide')
    expect(screen.getByText('2').className).not.toContain('ui-group__value--wide')
  })
})
