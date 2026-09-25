import type { UserDto } from '@gonggong/protocol'
import { create } from 'zustand'
import { ApiError, api, setUnauthorizedHandler } from '../lib/api'

type SessionStatus = 'idle' | 'loading' | 'ready' | 'error'

interface SessionState {
  user: UserDto | null
  status: SessionStatus
  load: () => Promise<void>
  setUser: (user: UserDto | null) => void
}

export const useSession = create<SessionState>()((set) => ({
  user: null,
  status: 'idle',
  async load() {
    set({ status: 'loading' })
    try {
      set({ user: await api.get<UserDto>('/me'), status: 'ready' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) set({ user: null, status: 'ready' })
      else set({ status: 'error' })
    }
  },
  setUser: (user) => set({ user, status: 'ready' }),
}))

setUnauthorizedHandler(() => useSession.getState().setUser(null))
