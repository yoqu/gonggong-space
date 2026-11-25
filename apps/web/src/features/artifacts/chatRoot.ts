import type { ArtifactChatDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'

/**
 * 画布 AI 对话 (ArtifactChatDto): per group, the artifact whose canvas is in front and its conversation's root. While
 * it is set, the canvas's own composer has the canvas selection and the group's composer stops floating over it.
 */
export const useCanvasChat = create<{ byGroup: Record<string, { artifactId: string; rootId: string }> }>()(
  () => ({ byGroup: {} }),
)

const roots = new Map<string, Promise<ArtifactChatDto>>()

/** The artifact's conversation, asked for once per artifact (the server makes it on first use). */
function chatRoot(artifactId: string) {
  let root = roots.get(artifactId)
  if (!root) {
    root = api.post<ArtifactChatDto>(`/artifacts/${artifactId}/chat`)
    root.catch(() => roots.delete(artifactId))
    roots.set(artifactId, root)
  }
  return root
}

/** `artifactId`'s 画布 AI 对话; null while loading, when it failed or with no artifact. */
export function useArtifactChat(artifactId: string | null) {
  const [chat, setChat] = useState<{ artifactId: string; dto: ArtifactChatDto } | null>(null)
  useEffect(() => {
    if (!artifactId) return
    let live = true
    chatRoot(artifactId).then(
      (dto) => live && setChat({ artifactId, dto }),
      () => {},
    )
    return () => {
      live = false
    }
  }, [artifactId])
  return chat && chat.artifactId === artifactId ? chat.dto : null
}

/** The root of `artifactId`'s 画布 AI 对话; null while loading, when it failed or with no artifact. */
export const useArtifactChatRoot = (artifactId: string | null) => useArtifactChat(artifactId)?.rootId ?? null

/**
 * The group to talk in: mine, or the one the server sent along for someone outside it given 可协作 (作品权限), who
 * talks in this conversation only.
 */
export function useChatGroup(groupId: string, artifactId: string) {
  const mine = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  const chat = useArtifactChat(mine ? null : artifactId)
  return mine ?? (chat?.group?.id === groupId ? chat.group : undefined)
}

/** While `on` (the artifact's tab is in front and the member may edit), its canvas has its own composer. */
export function useFrontCanvasChat(groupId: string, artifactId: string, on: boolean) {
  const rootId = useArtifactChatRoot(on ? artifactId : null)
  useEffect(() => {
    if (!on || !rootId || !groupId) return
    const set = (next: { artifactId: string; rootId: string } | null) =>
      useCanvasChat.setState((s) => {
        const byGroup = { ...s.byGroup }
        if (next) byGroup[groupId] = next
        else if (byGroup[groupId]?.artifactId === artifactId) delete byGroup[groupId]
        return { byGroup }
      })
    set({ artifactId, rootId })
    return () => set(null)
  }, [on, rootId, groupId, artifactId])
  return rootId
}
