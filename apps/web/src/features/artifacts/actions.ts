import {
  type AnnotationDto,
  ARTIFACT_REF_TYPES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  type ArtifactCommandReq,
  type ArtifactEditOp,
  type ArtifactUploadRes,
  type BotDto,
  type CreateAnnotationReq,
  type SendAnnotationsReq,
  type UpdateAnnotationReq,
} from '@gonggong/protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ApiError, api, errorText } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
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

/** Whether the bot's machine is up, as the group's member list shows it: else its runs wait. */
export const botOnline = (b: Pick<BotDto, 'presence'>) => b.presence === 'online' || b.presence === 'running'

/** What a canvas request to `bot` says before it goes: null while the bot is online. */
export const offlineHint = (bot: BotDto | null) =>
  bot && !botOnline(bot) ? t('@{name} 离线，上线后执行', { name: bot.name }) : null

/** The toast once a request went to `bot`: handed over, or queued until it comes online. */
export const handedTo = (bot: BotDto) =>
  toast(
    botOnline(bot)
      ? { type: 'success', message: t('已交给 @{name}', { name: bot.name }) }
      : { type: 'info', message: t('已排队，@{name} 上线后执行', { name: bot.name }) },
  )

/** POST /api/artifacts/:id/commands: the server posts the @bot message as the member. */
export async function sendCommand(artifactId: string, req: ArtifactCommandReq, bot: BotDto) {
  try {
    await api.post(`/artifacts/${artifactId}/commands`, req)
    handedTo(bot)
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

/** What the uploads route takes for a reference, by extension (a browser often types .md as nothing). */
const REF_TYPES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(ARTIFACT_REF_TYPES).map(([type, ext]) => [ext, type])),
  jpeg: 'image/jpeg',
}
export const REF_ACCEPT = Object.keys(REF_TYPES)
  .map((e) => `.${e}`)
  .join(',')

/** POST /api/artifacts/:id/uploads: the image as the raw body; the `asset` op then puts it in place. */
export const uploadImage = (artifactId: string, file: Blob) =>
  api.post<ArtifactUploadRes>(`/artifacts/${artifactId}/uploads`, file)

/**
 * A file dropped or picked for the canvas as the uploads route takes it (typed by its extension), or the reason it
 * cannot go: not an image, PDF or text file, or over the size limit.
 */
export function refUpload(file: File): Blob | string {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const type = file.name.includes('.') ? REF_TYPES[ext] : undefined
  if (!type) return t('不支持的文件类型：{name}', { name: file.name })
  if (file.size > ARTIFACT_UPLOAD_MAX_BYTES)
    return t('{name} 超过 {mb} MB', { name: file.name, mb: ARTIFACT_UPLOAD_MAX_BYTES / 1024 / 1024 })
  return new Blob([file], { type })
}

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
  return { list, reload, tick }
}

/**
 * Annotations on other versions than `versionId` (they stay with the version they were made on, so a new version, a
 * local one too, seems to drop them): how many are still open, by version, and the ones handed to the AI, whose
 * results show in a newer version. Asked only while `enabled`.
 */
export function useOpenElsewhere(
  artifactId: string,
  versionId: string | null,
  enabled: boolean,
  tick: number,
) {
  const [state, setState] = useState<{ counts: Record<string, number>; sent: AnnotationDto[] }>(
    NONE_ELSEWHERE,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` reloads with the shown version's list
  useEffect(() => {
    if (!enabled) return setState(NONE_ELSEWHERE)
    let live = true
    api.get<AnnotationDto[]>(`/artifacts/${artifactId}/annotations`).then(
      (l) => {
        if (!live) return
        const counts: Record<string, number> = {}
        const sent: AnnotationDto[] = []
        for (const a of l) {
          if (a.versionId === versionId) continue
          if (a.status === 'open') counts[a.versionId] = (counts[a.versionId] ?? 0) + 1
          else if (a.status === 'sent') sent.push(a)
        }
        setState({ counts, sent })
      },
      () => live && setState(NONE_ELSEWHERE),
    )
    return () => {
      live = false
    }
  }, [artifactId, versionId, enabled, tick])
  return state
}
const NONE_ELSEWHERE = { counts: {}, sent: [] }

export const createAnnotation = (artifactId: string, req: CreateAnnotationReq) =>
  api.post<AnnotationDto>(`/artifacts/${artifactId}/annotations`, req)
export const updateAnnotation = (id: string, req: UpdateAnnotationReq) =>
  api.patch<AnnotationDto>(`/annotations/${id}`, req)
export const deleteAnnotation = (id: string) => api.del(`/annotations/${id}`)
export const sendAnnotations = (artifactId: string, req: SendAnnotationsReq) =>
  api.post(`/artifacts/${artifactId}/annotations/send`, req)

/** The screens' HTML, one after the other under a comment naming each file (Copy as code, ⌘C, Export › code). */
export async function screensCode(screens: { file: string }[], readFile: (file: string) => Promise<string>) {
  const parts = await Promise.all(screens.map(async (s) => `<!-- ${s.file} -->\n${await readFile(s.file)}`))
  return parts.join('\n\n')
}

/** Says an action went through; the canvas shows it over itself, where the action was. */
export type Notify = (message: string) => void
const toastDone: Notify = (message) => toast({ type: 'success', message })

/** Copies the screens' code to the system clipboard; `done` says so, a failure toasts. */
export async function copyScreensCode(
  screens: { file: string }[],
  readFile: (file: string) => Promise<string>,
  done: Notify = toastDone,
) {
  if (!screens.length) return false
  try {
    await copyText(await screensCode(screens, readFile))
    done(t('已复制 {n} 个屏幕的代码', { n: screens.length }))
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}

async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = bitmap.width
  c.height = bitmap.height
  c.getContext('2d')?.drawImage(bitmap, 0, 0)
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error(t('图片转换失败')))), 'image/png'),
  )
}

/** Copy as PNG (⌘⇧C): the screen's thumbnail to the system clipboard. */
export async function copyPng(url: string, done: Notify = toastDone) {
  try {
    // The item takes a promise so the copy still counts as part of the click (Safari).
    const png = fetch(url, { credentials: 'include' }).then(async (res) => {
      if (!res.ok) throw new Error(t('读取缩略图失败'))
      return asPng(await res.blob())
    })
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    done(t('已复制为 PNG'))
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}
