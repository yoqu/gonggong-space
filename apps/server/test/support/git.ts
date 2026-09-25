import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** A local bare repo with one commit on `main`, reachable as a file:// URL. */
export function bareRepo() {
  const root = mkdtempSync(join(tmpdir(), 'gonggong-srv-repo-'))
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@gonggong', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  const bare = join(root, 'remote.git')
  git(root, 'init', '-q', '--bare', '-b', 'main', bare)
  const seed = join(root, 'seed')
  git(root, 'clone', '-q', bare, seed)
  /** Commits `file` on main and pushes it. */
  const commit = (file: string, body: string) => {
    mkdirSync(dirname(join(seed, file)), { recursive: true })
    writeFileSync(join(seed, file), body)
    git(seed, 'add', '.')
    git(seed, 'commit', '-qm', file)
    git(seed, 'push', '-q', 'origin', 'main')
  }
  commit('README.md', '# demo\n')
  return { url: `file://${bare}`, path: bare, head: git(seed, 'rev-parse', '--short=7', 'HEAD'), commit }
}
