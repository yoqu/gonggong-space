import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageAttachments } from '../src/features/attachments/MessageAttachments'
import { Lightbox } from '../src/ui'

const ITEMS = [
  { src: '/a.png', alt: 'a.png' },
  { src: '/b.png', alt: 'b.png' },
  { src: '/c.png', alt: 'c.png' },
]

function Viewer({ start = 0 }: { start?: number }) {
  const [index, setIndex] = useState(start)
  return <Lightbox items={ITEMS} index={index} onIndexChange={setIndex} onClose={() => {}} />
}

const shown = () => screen.getByRole('dialog').querySelector('.ui-lightbox__img img')?.getAttribute('src')

const scale = () => {
  const img = screen.getByRole('dialog').querySelector('.ui-lightbox__img img') as HTMLElement
  return Number(/scale\(([\d.]+)\)/.exec(img.style.transform)?.[1] ?? 1)
}

const swipe = (dx: number, dy = 0) => {
  const stage = document.querySelector('.ui-lightbox__stage') as HTMLElement
  fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 300 }] })
  fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] })
}

describe('Lightbox', () => {
  it('shows one image without paging controls', () => {
    render(<Lightbox src="/a.png" alt="a.png" onClose={() => {}} />)
    expect(shown()).toBe('/a.png')
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull()
    expect(screen.queryByText('1 / 1')).toBeNull()
  })

  it('pages with the arrow keys and buttons, stopping at both ends', () => {
    render(<Viewer />)
    expect(screen.getByText('1 / 3')).toBeTruthy()
    const prev = screen.getByRole('button', { name: '上一张' }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(shown()).toBe('/b.png')
    expect(screen.getByText('2 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一张' }))
    expect(shown()).toBe('/c.png')
    expect((screen.getByRole('button', { name: '下一张' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(shown()).toBe('/c.png')
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(shown()).toBe('/b.png')
  })

  it('pages with a horizontal swipe, not a vertical or short one, and not while zoomed', () => {
    render(<Viewer start={1} />)
    swipe(-80)
    expect(shown()).toBe('/c.png')
    swipe(80)
    expect(shown()).toBe('/b.png')
    swipe(30)
    swipe(60, 120)
    expect(shown()).toBe('/b.png')
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    swipe(80)
    expect(shown()).toBe('/b.png')
  })

  it('leaves zoom when paging', () => {
    render(<Viewer />)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(scale()).toBeGreaterThan(1)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(scale()).toBe(1)
  })

  it('zooms with the buttons, keys and wheel, and resets to fit', () => {
    render(<Lightbox src="/a.png" alt="a.png" onClose={() => {}} />)
    const out = screen.getByRole('button', { name: '缩小' }) as HTMLButtonElement
    expect(out.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    const once = scale()
    expect(once).toBeGreaterThan(1)
    fireEvent.keyDown(document, { key: '+' })
    expect(scale()).toBeGreaterThan(once)
    fireEvent.keyDown(document, { key: '-' })
    expect(scale()).toBeCloseTo(once)
    fireEvent.wheel(screen.getByRole('dialog'), { deltaY: -200, clientX: 10, clientY: 10 })
    expect(scale()).toBeGreaterThan(once)
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }))
    expect(scale()).toBe(1)
    expect(out.disabled).toBe(true)
  })

  it('pans a zoomed image by dragging', () => {
    render(<Lightbox src="/a.png" alt="a.png" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    const img = screen.getByRole('dialog').querySelector('.ui-lightbox__img img') as HTMLElement
    fireEvent.pointerDown(img, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(img, { pointerId: 1, clientX: 140, clientY: 120 })
    fireEvent.pointerUp(img, { pointerId: 1, clientX: 140, clientY: 120 })
    expect(img.style.transform).toMatch(/translate\(40px, 20px\)/)
  })

  it('gives toolbar buttons a translucent fill so their white text shows on the scrim', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/ui/lightbox.css'), 'utf8')
    const rule = /\.ui-lightbox__bar \.ui-btn \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/background:\s*#ffffff2e/)
    expect(rule).toMatch(/color:\s*#fff/)
  })

  it('pages through the images of a message, leaving its videos out', () => {
    const att = (id: string, name: string, mime: string): Attachment =>
      ({ id, name, mime, size: 1000, messageId: 'm1' }) as Attachment
    render(
      <MessageAttachments
        from="李建国"
        list={[
          att('a1', 'one.png', 'image/png'),
          att('v1', 'clip.mp4', 'video/mp4'),
          att('a2', 'two.png', 'image/png'),
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '查看大图 one.png' }))
    expect(screen.getByText('1 / 2')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    const box = screen.getByRole('dialog', { name: 'two.png' })
    expect(within(box).getByRole('link', { name: '下载' }).getAttribute('href')).toContain('/attachments/a2')
  })
})

describe('Lightbox flight from the thumbnail', () => {
  type Frame = Record<string, string | number>
  let calls: { el: Element; frames: Frame[]; finish: () => void }[] = []
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect
  const stub = (spring: string) => {
    calls = []
    document.documentElement.style.setProperty('--spring-snappy', spring)
    document.documentElement.style.setProperty('--fade-out', '110ms ease-out')
    // jsdom has no Web Animations.
    Element.prototype.animate = function (
      this: Element,
      frames: Keyframe[] | PropertyIndexedKeyframes | null,
    ) {
      let finish = () => {}
      const finished = new Promise<void>((r) => {
        finish = r
      })
      calls.push({ el: this, frames: frames as Frame[], finish })
      return { finished, cancel() {} } as unknown as Animation
    }
    Element.prototype.getAnimations = () => []
  }
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate
    delete (Element.prototype as Partial<Element>).getAnimations
    document.documentElement.removeAttribute('style')
  })
  const thumb = () => {
    const el = document.createElement('button')
    el.getBoundingClientRect = () => rect(10, 500, 100, 50)
    document.body.append(el)
    return el
  }
  const loaded = () => {
    const img = screen.getByRole('dialog').querySelector('.ui-lightbox__img img') as HTMLImageElement
    img.getBoundingClientRect = () => rect(100, 100, 400, 400)
    fireEvent.load(img)
    return img
  }

  it('grows from the thumbnail on opening and shrinks back into it on closing', async () => {
    stub('300ms linear(0, 1)')
    const origin = thumb()
    const onClose = vi.fn()
    render(<Lightbox src="/a.png" alt="a.png" origin={() => origin} onClose={onClose} />)
    const img = loaded()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.el).toBe(img)
    // Cover scale (max of 100/400, 50/400), centres 60,525 → 300,300, cropped to the thumbnail's 2:1.
    expect(calls[0]!.frames[0]).toMatchObject({
      transform: 'translate(-240px, 225px) scale(0.25)',
      clipPath: 'inset(100px 0px round 0px)',
    })
    expect(calls[0]!.frames.at(-1)).toMatchObject({ transform: 'translate(0px, 0px) scale(1)' })

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').hasAttribute('data-closing')).toBe(true)
    expect(calls[1]!.frames.at(-1)).toMatchObject({ transform: 'translate(-240px, 225px) scale(0.25)' })
    calls[1]!.finish()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    origin.remove()
  })

  it('fades out instead when the thumbnail is gone or the image is zoomed', async () => {
    stub('300ms linear(0, 1)')
    const onClose = vi.fn()
    render(<Lightbox src="/a.png" alt="a.png" origin={() => null} onClose={onClose} />)
    loaded()
    expect(calls).toHaveLength(0)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(calls[0]!.el).toBe(screen.getByRole('dialog'))
    expect(calls[0]!.frames.at(-1)).toMatchObject({ opacity: 0 })
    calls[0]!.finish()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('only fades under reduced motion, where the springs are 0s', async () => {
    stub('0s linear')
    const origin = thumb()
    const onClose = vi.fn()
    render(<Lightbox src="/a.png" alt="a.png" origin={() => origin} onClose={onClose} />)
    loaded()
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(calls[0]!.frames.at(-1)).toMatchObject({ opacity: 0 })
    origin.remove()
  })

  it('flies from the tile of a message image', () => {
    stub('300ms linear(0, 1)')
    const tiles = new Set<Element>()
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.matches('.att-tile')) tiles.add(this)
      return rect(10, 10, 100, 100)
    })
    render(
      <MessageAttachments
        from="李建国"
        list={[{ id: 'a1', name: 'one.png', mime: 'image/png', size: 1, messageId: 'm1' } as Attachment]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '查看大图 one.png' }))
    loaded()
    expect(calls).toHaveLength(1)
    expect([...tiles][0]?.querySelector('img')?.getAttribute('alt')).toBe('one.png')
    measure.mockRestore()
  })

  it('eases zoom and pan with a motion token, so reduced motion makes them instant', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/ui/lightbox.css'), 'utf8')
    expect(css).toMatch(/transition: transform var\(--spring-interactive\)/)
  })
})
