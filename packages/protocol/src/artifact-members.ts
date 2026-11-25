import { z } from 'zod'
import { ArtifactAccess } from './artifacts.js'
import { GroupDto } from './web/groups.js'

/**
 * A person given access to one work beyond its group (作品权限): `view` 可看, `edit` 可协作 (changes it like a member).
 * GET /api/artifacts/:id/members lists them; PUT …/members/:userId `{ role }` (managers, people of its team) and
 * DELETE …/members/:userId answer the new list.
 */
export const ArtifactMemberDto = z.object({
  userId: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  role: ArtifactAccess,
})
export type ArtifactMemberDto = z.infer<typeof ArtifactMemberDto>
export const ArtifactMemberReq = z.object({ role: ArtifactAccess })
export type ArtifactMemberReq = z.infer<typeof ArtifactMemberReq>

/**
 * POST /api/artifacts/:id/chat — the artifact's 画布 AI 对话: a thread whose root is its own reply, so neither it nor
 * its replies show in the group's messages, Feishu or 话题. The canvas reads it as a thread and posts to it with
 * `threadRootId`; its runs answer in it, in a session of their own.
 */
export const ArtifactChatDto = z.object({
  rootId: z.string(),
  /** For someone outside its group given 可协作 (作品权限): the group as members see it, to talk in this conversation. */
  group: GroupDto.optional(),
})
export type ArtifactChatDto = z.infer<typeof ArtifactChatDto>
