import { type AnimationEvent, useCallback, useEffect, useState } from 'react'
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

/**
 * List rows that leave with an exit animation: `leave(id, gone)` marks the row (render `data-leaving`), then calls
 * `gone` to drop it after `timeout` ms; at once under reduced motion.
 */
export function useLeaving(timeout = 220) {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  const leave = useCallback(
    (id: string, gone: () => void) => {
      if (reducedMotion()) return gone()
      setLeaving((s) => new Set(s).add(id))
      setTimeout(() => {
        setLeaving((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        })
        gone()
      }, timeout)
    },
    [timeout],
  )
  return { leaving, leave }
}
