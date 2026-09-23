import { useSyncExternalStore } from 'react'

export const MOBILE_MAX = 768
export const RAIL_MIN = 1100

const subscribe = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

export const useViewportWidth = () => useSyncExternalStore(subscribe, () => window.innerWidth)
export const useIsMobile = () => useViewportWidth() < MOBILE_MAX
