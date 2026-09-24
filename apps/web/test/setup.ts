import { afterEach } from 'vitest'

// jsdom has no AnimationEvent, which makes React listen for `webkitAnimationEnd`; define it before react-dom loads.
if (!('AnimationEvent' in window)) Object.assign(window, { AnimationEvent: Event })
const { cleanup } = await import('@testing-library/react')

afterEach(cleanup)
