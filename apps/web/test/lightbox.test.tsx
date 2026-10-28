import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
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
