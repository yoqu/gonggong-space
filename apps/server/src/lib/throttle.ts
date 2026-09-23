/** In-memory sliding-window failure counter (P1 runs a single server process). */
export class Throttle {
  private failures = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => Date,
  ) {}

  private recent(key: string) {
    const since = this.now().getTime() - this.windowMs
    const list = (this.failures.get(key) ?? []).filter((t) => t > since)
    if (list.length) this.failures.set(key, list)
    else this.failures.delete(key)
    return list
  }

  blocked(key: string) {
    return this.recent(key).length >= this.limit
  }

  fail(key: string) {
    this.failures.set(key, [...this.recent(key), this.now().getTime()])
  }

  reset(key: string) {
    this.failures.delete(key)
  }
}
