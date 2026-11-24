/**
 * App updates (Tauri updater) from the bound server, or GitHub Releases while it hosts none: checked at launch and every
 * 6 hours while 自动升级 is on, or from Settings; a found update downloads in the background and is installed when
 * the user restarts, or by itself while 自动升级 is on once this machine has run no task for a minute. The bundled
 * daemon is stopped right before the relaunch.
 */
import { create } from 'zustand'
import { ipc, type Update } from './ipc'
import { useDaemon } from './store'

const EVERY_MS = 6 * 3600 * 1000
/** How long the machine must stay idle before restarting by itself, so a follow-up message can still start a run. */
const IDLE_MS = 60 * 1000
const IDLE_POLL_MS = 15 * 1000

export type UpdatePhase =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'latest' }
  | { phase: 'downloading'; version: string }
  | { phase: 'ready'; version: string; notes?: string }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; message: string }

export const useUpdate = create<{ state: UpdatePhase; dismissed: boolean; auto: boolean }>()(() => ({
  state: { phase: 'idle' },
  dismissed: false,
  /** 自动升级 is on: a downloaded update is installed by itself once the machine is idle. */
  auto: false,
}))

/** The downloaded update, installed on restart. */
let downloaded: Update | null = null
/** A re-check while an update waits for the restart. */
let refreshing = false

const set = (state: UpdatePhase) => useUpdate.setState({ state })

/** The latest update when it is newer than `than` (the downloaded one), downloaded; null when there is none. */
async function fetchNewer(than?: Update | null) {
  const update = await ipc.checkUpdate()
  if (!update || update.version === than?.version) return null
  await update.download()
  return update
}

function ready(update: Update) {
  downloaded = update
  useUpdate.setState({
    state: { phase: 'ready', version: update.version, notes: update.body?.trim() || undefined },
    dismissed: false,
  })
}

/**
 * Checks once and downloads what it finds. While a downloaded update waits for the restart it keeps checking, so an
 * app left running across several releases restarts straight into the latest instead of one release at a time.
 */
export async function checkForUpdate() {
  const { state } = useUpdate.getState()
  if (state.phase === 'ready') {
    if (refreshing) return
    refreshing = true
    try {
      const update = await fetchNewer(downloaded)
      if (update && useUpdate.getState().state.phase === 'ready') ready(update)
    } catch {
      // A failed background re-check keeps the downloaded update; the next check retries.
    } finally {
      refreshing = false
    }
    return
  }
  if (state.phase !== 'idle' && state.phase !== 'latest' && state.phase !== 'error') return
  set({ phase: 'checking' })
  try {
    const update = await ipc.checkUpdate()
    if (!update) return set({ phase: 'latest' })
    set({ phase: 'downloading', version: update.version })
    await update.download()
    ready(update)
  } catch (e) {
    set({ phase: 'error', message: String(e) })
  }
}

/** Background checks while 自动升级 is on; returns the stop function. */
export function startUpdater() {
  const tick = () =>
    ipc.settings().then(
      (s) => {
        useUpdate.setState({ auto: s.autoUpgrade })
        return s.autoUpgrade ? checkForUpdate() : undefined
      },
      () => {},
    )
  void tick()
  const timer = setInterval(tick, EVERY_MS)
  const idle = setInterval(() => void autoRestart(), IDLE_POLL_MS)
  return () => {
    clearInterval(timer)
    clearInterval(idle)
  }
}

/** Since when the daemon has been online with no task, as seen by `autoRestart`. */
let idleSince: number | null = null

/**
 * Restarts into the downloaded update once the daemon has been online with no run for `IDLE_MS` and 自动升级 is on.
 * Online, so finished runs have been reported before the daemon stops.
 */
export async function autoRestart(now = Date.now()) {
  const { snapshot } = useDaemon.getState()
  const idle = snapshot.phase === 'running' && snapshot.status.conn.state === 'online' && activeRuns() === 0
  if (!idle) {
    idleSince = null
    return
  }
  idleSince ??= now
  if (useUpdate.getState().state.phase !== 'ready' || now - idleSince < IDLE_MS) return
  const auto = await ipc.settings().then(
    (s) => s.autoUpgrade,
    () => false,
  )
  useUpdate.setState({ auto })
  if (auto) await restartToUpdate()
}

/** Runs on this machine that a restart would interrupt. */
export function activeRuns() {
  const { snapshot } = useDaemon.getState()
  return snapshot.phase === 'running' ? snapshot.status.runs.length : 0
}

/** Installs the downloaded update, stops the daemon and relaunches into the new version. */
export async function restartToUpdate() {
  const update = downloaded
  const { state } = useUpdate.getState()
  if (!update || state.phase !== 'ready') return
  set({ phase: 'installing', version: state.version })
  try {
    // A release published since the download would otherwise take one more restart; offline, install what we have.
    const latest = await fetchNewer(update).catch(() => null)
    if (latest) set({ phase: 'installing', version: latest.version })
    await (latest ?? update).install()
    await ipc.stopDaemon()
    await ipc.relaunch()
  } catch (e) {
    set({ phase: 'error', message: String(e) })
  }
}
