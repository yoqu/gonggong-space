import { type AnimationEvent, useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import './motion.css'

export type PresenceState = 'open' | 'closed'

// `.ui-leaving` runs on --fade-out (110ms), with or without reduced motion; one frame of slack so it ends first.
const LEAVE_TIMEOUT = 130

export const reducedMotion = prefersReducedMotion

/**
 * Keeps a closing element mounted with `state: 'closed'` until its own exit animation ends
 * (attach `onAnimationEnd`), or after `timeout` ms in case no animation runs.
 * Under `prefers-reduced-motion: reduce`, keeps the short opacity fade-out (movement is zeroed in CSS).
 */
export function usePresence(open: boolean, { timeout = 300 }: { timeout?: number } = {}) {
  const [prev, setPrev] = useState(open)
  const [leaving, setLeaving] = useState(false)
  if (prev !== open) {
    setPrev(open)
    setLeaving(!open)
  }
  useEffect(() => {
    if (!leaving) return
    const ms = reducedMotion() ? Math.min(timeout, LEAVE_TIMEOUT) : timeout
    const timer = setTimeout(() => setLeaving(false), ms)
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
 * `gone` to drop it after `timeout` ms (default: as `.ui-leaving` ends, so no blank row lingers).
 */
export function useLeaving(timeout = LEAVE_TIMEOUT) {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  // Pending exits are dropped on unmount: their state updates would land on a gone tree.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
      pending.clear()
    }
  }, [])
  const leave = useCallback(
    (id: string, gone: () => void) => {
      const ms = reducedMotion() ? Math.min(timeout, LEAVE_TIMEOUT) : timeout
      setLeaving((s) => new Set(s).add(id))
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        setLeaving((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        })
        gone()
      }, ms)
      timers.current.add(timer)
    },
    [timeout],
  )
  return { leaving, leave }
}
