import type { GitAccountDto, GitProvider, ProviderRepoDto } from '@gonggong/protocol'
import { create } from 'zustand'
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
}>()((set) => ({
  accounts: null,
  load: () => gitAccountsApi.list().then((accounts) => set({ accounts })),
  set: (accounts) => set({ accounts }),
}))

/** `https://github.com` → GitHub; other instances by host. */
export const accountLabel = (a: GitAccountDto) =>
  a.baseUrl === 'https://github.com' ? 'GitHub' : new URL(a.baseUrl).host
