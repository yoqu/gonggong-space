/**
 * App updates from GitHub Releases (Tauri updater, `plugins.updater` in tauri.conf.json): checked at launch and every
 * 6 hours while 自动升级 is on, or from Settings; a found update downloads in the background and is installed when
 * the user restarts. The bundled daemon is stopped right before the relaunch.
 */
import { create } from 'zustand'
import { ipc, type Update } from './ipc'
import { useDaemon } from './store'

const EVERY_MS = 6 * 3600 * 1000

export type UpdatePhase =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'latest' }
  | { phase: 'downloading'; version: string }
  | { phase: 'ready'; version: string }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; message: string }

export const useUpdate = create<{ state: UpdatePhase; dismissed: boolean }>()(() => ({
  state: { phase: 'idle' },
  dismissed: false,
}))

/** The downloaded update, installed on restart. */
let downloaded: Update | null = null

const set = (state: UpdatePhase) => useUpdate.setState({ state })

/** Checks once and downloads what it finds; no-op while busy or once an update waits for the restart. */
export async function checkForUpdate() {
  const { phase } = useUpdate.getState().state
  if (phase !== 'idle' && phase !== 'latest' && phase !== 'error') return
  set({ phase: 'checking' })
  try {
    const update = await ipc.checkUpdate()
    if (!update) return set({ phase: 'latest' })
    set({ phase: 'downloading', version: update.version })
    await update.download()
    downloaded = update
    useUpdate.setState({ state: { phase: 'ready', version: update.version }, dismissed: false })
  } catch (e) {
    set({ phase: 'error', message: String(e) })
  }
}

/** Background checks while 自动升级 is on; returns the stop function. */
export function startUpdater() {
  const tick = () =>
    ipc.settings().then(
      (s) => (s.autoUpgrade ? checkForUpdate() : undefined),
      () => {},
    )
  void tick()
  const timer = setInterval(tick, EVERY_MS)
  return () => clearInterval(timer)
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
    await update.install()
    await ipc.stopDaemon()
    await ipc.relaunch()
  } catch (e) {
    set({ phase: 'error', message: String(e) })
  }
}
