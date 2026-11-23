import { z } from 'zod'
import { AnnotationStatus, ArtifactHtmlFile, GgId, Rect } from './artifacts.js'

// ── Comment threads (docs/plan/产物容器-开发计划.md §5): one table for every kind, anchored the kind's own way ──
export const ArtifactThreadStatus = AnnotationStatus
export type ArtifactThreadStatus = z.infer<typeof ArtifactThreadStatus>

/** Units are the kind's own: page CSS pixels (site), slide fractions 0–1 (slides), board coordinates (whiteboard). */
export const ArtifactPoint = z.object({ x: z.number(), y: z.number() })
export type ArtifactPoint = z.infer<typeof ArtifactPoint>

/**
 * Where a thread points: either a structured anchor for our own UI (`prototype` / `site` / …) or an opaque serialized
 * string written by an open-artifact editor (stored and returned verbatim).
 */
export const ArtifactThreadStructuredAnchor = z.discriminatedUnion('kind', [
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
export type ArtifactThreadStructuredAnchor = z.infer<typeof ArtifactThreadStructuredAnchor>

export const ArtifactThreadAnchor = z.union([ArtifactThreadStructuredAnchor, z.string().min(1).max(4000)])
export type ArtifactThreadAnchor = z.infer<typeof ArtifactThreadAnchor>

export const ArtifactThreadLocation = z.record(z.string(), z.unknown())
export type ArtifactThreadLocation = z.infer<typeof ArtifactThreadLocation>

const Text = z.string().trim().min(1).max(2000)
/** Who a message asks: bot ids (or `'agent'` from an open-artifact editor). */
const To = z.array(z.string()).max(10)

export const ArtifactThreadReactionDto = z.object({
  emoji: z.string(),
  userIds: z.array(z.string()),
  authors: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
})
export type ArtifactThreadReactionDto = z.infer<typeof ArtifactThreadReactionDto>

export const ArtifactThreadMessageDto = z.object({
  id: z.string(),
  /** `bot`: a bot's answer (written by its runs). */
  authorKind: z.enum(['user', 'bot']),
  authorId: z.string(),
  authorName: z.string(),
  text: z.string(),
  to: z.array(z.string()),
  reactions: z.array(ArtifactThreadReactionDto),
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
  /** Short human label of what the thread is about (from open-artifact editors or site/prototype summary). */
  label: z.string(),
  /** Longer description of the anchored content, for the agent. */
  detail: z.string().nullable(),
  /** Extra structured location (coordinates, slide/element ids), for the agent. */
  location: ArtifactThreadLocation,
  status: ArtifactThreadStatus,
  resolvedBy: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  sentMessageId: z.string().nullable(),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.string(),
  /** Oldest first; the first is the thread's own text. */
  messages: z.array(ArtifactThreadMessageDto),
})
export type ArtifactThreadDto = z.infer<typeof ArtifactThreadDto>

/** POST /api/artifacts/:id/threads (GET …?version=<id> lists them) — structured anchors match the artifact's kind. */
export const CreateArtifactThreadReq = z.object({
  versionId: z.string().optional(),
  anchor: ArtifactThreadAnchor,
  label: z.string().max(300).default(''),
  detail: z.string().max(4000).nullable().optional(),
  location: ArtifactThreadLocation.default({}),
  text: Text,
  to: To.default([]),
})
export type CreateArtifactThreadReq = z.infer<typeof CreateArtifactThreadReq>
/** PATCH /api/artifact-threads/:id (DELETE the same path removes it, its author only): `anchor` moves it. */
export const UpdateArtifactThreadReq = z.object({
  status: ArtifactThreadStatus.optional(),
  anchor: ArtifactThreadAnchor.optional(),
  label: z.string().max(300).optional(),
  detail: z.string().max(4000).nullable().optional(),
  location: ArtifactThreadLocation.optional(),
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
/** POST /api/artifact-threads/:id/messages/:messageId/reactions — adds or removes the caller's emoji reaction. */
export const ReactArtifactThreadMessageReq = z.object({
  emoji: z.string().trim().min(1).max(32),
  on: z.boolean(),
})
export type ReactArtifactThreadMessageReq = z.infer<typeof ReactArtifactThreadMessageReq>
/** POST /api/artifacts/:id/threads/send — posts an @bot message as the member (answers its MessageDto); they become `sent`. */
export const SendArtifactThreadsReq = z.object({
  threadIds: z.array(z.string()).min(1).max(50),
  botId: z.string(),
  extra: z.string().max(2000).optional(),
})
export type SendArtifactThreadsReq = z.infer<typeof SendArtifactThreadsReq>
