import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingChat, ShowFloatingChat } from '../src/app/floatingChat'
import { ComposerDock, type ComposerHud } from '../src/features/chat/ComposerDock'

const dock = (floating: boolean, hud?: ComposerHud | null, onShowChat?: () => void) => (
  <FloatingChat.Provider value={floating}>
    <ShowFloatingChat.Provider value={floating ? (onShowChat ?? null) : null}>
      <ComposerDock hud={hud}>
        <textarea aria-label="输入" />
      </ComposerDock>
    </ShowFloatingChat.Provider>
  </FloatingChat.Provider>
)

beforeEach(() => localStorage.clear())

describe('composer dock', () => {
  it('stays in the chat column with no controls when not floating', () => {
    render(dock(false))
    expect(screen.getByRole('textbox', { name: '输入' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '收起输入框' })).toBeNull()
  })

  it('floats, hides into the orb via explicit pill or top grip, and grows back with ⌘J', () => {
    const { rerender, unmount } = render(dock(true))
    const box = screen.getByRole('textbox', { name: '输入' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '草稿' } })
    const hideBtn = screen.getByRole('button', { name: '收起输入框' })
    expect(hideBtn.textContent).toContain('收起')
    fireEvent.click(hideBtn)
    expect(screen.getByRole('button', { name: '展开输入框' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '输入' })).toBeNull()
    expect(localStorage.getItem('gg.composerDock.hidden')).toBe('1')
    fireEvent.keyDown(window, { key: 'j', metaKey: true })
    expect(screen.queryByRole('button', { name: '展开输入框' })).toBeNull()
    // The same composer instance: the draft survived.
    expect((screen.getByRole('textbox', { name: '输入' }) as HTMLTextAreaElement).value).toBe('草稿')
    // Top grabber bar also collapses the dock.
    fireEvent.click(screen.getByTestId('cdock-grip'))
    expect(screen.getByRole('button', { name: '展开输入框' })).toBeTruthy()
    // Leaving 全屏 puts it back in the chat, whatever the floating state.
    rerender(dock(false))
    expect(screen.getByRole('textbox', { name: '输入' })).toBeTruthy()
    unmount()
    render(dock(true))
    expect(screen.getByRole('button', { name: '展开输入框' })).toBeTruthy()
  })

  it('drags the orb and snaps to the nearest edge (left / right / bottom), persisting orbPos', () => {
    localStorage.setItem('gg.composerDock.hidden', '1')
    render(dock(true))
    const orb = screen.getByRole('button', { name: '展开输入框' })

    // Drag strongly to the left edge and release: should snap to 'left' and stay closed.
    fireEvent.pointerDown(orb, { pointerId: 1, clientX: 400, clientY: 500 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 320 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 320 })
    fireEvent.click(orb)

    expect(screen.getByRole('button', { name: '展开输入框' })).toBeTruthy()
    const savedLeft = JSON.parse(localStorage.getItem('gg.composerDock.orbPos') ?? 'null')
    expect(savedLeft?.edge).toBe('left')

    // Drag to the right edge and release: should snap to 'right'.
    fireEvent.pointerDown(orb, { pointerId: 2, clientX: 60, clientY: 320 })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 960, clientY: 300 })
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 960, clientY: 300 })
    const savedRight = JSON.parse(localStorage.getItem('gg.composerDock.orbPos') ?? 'null')
    expect(savedRight?.edge).toBe('right')

    // Drag down toward the bottom center and release: should snap to 'bottom'.
    fireEvent.pointerDown(orb, { pointerId: 3, clientX: 960, clientY: 300 })
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 512, clientY: 495 })
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 512, clientY: 495 })
    const savedBottom = JSON.parse(localStorage.getItem('gg.composerDock.orbPos') ?? 'null')
    expect(savedBottom?.edge).toBe('bottom')

    // Click without dragging (< 5px): expands the dock back to bottom-center.
    fireEvent.pointerDown(orb, { pointerId: 4, clientX: 512, clientY: 495 })
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 513, clientY: 495 })
    fireEvent.click(orb)
    expect(screen.getByRole('textbox', { name: '输入' })).toBeTruthy()
  })

  it('renders the floating capsule HUD above the dock and expands chat on click', () => {
    const onShowChat = vi.fn()
    const { rerender } = render(
      dock(
        true,
        {
          tone: 'running',
          text: '已发送「帮我优化登录页」 · 共字君 思考中',
        },
        onShowChat,
      ),
    )
    const hud = screen.getByTestId('cdock-hud')
    expect(hud.textContent).toContain('已发送「帮我优化登录页」 · 共字君 思考中')
    fireEvent.click(hud)
    expect(onShowChat).toHaveBeenCalledTimes(1)

    // Not shown when not floating.
    rerender(
      dock(
        false,
        {
          tone: 'running',
          text: '已发送「帮我优化登录页」 · 共字君 思考中',
        },
        onShowChat,
      ),
    )
    expect(screen.queryByTestId('cdock-hud')).toBeNull()
  })

  it('pins the HUD beside an orb snapped to the top-right corner, on a layer apart from its enter animation', () => {
    localStorage.setItem('gg.composerDock.hidden', '1')
    localStorage.setItem('gg.composerDock.orbPos', JSON.stringify({ edge: 'right', ratio: 0 }))
    const w = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    const h = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
    try {
      render(dock(true, { tone: 'running', text: '共字君：思考中' }))
      const hud = screen.getByTestId('cdock-hud')
      const pos = hud.parentElement as HTMLElement
      expect(pos.className).toBe('cdock__hud-pos')
      // jsdom 1024 x 768: dock 976 x 736, orb at (466, -692) → HUD right-aligned and dropped below the orb.
      expect(pos.style.transform).toBe(`translate3d(338px, ${-692 + 44 + 16 + 30}px, 0)`)
      expect(hud.style.transform).toBe('')
    } finally {
      w.mockRestore()
      h.mockRestore()
    }
  })

  it('auto-shows HUD when a message is sent while floating and fades out after 5s', () => {
    vi.useFakeTimers()
    try {
      const onShowChat = vi.fn()
      const { rerender } = render(
        <FloatingChat.Provider value={true}>
          <ShowFloatingChat.Provider value={onShowChat}>
            <ComposerDock
              messages={[
                {
                  id: 'm1',
                  kind: 'user',
                  authorName: '姜维川',
                  body: '看一下构建状态',
                },
              ]}
            >
              <textarea aria-label="输入" />
            </ComposerDock>
          </ShowFloatingChat.Provider>
        </FloatingChat.Provider>,
      )
      // Simulate sending a new message while floating
      rerender(
        <FloatingChat.Provider value={true}>
          <ShowFloatingChat.Provider value={onShowChat}>
            <ComposerDock
              messages={[
                {
                  id: 'm1',
                  kind: 'user',
                  authorName: '姜维川',
                  body: '看一下构建状态',
                },
                {
                  id: 'm2',
                  kind: 'user',
                  authorName: '姜维川',
                  body: '@共字君 触发测试构建',
                },
              ]}
            >
              <textarea aria-label="输入" />
            </ComposerDock>
          </ShowFloatingChat.Provider>
        </FloatingChat.Provider>,
      )
      const hud = screen.getByTestId('cdock-hud')
      expect(hud.textContent).toContain('@共字君 触发测试构建')

      act(() => {
        vi.advanceTimersByTime(5100)
      })
      expect(screen.queryByTestId('cdock-hud')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
