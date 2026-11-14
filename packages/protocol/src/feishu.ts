import { z } from 'zod'
import { FeishuIssue } from './feishu-errors.js'
import { GroupDto } from './web.js'

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
  /**
   * Whether the Feishu admin approved the app's first version: the dev config only goes through after (plan 飞书联动
   * §5.3). `unknown`: an app Feishu will not let 共工 modify, so the config call tells nothing.
   */
  review: z.enum(['approved', 'pending', 'unknown']),
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
  /** 网页消息同步到飞书群: web messages (and their run and preview cards) go to the chat. */
  syncOutbound: z.boolean(),
  /** 同步全部飞书消息: every user message in the chat comes in (no bot runs), not only those that @ a bot. */
  syncAll: z.boolean(),
})
export type FeishuChatDto = z.infer<typeof FeishuChatDto>

/** The caller's Feishu identity (飞书登录 / 个人设置 binding). */
export const FeishuIdentityDto = z.object({
  name: z.string(),
  avatar: z.string().nullable(),
  email: z.string().nullable(),
  boundAt: z.string(),
  /** 飞书通知: pushed notifications also arrive as a card in the main app's DM. */
  notify: z.boolean(),
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
/** PUT /api/me/feishu/notify */
export const FeishuNotifyReq = z.object({ notify: z.boolean() })

/** A group bot as seen from the bound chat: whether its own app is set up and is in the chat. */
export const GroupFeishuBotDto = z.object({
  botId: z.string(),
  name: z.string(),
  /** null: the bot has no Feishu app. */
  appId: z.string().nullable(),
  inChat: z.boolean(),
  /** Why adding its app to the chat last failed; cleared once it is in. */
  issue: FeishuIssue.nullable(),
})
export type GroupFeishuBotDto = z.infer<typeof GroupFeishuBotDto>

/** GET /api/groups/:id/feishu (group admins). `available` is false until the main app is configured. */
export const GroupFeishuView = z.object({
  available: z.boolean(),
  /** The main app's bot name in Feishu: chats are listed only where it is a member. */
  mainAppName: z.string().nullable(),
  chat: FeishuChatDto.nullable(),
  /** Why the main app could not read the bound chat (e.g. its secret was revoked); the settings stay usable. */
  feishuError: FeishuIssue.nullable(),
  /** The main app's chats not bound to another group, to pick from. */
  chats: z.array(z.object({ chatId: z.string(), name: z.string() })),
  bots: z.array(GroupFeishuBotDto),
  /** Group members and whether they linked Feishu (only those are pulled into a created chat). */
  members: z.array(z.object({ userId: z.string(), name: z.string(), linked: z.boolean() })),
})
export type GroupFeishuView = z.infer<typeof GroupFeishuView>

/** POST /api/groups/:id/feishu/sync-members: chat users pulled into the group and those left out. */
export const FeishuMemberSyncDto = z.object({
  added: z.number().int(),
  /** Not linked to any 共工 account. */
  skippedUnlinked: z.number().int(),
  /** Linked, but not a member of the group's team. */
  skippedNotInTeam: z.number().int(),
})
export type FeishuMemberSyncDto = z.infer<typeof FeishuMemberSyncDto>

/** GET /api/feishu/chats: chats to create a group from (the main app and the caller are in, not bound yet). */
export const FeishuChatChoicesDto = z.object({
  /** false until the main app is configured. */
  available: z.boolean(),
  mainAppName: z.string().nullable(),
  chats: z.array(z.object({ chatId: z.string(), name: z.string() })),
})
export type FeishuChatChoicesDto = z.infer<typeof FeishuChatChoicesDto>

/** POST /api/groups/from-feishu: a group in the current team, bound to the chat, with its linked users. */
export const CreateGroupFromFeishuReq = z.object({
  chatId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(60),
})
export const GroupFromFeishuDto = FeishuMemberSyncDto.extend({ group: GroupDto })
export type GroupFromFeishuDto = z.infer<typeof GroupFromFeishuDto>

/** PUT /api/groups/:id/feishu: bind the group to one of the main app's chats (one to one). */
export const BindFeishuChatReq = z.object({ chatId: z.string().trim().min(1) })
/** PATCH /api/groups/:id/feishu */
export const UpdateFeishuChatReq = z.object({
  syncOutbound: z.boolean().optional(),
  syncAll: z.boolean().optional(),
})

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

/** A bot and its own Feishu app, on 管理后台 · 飞书. */
export const FeishuOverviewBotDto = z.object({
  botId: z.string(),
  name: z.string(),
  teamName: z.string(),
  ownerName: z.string(),
  app: FeishuAppDto.nullable(),
})
export type FeishuOverviewBotDto = z.infer<typeof FeishuOverviewBotDto>

/** A group linked to a Feishu chat, on 管理后台 · 飞书. */
export const FeishuOverviewChatDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  teamName: z.string(),
  chatName: z.string(),
  boundAt: z.string(),
  /** Bots whose app is in the chat; null: not asked of Feishu here (群设置 · 飞书 shows it live). */
  botsInChat: z.number().int().nullable(),
  botsTotal: z.number().int(),
  /** The latest reason a bot's app could not join the chat, kept in memory since the server started. */
  issue: FeishuIssue.nullable(),
  /** The caller is in the group, so its settings open from here. */
  member: z.boolean(),
})
export type FeishuOverviewChatDto = z.infer<typeof FeishuOverviewChatDto>

/** GET /api/admin/feishu/overview (sysadmin): how far Feishu is set up, every bot's app and every linked chat. */
export const FeishuOverviewDto = z.object({
  publicUrl: z.string(),
  main: FeishuAppDto.nullable(),
  /** Accounts that linked Feishu. */
  linkedUsers: z.number().int(),
  /** Someone besides who connected the main app linked Feishu: the app's availability range reaches members. */
  othersLinked: z.boolean(),
  bots: z.array(FeishuOverviewBotDto),
  chats: z.array(FeishuOverviewChatDto),
})
export type FeishuOverviewDto = z.infer<typeof FeishuOverviewDto>
