// Free of zod, so clients that only compare versions (the desktop app) don't bundle it.

/** Orders dotted numeric versions ("0.10.1" > "0.9"); pre-release / build suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (v.split(/[-+]/)[0] ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}
