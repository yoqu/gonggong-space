/** Remote git URL forms accepted for group repos; file:// is kept for local and test repos. */
export const REPO_URL = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)\S+$/

/** `git@host:path`, also user-less `host:path` (ssh config aliases); a one-letter host would be a Windows drive. */
const SCP = /^(?:[^@/\s]+@)?([^:/\s\\]{2,}):(?!\/\/)(.+)$/
const SCHEME = /^(?:ssh|https?):\/\/(?:[^@/\s]*@)?([^:/\s]+)(?::\d+)?\/(.+)$/

function parts(url: string): { host: string; path: string } | null {
  const m = SCHEME.exec(url.trim()) ?? SCP.exec(url.trim())
  const path = m?.[2]?.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  return m?.[1] && path ? { host: m[1], path } : null
}

/**
 * Identity of a remote repo regardless of protocol, port and credentials: `host/path`, lowercased. The port is left
 * out on purpose — a self-hosted GitLab often serves ssh on 2222 and https on 443 for the same repo. Mirrors
 * `normalize_remote` in the Rust daemon (cases/repo-keys.json).
 */
export function repoKey(url: string): string | null {
  const p = parts(url)
  return p && `${p.host}/${p.path}`.toLowerCase()
}

/** Last path segment in its original case, e.g. `MyApp`. */
export function repoName(url: string): string {
  return parts(url)?.path.split('/').pop() ?? url.trim()
}

/** The URL without secrets, for history, events and audits: https userinfo and ssh passwords are dropped. */
export function publicRepoUrl(url: string): string {
  const u = url.trim()
  return u.replace(/^(https?:\/\/)[^@/\s]*@/, '$1').replace(/^(ssh:\/\/[^:@/\s]+):[^@/\s]*@/, '$1@')
}
