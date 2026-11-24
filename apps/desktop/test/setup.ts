import { afterEach } from 'vitest'

// jsdom reports en-US; the suite asserts the default Chinese texts.
localStorage.setItem('gg.locale', 'zh')

// jsdom has no AnimationEvent, which makes React listen for `webkitAnimationEnd`; define it before react-dom loads.
if (!('AnimationEvent' in window)) Object.assign(window, { AnimationEvent: Event })
const { cleanup, configure } = await import('@testing-library/react')

afterEach(cleanup)

// RunDetail loads lazily: a cold module import on a slow CI runner outlasts the 1s default.
configure({ asyncUtilTimeout: 5000 })

// jsdom lacks ResizeObserver; the shared Tabs re-measures its indicator with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Nor IntersectionObserver, used by the shell's scroll edge.
globalThis.IntersectionObserver ??= class {
  root = null
  rootMargin = ''
  thresholds = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
} as unknown as typeof IntersectionObserver
