import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// jsdom reports en-US; the suite asserts the default Chinese texts.
localStorage.setItem('gg.locale', 'zh')

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
