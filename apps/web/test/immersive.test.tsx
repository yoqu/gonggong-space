import { act, fireEvent, render, within } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useImmersive } from '../src/features/chat/immersive'

function Harness({ enabled = true }: { enabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [on, exit] = useImmersive(box, enabled)
  return (
    <>
      <div ref={box} data-testid="box" />
      <button type="button" data-on={on} onClick={exit}>
        foot
      </button>
    </>
  )
}

function setup(enabled = true, size = { scrollHeight: 2000, clientHeight: 600, scrollTop: 0 }) {
  const view = within(render(<Harness enabled={enabled} />).container)
  const box = view.getByTestId('box')
  for (const [k, v] of Object.entries(size))
    Object.defineProperty(box, k, { configurable: true, writable: true, value: v })
  const on = () => view.getByRole('button').dataset.on === 'true'
  const swipe = (dy: number) => {
    fireEvent.touchStart(box, { touches: [{ clientY: 300 }] })
    fireEvent.touchMove(box, { touches: [{ clientY: 300 + dy }] })
  }
  return { box, on, swipe, view }
}

describe('immersive reading on phones', () => {
  it('hides the extras once the finger moves the list either way, not on a tap-sized wiggle', () => {
    const { box, on, swipe } = setup()
    swipe(10)
    expect(on()).toBe(false)
    swipe(40)
    expect(on()).toBe(true)
    fireEvent.touchEnd(box)
    expect(on()).toBe(true)
    swipe(-40)
    expect(on()).toBe(true)
  })

  it('brings them back at the bottom once the finger is up, or when the foot is tapped', () => {
    const { box, on, swipe, view } = setup()
    swipe(-40)
    Object.defineProperty(box, 'scrollTop', { configurable: true, writable: true, value: 1400 })
    fireEvent.scroll(box)
    expect(on()).toBe(true)
    fireEvent.touchEnd(box)
    expect(on()).toBe(false)

    Object.defineProperty(box, 'scrollTop', { configurable: true, writable: true, value: 0 })
    swipe(40)
    fireEvent.touchEnd(box)
    expect(on()).toBe(true)
    act(() => view.getByRole('button').click())
    expect(on()).toBe(false)
  })

  it('stays off on desktop, for a list that fits, and while typing', () => {
    expect(
      (() => {
        const s = setup(false)
        s.swipe(60)
        return s.on()
      })(),
    ).toBe(false)
    const short = setup(true, { scrollHeight: 500, clientHeight: 600, scrollTop: 0 })
    short.swipe(60)
    expect(short.on()).toBe(false)

    const typing = setup()
    const input = document.createElement('textarea')
    document.body.append(input)
    input.focus()
    typing.swipe(60)
    expect(typing.on()).toBe(false)
    input.remove()
  })
})
