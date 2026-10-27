export interface TerminalWriteTarget {
  write(data: Uint8Array, callback?: () => void): void
}

type Options = {
  maxBatchBytes?: number
  maxBufferedBytes?: number
  onPressureChange?: (paused: boolean) => void
}

/**
 * Coalesces output and applies xterm's write backpressure. Input must not wait
 * for this queue; upstream pause/resume is handled by onPressureChange.
 */
export class TerminalOutputWriter {
  private pending: Uint8Array[] = []
  private bytes = 0
  private writing = false
  private scheduled = false
  private pendingWrite = false
  private disposed = false
  private pressured = false
  private readonly maxBatchBytes: number
  private readonly maxBufferedBytes: number
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly target: TerminalWriteTarget,
    private readonly options: Options = {},
  ) {
    this.maxBatchBytes = options.maxBatchBytes ?? 64 * 1024
    this.maxBufferedBytes = options.maxBufferedBytes ?? 4 * 1024 * 1024
  }

  get bufferedBytes() {
    return this.bytes
  }

  write(data: Uint8Array) {
    if (this.disposed || data.byteLength === 0) return
    this.pending.push(Uint8Array.from(data))
    this.bytes += data.byteLength
    this.updatePressure()
    this.schedule()
  }

  dispose() {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.pending = []
    this.bytes = 0
    this.pressured = false
  }

  private schedule() {
    if (this.scheduled || this.pendingWrite || !this.bytes || this.disposed) return
    this.scheduled = true
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.scheduled = false
      this.flush()
    }, 0)
  }

  private flush() {
    if (this.writing || this.disposed) return
    const batch = this.takeBatch()
    if (!batch) return
    this.writing = true
    this.pendingWrite = true
    let called = false
    this.target.write(batch, () => {
      if (called || this.disposed) return
      called = true
      this.writing = false
      this.pendingWrite = false
      this.updatePressure()
      this.schedule()
    })
  }

  private takeBatch() {
    if (!this.pending.length) return null
    let length = 0
    let count = 0
    while (count < this.pending.length && length < this.maxBatchBytes) {
      const next = this.pending[count]
      if (!next) break
      length += next.byteLength
      count++
    }
    const parts = this.pending.splice(0, count)
    const last = parts.at(-1)
    if (!last) return null
    const overflow = length - this.maxBatchBytes
    if (overflow > 0) {
      const rest = last.subarray(last.byteLength - overflow)
      parts[parts.length - 1] = last.subarray(0, last.byteLength - overflow)
      this.pending.unshift(rest)
      length -= overflow
    }
    this.bytes -= length
    if (parts.length === 1) return parts[0] ?? null
    const batch = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
      batch.set(part, offset)
      offset += part.byteLength
    }
    return batch
  }

  private updatePressure() {
    const pressured = this.pressured
      ? this.bytes > this.maxBufferedBytes / 2
      : this.bytes >= this.maxBufferedBytes
    if (pressured === this.pressured) return
    this.pressured = pressured
    this.options.onPressureChange?.(pressured)
  }
}
