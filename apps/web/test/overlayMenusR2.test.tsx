import { readFileSync } from 'node:fs'
import type { MessageDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { MessageActions } from '../src/features/chat/MessageActions'
import { ReactionPicker } from '../src/features/reactions'
import { MenuButton, Popover } from '../src/ui'
import { mockApi } from './mockApi'

const origWidth = window.innerWidth
const origHeight = window.innerHeight

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => {},
  }) as DOMRect

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function mockSize(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(height)
}

afterEach(() => {
  setViewport(origWidth, origHeight)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Popover portal top-end positioning', () => {
  it('prefers placing above the anchor and clamps horizontally within the viewport', () => {
    setViewport(390, 800)
    mockSize(240, 48)
    const { container } = render(
      <Popover portal placement="top-end" aria-label="表情" trigger={<button type="button">打开</button>}>
        <div>面板内容</div>
      </Popover>,
    )
    const anchor = container.querySelector('.ui-popover-anchor') as HTMLElement
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(360, 300, 28, 28))

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    const dialog = screen.getByRole('dialog', { name: '表情' })
    expect(dialog.parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
    // Placed above anchor (300 - 8 - 48 = 244) and clamped to right viewport edge (390 - 8 - 240 = 142).
    expect(dialog.style.top).toBe('244px')
    expect(dialog.style.left).toBe('142px')
  })

  it('flips below when room above is insufficient and clamps left edge within the viewport', () => {
    setViewport(390, 800)
    mockSize(240, 48)
    const { container } = render(
      <Popover portal placement="top-end" aria-label="表情" trigger={<button type="button">打开</button>}>
        <div>面板内容</div>
      </Popover>,
    )
    const anchor = container.querySelector('.ui-popover-anchor') as HTMLElement
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(10, 24, 28, 28))

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    const dialog = screen.getByRole('dialog', { name: '表情' })
    // Above has only 8px room (< 48px), below has 732px: flips below (52 + 8 = 60) and clamps left to 8px.
    expect(dialog.style.top).toBe('60px')
    expect(dialog.style.left).toBe('8px')
  })
})

describe('ReactionPicker portal', () => {
  beforeEach(() => {
    useSession.setState({
      user: {
        id: 'u1',
        account: 'wang',
        name: '王磊',
        role: 'member',
        mustChangePassword: false,
        disabled: false,
        gitProtocol: 'auto',
        email: null,
        avatar: null,
      },
    } as never)
  })

  it('renders 6 emojis in a portaled popover, toggles on click, and closes on Escape', async () => {
    const emojiPath = `/messages/m-r2-1/reactions/${encodeURIComponent('👍')}`
    const calls = mockApi({
      [`PUT ${emojiPath}`]: {
        groupId: 'g1',
        messageId: 'm-r2-1',
        reactions: [{ emoji: '👍', count: 1, mine: true, users: [{ id: 'u1', name: '王磊' }] }],
      },
    })
    const message: Pick<MessageDto, 'id' | 'groupId' | 'reactions'> = {
      id: 'm-r2-1',
      groupId: 'g1',
      reactions: [],
    }
    const { container } = render(<ReactionPicker message={message} />)
    const trigger = screen.getByRole('button', { name: '添加表情回应' })

    fireEvent.click(trigger)
    const popover = screen.getByRole('dialog', { name: '表情回应' })
    expect(popover.parentElement).toBe(document.body)
    expect(container.contains(popover)).toBe(false)
    expect(popover.classList.contains('ui-float--fixed')).toBe(true)
    expect(popover.classList.contains('ui-float--top-end')).toBe(true)
    expect(popover.querySelector('.pn-emoji--fixed')).toBeTruthy()

    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.querySelector('img')?.alt)).toEqual(['👍', '✅', '👀', '🎉', '❤️', '😂'])

    fireEvent.click(screen.getByRole('option', { name: '赞' }))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => expect(calls).toEqual([{ method: 'PUT', path: emojiPath, body: undefined }]))

    // Reopen and verify Escape closes and returns focus to trigger.
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const reopenPop = screen.getByRole('dialog', { name: '表情回应' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(reopenPop.dataset.state).toBe('closed')
    expect(reopenPop.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('dialog', { name: '表情回应' })).toBeNull()
    fireEvent.animationEnd(reopenPop)
    expect(reopenPop.isConnected).toBe(false)
  })
})

describe('MenuButton portal and narrow-screen submenus', () => {
  it('portals to body, stays open on inside press, invokes onSelect, and closes outside/Esc', () => {
    setViewport(1024, 768)
    mockSize(200, 140)
    const onSelect = vi.fn()
    const { container } = render(
      <MenuButton
        portal
        align="end"
        aria-label="更多"
        items={[
          {
            value: 'later',
            label: '稍后处理',
            submenu: [{ value: 'remind:1h', label: '1 小时后' }],
          },
          { value: 'pin', label: '置顶' },
        ]}
        onSelect={onSelect}
      >
        更多
      </MenuButton>,
    )
    const trigger = screen.getByRole('button', { name: '更多' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect(900, 200, 28, 28))

    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    expect(container.contains(menu)).toBe(false)
    expect(menu.classList.contains('ui-menu--fixed')).toBe(true)
    expect(menu.style.top).toBe('232px')
    expect(menu.style.left).toBe('728px')

    // Pressing inside the portaled menu must not trigger outside-press dismissal.
    const later = screen.getByRole('menuitem', { name: '稍后处理' })
    fireEvent.mouseDown(later)
    fireEvent.click(later)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const subItem = screen.getByRole('menuitem', { name: '1 小时后' })
    fireEvent.mouseDown(subItem)
    fireEvent.click(subItem)
    expect(onSelect).toHaveBeenCalledWith('remind:1h')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.animationEnd(menu)
    expect(screen.queryByRole('menu')).toBeNull()

    // Outside mousedown closes the portaled menu.
    fireEvent.click(trigger)
    const menu2 = screen.getByRole('menu')
    fireEvent.mouseDown(document.body)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.animationEnd(menu2)
    expect(screen.queryByRole('menu')).toBeNull()

    // Escape closes the portaled menu and refocuses the trigger.
    fireEvent.click(trigger)
    const menu3 = screen.getByRole('menu')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    fireEvent.animationEnd(menu3)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('flips above when short of room below and clamps horizontal position within viewport', () => {
    setViewport(390, 600)
    mockSize(200, 180)
    render(
      <MenuButton
        portal
        align="start"
        aria-label="操作"
        items={[{ value: 'a', label: '项目 A' }]}
        onSelect={() => {}}
      >
        操作
      </MenuButton>,
    )
    const trigger = screen.getByRole('button', { name: '操作' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect(300, 520, 40, 28))

    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(menu.classList.contains('ui-menu--above')).toBe(true)
    expect(menu.style.top).toBe('336px')
    expect(menu.style.left).toBe('182px')
  })

  it('clamps submenus inside a 390px viewport from both right and left edges', () => {
    setViewport(390, 844)
    mockSize(200, 120)
    const items = [
      {
        value: 'later',
        label: '稍后处理',
        submenu: [{ value: '1h', label: '1 小时后' }],
      },
    ]

    // Parent menu near right edge: submenu opens left and clamps at left viewport edge (8px).
    const first = render(
      <MenuButton portal align="end" aria-label="更多" items={items} onSelect={() => {}}>
        更多
      </MenuButton>,
    )
    const trigger1 = screen.getByRole('button', { name: '更多' })
    vi.spyOn(trigger1, 'getBoundingClientRect').mockReturnValue(rect(350, 200, 28, 28))
    fireEvent.click(trigger1)
    const item1 = screen.getByRole('menuitem', { name: '稍后处理' })
    const wrap1 = item1.closest('.ui-menu__subwrap') as HTMLElement
    vi.spyOn(wrap1, 'getBoundingClientRect').mockReturnValue(rect(184, 238, 188, 36))
    fireEvent.click(item1)
    const sub1 = document.querySelector('.ui-menu--sub') as HTMLElement
    const left1 = 184 + Number.parseFloat(sub1.style.left)
    expect(left1).toBe(8)
    expect(left1 + 200).toBeLessThanOrEqual(390 - 8)
    expect(sub1.style.right).toBe('auto')
    first.unmount()

    // Parent menu near left edge: submenu opens right and clamps at right viewport edge (382px).
    render(
      <MenuButton portal align="start" aria-label="更多" items={items} onSelect={() => {}}>
        更多
      </MenuButton>,
    )
    const trigger2 = screen.getByRole('button', { name: '更多' })
    vi.spyOn(trigger2, 'getBoundingClientRect').mockReturnValue(rect(8, 200, 28, 28))
    fireEvent.click(trigger2)
    const item2 = screen.getByRole('menuitem', { name: '稍后处理' })
    const wrap2 = item2.closest('.ui-menu__subwrap') as HTMLElement
    vi.spyOn(wrap2, 'getBoundingClientRect').mockReturnValue(rect(14, 238, 188, 36))
    fireEvent.click(item2)
    const sub2 = document.querySelector('.ui-menu--sub') as HTMLElement
    const left2 = 14 + Number.parseFloat(sub2.style.left)
    expect(left2).toBe(182)
    expect(left2).toBeGreaterThanOrEqual(8)
    expect(left2 + 200).toBeLessThanOrEqual(390 - 8)
    expect(sub2.style.right).toBe('auto')
  })

  it('portals MessageActions 更多 menu onto document.body', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <MessageActions
          message={{ id: 'm-r2-2', groupId: 'g1', kind: 'user', body: 'hi', reactions: [] } as never}
          link="https://example.com/m"
          onQuote={() => {}}
          copyText="hi"
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    expect(container.contains(menu)).toBe(false)
  })
})

describe('touch and portalled overlay CSS contracts', () => {
  it('styles portalled ReactionPicker popovers and coarse-pointer reaction pills', () => {
    const css = readFileSync('src/features/reactions/reactions.css', 'utf8')
    expect(css).toContain('.ui-popover:has(> .pn-emoji--fixed)')
    expect(css).not.toContain('.reaction-picker > .ui-popover')
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.reaction-pill__emoji \{[^}]*height: 100%;/)
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.reaction-pill__emoji \{[^}]*min-width: 32px;/)
  })

  it('styles fixed portalled menus, coarse-pointer touch rows, and narrow-screen submenus', () => {
    const css = readFileSync('src/ui/menu.css', 'utf8')
    expect(css).toMatch(/\.ui-menu--popover\.ui-menu--fixed \{[^}]*position: fixed;/)
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.ui-menu__item \{[^}]*min-height: 36px;/)
    expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.ui-menu--sub \{[^}]*min-width: 160px;/)
  })
})
