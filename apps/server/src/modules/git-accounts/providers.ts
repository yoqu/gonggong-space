import type { GitProvider } from '@gonggong/protocol'

export const limits = { timeoutMs: 10_000 }
const REPO_LIMIT = 30
const BRANCH_LIMIT = 200
/** GitHub has no "search among repos I can access", so the full list is fetched and filtered here. */
const GITHUB_CACHE_MS = 5 * 60_000
const GITHUB_MAX_PAGES = 10

export class ProviderError extends Error {
  constructor(
    readonly kind: 'unauthorized' | 'network' | 'http',
    message: string,
  ) {
    super(message)
  }
}

export interface ProviderRepo {
  fullName: string
  httpsUrl: string
  sshUrl: string
  defaultBranch: string | null
  private: boolean
}

export interface Account {
  id: string
  provider: GitProvider
  baseUrl: string
  token: string
}

async function get<T>(url: string, headers: Record<string, string>): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(limits.timeoutMs) })
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new ProviderError('network', '连接超时，请稍后重试')
    throw new ProviderError('network', '无法连接，请检查实例地址或证书')
  }
  if (res.status === 401) throw new ProviderError('unauthorized', 'Token 无效或已过期')
  if (!res.ok) throw new ProviderError('http', `${new URL(url).host} 返回 ${res.status}`)
  return (await res.json()) as T
}

const matches = (q: string) => {
  const needle = q.trim().toLowerCase()
  return (s: string) => s.toLowerCase().includes(needle)
}

/** Fetches pages of `size` until a short page or `max` pages. */
async function pages<T>(fetchPage: (page: number) => Promise<T[]>, size: number, max: number) {
  const all: T[] = []
  for (let page = 1; page <= max; page++) {
    const rows = await fetchPage(page)
    all.push(...rows)
    if (rows.length < size) break
  }
  return all
}

const githubCache = new Map<string, { at: number; repos: ProviderRepo[] }>()

export function forgetAccount(id: string) {
  githubCache.delete(id)
}

interface GithubRepo {
  full_name: string
  clone_url: string
  ssh_url: string
  default_branch: string | null
  private: boolean
}

function github(a: Account) {
  const api = a.baseUrl === 'https://github.com' ? 'https://api.github.com' : `${a.baseUrl}/api/v3`
  const headers = { authorization: `Bearer ${a.token}`, accept: 'application/vnd.github+json' }
  const call = <T>(path: string) => get<T>(`${api}${path}`, headers)
  const all = async () => {
    const hit = githubCache.get(a.id)
    if (hit && Date.now() - hit.at < GITHUB_CACHE_MS) return hit.repos
    const rows = await pages(
      (page) => call<GithubRepo[]>(`/user/repos?sort=pushed&per_page=100&page=${page}`),
      100,
      GITHUB_MAX_PAGES,
    )
    const repos = rows.map((r) => ({
      fullName: r.full_name,
      httpsUrl: r.clone_url,
      sshUrl: r.ssh_url,
      defaultBranch: r.default_branch,
      private: r.private,
    }))
    githubCache.set(a.id, { at: Date.now(), repos })
    return repos
  }
  return {
    me: async () => (await call<{ login: string }>('/user')).login,
    repos: async (q: string) => {
      const hit = matches(q)
      return (await all()).filter((r) => hit(r.fullName)).slice(0, REPO_LIMIT)
    },
    branches: async (repo: string, q: string) => {
      const path = repo.split('/').map(encodeURIComponent).join('/')
      const rows = await pages(
        (page) => call<{ name: string }[]>(`/repos/${path}/branches?per_page=100&page=${page}`),
        100,
        BRANCH_LIMIT / 100,
      )
      const hit = matches(q)
      return rows.map((b) => b.name).filter(hit)
    },
  }
}

interface GitlabProject {
  path_with_namespace: string
  http_url_to_repo: string
  ssh_url_to_repo: string
  default_branch: string | null
  visibility: string
}

function gitlab(a: Account) {
  const headers = { 'private-token': a.token }
  const call = <T>(path: string) => get<T>(`${a.baseUrl}/api/v4${path}`, headers)
  return {
    me: async () => (await call<{ username: string }>('/user')).username,
    repos: async (q: string) => {
      const params = new URLSearchParams({
        membership: 'true',
        simple: 'true',
        order_by: 'last_activity_at',
        per_page: String(REPO_LIMIT),
      })
      if (q.trim()) params.set('search', q.trim())
      if (q.includes('/')) params.set('search_namespaces', 'true')
      const rows = await call<GitlabProject[]>(`/projects?${params}`)
      return rows.map((p) => ({
        fullName: p.path_with_namespace,
        httpsUrl: p.http_url_to_repo,
        sshUrl: p.ssh_url_to_repo,
        defaultBranch: p.default_branch,
        private: p.visibility !== 'public',
      }))
    },
    branches: async (repo: string, q: string) => {
      const params = new URLSearchParams({ per_page: '100' })
      if (q.trim()) params.set('search', q.trim())
      const rows = await pages(
        (page) =>
          call<{ name: string }[]>(
            `/projects/${encodeURIComponent(repo)}/repository/branches?${params}&page=${page}`,
          ),
        100,
        BRANCH_LIMIT / 100,
      )
      return rows.map((b) => b.name)
    },
  }
}

export const providerApi = (a: Account) => (a.provider === 'github' ? github(a) : gitlab(a))
