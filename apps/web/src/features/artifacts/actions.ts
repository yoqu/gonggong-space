import type {
  AnnotationDto,
  ArtifactCommandReq,
  ArtifactEditOp,
  ArtifactUploadRes,
  BotDto,
  CreateAnnotationReq,
  SendAnnotationsReq,
  UpdateAnnotationReq,
} from '@gonggong/protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ApiError, api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { toast } from '../../ui'

// R3 of docs/plan/原型编辑器-Stitch对标-开发计划.md: direct edits, annotations and AI commands from the canvas.

/** The group's bots, in the group's order. */
export function useGroupBots(groupId: string): BotDto[] {
  const botIds = useWorkspace((s) => s.groups.find((g) => g.id === groupId)?.botIds)
  const all = useWorkspace((s) => s.bots)
  return useMemo(
    () => (botIds ?? []).map((id) => all.find((b) => b.id === id)).filter((b): b is BotDto => !!b),
    [botIds, all],
  )
}

/**
 * The bot the canvas hands work to, per group: picked once, else the artifact's own bot (ArtifactDto.botId) while it
 * is in the group, else the first.
 */
const usePicked = create<Record<string, string>>()(() => ({}))
export function useArtifactBot(groupId: string, ownBotId?: string | null) {
  const bots = useGroupBots(groupId)
  const picked = usePicked((s) => s[groupId])
  const bot = bots.find((b) => b.id === picked) ?? bots.find((b) => b.id === ownBotId) ?? bots[0] ?? null
  const pick = useCallback((id: string) => usePicked.setState({ [groupId]: id }), [groupId])
  return { bots, bot, pick }
}

/** POST /api/artifacts/:id/commands: the server posts the @bot message as the member. */
export async function sendCommand(artifactId: string, req: ArtifactCommandReq, botName: string) {
  try {
    await api.post(`/artifacts/${artifactId}/commands`, req)
    toast({ type: 'success', message: t('已交给 @{name}', { name: botName }) })
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}

/**
 * One new version from `ops`. A 409 (the head moved, or a run is at work) is said as such; the artifact reloads
 * either way, so the member redoes the edit on what is there now.
 */
export async function saveEdits(run: (ops: ArtifactEditOp[]) => Promise<void>, ops: ArtifactEditOp[]) {
  try {
    await run(ops)
    return true
  } catch (e) {
    if (e instanceof ApiError && e.status === 409)
      toast({ type: 'warning', title: t('产物已更新，已刷新'), message: errorText(e) })
    else toastError(e)
    return false
  }
}

/** POST /api/artifacts/:id/uploads: the image as the raw body; the `asset` op then puts it in place. */
export const uploadImage = (artifactId: string, file: Blob) =>
  api.post<ArtifactUploadRes>(`/artifacts/${artifactId}/uploads`, file)

/** The annotations of one version of the artifact (oldest first). */
export function useAnnotations(artifactId: string, versionId: string | null) {
  const [list, setList] = useState<AnnotationDto[]>([])
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` reloads on demand
  useEffect(() => {
    if (!versionId) return setList([])
    let live = true
    api
      .get<AnnotationDto[]>(`/artifacts/${artifactId}/annotations?version=${encodeURIComponent(versionId)}`)
      .then(
        (l) => live && setList(l),
        () => live && setList([]),
      )
    return () => {
      live = false
    }
  }, [artifactId, versionId, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { list, reload }
}

export const createAnnotation = (artifactId: string, req: CreateAnnotationReq) =>
  api.post<AnnotationDto>(`/artifacts/${artifactId}/annotations`, req)
export const updateAnnotation = (id: string, req: UpdateAnnotationReq) =>
  api.patch<AnnotationDto>(`/annotations/${id}`, req)
export const deleteAnnotation = (id: string) => api.del(`/annotations/${id}`)
export const sendAnnotations = (artifactId: string, req: SendAnnotationsReq) =>
  api.post(`/artifacts/${artifactId}/annotations/send`, req)
