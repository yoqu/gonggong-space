import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatLayout } from '../src/app/ChatLayout'

const layout = (railKind?: 'run' | 'info') => (
  <ChatLayout sidebar={<div />} rail={<div />} railOpen railKind={railKind} mobileView="chat">
    <div />
  </ChatLayout>
)
const rail = () => screen.getByRole('complementary', { name: '侧栏' })
const handle = () => screen.getByRole('separator', { name: '调整侧栏宽度' })

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
})
afterEach(() => localStorage.clear())

describe('resizable rail', () => {
  it('starts at the kind default width', () => {
    render(layout())
    expect(rail().style.width).toBe('320px')
    expect(handle().getAttribute('aria-valuenow')).toBe('320')
  })

  it('widens when dragged left and remembers the width per kind', () => {
    const { unmount } = render(layout())
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 820, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(rail().style.width).toBe('500px')
    unmount()
    const again = render(layout())
    expect(rail().style.width).toBe('500px')
    again.unmount()
    render(layout('info'))
    expect(rail().style.width).toBe('320px')
  })

  it('clamps between the minimum and 60% of the window', async () => {
    render(layout())
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 1200, pointerId: 1 })
    await waitFor(() => expect(rail().style.width).toBe('280px'))
    fireEvent.pointerMove(window, { clientX: 0, pointerId: 1 })
    await waitFor(() => expect(rail().style.width).toBe(`${Math.round(1440 * 0.6)}px`))
  })

  it('follows the latest pointer once per frame and stores the width only on release', async () => {
    render(layout())
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    expect(document.documentElement.dataset.resizing).toBe('')
    fireEvent.pointerMove(window, { clientX: 950, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 900, pointerId: 1 })
    await waitFor(() => expect(rail().style.width).toBe('420px'))
    expect(localStorage.getItem('gonggong.railWidth.run')).toBeNull()
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(localStorage.getItem('gonggong.railWidth.run')).toBe('420')
    expect(document.documentElement.dataset.resizing).toBeUndefined()
  })

  it('ends the drag when the pointer is cancelled', () => {
    render(layout())
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerCancel(window, { pointerId: 1 })
    expect(document.documentElement.dataset.resizing).toBeUndefined()
    fireEvent.pointerMove(window, { clientX: 800, pointerId: 1 })
    expect(rail().style.width).toBe('320px')
  })

  it('resizes from the keyboard', () => {
    render(layout())
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(rail().style.width).toBe('336px')
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(rail().style.width).toBe('304px')
  })
})
