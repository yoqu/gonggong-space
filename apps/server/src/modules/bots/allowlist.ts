/** Same command, same entry: `go  build` and `go build` are one prefix. */
export const normalizeAllowlist = (list: string[]) => [
  ...new Set(list.map((s) => s.trim().split(/\s+/).join(' '))),
]
