import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatLayout } from '../src/app/ChatLayout'

const layout = (railKind?: 'run' | 'info', body: React.ReactNode = <div />) => (
  <ChatLayout sidebar={<div />} rail={<div />} railOpen railKind={railKind} mobileView="chat">
    {body}
  </ChatLayout>
)
const frame = () => document.querySelector('.chat') as HTMLElement
const railWidth = () => frame().style.getPropertyValue('--rail-width')
const handle = () => screen.getByRole('separator', { name: '调整侧栏宽度' })

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
})
afterEach(() => localStorage.clear())

describe('resizable rail', () => {
  it('starts at the kind default width', () => {
    render(layout())
    expect(railWidth()).toBe('320px')
    expect(handle().getAttribute('aria-valuenow')).toBe('320')
  })

  it('widens when dragged left and remembers the width per kind', () => {
    const { unmount } = render(layout())
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 820, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(railWidth()).toBe('500px')
    unmount()
    const again = render(layout())
    expect(railWidth()).toBe('500px')
    again.unmount()
    render(layout('info'))
    expect(railWidth()).toBe('320px')
  })

  it('clamps between the minimum and 60% of the window', async () => {
    render(layout())
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 1200, pointerId: 1 })
    await waitFor(() => expect(railWidth()).toBe('280px'))
    fireEvent.pointerMove(window, { clientX: 0, pointerId: 1 })
    await waitFor(() => expect(railWidth()).toBe(`${Math.round(1440 * 0.6)}px`))
  })

  it('mutates the container CSS variable per frame without re-rendering children, committing only on release', async () => {
    let renders = 0
    function Probe() {
      renders++
      return <div data-testid="probe" />
    }
    render(layout('run', <Probe />))
    expect(renders).toBe(1)

    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    expect(document.documentElement.dataset.resizing).toBe('')
    expect(frame().dataset.resizing).toBe('')
    fireEvent.pointerMove(window, { clientX: 950, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 900, pointerId: 1 })
    await waitFor(() => expect(railWidth()).toBe('420px'))
    expect(renders).toBe(1)
    expect(localStorage.getItem('gonggong.railWidth.run')).toBeNull()

    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(localStorage.getItem('gonggong.railWidth.run')).toBe('420')
    expect(document.documentElement.dataset.resizing).toBeUndefined()
    expect(frame().dataset.resizing).toBeUndefined()
  })

  it('ends the drag when the pointer is cancelled', () => {
    render(layout())
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerCancel(window, { pointerId: 1 })
    expect(document.documentElement.dataset.resizing).toBeUndefined()
    fireEvent.pointerMove(window, { clientX: 800, pointerId: 1 })
    expect(railWidth()).toBe('320px')
  })

  it('resizes from the keyboard', () => {
    render(layout())
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(railWidth()).toBe('336px')
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(railWidth()).toBe('304px')
  })
})
