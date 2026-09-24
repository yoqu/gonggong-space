import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { disablePush } from '../notifications/push'

/** Revokes the server session, then forgets everything the previous user loaded. */
export async function logout() {
  try {
    // Best effort: a failed unsubscribe must not keep the user logged in.
    await disablePush().catch((e: Error) => console.warn('push unsubscribe failed:', e))
    await api.post('/auth/logout')
  } finally {
    useWorkspace.setState({ groups: [], bots: [], machines: [], notifCount: 0, loaded: false })
    useSession.getState().setUser(null)
  }
}
