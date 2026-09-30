import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gitEnv } from '../groups/repo.js'
import { type PathEntry, withDirs } from './match.js'

const run = promisify(execFile)
/** Plan D14: opening the @ candidates fetches at most once a minute. */
const THROTTLE_MS = 60_000
/** A slow fetch doesn't hold up the popover: the last listing is served and the next open picks up the result. */
const WAIT_MS = 1_500
const GIT_TIMEOUT_MS = 60_000

interface Repo {
  id: string
  url: string
  branch: string
}

interface State {
  entries: PathEntry[] | null
  /** Last successful fetch; null = never synced. */
  updatedAt: Date | null
  triedAt: Date | null
  refreshing: Promise<void> | null
}

const git = (args: string[]) =>
  run('git', args, { env: gitEnv(), timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 })

/**
 * Base-branch file-tree mirrors for the @ file candidates (spec §8.7, plan D14): shallow, blob-less bare clones made
 * with the server's read-only credential, one per repo under `root`.
 */
export class Mirrors {
  private states = new Map<string, State>()

  constructor(
    private root: string,
    private now: () => Date,
  ) {}

  async get(repo: Repo): Promise<{ entries: PathEntry[]; updatedAt: Date | null }> {
    const s = this.touch(repo)
    if (s.refreshing)
      await (s.entries
        ? Promise.race([s.refreshing, new Promise((r) => setTimeout(r, WAIT_MS))])
        : s.refreshing)
    return { entries: s.entries ?? [], updatedAt: s.updatedAt }
  }

  /** The listing at hand, never waiting for a fetch or first clone (search spans every repo of the user). */
  peek(repo: Repo): PathEntry[] {
    return this.touch(repo).entries ?? []
  }

  /** Starts a refresh when due. */
  private touch(repo: Repo) {
    const s = this.states.get(repo.id) ?? { entries: null, updatedAt: null, triedAt: null, refreshing: null }
    this.states.set(repo.id, s)
    const now = this.now()
    if (!s.refreshing && (!s.triedAt || now.getTime() - s.triedAt.getTime() >= THROTTLE_MS)) {
      s.triedAt = now
      s.refreshing = this.refresh(repo, s).finally(() => {
        s.refreshing = null
      })
    }
    return s
  }

  private async refresh(repo: Repo, s: State) {
    const dir = join(this.root, `${repo.id}.git`)
    const ref = `refs/heads/${repo.branch}`
    try {
      if (existsSync(dir)) await git(['-C', dir, 'fetch', '-q', '--depth=1', 'origin', `+${ref}:${ref}`])
      else await clone(repo, dir)
      const { stdout } = await git(['-C', dir, 'ls-tree', '-r', '-z', '--name-only', ref])
      s.entries = withDirs(stdout.split('\0').filter(Boolean))
      s.updatedAt = this.now()
    } catch (e) {
      console.warn(`mirror ${repo.url}: ${(e as Error).message}`)
    }
  }
}

/** Clones next to the target and renames, so an interrupted clone never looks like a mirror. */
async function clone(repo: Repo, dir: string) {
  const partial = `${dir}.partial`
  await mkdir(join(dir, '..'), { recursive: true })
  await rm(partial, { recursive: true, force: true })
  try {
    await git([
      'clone',
      '-q',
      '--bare',
      '--filter=blob:none',
      '--depth=1',
      '--branch',
      repo.branch,
      '--',
      repo.url,
      partial,
    ])
  } catch (e) {
    await rm(partial, { recursive: true, force: true })
    throw e
  }
  await rename(partial, dir)
}
