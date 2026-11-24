import { z } from 'zod'
import { GitProtocol } from '../daemon.js'

/** REST base: /api. Auth: httpOnly cookie `gonggong_session`. Errors: { error: ErrorCode, message }. */
export const ErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
  'must_change_password',
  'code_expired',
  'code_locked',
  /** POST /api/messages/:id/recall past RECALL_WINDOW_MS. */
  'recall_expired',
  /** PATCH /api/messages/:id past RECALL_WINDOW_MS. */
  'edit_expired',
  'payload_too_large',
  'rate_limited',
])
export const ApiError = z.object({ error: ErrorCode, message: z.string() })

// ── Users & auth ────────────────────────────────────────────────────────────
export const Role = z.enum(['sysadmin', 'member'])
export const UserDto = z.object({
  id: z.string(),
  account: z.string(),
  name: z.string(),
  role: Role,
  mustChangePassword: z.boolean(),
  disabled: z.boolean(),
  gitProtocol: GitProtocol,
  email: z.string().nullable(),
  /** Image URL (uploaded file or Feishu avatar); null = generated from the name. */
  avatar: z.string().nullable(),
})
export type UserDto = z.infer<typeof UserDto>
/** 通知 per member and conversation: everything, only @ (incl. @所有人), or nothing (plan 未读与通知). */
export const NotifyLevel = z.enum(['all', 'mentions', 'off'])
export type NotifyLevel = z.infer<typeof NotifyLevel>
/** 勿扰: push is held back while paused or inside the daily quiet hours (HH:mm in `timezone`, may cross midnight). */
export const NotifyPrefs = z.object({
  pausedUntil: z.string().nullable().optional(),
  quietHours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      timezone: z.string().min(1),
    })
    .nullable()
    .optional(),
})
export type NotifyPrefs = z.infer<typeof NotifyPrefs>
/** PATCH /api/me: the caller's own preferences and profile (same name rule as sign-up); `email: ''` clears it. */
export const UpdateMeReq = z.object({
  gitProtocol: GitProtocol.optional(),
  name: z.string().trim().min(1).max(40).optional(),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email().max(120))]).optional(),
  /** Merged into the stored prefs; null clears a field. */
  notifyPrefs: NotifyPrefs.optional(),
})
/** PUT /api/{me,teams/:id,bots/:id,groups/:id}/avatar (multipart `file`): raster images only, SVG could carry script. */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export const LoginReq = z.object({ account: z.string(), password: z.string() })
export const ChangePasswordReq = z.object({ oldPassword: z.string(), newPassword: z.string().min(8) })
/** Minimal user reference for pickers (GET /api/users). */
export const UserBriefDto = z.object({
  id: z.string(),
  name: z.string(),
  account: z.string(),
  avatar: z.string().nullable(),
})
export type UserBriefDto = z.infer<typeof UserBriefDto>
/** GET /api/users/:id/card?groupId= — hover card; `groupAdmin` is for `groupId`, `online` = has a live web session. */
export const UserCardDto = UserBriefDto.extend({ role: Role, groupAdmin: z.boolean(), online: z.boolean() })
export type UserCardDto = z.infer<typeof UserCardDto>

const Account = z.string().regex(/^[a-z0-9_.-]{2,32}$/)
export const CreateUserReq = z.object({
  account: Account,
  name: z.string().min(1),
  role: Role,
  password: z.string().min(8),
})
/** POST /api/auth/register — self sign-up, only while the sysadmin has opened it (系统参数 · 开放注册). */
export const RegisterReq = z.object({
  account: Account,
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8),
  /** A valid team invite allows signing up while registration is closed, and joins its team (plan D12). */
  inviteToken: z.string().optional(),
})
/** GET /api/auth/options — public: what the login page may offer. */
export const AuthOptionsDto = z.object({
  registrationOpen: z.boolean(),
  /** The main Feishu app is configured: the login page offers 飞书登录. */
  feishuLogin: z.boolean(),
  /** True when Feishu login is enabled and first-time Feishu users may create an account without open sign-up. */
  feishuAutoSignup: z.boolean().optional(),
})
export type AuthOptionsDto = z.infer<typeof AuthOptionsDto>
export const UpdateUserReq = z.object({ name: z.string().min(1).optional(), role: Role.optional() })
/** POST /api/admin/users/:id/password — temporary password; the member must change it at next login. */
export const ResetPasswordReq = z.object({ password: z.string().min(8) })
/** Row of the admin 账号与角色 table. */
export const AdminUserDto = UserDto.extend({
  machineCount: z.number().int(),
  online: z.boolean(),
  /** Names of the live teams the account belongs to. */
  teams: z.array(z.string()),
})
export type AdminUserDto = z.infer<typeof AdminUserDto>
