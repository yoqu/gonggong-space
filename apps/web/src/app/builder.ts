import { useSyncExternalStore } from 'react'
import { useSession } from './session'
import { useWorkspace } from './workspace'

const KEY = 'gg.builder'

const optedIn = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const listeners = new Set<() => void>()
const subscribe = (f: () => void) => {
  listeners.add(f)
  window.addEventListener('storage', f)
  return () => {
    listeners.delete(f)
    window.removeEventListener('storage', f)
  }
}

/** 搭建自己的 Bot: the user asks for the builder tools (machines, market) before owning anything. */
export function becomeBuilder() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // storage unavailable: the shell stays as it is; the user can still open /machines directly
  }
  for (const f of listeners) f()
}

/**
 * Builders set bots up; everyone else just @s bots in groups, so the shell hides machines and the market from them.
 * Anyone owning a machine or bot, running a team or group, a sysadmin, or who opted in counts.
 */
export function useIsBuilder() {
  const me = useSession((s) => s.user)
  const teamRole = useSession((s) => !!s.tenancy?.teams.some((x) => x.role !== 'member'))
  const owns = useWorkspace(
    (s) =>
      !!me &&
      (s.machines.some((m) => m.ownerId === me.id) ||
        s.bots.some((b) => b.ownerId === me.id) ||
        s.groups.some((g) => g.members.some((x) => x.userId === me.id && x.isAdmin))),
  )
  const on = useSyncExternalStore(subscribe, optedIn)
  return on || me?.role === 'sysadmin' || teamRole || owns
}
