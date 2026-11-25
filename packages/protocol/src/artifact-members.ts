import { z } from 'zod'
import { ArtifactAccess } from './artifacts.js'

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
