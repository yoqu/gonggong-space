import { type FeishuIssue, feishuErrorHint } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import { fail } from '../../lib/errors.js'
import type { FeishuError } from './client.js'

/**
 * Why each group bot's app last failed to join the bound chat, shown on 群设置 · 飞书 until it gets in. Kept in memory:
 * after a restart the bot still shows as outside the chat, only without the reason.
 */
const issues = new WeakMap<Ctx, Map<string, FeishuIssue>>()

function of(ctx: Ctx) {
  let m = issues.get(ctx)
  if (!m) {
    m = new Map()
    issues.set(ctx, m)
  }
  return m
}

export const issueOf = (err: FeishuError): FeishuIssue => ({ code: err.code, message: err.message })

export function setBotIssue(ctx: Ctx, groupId: string, botId: string, issue: FeishuIssue | null) {
  if (issue) of(ctx).set(`${groupId}:${botId}`, issue)
  else of(ctx).delete(`${groupId}:${botId}`)
}

export const botIssue = (ctx: Ctx, groupId: string, botId: string) =>
  of(ctx).get(`${groupId}:${botId}`) ?? null

/** Plain-words params of an event or error about `err`: what happened and what to do. */
export function hintParams(err: FeishuIssue) {
  const h = feishuErrorHint(err.code)
  return { what: { key: h.what }, todo: { key: h.todo } }
}

/** A failed Feishu call as a 共工 error: plain words first, Feishu's code and message after. */
export const failFeishu = (prefix: '飞书调用失败' | '拉入飞书群失败', err: FeishuIssue): never =>
  fail(
    'invalid',
    prefix === '飞书调用失败'
      ? '飞书调用失败：{what}{todo}（飞书错误码 {code}：{reason}）'
      : '拉入飞书群失败：{what}{todo}（飞书错误码 {code}：{reason}）',
    { ...hintParams(err), code: err.code, reason: err.message },
  )
