import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'

/** Revokes the server session, then forgets everything the previous user loaded. */
export async function logout() {
  try {
    await api.post('/auth/logout')
  } finally {
    useWorkspace.setState({ groups: [], bots: [], machines: [], notifCount: 0 })
    useSession.getState().setUser(null)
  }
}
