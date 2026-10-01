import { afterEach } from 'vitest'

// jsdom reports en-US; the suite asserts the default Chinese texts.
localStorage.setItem('gg.locale', 'zh')

// jsdom has no AnimationEvent, which makes React listen for `webkitAnimationEnd`; define it before react-dom loads.
if (!('AnimationEvent' in window)) Object.assign(window, { AnimationEvent: Event })
const { cleanup } = await import('@testing-library/react')

afterEach(cleanup)

// jsdom has no layout, so nothing ever resizes.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom has no layout, so nothing ever scrolls under a toolbar.
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver

// Tests pass plain objects as files, which jsdom's object URLs reject.
URL.createObjectURL = () => 'blob:test'
URL.revokeObjectURL = () => {}
