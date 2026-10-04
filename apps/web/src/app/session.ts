import type { MeDto, TeamDto, UserDto } from '@gonggong/protocol'
import { create } from 'zustand'
import { ApiError, api, setUnauthorizedHandler } from '../lib/api'
import { storedTeam, storeTeam } from '../lib/team'

type SessionStatus = 'idle' | 'loading' | 'ready' | 'error'

/** What /api/me says about teams and the platform; null until a MeDto arrived. */
export type Tenancy = Pick<MeDto, 'teams' | 'singleTeamMode' | 'canCreateTeam' | 'demoMode'>

interface SessionState {
  user: UserDto | null
  tenancy: Tenancy | null
  status: SessionStatus
  load: () => Promise<void>
  setUser: (user: UserDto | MeDto | null) => void
  setTeams: (update: (teams: TeamDto[]) => TeamDto[]) => void
}

/** Keeps the stored team one the user is in: a stale one would make every team-scoped request fail. */
function syncTeam(teams: TeamDto[]) {
  const picked = storedTeam()
  if (!teams.some((x) => x.id === picked)) storeTeam(teams[0]?.id ?? null)
}

export const useSession = create<SessionState>()((set) => ({
  user: null,
  tenancy: null,
  status: 'idle',
  async load() {
    set({ status: 'loading' })
    try {
      useSession.getState().setUser(await api.get<MeDto>('/me'))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) set({ user: null, tenancy: null, status: 'ready' })
      else set({ status: 'error' })
    }
  },
  setUser(user) {
    if (user && 'teams' in user) {
      const { teams, singleTeamMode, canCreateTeam, demoMode, ...rest } = user
      syncTeam(teams)
      set({ user: rest, tenancy: { teams, singleTeamMode, canCreateTeam, demoMode }, status: 'ready' })
    } else set(user ? { user, status: 'ready' } : { user, tenancy: null, status: 'ready' })
  },
  setTeams: (update) =>
    set((s) => (s.tenancy ? { tenancy: { ...s.tenancy, teams: update(s.tenancy.teams) } } : {})),
}))

setUnauthorizedHandler(() => useSession.getState().setUser(null))
