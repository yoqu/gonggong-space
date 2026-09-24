import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTheme, initTheme, resolveTheme, setTheme, THEME_STORAGE_KEY } from '../src/app/theme'

type ChangeListener = (event: { matches: boolean }) => void

let systemDark = false
let changeListeners: Set<ChangeListener> = new Set()

const installMatchMedia = () => {
  changeListeners = new Set()
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return systemDark
    },
    onchange: null,
    addEventListener: (_: string, cb: ChangeListener) => changeListeners.add(cb),
    removeEventListener: (_: string, cb: ChangeListener) => changeListeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const setSystemDark = (dark: boolean) => {
  systemDark = dark
  for (const cb of changeListeners) cb({ matches: dark })
}

beforeEach(() => {
  systemDark = false
  installMatchMedia()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  // detach any system-mode listener the module installed, then reset DOM state
  setTheme('light')
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme defaults', () => {
  it('defaults to light when nothing is stored', () => {
    expect(getTheme()).toBe('light')
    expect(resolveTheme()).toBe('light')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('stays light on first visit even when the OS prefers dark', () => {
    systemDark = true
    expect(resolveTheme()).toBe('light')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('setTheme', () => {
  it('persists the preference and updates data-theme', () => {
    setTheme('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(getTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setTheme('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('sanitizes an invalid runtime value back to light', () => {
    setTheme('neon' as Parameters<typeof setTheme>[0])
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('system mode', () => {
  it('resolves from the media query and follows its changes', () => {
    systemDark = true
    setTheme('system')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setSystemDark(false)
    expect(document.documentElement.dataset.theme).toBe('light')

    setSystemDark(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('ignores media query changes once an explicit theme is chosen', () => {
    setTheme('system')
    setTheme('dark')
    setSystemDark(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('initTheme wires the stored system preference to live updates', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    systemDark = true
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    setSystemDark(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('resolveTheme maps an explicit system preference through the media query', () => {
    expect(resolveTheme('system')).toBe('light')
    systemDark = true
    expect(resolveTheme('system')).toBe('dark')
    expect(resolveTheme('dark')).toBe('dark')
  })
})

describe('invalid stored values', () => {
  it('falls back to light', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(getTheme()).toBe('light')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('view transition', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('cross-fades through document.startViewTransition when available', () => {
    const start = vi.fn((update: () => void) => update())
    Object.assign(document, { startViewTransition: start })
    setTheme('dark')
    expect(start).toHaveBeenCalledOnce()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('skips the transition under reduced motion', () => {
    systemDark = true // the stub answers every media query, including prefers-reduced-motion
    const start = vi.fn()
    Object.assign(document, { startViewTransition: start })
    setTheme('dark')
    expect(start).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('applies synchronously without the API', () => {
    setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
