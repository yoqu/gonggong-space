import type { DiffScope, WorkspaceDiffDto } from '@gonggong/protocol'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { type DiffFile, parsePatch } from './patch'
import type { DiffSource } from './store'

const EMPTY: WorkspaceDiff = { patch: null, files: [], base: null, branch: null, error: null, loading: true }

/** A live turn keeps changing: refetch its diff at most this often while run.updated events arrive. */
const LIVE_REFETCH_MS = 2000

export interface WorkspaceDiff {
  patch: string | null
  files: DiffFile[]
  base: string | null
  branch: string | null
  error: string | null
  loading: boolean
}

/**
 * Changes of a bot's workspace. A finished turn's patch is already at hand (`patch`); everything else — the live
 * turn, uncommitted work, the branch against main — is read from the bot's machine on demand.
 */
export function useWorkspaceDiff(
  source: DiffSource | null,
  scope: DiffScope,
  patch?: string | null,
): WorkspaceDiff {
  const [state, setState] = useState<WorkspaceDiff>(EMPTY)
  const stored = scope === 'turn' && patch !== undefined
  const { groupId, botId, runId } = source ?? { groupId: null, botId: null, runId: null }
  useEffect(() => {
    if (stored || !groupId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      api
        .get<WorkspaceDiffDto>(
          `/groups/${groupId}/bots/${botId}/diff?scope=${scope}${runId ? `&runId=${runId}` : ''}`,
        )
        .then(
          (d) =>
            alive &&
            setState({
              patch: d.patch,
              files: parsePatch(d.patch ?? ''),
              base: d.base,
              branch: d.branch,
              error: null,
              loading: false,
            }),
          (e: Error) => alive && setState((s) => ({ ...s, error: e.message, loading: false })),
        )
    setState((s) => ({ ...s, loading: true }))
    void load()
    const off = realtime.subscribe((e) => {
      if (e.t !== 'run.updated' || e.run.botId !== botId || e.run.groupId !== groupId || timer) return
      timer = setTimeout(() => {
        timer = undefined
        void load()
      }, LIVE_REFETCH_MS)
    })
    return () => {
      alive = false
      off()
      clearTimeout(timer)
    }
  }, [stored, groupId, botId, runId, scope])
  const files = useMemo(() => parsePatch(patch ?? ''), [patch])
  if (stored) return { patch: patch ?? null, files, base: null, branch: null, error: null, loading: false }
  return state
}
