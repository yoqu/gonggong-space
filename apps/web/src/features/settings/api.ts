import type { GitAccountDto, GitProvider, ProviderRepoDto } from '@gonggong/protocol'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'

export const gitAccountsApi = {
  list: () => api.get<GitAccountDto[]>('/me/git-accounts'),
  add: (body: { provider: GitProvider; baseUrl?: string; token: string }) =>
    api.post<GitAccountDto>('/me/git-accounts', body),
  remove: (id: string) => api.del(`/me/git-accounts/${id}`),
  repos: (id: string, q: string) =>
    api.get<ProviderRepoDto[]>(`/git-accounts/${id}/repos?q=${encodeURIComponent(q)}`),
  branches: (id: string, repo: string, q = '') =>
    api.get<string[]>(
      `/git-accounts/${id}/branches?repo=${encodeURIComponent(repo)}&q=${encodeURIComponent(q)}`,
    ),
}

/** The caller's git accounts, shared by the settings window and the repo picker. */
export const useGitAccounts = create<{
  accounts: GitAccountDto[] | null
  load: () => Promise<void>
  set: (accounts: GitAccountDto[]) => void
  reset: () => void
}>()((set) => {
  // A list fetched before a local change (or a sign-out) must not overwrite it.
  let gen = 0
  return {
    accounts: null,
    load: () => {
      const mine = ++gen
      return gitAccountsApi.list().then((accounts) => {
        if (mine === gen) set({ accounts })
      })
    },
    set: (accounts) => {
      gen++
      set({ accounts })
    },
    reset: () => {
      gen++
      set({ accounts: null })
    },
  }
})

// Signing out in place must not leave one user's accounts for the next to see.
useSession.subscribe((s, prev) => {
  if (prev.user && !s.user) useGitAccounts.getState().reset()
})

/** `https://github.com` → GitHub; other instances by host, or the address as typed when it is not a URL. */
export function accountLabel(a: GitAccountDto) {
  if (a.baseUrl === 'https://github.com') return 'GitHub'
  try {
    return new URL(a.baseUrl).host
  } catch {
    return a.baseUrl
  }
}
