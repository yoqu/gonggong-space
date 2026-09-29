import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AppFrame,
  Button,
  ContextMenu,
  Dialog,
  HUD,
  Menu,
  type MenuItem,
  NavRail,
  NotificationBanner,
  Popover,
  Sheet,
  Sidebar,
  Toast,
  Tooltip,
  Window,
} from '../src/ui'

afterEach(() => vi.useRealTimers())

const key = (k: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...init })

const SHARE: MenuItem[] = [
  { label: '打开', value: 'open' },
  {
    label: '共享',
    value: 'share',
    submenu: [
      { label: '邮件', value: 'mail' },
      { label: '信息', value: 'msg' },
    ],
  },
  { label: '重新命名', value: 'rename' },
  { label: '移到废纸篓', value: 'trash', destructive: true },
]

describe('Menu v2', () => {
  it('opens a submenu with → and closes it with ← back to the parent item', () => {
    const onSelect = vi.fn()
    render(<Menu aria-label="文件" items={SHARE} onSelect={onSelect} autoFocus />)
    expect(document.activeElement?.textContent).toBe('打开')
    key('ArrowDown')
    const share = screen.getByRole('menuitem', { name: '共享' })
    expect(document.activeElement).toBe(share)
    expect(share.getAttribute('aria-haspopup')).toBe('menu')
    expect(share.getAttribute('aria-expanded')).toBe('false')
    key('ArrowRight')
    expect(share.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '邮件' }))
    key('ArrowDown')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '信息' }))
    key('ArrowLeft')
    expect(screen.queryByRole('menuitem', { name: '信息' })).toBeNull()
    expect(document.activeElement).toBe(share)
    key('ArrowRight')
    fireEvent.click(screen.getByRole('menuitem', { name: '邮件' }))
    expect(onSelect).toHaveBeenCalledWith('mail')
  })

  it('closes only the submenu on Escape', () => {
    const onClose = vi.fn()
    render(<Menu items={SHARE} onClose={onClose} autoFocus />)
    key('ArrowDown')
    key('ArrowRight')
    key('Escape')
    expect(screen.queryByRole('menuitem', { name: '邮件' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    key('Escape')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('jumps to the next item starting with a typed letter', () => {
    render(
      <Menu
        items={[
          { label: 'Alpha', value: 'a' },
          { label: 'Beta', value: 'b' },
          { label: 'Bravo', value: 'c' },
        ]}
        autoFocus
      />,
    )
    key('b')
    expect(document.activeElement?.textContent).toBe('Beta')
    key('B')
    expect(document.activeElement?.textContent).toBe('Bravo')
    key('b')
    expect(document.activeElement?.textContent).toBe('Beta')
  })

  it('keeps a single highlight between hover and keyboard', () => {
    render(<Menu items={SHARE} activeValue="rename" />)
    const active = () => [...document.querySelectorAll('[data-active]')].map((e) => e.textContent)
    expect(active()).toEqual(['重新命名'])
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: '打开' }))
    expect(active()).toEqual(['打开'])
  })
})

describe('ContextMenu', () => {
  function Host({ onSelect = () => {} }: { onSelect?: (v: string) => void }) {
    return (
      <ContextMenu items={SHARE} onSelect={onSelect}>
        <button type="button">消息</button>
      </ContextMenu>
    )
  }

  it('opens on right-click at the pointer and selects', () => {
    const onSelect = vi.fn()
    render(<Host onSelect={onSelect} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: '消息' }), { clientX: 120, clientY: 80 })
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('80px')
    fireEvent.click(within(menu).getByRole('menuitem', { name: '打开' }))
    expect(onSelect).toHaveBeenCalledWith('open')
    return waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens with ⇧F10 focused on the first item and returns focus on Escape', async () => {
    render(<Host />)
    const target = screen.getByRole('button', { name: '消息' })
    target.focus()
    key('F10', { shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开' }))
    key('Escape')
    expect(document.activeElement).toBe(target)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    key('ContextMenu')
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('closes on an outside press', async () => {
    render(
      <>
        <Host />
        <button type="button">外部</button>
      </>,
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: '消息' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('Popover', () => {
  it('toggles from its trigger, moves focus in, and returns it on Escape', async () => {
    render(
      <Popover aria-label="名片" trigger={<Button>@张三</Button>}>
        <Button>发消息</Button>
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: '@张三' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    trigger.focus()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('dialog', { name: '名片' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '发消息' }))
    key('Escape')
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes on an outside press and reports open changes', async () => {
    const onOpenChange = vi.fn()
    render(
      <>
        <button type="button">外部</button>
        <Popover defaultOpen onOpenChange={onOpenChange} trigger={<Button>筛选</Button>}>
          内容
        </Popover>
      </>,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('portals out of a clipping ancestor, flips above when there is no room below, and keeps inner presses', () => {
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, left: 40, right: 140, width: 100, height }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('ui-popover') ? rect(0, 300) : rect(window.innerHeight - 60, 30)
    })
    render(
      <div data-testid="clip" style={{ overflow: 'auto' }}>
        <Popover portal aria-label="挑选" trigger={<Button>添加</Button>}>
          <Button>甲</Button>
        </Popover>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    const panel = screen.getByRole('dialog', { name: '挑选' })
    expect(screen.getByTestId('clip').contains(panel)).toBe(false)
    expect(panel.classList.contains('ui-float--fixed')).toBe(true)
    expect(panel.style.top).toBe(`${window.innerHeight - 60 - 8 - 300}px`)
    fireEvent.mouseDown(within(panel).getByRole('button', { name: '甲' }))
    expect(screen.getByRole('dialog', { name: '挑选' })).toBeTruthy()
    vi.restoreAllMocks()
  })
})

describe('Tooltip', () => {
  it('describes its trigger, shows on focus or after the hover delay, hides on Escape', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="新建群组" shortcut="⌘N">
        <Button aria-label="新建群组">+</Button>
      </Tooltip>,
    )
    const btn = screen.getByRole('button', { name: '新建群组' })
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id)
    expect(tip.textContent).toBe('新建群组⌘N')
    expect(tip.dataset.open).toBeUndefined()
    fireEvent.mouseEnter(btn.parentElement!)
    act(() => vi.advanceTimersByTime(599))
    expect(tip.dataset.open).toBeUndefined()
    act(() => vi.advanceTimersByTime(1))
    expect(tip.dataset.open).toBe('')
    fireEvent.mouseLeave(btn.parentElement!)
    expect(tip.dataset.open).toBeUndefined()
    fireEvent.focus(btn)
    expect(tip.dataset.open).toBe('')
    fireEvent.keyDown(btn, { key: 'Escape' })
    expect(tip.dataset.open).toBeUndefined()
  })
})

describe('Sheet', () => {
  function Host({ onCreate = () => {} }: { onCreate?: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <AppFrame toolbar={<div>工具栏</div>}>
        <Button onClick={() => setOpen(true)}>新建群组…</Button>
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="新建群组"
          message="群组创建后可以修改。"
          footer={<Button variant="plain">了解群组类型…</Button>}
          actions={[
            { label: '取消', onClick: () => setOpen(false) },
            { label: '创建', variant: 'primary', onClick: onCreate },
          ]}
        >
          <input aria-label="群名称" />
        </Sheet>
      </AppFrame>
    )
  }

  it('focuses the first field, loops Tab, closes on Escape and returns focus', async () => {
    render(<Host />)
    const trigger = screen.getByRole('button', { name: '新建群组…' })
    trigger.focus()
    fireEvent.click(trigger)
    const sheet = screen.getByRole('dialog', { name: '新建群组' })
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('群名称'))
    const create = screen.getByRole('button', { name: '创建' })
    create.focus()
    key('Tab')
    expect(document.activeElement).toBe(screen.getByLabelText('群名称'))
    key('Escape')
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('lays actions out left to right after the footer, and ignores the scrim by default', () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: '新建群组…' }))
    const sheet = screen.getByRole('dialog')
    expect(
      within(sheet)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['了解群组类型…', '取消', '创建'])
    fireEvent.mouseDown(sheet.parentElement!.querySelector('.ui-scrim')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('Dialog v2', () => {
  it('renders message and actions without a close button, focusing the autoFocus action', () => {
    const onOk = vi.fn()
    render(
      <Dialog
        open
        title="要离开群吗？"
        message="离开后不再接收消息。"
        onClose={() => {}}
        actions={[{ label: '取消' }, { label: '离开', variant: 'primary', onClick: onOk, autoFocus: true }]}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: '要离开群吗？' })
    expect(within(dialog).getByText('离开后不再接收消息。')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '关闭' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '离开' }))
    fireEvent.click(screen.getByRole('button', { name: '离开' }))
    expect(onOk).toHaveBeenCalledOnce()
  })

  it('wraps bare content as an alertdialog and closes on the scrim by default', () => {
    const onClose = vi.fn()
    render(
      <Dialog open bare role="alertdialog" aria-label="删除确认" onClose={onClose}>
        <p>内容</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('alertdialog', { name: '删除确认' })
    expect(dialog.className).toContain('ui-dialog--bare')
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('Toast and HUD', () => {
  it('announces a toast, runs its action, and auto-closes after duration', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const onUndo = vi.fn()
    render(
      <Toast
        icon="trash"
        message="已删除 3 条消息"
        action={{ label: '撤销', onClick: onUndo }}
        duration={5000}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('已删除 3 条消息')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(onUndo).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(5000))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders nothing when closed, and a 16-step level in the HUD', () => {
    const { container } = render(<Toast open={false} message="x" />)
    expect(container.innerHTML).toBe('')
    render(<HUD icon="bell" level={0.5} />)
    const hud = screen.getByRole('status')
    expect(hud.querySelectorAll('.ui-hud__level i')).toHaveLength(16)
    expect(hud.querySelectorAll('.ui-hud__level i[data-on]')).toHaveLength(8)
  })
})

describe('NotificationBanner', () => {
  it('announces as an alert with actions, stack count and a close button', () => {
    const onClose = vi.fn()
    const onReply = vi.fn()
    render(
      <NotificationBanner
        avatar={{ name: 'Mia Chen' }}
        title="Mia Chen"
        subtitle="产品设计组"
        body="稿子更新了"
        stacked={3}
        actions={[{ label: '回复', onClick: onReply }]}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('alert', { name: '消息：Mia Chen' })).toBeTruthy()
    expect(screen.getByText('现在')).toBeTruthy()
    expect(screen.getByText('另外 3 条通知')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回复' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }))
    expect(onReply).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('NavRail', () => {
  it('takes one tab stop, moves and selects with arrow keys, and shows badges', () => {
    const onSelect = vi.fn()
    render(
      <NavRail
        avatar={{ name: 'Yoqu', status: 'online' }}
        items={[
          { id: 'msg', label: '消息', icon: 'bubble', badge: 18 },
          { id: 'cal', label: '日历', icon: 'clock', dot: true },
        ]}
        footer={[{ id: 'set', label: '设置', icon: 'gear' }]}
        onSelect={onSelect}
      />,
    )
    const nav = screen.getByRole('navigation', { name: '应用导航' })
    const item = (name: RegExp) => within(nav).getByRole('button', { name })
    expect([item(/消息/).tabIndex, item(/日历/).tabIndex, item(/设置/).tabIndex]).toEqual([0, -1, -1])
    expect(item(/消息/).getAttribute('aria-current')).toBe('page')
    expect(within(item(/消息/)).getByRole('img', { name: '18 条未读' })).toBeTruthy()
    expect(within(item(/日历/)).getByLabelText('有新内容')).toBeTruthy()
    item(/消息/).focus()
    key('ArrowDown')
    expect(document.activeElement).toBe(item(/日历/))
    expect(onSelect).toHaveBeenLastCalledWith('cal')
    key('End')
    expect(document.activeElement).toBe(item(/设置/))
    expect(item(/设置/).tabIndex).toBe(0)
  })
})

describe('Sidebar v2', () => {
  const sections = [
    {
      title: '个人收藏',
      collapsible: true,
      items: [
        { id: 'recents', label: '最近使用', icon: 'clock' as const },
        {
          id: 'docs',
          label: '文稿',
          icon: 'folder' as const,
          children: [{ id: 'q3', label: '2026 Q3', icon: 'doc' as const }],
        },
      ],
    },
    {
      id: 'tags',
      title: '标签',
      collapsible: true,
      items: [{ id: 'fav', label: '重要', icon: 'star' as const }],
    },
  ]

  it('takes one tab stop and moves the selection with arrows across sections', () => {
    render(<Sidebar sections={sections} defaultSelected="recents" />)
    const row = (name: RegExp) => screen.getByRole('button', { name })
    expect([row(/最近使用/).tabIndex, row(/文稿/).tabIndex, row(/重要/).tabIndex]).toEqual([0, -1, -1])
    row(/最近使用/).focus()
    key('ArrowDown')
    key('ArrowDown')
    expect(document.activeElement).toBe(row(/重要/))
    expect(row(/重要/).getAttribute('aria-current')).toBe('page')
    key('Home')
    expect(document.activeElement).toBe(row(/最近使用/))
  })

  it('expands with → and collapses with ←, and collapses sections', () => {
    render(<Sidebar sections={sections} defaultCollapsed={['tags']} />)
    const docs = screen.getByRole('button', { name: /文稿/ })
    expect(docs.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /Q3/ })).toBeNull()
    docs.focus()
    key('ArrowRight')
    expect(docs.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /Q3/ }).style.paddingLeft).toBe('22px')
    key('ArrowLeft')
    expect(screen.queryByRole('button', { name: /Q3/ })).toBeNull()

    const tags = screen.getByRole('button', { name: '标签' })
    expect(tags.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /重要/ })).toBeNull()
    fireEvent.click(tags)
    expect(screen.getByRole('button', { name: /重要/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '个人收藏' }))
    expect(screen.queryByRole('button', { name: /最近使用/ })).toBeNull()
  })

  it('draws tile icons on a color block', () => {
    render(
      <Sidebar
        iconStyle="tile"
        sections={[
          { items: [{ id: 'wifi', label: '无线局域网', icon: 'wifi', color: 'var(--system-blue)' }] },
        ]}
      />,
    )
    const tile = screen.getByRole('button', { name: /无线局域网/ }).querySelector('.ui-sidebar__icon--tile')
    expect((tile as HTMLElement).style.background).toBe('var(--system-blue)')
  })
})

describe('Window structure', () => {
  it('lays out rail, sidebar, toolbar, content and inspector without window chrome', () => {
    const { container } = render(
      <AppFrame
        rail={<nav aria-label="应用导航" />}
        sidebar={<nav aria-label="会话" />}
        toolbar={<header>工具栏</header>}
        inspector={<div>群设置</div>}
      >
        内容
      </AppFrame>,
    )
    const frame = container.firstElementChild as HTMLElement
    expect(frame.className).toContain('ui-frame')
    expect([...frame.children].map((c) => c.className.split(' ')[0])).toEqual([
      'ui-frame__rail',
      'ui-frame__sidebar',
      'ui-frame__main',
      'ui-frame__inspector',
    ])
    expect(screen.getByRole('complementary').textContent).toBe('群设置')
    expect(container.querySelector('.ui-lights')).toBeNull()
  })

  it('draws traffic lights inside a Window only, on the rail when there is one', () => {
    const { container } = render(
      <Window title="消息" rail={<nav aria-label="应用导航" />} sidebar={<nav aria-label="会话" />}>
        内容
      </Window>,
    )
    expect(screen.getByRole('group', { name: '消息' })).toBeTruthy()
    expect(container.querySelector('.ui-frame__rail .ui-lights')).not.toBeNull()
    expect(container.querySelector('.ui-frame__sidebar .ui-lights')).toBeNull()
    expect(screen.getByRole('heading', { name: '消息' })).toBeTruthy()
  })
})
