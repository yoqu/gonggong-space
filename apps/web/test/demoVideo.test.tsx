import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoVideo } from '../src/ui'

const SOURCES = {
  light: { src: '/a-light.mp4', poster: '/a-light.webp' },
  dark: { src: '/a-dark.mp4', poster: '/a-dark.webp' },
}

let reduced = false
let seen: ((visible: boolean) => void) | null = null
const play = vi.fn(() => Promise.resolve())
const pause = vi.fn()

beforeEach(() => {
  reduced = false
  seen = null
  play.mockClear()
  pause.mockClear()
  document.documentElement.dataset.theme = 'light'
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') && reduced,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
  globalThis.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      seen = (visible) => cb([{ isIntersecting: visible } as IntersectionObserverEntry], this as never)
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver
  Object.assign(HTMLMediaElement.prototype, { play, pause })
})

afterEach(() => {
  delete document.documentElement.dataset.theme
})

const video = () => document.querySelector('video') as HTMLVideoElement

describe('DemoVideo', () => {
  it('loops muted inline, loading only once on screen and pausing off it', () => {
    render(<DemoVideo sources={SOURCES} label="演示" autoPlay />)
    expect(video().muted).toBe(true)
    expect(video().loop).toBe(true)
    expect(video().hasAttribute('playsinline')).toBe(true)
    expect(video().getAttribute('poster')).toBe('/a-light.webp')
    expect(video().getAttribute('src')).toBeNull()
    act(() => seen?.(true))
    expect(video().getAttribute('src')).toBe('/a-light.mp4')
    expect(play).toHaveBeenCalled()
    act(() => seen?.(false))
    expect(pause).toHaveBeenCalled()
  })

  it('follows the theme', async () => {
    render(<DemoVideo sources={SOURCES} label="演示" autoPlay />)
    act(() => seen?.(true))
    await act(async () => {
      document.documentElement.dataset.theme = 'dark'
    })
    expect(video().getAttribute('src')).toBe('/a-dark.mp4')
    expect(video().getAttribute('poster')).toBe('/a-dark.webp')
  })

  it('waits for a click when not autoplaying', () => {
    render(<DemoVideo sources={SOURCES} label="演示" />)
    act(() => seen?.(true))
    expect(play).not.toHaveBeenCalled()
    expect(video().loop).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '播放演示' }))
    expect(video().getAttribute('src')).toBe('/a-light.mp4')
    expect(play).toHaveBeenCalled()
  })

  it('shows only the poster when motion is reduced', () => {
    reduced = true
    render(<DemoVideo sources={SOURCES} label="演示" autoPlay />)
    expect(video()).toBeNull()
    expect(screen.getByRole('img', { name: '演示' }).getAttribute('src')).toBe('/a-light.webp')
  })
})
