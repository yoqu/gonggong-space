import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BotDto, RunDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingChat, ShowFloatingChat } from '../src/app/floatingChat'
import { useWorkspace } from '../src/app/workspace'
import { useCanvasChat } from '../src/features/artifacts/chatRoot'
import { ComposerDock, type ComposerHud } from '../src/features/chat/ComposerDock'

const makeRun = (o: Partial<RunDto> = {}): RunDto =>
  ({
    id: 'r1',
    botId: 'b1',
    status: 'running',
    step: '',
    approvals: [],
    questions: [],
    ...o,
  }) as RunDto

const dock = (floating: boolean, hud?: ComposerHud | null, onShowChat?: () => void) => (
  <FloatingChat.Provider value={floating}>
    <ShowFloatingChat.Provider value={floating ? (onShowChat ?? null) : null}>
      <ComposerDock hud={hud}>
        <textarea aria-label="输入" />
      </ComposerDock>
    </ShowFloatingChat.Provider>
  </FloatingChat.Provider>
)

beforeEach(() => {
  localStorage.clear()
  useCanvasChat.setState({ byGroup: {} })
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '共字君' } as BotDto, { id: 'b2', name: 'gemini大师' } as BotDto],
  })
})

describe('composer dock', () => {
  it("does not float the group's composer over a canvas in front, which has its own (画布 AI 对话)", () => {
    useCanvasChat.setState({ byGroup: { g1: { artifactId: 'a1', rootId: 'root1' } } })
    const at = (floating: boolean) => (
      <FloatingChat.Provider value={floating}>
        <ComposerDock groupId="g1">
          <textarea aria-label="输入" />
        </ComposerDock>
      </FloatingChat.Provider>
    )
    const { rerender } = render(at(true))
    expect(screen.queryByRole('textbox', { name: '输入' })).toBeNull()
    rerender(at(false))
    expect(screen.getByRole('textbox', { name: '输入' })).toBeTruthy()
  })

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
      expect(hud.textContent).toContain('已发送')
      expect(hud.textContent).not.toContain('触发测试构建')
      expect(hud.getAttribute('title')).toContain('@共字君 触发测试构建')

      act(() => {
        vi.advanceTimersByTime(5100)
      })
      expect(screen.queryByTestId('cdock-hud')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a compact working animation without printing long process text when a bot is running', () => {
    const onShowChat = vi.fn()
    const onLocate = vi.fn()
    const longStep =
      'cd /Users/yoqu/Documents/code/self/ai-chat-master/.claude/worktrees/agent-aef1c6ecc77b237fd/apps/web && pnpm test'
    const active = makeRun({ id: 'r1', botId: 'b1', status: 'running', step: longStep })
    render(
      <FloatingChat.Provider value={true}>
        <ShowFloatingChat.Provider value={onShowChat}>
          <ComposerDock runs={[active]} onLocate={onLocate}>
            <textarea aria-label="输入" />
          </ComposerDock>
        </ShowFloatingChat.Provider>
      </FloatingChat.Provider>,
    )
    const hud = screen.getByTestId('cdock-hud')
    expect(hud.dataset.tone).toBe('running')
    expect(hud.textContent).toBe('共字君')
    expect(hud.textContent).not.toContain('cd /Users')
    expect(hud.textContent).not.toContain('展开聊天')
    expect(hud.getAttribute('aria-label')).toContain('展开聊天')
    const anim = screen.getByTestId('cdock-hud-anim')
    expect(anim.querySelectorAll('i')).toHaveLength(3)

    fireEvent.click(hud)
    expect(onLocate).toHaveBeenCalledWith(active)
    expect(onShowChat).toHaveBeenCalledTimes(1)
  })

  it('summarizes multiple active runs compactly and prefers a running bot over queued ones', () => {
    const queued = makeRun({ id: 'r1', botId: 'b2', status: 'queued' })
    const running = makeRun({ id: 'r2', botId: 'b1', status: 'running', step: 'long shell command' })
    render(
      <FloatingChat.Provider value={true}>
        <ShowFloatingChat.Provider value={vi.fn()}>
          <ComposerDock runs={[queued, running]}>
            <textarea aria-label="输入" />
          </ComposerDock>
        </ShowFloatingChat.Provider>
      </FloatingChat.Provider>,
    )
    const hud = screen.getByTestId('cdock-hud')
    expect(hud.textContent).toBe('共字君 +1')
    expect(screen.getByTestId('cdock-hud-anim')).toBeTruthy()
  })

  it('keeps approval HUD compact while preserving the full title in the hover tooltip', () => {
    const onLocate = vi.fn()
    const approval = {
      id: 'ap1',
      status: 'pending',
      title: '执行非常长的命令 pnpm --filter @gonggong/server db:migrate',
    }
    const waiting = makeRun({
      id: 'r1',
      botId: 'b1',
      status: 'awaiting_approval',
      approvals: [approval as RunDto['approvals'][number]],
    })
    render(
      <FloatingChat.Provider value={true}>
        <ShowFloatingChat.Provider value={vi.fn()}>
          <ComposerDock runs={[waiting]} onLocate={onLocate}>
            <textarea aria-label="输入" />
          </ComposerDock>
        </ShowFloatingChat.Provider>
      </FloatingChat.Provider>,
    )
    const hud = screen.getByTestId('cdock-hud')
    expect(hud.dataset.tone).toBe('attention')
    expect(hud.textContent).toBe('共字君 · 待审批')
    expect(hud.getAttribute('title')).toContain('执行非常长的命令')
    expect(screen.queryByTestId('cdock-hud-anim')).toBeNull()

    fireEvent.click(hud)
    expect(onLocate).toHaveBeenCalledWith(waiting, 'ap1')
  })

  it('keeps HUD max-width compact and respects prefers-reduced-motion in CSS', () => {
    const css = readFileSync(resolve(__dirname, '../src/features/chat/composer-dock.css'), 'utf8')
    expect(css).not.toContain('640px')
    expect(css).toContain('max-width: min(240px, 100%)')
    expect(css).toContain('.cdock__hud-wave')
    expect(css).toContain('@keyframes cdock-hud-wave')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain('.cdock[data-dragging] .cdock__hud-pos')
  })

  it('sets data-dragging on .cdock while dragging the orb so the HUD tracks 1:1 with zero transition lag', () => {
    localStorage.setItem('gg.composerDock.hidden', '1')
    const { container } = render(dock(true, { tone: 'running', text: '共字君' }))
    const root = container.querySelector('.cdock') as HTMLElement
    const orb = screen.getByRole('button', { name: '展开输入框' })
    expect(root.hasAttribute('data-dragging')).toBe(false)

    fireEvent.pointerDown(orb, { pointerId: 1, clientX: 400, clientY: 500 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 350, clientY: 460 })
    expect(root.hasAttribute('data-dragging')).toBe(true)

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 350, clientY: 460 })
    expect(root.hasAttribute('data-dragging')).toBe(false)
  })

  it('keeps ⌘J toggle 100% interruptible mid-flight using pure compositor animations (no width/height)', () => {
    type Frame = Record<string, string | number>
    const anims: { el: Element; frames: Frame[]; cancel: ReturnType<typeof vi.fn>; finish: () => void }[] = []
    document.documentElement.style.setProperty('--spring-smooth', '379ms linear(0, 1)')
    document.documentElement.style.setProperty('--spring-bouncy', '340ms linear(0, 1)')
    const prevAnimate = Element.prototype.animate
    const prevGetAnims = Element.prototype.getAnimations
    Element.prototype.animate = function (
      this: Element,
      frames: Keyframe[] | PropertyIndexedKeyframes | null,
    ) {
      const cancel = vi.fn()
      const rec = {
        el: this,
        frames: (Array.isArray(frames) ? frames : []) as Frame[],
        cancel,
        finish() {
          anim.onfinish?.(new Event('finish') as AnimationPlaybackEvent)
        },
      }
      const anim = {
        playState: 'running',
        onfinish: null as ((ev: AnimationPlaybackEvent) => void) | null,
        cancel,
      } as unknown as Animation
      anims.push(rec)
      return anim
    }
    Element.prototype.getAnimations = () => []
    try {
      const { container } = render(dock(true))
      const root = container.querySelector('.cdock') as HTMLElement
      expect(root.dataset.phase).toBe('open')

      // Start closing via ⌘J.
      fireEvent.keyDown(window, { key: 'j', metaKey: true })
      expect(root.dataset.phase).toBe('closing')
      const shellClose = anims.find((a) => a.el.classList.contains('cdock__shell'))!
      expect(shellClose).toBeTruthy()
      for (const f of shellClose.frames) {
        expect(f).not.toHaveProperty('width')
        expect(f).not.toHaveProperty('height')
        expect(f).toHaveProperty('transform')
        expect(f).toHaveProperty('clipPath')
      }

      // Interrupt mid-close with ⌘J -> immediately reverses to opening without waiting for close to finish.
      fireEvent.keyDown(window, { key: 'j', metaKey: true })
      expect(root.dataset.phase).toBe('opening')
      expect(shellClose.cancel).toHaveBeenCalled()

      // Interrupt mid-open with ⌘J -> reverses back to closing.
      const shellOpen = [...anims].reverse().find((a) => a.el.classList.contains('cdock__shell'))!
      fireEvent.keyDown(window, { key: 'j', metaKey: true })
      expect(root.dataset.phase).toBe('closing')
      expect(shellOpen.cancel).toHaveBeenCalled()

      // Finish closing cleanly.
      const finalClose = [...anims].reverse().find((a) => a.el.classList.contains('cdock__shell'))!
      act(() => finalClose.finish())
      expect(root.dataset.phase).toBe('closed')
    } finally {
      Element.prototype.animate = prevAnimate
      Element.prototype.getAnimations = prevGetAnims
      document.documentElement.removeAttribute('style')
    }
  })

  it('snapshots live computed transform, clipPath and opacity=0 BEFORE cancelling the interrupted animation', () => {
    type Frame = Record<string, string | number>
    const anims: { el: Element; frames: Frame[]; cancel: ReturnType<typeof vi.fn> }[] = []
    document.documentElement.style.setProperty('--spring-smooth', '379ms linear(0, 1)')
    document.documentElement.style.setProperty('--spring-bouncy', '340ms linear(0, 1)')
    const prevAnimate = Element.prototype.animate
    const prevGetAnims = Element.prototype.getAnimations
    const liveState = new WeakMap<Element, { transform: string; clipPath: string; opacity: string }>()

    Element.prototype.animate = function (
      this: Element,
      frames: Keyframe[] | PropertyIndexedKeyframes | null,
    ) {
      if (this.classList.contains('cdock__shell')) {
        liveState.set(this, {
          transform: 'matrix(1, 0, 0, 1, 120, -40)',
          clipPath: 'inset(24px 80px 0px 80px round 22px)',
          opacity: '1',
        })
      } else if (this.classList.contains('cdock__body')) {
        liveState.set(this, { transform: 'scale(0.98)', clipPath: 'none', opacity: '0' })
      }
      const el = this
      const cancel = vi.fn(() => {
        // Real browser live CSSStyleDeclaration immediately reverts animated values once cancel() runs.
        liveState.set(el, { transform: 'none', clipPath: 'none', opacity: '1' })
      })
      const rec = { el, frames: (Array.isArray(frames) ? frames : []) as Frame[], cancel }
      anims.push(rec)
      return { playState: 'running', onfinish: null, cancel } as unknown as Animation
    }
    Element.prototype.getAnimations = () => []

    const realGetComputedStyle = window.getComputedStyle.bind(window)
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const base = realGetComputedStyle(el)
      return new Proxy(base, {
        get(target, prop) {
          const cur = liveState.get(el)
          if (cur && (prop === 'transform' || prop === 'clipPath' || prop === 'opacity')) return cur[prop]
          const val = Reflect.get(target, prop, target)
          return typeof val === 'function' ? val.bind(target) : val
        },
      })
    })

    try {
      render(dock(true))
      // Start closing via ⌘J.
      fireEvent.keyDown(window, { key: 'j', metaKey: true })
      // Interrupt mid-close -> opening must start from the mid-flight matrix & inset, NOT 'none' / orbFrame!
      fireEvent.keyDown(window, { key: 'j', metaKey: true })
      const openShell = [...anims].reverse().find((a) => a.el.classList.contains('cdock__shell'))!
      expect(openShell.frames[0]).toEqual({
        transform: 'matrix(1, 0, 0, 1, 120, -40)',
        clipPath: 'inset(24px 80px 0px 80px round 22px)',
      })

      // Interrupt mid-open while body opacity is '0' -> closing must preserve opacity 0 (NOT coerce to 1).
      fireEvent.keyDown(window, { key: 'j', metaKey: true })
      const closeBody = [...anims].reverse().find((a) => a.el.classList.contains('cdock__body'))!
      expect(closeBody.frames[0]?.opacity).toBe(0)
    } finally {
      styleSpy.mockRestore()
      Element.prototype.animate = prevAnimate
      Element.prototype.getAnimations = prevGetAnims
      document.documentElement.removeAttribute('style')
    }
  })
})
