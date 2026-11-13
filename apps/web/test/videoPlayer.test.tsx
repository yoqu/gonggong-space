import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageAttachments } from '../src/features/attachments/MessageAttachments'
import { VideoPlayer } from '../src/ui'

let play: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.removeItem('gg.video')
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true })
    this.dispatchEvent(new Event('pause'))
  })
})
afterEach(() => vi.restoreAllMocks())

const load = (v: HTMLVideoElement, duration = 120) => {
  Object.defineProperty(v, 'duration', { configurable: true, value: duration })
  fireEvent.loadedMetadata(v)
}

describe('VideoPlayer', () => {
  it('draws its own controls instead of the browser ones', () => {
    const { container } = render(<VideoPlayer src="/v.mp4" label="v.mp4" />)
    const v = container.querySelector('video') as HTMLVideoElement
    expect(v.controls).toBe(false)
    load(v, 125)
    expect(screen.getByRole('button', { name: '播放 v.mp4' })).toBeTruthy()
    const bar = screen.getByRole('slider', { name: '播放进度' })
    expect(bar.getAttribute('aria-valuetext')).toBe('0:00 / 2:05')
    expect(screen.getByText('2:05')).toBeTruthy()
    expect(screen.getByRole('button', { name: '全屏' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '静音' })).toBeTruthy()
  })

  it('plays and pauses from the big button, the bar and a click on the picture', async () => {
    const onStart = vi.fn()
    const { container } = render(<VideoPlayer src="/v.mp4" label="v.mp4" onStart={onStart} />)
    const v = container.querySelector('video') as HTMLVideoElement
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放 v.mp4' })))
    expect(play).toHaveBeenCalled()
    expect(onStart).toHaveBeenCalledOnce()
    expect(container.querySelector('.ui-video')?.getAttribute('data-playing')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(v.paused).toBe(true)
    await act(async () => fireEvent.click(v))
    expect(v.paused).toBe(false)
  })

  it('seeks, changes volume and speed from the keyboard', async () => {
    const { container } = render(<VideoPlayer src="/v.mp4" />)
    const v = container.querySelector('video') as HTMLVideoElement
    load(v)
    const root = container.querySelector('.ui-video') as HTMLElement
    fireEvent.keyDown(root, { key: 'ArrowRight' })
    expect(v.currentTime).toBe(5)
    fireEvent.keyDown(root, { key: 'l' })
    expect(v.currentTime).toBe(15)
    fireEvent.keyDown(root, { key: 'j' })
    expect(v.currentTime).toBe(5)
    fireEvent.keyDown(root, { key: '5' })
    expect(v.currentTime).toBe(60)
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    expect(v.volume).toBeCloseTo(0.9)
    fireEvent.keyDown(root, { key: 'm' })
    expect(v.muted).toBe(true)
    expect(screen.getByRole('button', { name: '取消静音' })).toBeTruthy()
    await act(async () => fireEvent.keyDown(root, { key: ' ' }))
    expect(play).toHaveBeenCalled()
    fireEvent.keyDown(root, { key: '>' })
    expect(v.playbackRate).toBe(1.25)
  })

  it('picks a speed from its menu and remembers volume across players', () => {
    const { container, unmount } = render(<VideoPlayer src="/v.mp4" />)
    fireEvent.click(screen.getByRole('button', { name: '播放速度' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: '1.5×' }))
    expect((container.querySelector('video') as HTMLVideoElement).playbackRate).toBe(1.5)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.change(screen.getByRole('slider', { name: '音量' }), { target: { value: '0.4' } })
    unmount()
    const again = render(<VideoPlayer src="/w.mp4" />)
    expect((again.container.querySelector('video') as HTMLVideoElement).volume).toBeCloseTo(0.4)
  })

  it('seeks where the progress bar is pressed', () => {
    const { container } = render(<VideoPlayer src="/v.mp4" />)
    const v = container.querySelector('video') as HTMLVideoElement
    load(v, 200)
    const bar = screen.getByRole('slider', { name: '播放进度' })
    bar.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 10 }) as DOMRect
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 })
    expect(v.currentTime).toBe(50)
  })

  it('pauses the other player when one starts', async () => {
    const { container } = render(
      <>
        <VideoPlayer src="/a.mp4" label="a" />
        <VideoPlayer src="/b.mp4" label="b" />
      </>,
    )
    const [a] = container.querySelectorAll('video')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放 a' })))
    expect(a?.paused).toBe(false)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放 b' })))
    expect(a?.paused).toBe(true)
  })

  it('shows a cover until the first play and reports load errors', async () => {
    const onError = vi.fn()
    const { container } = render(
      <VideoPlayer src="/v.mp4" label="v" cover={<span>cover-bar</span>} onError={onError} />,
    )
    expect(screen.getByText('cover-bar')).toBeTruthy()
    expect(screen.queryByRole('slider', { name: '播放进度' })).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放 v' })))
    expect(screen.queryByText('cover-bar')).toBeNull()
    expect(screen.getByRole('slider', { name: '播放进度' })).toBeTruthy()
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)
    expect(onError).toHaveBeenCalled()
  })
})

describe('VideoPlayer in a narrow tile', () => {
  const css = (path: string) => readFileSync(join(import.meta.dirname, '../src', path), 'utf8')

  it('lets a playing video of a multi-media message take the whole row', async () => {
    const att = (id: string, name: string): Attachment =>
      ({ id, name, mime: 'video/mp4', size: 1000, messageId: 'm1' }) as Attachment
    render(<MessageAttachments from="李建国" list={[att('v1', 'a.mp4'), att('v2', 'b.mp4')]} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放 b.mp4' })))
    const tile = screen.getByRole('group', { name: 'b.mp4' }).closest('.att-tile')
    expect(tile?.classList.contains('att-tile--on')).toBe(true)
    const rule = /\.att-media--multi > \.att-tile--on[^{]*\{([^}]*)\}/.exec(
      css('features/attachments/attachments.css'),
    )
    expect(rule?.[1]).toMatch(/grid-column:\s*1 \/ -1/)
  })

  it('sheds controls by the player width, not the viewport, so fullscreen always fits', () => {
    const player = css('ui/video-player.css')
    expect(/\.ui-video \{([^}]*)\}/.exec(player)?.[1]).toMatch(/container-type:\s*inline-size/)
    expect(player).not.toMatch(/@media \(max-width/)
    expect(player).toMatch(/@container \(width < \d+px\)/)
  })
})
