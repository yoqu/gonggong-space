import { z } from 'zod'
import type { ProtocolKey } from './i18n-en.js'

/** A failed Feishu call: Feishu's error code and its own message, shown after the plain words of `feishuErrorHint`. */
export const FeishuIssue = z.object({ code: z.number().int(), message: z.string() })
export type FeishuIssue = z.infer<typeof FeishuIssue>

/** A group event about a failed Feishu call; `botId` is the bot whose own app failed (null: the main app). */
export const FeishuIssueEvent = FeishuIssue.extend({ botId: z.string().nullable() })
export type FeishuIssueEvent = z.infer<typeof FeishuIssueEvent>

export interface FeishuErrorHint {
  /** What happened, in plain words. */
  what: ProtocolKey
  /** What the reader can do about it. */
  todo: ProtocolKey
  /** The bot's own app is not in the chat: 拉入飞书群 fixes it. */
  pullIn?: true
}

const hint = (codes: number[], h: FeishuErrorHint) => codes.map((c) => [c, h] as const)

/**
 * Feishu's codes per its server docs (im/v1 message create, chat members create, common errors) and what 共工 saw in
 * tests (plan 飞书联动 §5): 20010 out of the availability range, 99991672 scope not in effect yet.
 */
const HINTS = new Map<number, FeishuErrorHint>([
  ...hint([230002], {
    what: '机器人不在飞书群里。',
    todo: '请群管理员把它拉入飞书群，或在飞书群设置里添加该机器人。',
    pullIn: true,
  }),
  ...hint([232011], {
    what: '共工主应用不在飞书群里，无法替你拉入成员或机器人。',
    todo: '请在飞书群设置 › 群机器人里添加共工主应用后重试。',
  }),
  ...hint([230006, 232025], {
    what: '飞书应用没有开启机器人能力。',
    todo: '请应用管理员在飞书开放平台的「应用能力」里添加机器人，并发布新版本。',
  }),
  ...hint([230013, 232024, 232034, 20010], {
    what: '飞书应用还没发布，或相关成员不在它的可用范围内。',
    todo: '请应用管理员在飞书开放平台发布应用版本，并在飞书管理后台把可用范围设为需要的成员。',
  }),
  ...hint([232017], {
    what: '飞书群设置了仅群主和管理员可添加成员。',
    todo: '请飞书群主在群设置里改为所有人可添加，或把共工主应用设为群管理员。',
  }),
  ...hint([230018, 230035], {
    what: '飞书群开启了禁言或仅部分成员可发言，机器人发不了消息。',
    todo: '请飞书群主在群设置里允许机器人发言。',
  }),
  ...hint([232009], {
    what: '飞书群已解散。',
    todo: '请在群设置 · 飞书里解绑，再绑定或新建飞书群。',
  }),
  ...hint([99991672, 230027, 20027], {
    what: '飞书应用缺少所需权限，或新开通的权限还没生效。',
    todo: '请应用管理员在飞书开放平台开通所需权限（或在共工里点「更新权限」扫码确认），并发布版本。',
  }),
  ...hint([10014], {
    what: '飞书应用的凭证已失效。',
    todo: '请系统管理员检查 App Secret 是否被重置，并在共工里重新填写该飞书应用。',
  }),
  ...hint([99991668], {
    what: '你的飞书授权已过期。',
    todo: '请在个人设置里重新绑定飞书账号。',
  }),
  ...hint([230020, 232019], {
    what: '调用飞书太频繁，被临时限流。',
    todo: '稍等片刻再试。',
  }),
])

const UNKNOWN: FeishuErrorHint = {
  what: '飞书返回了错误。',
  todo: '请稍后重试；仍然失败时，把错误码发给系统管理员。',
}

/** Whether 共工 can explain the code (network failures, code 0, and unconfirmed codes are not). */
export const isKnownFeishuError = (code: number) => HINTS.has(code)

/** What a Feishu error code means for the reader and what they can do about it. */
export const feishuErrorHint = (code: number): FeishuErrorHint => HINTS.get(code) ?? UNKNOWN
