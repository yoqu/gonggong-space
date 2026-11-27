import type { MeDto, ThreadLayout } from '@gonggong/protocol'
import { useSession } from '../../app/session'
import { RAIL_MIN, useViewportBelow } from '../../app/viewport'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'

/** The account's choice of where a thread opens; beside the chat until one is made. */
export const useThreadLayout = (): ThreadLayout =>
  useSession((s) => s.tenancy?.uiPrefs?.threadLayout ?? 'side')

/** Under 1100px two columns do not fit: a thread always takes the chat's place there. */
export const useThreadSideFits = () => !useViewportBelow(RAIL_MIN)

const setLocal = (threadLayout: ThreadLayout) =>
  useSession.setState((s) =>
    s.tenancy ? { tenancy: { ...s.tenancy, uiPrefs: { ...s.tenancy.uiPrefs, threadLayout } } } : {},
  )

/** Switches at once and keeps it on the account; a failed save switches back. */
export async function setThreadLayout(next: ThreadLayout) {
  const before = useSession.getState().tenancy?.uiPrefs?.threadLayout ?? 'side'
  setLocal(next)
  try {
    useSession.getState().setUser(await api.patch<MeDto>('/me', { uiPrefs: { threadLayout: next } }))
  } catch (e) {
    setLocal(before)
    toastError(e)
  }
}
