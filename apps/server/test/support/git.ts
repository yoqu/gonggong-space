import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A local bare repo with one commit on `main`, reachable as a file:// URL. */
export function bareRepo() {
  const root = mkdtempSync(join(tmpdir(), 'aiws-srv-repo-'))
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@aiws', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  const bare = join(root, 'remote.git')
  git(root, 'init', '-q', '--bare', '-b', 'main', bare)
  const seed = join(root, 'seed')
  git(root, 'clone', '-q', bare, seed)
  writeFileSync(join(seed, 'README.md'), '# demo\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'init')
  git(seed, 'push', '-q', 'origin', 'main')
  return { url: `file://${bare}`, head: git(seed, 'rev-parse', '--short=7', 'HEAD') }
}
