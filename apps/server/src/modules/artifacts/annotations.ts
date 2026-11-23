import type {
  AnnotationDto,
  ArtifactThreadDto,
  CreateAnnotationReq,
  UpdateAnnotationReq,
} from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import { fail } from '../../lib/errors.js'
import type { Artifact } from './service.js'
import { createThread, deleteThread, editThreadMessage, listThreads, updateThread } from './threads.js'

// The prototype canvas's annotations API, kept for the web: each annotation is a prototype-anchored thread whose
// first message is its note.

const dto = (th: ArtifactThreadDto): AnnotationDto => {
  if (th.anchor.kind !== 'prototype') return fail('not_found', '批注不存在')
  const { file, ggId, selector, rect, snippet } = th.anchor
  return {
    id: th.id,
    artifactId: th.artifactId,
    versionId: th.versionId,
    file,
    ggId,
    selector,
    rect,
    snippet: snippet ?? '',
    note: th.messages[0]?.text ?? '',
    authorId: th.createdBy,
    authorName: th.createdByName,
    status: th.status,
    createdAt: th.createdAt,
  }
}

export async function listAnnotations(ctx: Ctx, a: Artifact, versionId: string | undefined) {
  return (await listThreads(ctx, a, versionId)).filter((th) => th.anchor.kind === 'prototype').map(dto)
}

export async function createAnnotation(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  r: CreateAnnotationReq,
) {
  const { versionId, note, ...place } = r
  return dto(
    await createThread(ctx, me, a, {
      versionId,
      anchor: { kind: 'prototype', ...place },
      text: note,
      to: [],
    }),
  )
}

/** Any member may resolve or reopen one; only its author rewrites or deletes it. */
export async function updateAnnotation(
  ctx: Ctx,
  me: { id: string; name: string },
  id: string,
  r: UpdateAnnotationReq,
) {
  let th = await updateThread(ctx, me, id, {})
  if (r.note !== undefined && th.createdBy !== me.id) fail('forbidden', '只能修改自己的批注')
  if (r.status) th = await updateThread(ctx, me, id, { status: r.status })
  if (r.note !== undefined)
    th = await editThreadMessage(ctx, me.id, id, (th.messages[0] as { id: string }).id, { text: r.note })
  return dto(th)
}

export const deleteAnnotation = (ctx: Ctx, userId: string, id: string) => deleteThread(ctx, userId, id)
