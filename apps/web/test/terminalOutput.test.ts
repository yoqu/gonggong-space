import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalOutputWriter } from '../src/features/terminal/output'

const scheduled: Array<() => void> = []
const tick = () => {
  const next = scheduled.shift()
  if (next) next()
}

beforeEach(() => {
  vi.stubGlobal('setTimeout', (callback: () => void) => scheduled.push(callback))
})
afterEach(() => {
  scheduled.length = 0
  vi.unstubAllGlobals()
})

describe('terminal output writer', () => {
  it('coalesces output received in the same task into one bounded write', async () => {
    const write = vi.fn((_data: Uint8Array, callback?: () => void) => callback?.())
    const output = new TerminalOutputWriter({ write }, { maxBatchBytes: 4 })

    output.write(Uint8Array.from([1, 2]))
    output.write(Uint8Array.from([3, 4, 5]))
    expect(write).not.toHaveBeenCalled()
    await tick()
    expect(write).toHaveBeenCalledTimes(1)
    expect(Array.from(write.mock.calls[0]![0])).toEqual([1, 2, 3, 4])
    await tick()
    expect(write).toHaveBeenCalledTimes(2)
    expect(Array.from(write.mock.calls[1]![0])).toEqual([5])
  })

  it('waits for xterm callbacks and preserves every byte across batch boundaries', async () => {
    const writes: Uint8Array[] = []
    const callbacks: Array<() => void> = []
    const output = new TerminalOutputWriter(
      {
        write(data, callback) {
          writes.push(Uint8Array.from(data))
          callbacks.push(callback!)
        },
      },
      { maxBatchBytes: 7 },
    )
    const expected = Uint8Array.from({ length: 1025 }, (_, i) => (i * 31) % 256)

    for (let offset = 0; offset < expected.length; offset += 13) {
      output.write(expected.subarray(offset, Math.min(offset + 13, expected.length)))
    }
    await tick()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toHaveLength(7)
    while (callbacks.length) {
      const count = writes.length
      callbacks.shift()!()
      expect(writes).toHaveLength(count)
      await tick()
      expect(writes.length - count).toBeLessThanOrEqual(1)
    }

    expect(writes.every((data) => data.length <= 7)).toBe(true)
    expect(Buffer.concat(writes)).toEqual(Buffer.from(expected))
    expect(output.bufferedBytes).toBe(0)
  })

  it('signals pressure at a byte threshold without discarding excess output', async () => {
    const pressure = vi.fn()
    let written = 0
    const callbacks: Array<() => void> = []
    const output = new TerminalOutputWriter(
      {
        write(data, callback) {
          written += data.byteLength
          callbacks.push(callback!)
        },
      },
      { maxBatchBytes: 8, maxBufferedBytes: 12, onPressureChange: pressure },
    )

    output.write(new Uint8Array(12))
    output.write(new Uint8Array(12))
    expect(pressure).toHaveBeenLastCalledWith(true)
    await tick()
    expect(output.bufferedBytes).toBe(16)
    callbacks.shift()?.()
    await tick()
    expect(pressure).toHaveBeenLastCalledWith(true)
    expect(output.bufferedBytes).toBe(8)
    callbacks.shift()?.()
    await tick()
    expect(output.bufferedBytes).toBe(0)
    callbacks.shift()?.()
    expect(written).toBe(24)
    await tick()
    expect(scheduled).toHaveLength(0)
    expect(pressure).toHaveBeenLastCalledWith(false)
    expect(pressure.mock.calls.map(([value]) => value)).toEqual([true, false])
  })

  it('yields between batches even when the writer calls back synchronously', async () => {
    const write = vi.fn((_data: Uint8Array, callback?: () => void) => callback?.())
    const output = new TerminalOutputWriter({ write }, { maxBatchBytes: 1 })

    output.write(new Uint8Array(128))
    await tick()
    expect(write).toHaveBeenCalledTimes(1)
    for (let i = 1; i < 128; i++) await tick()
    expect(write).toHaveBeenCalledTimes(128)
    expect(output.bufferedBytes).toBe(0)
  })

  it('preserves output that arrives before the previous write callback', async () => {
    const writes: Uint8Array[] = []
    const callbacks: Array<() => void> = []
    const output = new TerminalOutputWriter({
      write(data, callback) {
        writes.push(Uint8Array.from(data))
        callbacks.push(callback!)
      },
    })
    output.write(Uint8Array.from([1, 2]))
    await tick()
    output.write(Uint8Array.from([3, 4]))
    await tick()
    expect(writes).toHaveLength(1)
    callbacks.shift()?.()
    await tick()
    callbacks.shift()?.()
    await tick()
    expect(writes.map((data) => Array.from(data))).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('cancels scheduled writes on dispose', async () => {
    const write = vi.fn()
    const output = new TerminalOutputWriter({ write })
    output.write(new Uint8Array([1, 2, 3]))
    output.dispose()
    await tick()
    expect(write).not.toHaveBeenCalled()
    expect(output.bufferedBytes).toBe(0)
  })
})
