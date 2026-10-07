/** Runs `sweep` every `everyMs`, skipping a tick while the previous run is in flight; the returned function stops and waits for it. */
export function startSweep(label: string, sweep: () => Promise<unknown>, everyMs: number) {
  let running: Promise<void> | undefined
  const timer = setInterval(() => {
    running ??= sweep()
      .then(
        () => {},
        (err) => console.error(`${label}:`, err),
      )
      .finally(() => {
        running = undefined
      })
  }, everyMs)
  return async () => {
    clearInterval(timer)
    await running
  }
}
