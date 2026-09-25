import { type AnimationEvent, useEffect, useState } from 'react'
import './motion.css'

export type PresenceState = 'open' | 'closed'

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Keeps a closing element mounted with `state: 'closed'` until its own exit animation ends
 * (attach `onAnimationEnd`), or after `timeout` ms in case no animation runs.
 */
export function usePresence(open: boolean, { timeout = 300 }: { timeout?: number } = {}) {
  const [prev, setPrev] = useState(open)
  const [leaving, setLeaving] = useState(false)
  if (prev !== open) {
    setPrev(open)
    setLeaving(!open && !reducedMotion())
  }
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLeaving(false), timeout)
    return () => clearTimeout(timer)
  }, [leaving, timeout])
  return {
    mounted: open || leaving,
    state: (open ? 'open' : 'closed') as PresenceState,
    onAnimationEnd: (e: AnimationEvent) => {
      if (!open && e.target === e.currentTarget) setLeaving(false)
    },
  }
}
