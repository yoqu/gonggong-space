import { type AuditDto, type AuditQuery, SYSTEM_PARAM_VIEW } from '@gonggong/protocol'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { auditLogs, bots, groups, runs, users } from '../../db/schema.js'

type Row = typeof auditLogs.$inferSelect
type Detail = Record<string, unknown>
interface Names {
  user: (id: unknown) => string
  bot: (id: unknown) => string
  runBot: (id: unknown) => string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)

const APPROVAL: Record<string, string> = { approved: '批准', rejected: '拒绝', expired: '超时自动拒绝' }
const VOID_REASON: Record<string, string> = {
  stopped: '已 /stop',
  chain_stopped: '接力链已终止',
  ended: '运行已结束',
}
const MCP: Record<string, string> = { 'mcp.create': '添加', 'mcp.update': '修改', 'mcp.delete': '删除' }
const ROLE: Record<string, string> = { sysadmin: '系统管理员', member: '普通成员' }

const paramValue = (v: unknown, unit: string) => (v === null ? '未设置' : `${v}${unit}`)

function paramChanges(d: Detail) {
  const changes = (d.changes ?? {}) as Record<string, [unknown, unknown]>
  const numeric = SYSTEM_PARAM_VIEW.filter((p) => p.key in changes).map(({ key, label, unit }) => {
    const [from, to] = changes[key] as [unknown, unknown]
    return `${label} ${paramValue(from, '')} → ${paramValue(to, ` ${unit}`)}`
  })
  const reg = changes.registrationOpen ? [changes.registrationOpen[1] ? '开放自助注册' : '关闭自助注册'] : []
  return [...reg, ...numeric].join('；')
}

/** One-line Chinese description of an audit row (prototype 审计记录); unknown actions fall back to the action id. */
export function summarize(row: Pick<Row, 'category' | 'action'>, d: Detail, n: Names): string {
  const bot = n.runBot(d.runId)
  switch (row.category) {
    case 'approval':
      if (row.action === 'void')
        return `${bot} 的审批请求作废：${str(d.title)}（${VOID_REASON[str(d.reason)] ?? str(d.reason)}）`
      return `${APPROVAL[row.action] ?? row.action} ${bot} 执行 ${str(d.title)}`
    case 'question': {
      const q = `${bot} 的 ${count(d.questions)} 个问题`
      return row.action === 'answered'
        ? `回答 ${q}`
        : row.action === 'expired'
          ? `${q}超时未答`
          : `${q}已作废`
    }
    case 'run':
      switch (row.action) {
        case 'command.stop': {
          const names = ids(d.botIds).map(n.bot)
          return `/stop 中断 ${names.length ? names.join('、') : '本群全部轮次'}`
        }
        case 'run.stop':
          return `/stop 中断 ${bot}`
        case 'run.stop_chain':
          return `终止 ${bot} 所在的整条接力链`
        case 'run.keep':
          return `保留 ${bot} 被中断轮次的改动`
        case 'run.discard':
          return `丢弃 ${bot} 被中断轮次的改动${d.ok === false ? `（失败：${str(d.error)}）` : ''}`
        case 'command.cd':
          return d.path ? `/cd ${n.bot(d.botId)} → ${str(d.path)}` : `/cd ${n.bot(d.botId)} 恢复托管工作区`
        case 'command.new':
          return `/new ${n.bot(d.botId)} 开新会话`
        case 'run.task_stop':
          return `中断 ${bot} 的后台任务`
        case 'tool.cross_group_read':
          return `${bot} 跨群读取 ${count(d.groups)} 个群的内容`
      }
      break
    case 'admin':
      if (row.action in MCP)
        return `${MCP[row.action]}全局层 MCP：${d.enabled === false ? '停用' : '启用'} ${str(d.name)} · ${d.forceNewSession ? '已勾选' : '未勾选'}强制新会话`
      switch (row.action) {
        case 'bot.create':
          return `为 ${n.user(d.ownerId)} 新建 Bot ${str(d.name)}`
        case 'bot.update':
          return `修改 ${n.user(d.ownerId)} 的 Bot ${str(d.name)}`
        case 'bot.delete':
          return `删除 ${n.user(d.ownerId)} 的 Bot ${str(d.name)}`
        case 'bot.confirm':
          return `确认 Bot ${str(d.name)}`
        case 'bot.approval':
          return `修改 Bot ${str(d.name)} 的审批设置`
        case 'user.create':
          return `新建账号 ${str(d.account)}（${ROLE[str(d.role)] ?? str(d.role)}）`
        case 'user.update': {
          const parts = [
            d.name === undefined ? '' : `姓名改为 ${str(d.name)}`,
            d.role === undefined ? '' : `角色改为 ${ROLE[str(d.role)] ?? str(d.role)}`,
          ].filter(Boolean)
          return `修改账号 ${n.user(d.userId)}：${parts.join('，')}`
        }
        case 'user.password.reset':
          return `重置 ${str(d.account)} 的密码`
        case 'user.register':
          return `自助注册账号 ${str(d.account)}`
        case 'user.disable':
          return `停用账号 ${str(d.account)}`
        case 'user.enable':
          return `启用账号 ${str(d.account)}`
        case 'daemon.release':
          return `发布 daemon ${str(d.version)}（${(d.platforms as string[]).join('、')}）`
        case 'daemon.release.upload':
        case 'daemon.release.remove':
          return `${row.action.endsWith('upload') ? '上传' : '移除'} ${d.kind === 'cast' ? 'gg-cast' : 'daemon'} ${str(d.version)}（${str(d.platform)}）`
        case 'machine.revoke':
          return `吊销 ${n.user(d.ownerId)} 的机器 ${str(d.name)}`
        case 'machine.transfer':
          return `将 ${n.user(d.fromOwnerId)} 的机器 ${str(d.name)} 转移到名下`
        case 'params.update':
          return `修改系统参数：${paramChanges(d)}`
        case 'group.update':
          return '修改群名称与公告'
        case 'group.notice.remove':
          return '删除群公告'
        case 'group.params':
          return `修改群级参数：审批等待 ${d.approvalTimeoutMin} 分钟，接力链长上限 ${d.chainMaxHops} 跳，离线等待 ${d.offlineWaitMin} 分钟`
        case 'group.admin.grant':
          return `设 ${str(d.userName)} 为群管理员`
        case 'group.admin.revoke':
          return `取消 ${str(d.userName)} 的群管理员`
        case 'group.dissolve':
          return '解散群'
        case 'group.member.add':
          return `邀请 ${str(d.name)} 入群`
        case 'group.member.remove':
          return `将 ${str(d.name)} 移出群`
        case 'group.bot.add':
          return `拉入 Bot ${str(d.name)}`
        case 'group.bot.remove':
          return `移出 Bot ${str(d.name)}`
        case 'group.repo.change':
          return `${d.previous ? '更换' : '绑定'}仓库 ${str(d.url)} · 基准分支 ${str(d.branch)}`
      }
      break
    case 'preview':
      switch (row.action) {
        case 'share.create':
          return `生成预览「${str(d.title)}」的公开链接，有效 ${Number(d.days)} 天`
        case 'share.revoke':
          return `收回预览「${str(d.title)}」的公开链接`
        case 'share.extend':
          return `预览「${str(d.title)}」的公开链接有效期改到 ${str(d.expiresAt).slice(0, 16).replace('T', ' ')}`
        case 'share.visit':
          return `通过公开链接访问预览「${str(d.title)}」`
      }
  }
  return row.action
}

/** Newest first; `before` pages by id. Actor / group / bot names are resolved in batch. */
export async function listAudit(ctx: Ctx, q: z.infer<typeof AuditQuery>): Promise<AuditDto[]> {
  const rows = await ctx.db
    .select({ log: auditLogs, actorName: users.name, groupName: groups.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(groups, eq(groups.id, auditLogs.groupId))
    .where(
      and(
        q.category ? eq(auditLogs.category, q.category) : undefined,
        q.before ? lt(auditLogs.id, q.before) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(q.limit)
  const details = rows.map((r) => r.log.detail as Detail)
  const userIds = [...new Set(details.flatMap((d) => ids([d.userId, d.ownerId, d.fromOwnerId])))]
  const runIds = [...new Set(details.flatMap((d) => ids([d.runId])))]
  const botIds = [...new Set(details.flatMap((d) => ids([d.botId, ...ids(d.botIds)])))]
  const [userRows, runRows, botRows] = await Promise.all([
    userIds.length
      ? ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [],
    runIds.length
      ? ctx.db
          .select({ id: runs.id, name: bots.name })
          .from(runs)
          .innerJoin(bots, eq(bots.id, runs.botId))
          .where(inArray(runs.id, runIds))
      : [],
    botIds.length
      ? ctx.db.select({ id: bots.id, name: bots.name }).from(bots).where(inArray(bots.id, botIds))
      : [],
  ])
  const lookup = (list: { id: string; name: string }[]) => {
    const map = new Map(list.map((x) => [x.id, x.name]))
    return (id: unknown) => map.get(str(id)) ?? ''
  }
  const names: Names = { user: lookup(userRows), bot: lookup(botRows), runBot: lookup(runRows) }
  return rows.map(({ log, actorName, groupName }) => {
    const summary = summarize(log, log.detail as Detail, names)
    return {
      id: log.id,
      at: log.createdAt.toISOString(),
      category: log.category,
      actorName,
      action: log.action,
      groupName,
      summary: groupName ? `${summary} · ${groupName}` : summary,
      detail: log.detail as Detail,
    }
  })
}
