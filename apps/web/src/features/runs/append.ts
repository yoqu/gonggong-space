import { create } from 'zustand'

export interface AppendTarget {
  runId: string
  groupId: string
  botName: string
  /** The run answers in this thread (or 画布 AI 对话): its composer takes the target, the message goes there. */
  threadRootId?: string
}

/** The composer of `groupId`'s conversation `scope` (a thread or 画布 AI 对话 root; none: the group's) sends it. */
export const appendsHere = (target: AppendTarget | null, groupId: string, scope?: string) =>
  !!target && target.groupId === groupId && target.threadRootId === scope

/** 打断并追加 (spec §8.9): the running run the composer's next message goes into. */
export const useAppend = create<{
  target: AppendTarget | null
  start: (target: AppendTarget) => void
  clear: () => void
}>((set) => ({
  target: null,
  start: (target) => set({ target }),
  clear: () => set({ target: null }),
}))
