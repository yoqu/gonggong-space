import { z } from 'zod'
import { TeamParams } from './admin.js'
import { NotifyPrefs, UserDto } from './errors-auth.js'

// ── Teams (plan 团队层级) ─────────────────────────────────────────────────────
export const TeamRole = z.enum(['owner', 'admin', 'member'])
export type TeamRole = z.infer<typeof TeamRole>
export const TeamDto = z.object({
  id: z.string(),
  name: z.string(),
  /** An uploaded image's URL (`/api/avatars/…`), else one character or emoji; null = the name's initial. */
  avatar: z.string().nullable(),
  /** The caller's role in it. */
  role: TeamRole,
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  /** The caller's unread messages in its groups plus its unread notifications. */
  unread: z.number().int(),
})
export type TeamDto = z.infer<typeof TeamDto>
/** GET /api/me (and the other endpoints returning the signed-in account): live teams, earliest joined first. */
export const MeDto = UserDto.extend({
  teams: z.array(TeamDto),
  /** Hides the team switcher (plan D11). */
  singleTeamMode: z.boolean(),
  /** 系统参数 · teamCreation allows the caller to create teams, and single-team mode is off. */
  canCreateTeam: z.boolean(),
  demoMode: z.boolean(),
  /** 系统参数 · the plugin master switch: group settings offer the 插件 tab while it is on. */
  pluginsEnabled: z.boolean(),
  notifyPrefs: NotifyPrefs,
})
export type MeDto = z.infer<typeof MeDto>
const TeamName = z.string().trim().min(1).max(40)
/** One character or emoji shown instead of the name's initial. */
const TeamAvatar = z.string().trim().max(8).nullable()
export const CreateTeamReq = z.object({ name: TeamName })
export const AddTeamMemberReq = z.object({
  account: z.string().trim().min(1),
  role: TeamRole.default('member'),
})
export const UpdateTeamMemberReq = z.object({ role: TeamRole })
export const TransferTeamReq = z.object({ userId: z.string() })
export const CreateTeamInviteReq = z.object({
  role: z.enum(['admin', 'member']).default('member'),
  expiresInDays: z.number().int().min(1).max(30),
  /** null = unlimited. */
  maxUses: z.number().int().min(1).max(1000).nullable(),
})
export const TeamMemberDto = z.object({
  userId: z.string(),
  name: z.string(),
  account: z.string(),
  avatar: z.string().nullable(),
  role: TeamRole,
  joinedAt: z.string(),
})
export type TeamMemberDto = z.infer<typeof TeamMemberDto>
/** The token itself is only shown once, when the invite is created. */
export const TeamInviteDto = z.object({
  id: z.string(),
  teamId: z.string(),
  role: TeamRole,
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  expiresAt: z.string(),
  createdBy: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type TeamInviteDto = z.infer<typeof TeamInviteDto>
export const CreatedTeamInviteDto = z.object({ invite: TeamInviteDto, token: z.string() })
export type CreatedTeamInviteDto = z.infer<typeof CreatedTeamInviteDto>
/** GET /api/invites/:token — public; `valid` is false once expired, used up, revoked or the team archived. */
export const InvitePreviewDto = z.object({
  teamName: z.string(),
  inviterName: z.string(),
  valid: z.boolean(),
})
export type InvitePreviewDto = z.infer<typeof InvitePreviewDto>
/** Row of 管理后台 · 团队 (archived teams included). */
export const AdminTeamDto = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  /** Earliest-joined owner. */
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  members: z.number().int(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type AdminTeamDto = z.infer<typeof AdminTeamDto>
/** POST /api/admin/teams — the chosen account becomes its owner. */
export const CreateAdminTeamReq = z.object({ name: TeamName, ownerId: z.string() })
/** PUT /api/admin/teams/:id/owner — the account becomes an owner (joining if needed); other owners become admins. */
export const SetTeamOwnerReq = z.object({ userId: z.string() })
/** PATCH /api/teams/:id (admins); `params` replaces the team's overrides. */
export const UpdateTeamReq = z.object({
  name: TeamName.optional(),
  avatar: TeamAvatar.optional(),
  params: TeamParams.optional(),
})
