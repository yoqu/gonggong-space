import { create } from 'zustand'
import type { GitTarget } from './api'

const KEY = 'gg.git.drafts'

/**
 * What the commit window holds for a repo until a commit takes it, kept in this browser (IDEA keeps the message when
 * the tool window closes): the message, null until typed so a merge in progress offers git's; Amend; and the files
 * picked or left out by hand, the rest following the default (tracked changes picked, untracked files not).
 */
export interface CommitDraft {
  message: string | null
  amend: boolean
  checks: Record<string, boolean>
}

export const EMPTY_DRAFT: CommitDraft = { message: null, amend: false, checks: {} }

const load = (): Record<string, CommitDraft> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, CommitDraft>
  } catch {
    return {}
  }
}

interface Drafts {
  drafts: Record<string, CommitDraft>
  update: (key: string, patch: Partial<Omit<CommitDraft, 'checks'>>) => void
  check: (key: string, paths: string[], on: boolean) => void
  clear: (key: string) => void
}

export const useCommitDrafts = create<Drafts>()((set, get) => {
  const save = (drafts: Record<string, CommitDraft>) => {
    set({ drafts })
    try {
      localStorage.setItem(KEY, JSON.stringify(drafts))
    } catch {
      // storage unavailable: the draft lasts for this page only
    }
  }
  const draft = (key: string) => get().drafts[key] ?? EMPTY_DRAFT
  return {
    drafts: load(),
    update: (key, patch) => save({ ...get().drafts, [key]: { ...draft(key), ...patch } }),
    check: (key, paths, on) => {
      const d = draft(key)
      const checks = { ...d.checks, ...Object.fromEntries(paths.map((p) => [p, on])) }
      save({ ...get().drafts, [key]: { ...d, checks } })
    },
    clear: (key) => {
      const { [key]: _, ...rest } = get().drafts
      save(rest)
    },
  }
})

/** A workspace is the bot's in one group, so its drafts are per group, bot and repo. */
export function useCommitDraft(target: GitTarget) {
  const key = `${target.groupId}:${target.botId}:${target.repo ?? ''}`
  const draft = useCommitDrafts((s) => s.drafts[key]) ?? EMPTY_DRAFT
  const { update, check, clear } = useCommitDrafts.getState()
  return {
    draft,
    update: (patch: Partial<Omit<CommitDraft, 'checks'>>) => update(key, patch),
    check: (paths: string[], on: boolean) => check(key, paths, on),
    clear: () => clear(key),
  }
}
