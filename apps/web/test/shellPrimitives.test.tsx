import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  AlertDialog,
  Drawer,
  Menu,
  MenuButton,
  type MenuItem,
  Sidebar,
  TabView,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
} from '../src/ui'

const ITEMS: MenuItem[] = [
  { label: '打开', value: 'open', shortcut: '⌘O' },
  { separator: true },
  { header: '显示方式' },
  { label: '图标', value: 'icons', checked: true },
  { label: '列表', value: 'list', checked: false, disabled: true },
  { label: '移到废纸篓', value: 'trash', destructive: true },
]

describe('Menu', () => {
  it('renders items, checkbox items, separators and headers with menu roles', () => {
    render(<Menu aria-label="文件" items={ITEMS} />)
    const menu = screen.getByRole('menu', { name: '文件' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['打开⌘O', '移到废纸篓'])
    expect(screen.getByRole('menuitemcheckbox', { name: '图标' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(screen.getByText('显示方式')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '移到废纸篓' }).className).toContain(
      'ui-menu__item--destructive',
    )
  })

  it('moves focus with arrow keys, skipping disabled items and wrapping', () => {
    render(<Menu aria-label="文件" items={ITEMS} />)
    const open = screen.getByRole('menuitem', { name: /打开/ })
    open.focus()
    fireEvent.keyDown(open, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: '图标' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '移到废纸篓' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(open)
    fireEvent.keyDown(open, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '移到废纸篓' }))
  })

  it('opens from a MenuButton, selects with a click and closes on Escape back to the trigger', async () => {
    const onSelect = vi.fn()
    render(
      <MenuButton aria-label="更多" items={ITEMS} onSelect={onSelect}>
        …
      </MenuButton>,
    )
    const trigger = screen.getByRole('button', { name: '更多' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    trigger.focus()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /打开/ }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '图标' }))
    expect(onSelect).toHaveBeenCalledWith('icons')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(screen.getByRole('menu').dataset.state).toBe('closed')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('highlights nothing when opened with the pointer, the first item when opened from the keyboard', () => {
    render(
      <MenuButton aria-label="更多" items={ITEMS} onSelect={() => {}}>
        …
      </MenuButton>,
    )
    const trigger = screen.getByRole('button', { name: '更多' })
    fireEvent.click(trigger, { detail: 1 })
    expect(document.activeElement).toBe(screen.getByRole('menu'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /打开/ }))
  })

  it('closes on an outside press', async () => {
    render(
      <>
        <button type="button">外部</button>
        <MenuButton aria-label="更多" items={ITEMS} onSelect={() => {}}>
          …
        </MenuButton>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('scrolls the checked item of a long menu into view on open', () => {
    const scrolled: string[] = []
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.textContent ?? '')
    }
    const many: MenuItem[] = Array.from({ length: 40 }, (_, i) => ({
      label: `模型 ${i}`,
      value: `m${i}`,
      checked: i === 30,
    }))
    render(
      <MenuButton aria-label="模型" items={many} placement="above" onSelect={() => {}}>
        …
      </MenuButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: '模型' }))
    expect(scrolled).toEqual(['模型 30'])
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('caps an anchored menu to the viewport so a long list scrolls instead of overflowing', () => {
    const css = readFileSync('src/ui/menu.css', 'utf8')
    const start = css.indexOf('.ui-menu--popover:not(:has(.ui-menu__subwrap)) {')
    expect(start).toBeGreaterThanOrEqual(0)
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('max-height: min(60vh, 420px)')
    expect(rule).toContain('overflow-y: auto')
    expect(rule).toContain('overscroll-behavior: contain')
  })

  it('flips the menu above and its submenu to the left when a scrolling ancestor would clip them', () => {
    // A message list scrolling 0–400 × 0–500 with the trigger at its bottom-right corner.
    const rects = new Map<string, DOMRect>([
      ['list', new DOMRect(0, 0, 500, 400)],
      ['trigger', new DOMRect(470, 370, 24, 24)],
      ['menu', new DOMRect(300, 398, 200, 160)],
      ['sub', new DOMRect(500, 393, 180, 120)],
    ])
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const key = this.matches('.ui-menu--sub')
        ? 'sub'
        : this.matches('[role="menu"]')
          ? 'menu'
          : this.matches('[aria-label="更多"]')
            ? 'trigger'
            : this.matches('[data-testid="list"]')
              ? 'list'
              : ''
      return rects.get(key) ?? new DOMRect()
    }
    render(
      <div data-testid="list" style={{ overflowY: 'auto' }}>
        <MenuButton
          aria-label="更多"
          align="end"
          items={[{ label: '稍后处理', value: 'later', submenu: [{ label: '1 小时', value: '1h' }] }]}
          onSelect={() => {}}
        >
          …
        </MenuButton>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('menu').className).toContain('ui-menu--above')
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /稍后处理/ }))
    const sub = document.querySelector('.ui-menu--sub')!
    expect(sub.className).toContain('ui-menu--sub-start')
    expect(sub.className).toContain('ui-menu--sub-up')
    Element.prototype.getBoundingClientRect = original
  })

  it('keeps the menu below when it fits', () => {
    render(
      <MenuButton aria-label="更多" items={ITEMS} onSelect={() => {}}>
        …
      </MenuButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('menu').className).not.toContain('ui-menu--above')
  })
})

describe('AlertDialog', () => {
  it('lays out two actions side by side and three or more stacked', () => {
    const { rerender } = render(
      <AlertDialog
        open
        title="要删除吗？"
        onClose={() => {}}
        actions={[{ label: '取消' }, { label: '删除' }]}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: '要删除吗？' })
    const actions = () => dialog.querySelector('.ui-alert__actions') as HTMLElement
    expect(actions().classList.contains('ui-alert__actions--stack')).toBe(false)
    rerender(
      <AlertDialog
        open
        title="要删除吗？"
        onClose={() => {}}
        actions={[{ label: '保存' }, { label: '不保存' }, { label: '取消' }]}
      />,
    )
    expect(actions().classList.contains('ui-alert__actions--stack')).toBe(true)
  })

  it('passes the suppression checkbox state to the chosen action and closes on Escape', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(
      <AlertDialog
        open
        title="要删除吗？"
        message="此操作无法撤销。"
        suppression="不再询问"
        onClose={onClose}
        actions={[{ label: '取消' }, { label: '删除', variant: 'destructive', onClick: onDelete }]}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '不再询问' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith(true)
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('Drawer', () => {
  it('stays mounted while animating out, then unmounts', () => {
    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <Drawer open={open} title="群设置" onClose={() => setOpen(false)}>
          内容
        </Drawer>
      )
    }
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    const drawer = screen.getByRole('dialog', { name: '群设置' })
    expect(drawer.dataset.state).toBe('closed')
    fireEvent.animationEnd(drawer)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Sidebar', () => {
  const sections = [
    {
      title: '个人收藏',
      items: [
        { id: 'recents', label: '最近使用', icon: 'clock' as const, color: 'var(--system-blue)' },
        { id: 'dl', label: '下载', icon: 'download' as const, badge: 3 },
      ],
    },
    { title: '位置', items: [{ id: 'cloud', label: 'iCloud 云盘', icon: 'cloud' as const }] },
  ]

  it('marks the selected row with aria-current and moves it on click', () => {
    const onSelect = vi.fn()
    render(<Sidebar aria-label="导航" sections={sections} defaultSelected="recents" onSelect={onSelect} />)
    const nav = screen.getByRole('navigation', { name: '导航' })
    const row = (name: RegExp) => within(nav).getByRole('button', { name })
    expect(row(/最近使用/).getAttribute('aria-current')).toBe('page')
    expect(row(/下载/).getAttribute('aria-current')).toBeNull()
    expect(screen.getByText('个人收藏')).toBeTruthy()
    fireEvent.click(row(/iCloud/))
    expect(onSelect).toHaveBeenCalledWith('cloud')
    expect(row(/iCloud/).getAttribute('aria-current')).toBe('page')
    expect(row(/最近使用/).getAttribute('aria-current')).toBeNull()
  })

  it('follows a controlled selection', () => {
    render(<Sidebar sections={sections} selected="dl" />)
    expect(screen.getByRole('button', { name: /下载/ }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: /iCloud/ }))
    expect(screen.getByRole('button', { name: /下载/ }).getAttribute('aria-current')).toBe('page')
  })
})

describe('Toolbar', () => {
  it('renders the title with subtitle, and icon buttons named by their label', () => {
    const onBack = vi.fn()
    render(
      <Toolbar title="文稿" subtitle="24 项">
        <ToolbarGroup>
          <ToolbarButton icon="chevron-left" label="后退" onClick={onBack} />
          <ToolbarButton icon="grid" label="图标" active />
        </ToolbarGroup>
      </Toolbar>,
    )
    expect(screen.getByRole('heading', { name: '文稿' })).toBeTruthy()
    expect(screen.getByText('24 项')).toBeTruthy()
    const back = screen.getByRole('button', { name: '后退' })
    expect(back.getAttribute('title')).toBe('后退')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '图标' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('TabView', () => {
  it('shows the selected tab content', () => {
    render(
      <TabView
        tabs={[
          { value: 'g', label: '通用', content: '通用设置' },
          { value: 'a', label: '账户', content: '账户设置' },
        ]}
      />,
    )
    expect(screen.getByRole('tabpanel').textContent).toBe('通用设置')
    fireEvent.click(screen.getByRole('tab', { name: '账户' }))
    expect(screen.getByRole('tabpanel').textContent).toBe('账户设置')
  })
})
