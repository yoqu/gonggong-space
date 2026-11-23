import { z } from 'zod'
import { AnnotationStatus, ArtifactHtmlFile, GgId, Rect } from './artifacts.js'

// ── Comment threads (docs/plan/产物容器-开发计划.md §5): one table for every kind, anchored the kind's own way ──
export const ArtifactThreadStatus = AnnotationStatus
export type ArtifactThreadStatus = z.infer<typeof ArtifactThreadStatus>

/** Units are the kind's own: page CSS pixels (site), slide fractions 0–1 (slides), board coordinates (whiteboard). */
export const ArtifactPoint = z.object({ x: z.number(), y: z.number() })
export type ArtifactPoint = z.infer<typeof ArtifactPoint>

/**
 * Where a thread points. `kind` is the artifact's kind. A prototype's is the old annotation: `ggId` null an element
 * scripts generated, with `selector` empty too a dragged region whose `snippet` lists the `data-gg-id`s inside it.
 */
export const ArtifactThreadAnchor = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prototype'),
    file: ArtifactHtmlFile,
    ggId: GgId.nullable(),
    selector: z.string().max(500),
    rect: Rect,
    /** The element's outer HTML, truncated; absent on create: the server cuts it from the version's source. */
    snippet: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal('slides'),
    slide: z.string().min(1).max(200),
    /** The element inside the slide, as the editor names it. */
    path: z.string().max(500).optional(),
    point: ArtifactPoint.optional(),
  }),
  z.object({
    kind: z.literal('whiteboard'),
    element: z.string().min(1).max(200).optional(),
    point: ArtifactPoint,
  }),
  /** `t`: seconds from the start of the film. */
  z.object({ kind: z.literal('motion'), t: z.number().min(0), point: ArtifactPoint.optional() }),
  z.object({ kind: z.literal('site'), path: z.string().min(1).max(500), point: ArtifactPoint }),
])
export type ArtifactThreadAnchor = z.infer<typeof ArtifactThreadAnchor>

const Text = z.string().trim().min(1).max(2000)
/** Who a message asks: bot ids. */
const To = z.array(z.string()).max(10)

export const ArtifactThreadMessageDto = z.object({
  id: z.string(),
  /** `bot`: a bot's answer (written by its runs). */
  authorKind: z.enum(['user', 'bot']),
  authorId: z.string(),
  authorName: z.string(),
  text: z.string(),
  to: z.array(z.string()),
  reactions: z.array(z.object({ emoji: z.string(), userIds: z.array(z.string()) })),
  at: z.string(),
  editedAt: z.string().nullable(),
})
export type ArtifactThreadMessageDto = z.infer<typeof ArtifactThreadMessageDto>

/** `sentMessageId`: the @bot message 发给 Agent posted (`open → sent`; anyone may then resolve or reopen it). */
export const ArtifactThreadDto = z.object({
  id: z.string(),
  artifactId: z.string(),
  /** The version it was made on: it stays with it. */
  versionId: z.string(),
  anchor: ArtifactThreadAnchor,
  status: ArtifactThreadStatus,
  sentMessageId: z.string().nullable(),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.string(),
  /** Oldest first; the first is the thread's own text. */
  messages: z.array(ArtifactThreadMessageDto),
})
export type ArtifactThreadDto = z.infer<typeof ArtifactThreadDto>

/** POST /api/artifacts/:id/threads (GET …?version=<id> lists them) — the anchor's kind must be the artifact's. */
export const CreateArtifactThreadReq = z.object({
  versionId: z.string(),
  anchor: ArtifactThreadAnchor,
  text: Text,
  to: To.default([]),
})
export type CreateArtifactThreadReq = z.infer<typeof CreateArtifactThreadReq>
/** PATCH /api/artifact-threads/:id (DELETE the same path removes it, its author only): `anchor` moves it. */
export const UpdateArtifactThreadReq = z.object({
  status: ArtifactThreadStatus.optional(),
  anchor: ArtifactThreadAnchor.optional(),
})
export type UpdateArtifactThreadReq = z.infer<typeof UpdateArtifactThreadReq>
/** POST /api/artifact-threads/:id/messages — answers the thread. */
export const ArtifactThreadMessageReq = z.object({ text: Text, to: To.default([]) })
export type ArtifactThreadMessageReq = z.infer<typeof ArtifactThreadMessageReq>
/**
 * PATCH /api/artifact-threads/:id/messages/:messageId rewrites one's own (answers the thread); DELETE removes it, the
 * whole thread when it is the first (204, else the thread).
 */
export const EditArtifactThreadMessageReq = z.object({ text: Text, to: To.optional() })
export type EditArtifactThreadMessageReq = z.infer<typeof EditArtifactThreadMessageReq>
/** POST /api/artifacts/:id/threads/send — posts an @bot message as the member (answers its MessageDto); they become `sent`. */
export const SendArtifactThreadsReq = z.object({
  threadIds: z.array(z.string()).min(1).max(50),
  botId: z.string(),
  extra: z.string().max(2000).optional(),
})
export type SendArtifactThreadsReq = z.infer<typeof SendArtifactThreadsReq>
