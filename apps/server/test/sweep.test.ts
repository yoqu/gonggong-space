import { describe, expect, it } from 'vitest'
import { startSweep } from '../src/lib/sweep.js'

describe('startSweep', () => {
  it('skips ticks during a slow sweep and stop waits for the one in flight', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((ok) => {
      release = ok
    })
    const stop = startSweep(
      'test',
      async () => {
        calls++
        active++
        peak = Math.max(peak, active)
        await gate
        active--
      },
      5,
    )
    await new Promise((ok) => setTimeout(ok, 40))
    expect(calls).toBe(1)
    let stopped = false
    const done = stop().then(() => {
      stopped = true
    })
    await new Promise((ok) => setTimeout(ok, 10))
    expect(stopped).toBe(false)
    release()
    await done
    expect(peak).toBe(1)
    expect(calls, 'ticks during a slow sweep are skipped, not queued').toBe(1)
  })

  it('keeps sweeping after a failure', async () => {
    let calls = 0
    const stop = startSweep(
      'test',
      async () => {
        calls++
        throw new Error('boom')
      },
      5,
    )
    await expect.poll(() => calls).toBeGreaterThan(1)
    await stop()
  })
})
