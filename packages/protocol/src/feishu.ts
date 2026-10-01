import { z } from 'zod'

// ── 飞书联动 (plan 飞书联动-开发计划) ──

/** Long connection of one app to the Feishu open platform. */
export const FeishuAppStatus = z.enum(['connecting', 'connected', 'error'])
export type FeishuAppStatus = z.infer<typeof FeishuAppStatus>

/** A configured app; the secret never leaves the server. */
export const FeishuAppDto = z.object({
  appId: z.string(),
  status: FeishuAppStatus,
  error: z.string().nullable(),
  /** Dev config not applied yet (e.g. the first version awaits approval); retried automatically. */
  configError: z.string().nullable(),
  updatedAt: z.string(),
})
export type FeishuAppDto = z.infer<typeof FeishuAppDto>

/** GET /api/admin/feishu (main app, sysadmin) and GET /api/bots/:id/feishu (bot app); null = not configured. */
export const FeishuAppView = z.object({ app: FeishuAppDto.nullable() })
export type FeishuAppView = z.infer<typeof FeishuAppView>

/** PUT /api/admin/feishu, PUT /api/bots/:id/feishu: the credentials are checked against Feishu before saving. */
export const FeishuAppReq = z.object({
  appId: z.string().trim().min(1),
  appSecret: z.string().trim().min(1),
})
export type FeishuAppReq = z.infer<typeof FeishuAppReq>

/** The Feishu chat a group is bound to. */
export const FeishuChatDto = z.object({
  groupId: z.string(),
  chatId: z.string(),
  name: z.string(),
  boundAt: z.string(),
})
export type FeishuChatDto = z.infer<typeof FeishuChatDto>

/** The caller's Feishu identity (飞书登录 / 个人设置 binding). */
export const FeishuIdentityDto = z.object({
  name: z.string(),
  avatar: z.string().nullable(),
  email: z.string().nullable(),
  boundAt: z.string(),
})
export type FeishuIdentityDto = z.infer<typeof FeishuIdentityDto>

/** GET /api/auth/feishu/ticket/:ticket — a first 飞书登录 waiting for 绑定已有账号 / 新建账号 (10 minutes, one use). */
export const FeishuTicketDto = z.object({
  name: z.string(),
  email: z.string().nullable(),
  avatar: z.string().nullable(),
  /** 新建账号 is offered: 飞书自动开户 is on, or the login started from a usable team invite. */
  canCreate: z.boolean(),
  /** Where to land once signed in. */
  next: z.string(),
})
export type FeishuTicketDto = z.infer<typeof FeishuTicketDto>

/** POST /api/auth/feishu/ticket/:ticket/bind — link the Feishu identity to an existing account. */
export const FeishuBindReq = z.object({ account: z.string(), password: z.string() })

/** GET /api/me/feishu — the caller's linked Feishu identity, if any. */
export const FeishuIdentityView = z.object({ identity: FeishuIdentityDto.nullable() })
export type FeishuIdentityView = z.infer<typeof FeishuIdentityView>

/** A group bot as seen from the bound chat: whether its own app is set up and is in the chat. */
export const GroupFeishuBotDto = z.object({
  botId: z.string(),
  name: z.string(),
  /** null: the bot has no Feishu app. */
  appId: z.string().nullable(),
  inChat: z.boolean(),
})
export type GroupFeishuBotDto = z.infer<typeof GroupFeishuBotDto>

/** GET /api/groups/:id/feishu (group admins). `available` is false until the main app is configured. */
export const GroupFeishuView = z.object({
  available: z.boolean(),
  chat: FeishuChatDto.nullable(),
  /** The main app's chats not bound to another group, to pick from. */
  chats: z.array(z.object({ chatId: z.string(), name: z.string() })),
  bots: z.array(GroupFeishuBotDto),
})
export type GroupFeishuView = z.infer<typeof GroupFeishuView>

/** PUT /api/groups/:id/feishu: bind the group to one of the main app's chats (one to one). */
export const BindFeishuChatReq = z.object({ chatId: z.string().trim().min(1) })

/** 扫码创建 / 更新权限 session of a Feishu app (device authorization; the QR expires with it). */
export const FeishuRegisterStatus = z.enum(['waiting', 'succeeded', 'failed', 'expired', 'cancelled'])
export type FeishuRegisterStatus = z.infer<typeof FeishuRegisterStatus>

/** POST /api/admin/feishu/register, POST /api/bots/:id/feishu/register; `update` re-confirms the bound app's scopes. */
export const FeishuRegisterReq = z.object({ update: z.boolean().default(false) })
export type FeishuRegisterReq = z.infer<typeof FeishuRegisterReq>

/** GET /api/feishu/register/:id */
export const FeishuRegisterDto = z.object({
  id: z.string(),
  /** Open in Feishu (scan as a QR code). */
  url: z.string(),
  expiresAt: z.string(),
  status: FeishuRegisterStatus,
  error: z.string().nullable(),
  /** The saved app once succeeded. */
  app: FeishuAppDto.nullable(),
  /** Why long connection / redirect URL could not be set automatically: the admin sets them in the developer console. */
  configError: z.string().nullable(),
})
export type FeishuRegisterDto = z.infer<typeof FeishuRegisterDto>
