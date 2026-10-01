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
