import { type AuditDto, type AuditQuery, SYSTEM_PARAM_VIEW } from '@gonggong/protocol'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { auditLogs, bots, groups, runs, users } from '../../db/schema.js'
import { type MessageKey, t } from '../../i18n/index.js'
import { idParam } from '../../lib/ids.js'

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

const APPROVAL: Record<string, MessageKey> = {
  approved: '批准 {bot} 执行 {title}',
  rejected: '拒绝 {bot} 执行 {title}',
  expired: '超时自动拒绝 {bot} 执行 {title}',
}
const VOID_REASON: Record<string, MessageKey> = {
  stopped: '已 /stop',
  chain_stopped: '接力链已终止',
  ended: '运行已结束',
}
const QUESTION: Record<string, MessageKey> = {
  answered: '回答 {bot} 的 {n} 个问题',
  expired: '{bot} 的 {n} 个问题超时未答',
}
const MCP: Record<string, MessageKey> = { 'mcp.create': '添加', 'mcp.update': '修改', 'mcp.delete': '删除' }
const LAYER: Record<string, MessageKey> = { platform: '平台层', team: '团队层', group: '群层' }
const ROLE: Record<string, MessageKey> = { sysadmin: '系统管理员', member: '普通成员' }
const TOOL: Record<string, string> = { node: 'Node.js', claude: 'Claude Code', codex: 'Codex' }
const PROVIDERS: Record<string, MessageKey> = {
  'machine.providers.save': '保存机器的供应商',
  'machine.providers.remove': '删除机器的供应商',
  'machine.providers.default': '修改机器的默认供应商',
  'machine.providers.import': '导入机器的供应商',
}

const TEAM_ROLE: Record<string, MessageKey> = { owner: '所有者', admin: '管理员', member: '成员' }
const teamRole = (v: unknown) => (TEAM_ROLE[str(v)] ? t(TEAM_ROLE[str(v)] as MessageKey) : str(v))
const role = (v: unknown) => (ROLE[str(v)] ? t(ROLE[str(v)] as MessageKey) : str(v))

function paramChanges(d: Detail) {
  const changes = (d.changes ?? {}) as Record<string, [unknown, unknown]>
  const numeric = SYSTEM_PARAM_VIEW.filter((p) => p.key in changes).map(({ key, label, unit }) => {
    const [from, to] = changes[key] as [unknown, unknown]
    return `${t(label as MessageKey)} ${from} → ${to} ${t(unit as MessageKey)}`
  })
  const reg = changes.registrationOpen
    ? [t(changes.registrationOpen[1] ? '开放自助注册' : '关闭自助注册')]
    : []
  const single = changes.singleTeamMode
    ? [t(changes.singleTeamMode[1] ? '开启单团队模式' : '关闭单团队模式')]
    : []
  const creation = changes.teamCreation
    ? [t(changes.teamCreation[1] === 'all' ? '建团队权限改为所有人' : '建团队权限改为仅系统管理员')]
    : []
  const feishu = changes.feishuAutoSignup
    ? [t(changes.feishuAutoSignup[1] ? '开启飞书自动开户' : '关闭飞书自动开户')]
    : []
  const url = changes.publicUrl
    ? [t('对外地址改为 {url}', { url: str(changes.publicUrl[1]) || t('未设置') })]
    : []
  const demo = changes.demoMode ? [t(changes.demoMode[1] ? '开启演示模式' : '关闭演示模式')] : []
  return [...reg, ...single, ...creation, ...feishu, ...url, ...demo, ...numeric].join(t('；'))
}

/** One-line description of an audit row (prototype 审计记录); unknown actions fall back to the action id. */
export function summarize(row: Pick<Row, 'category' | 'action'>, d: Detail, n: Names): string {
  const bot = n.runBot(d.runId)
  switch (row.category) {
    case 'approval': {
      const title = str(d.title)
      if (row.action === 'void') {
        const reason = VOID_REASON[str(d.reason)]
        return t('{bot} 的审批请求作废：{title}（{reason}）', {
          bot,
          title,
          reason: reason ? t(reason) : str(d.reason),
        })
      }
      const approval = APPROVAL[row.action]
      return approval ? t(approval, { bot, title }) : `${row.action} ${bot} ${title}`
    }
    case 'question':
      return t(QUESTION[row.action] ?? '{bot} 的 {n} 个问题已作废', { bot, n: count(d.questions) })
    case 'run':
      switch (row.action) {
        case 'command.stop': {
          const names = ids(d.botIds).map(n.bot)
          return names.length
            ? t('/stop 中断 {bots}', { bots: names.join('、') })
            : t('/stop 中断本群全部轮次')
        }
        case 'run.stop':
          return t('/stop 中断 {bots}', { bots: bot })
        case 'run.stop_chain':
          return t('终止 {bot} 所在的整条接力链', { bot })
        case 'run.keep':
          return t('保留 {bot} 被中断轮次的改动', { bot })
        case 'run.discard':
          return d.ok === false
            ? t('丢弃 {bot} 被中断轮次的改动（失败：{error}）', { bot, error: str(d.error) })
            : t('丢弃 {bot} 被中断轮次的改动', { bot })
        case 'command.cd':
          return d.path
            ? `/cd ${n.bot(d.botId)} → ${str(d.path)}`
            : t('/cd {bot} 恢复托管工作区', { bot: n.bot(d.botId) })
        case 'command.new':
          return t('/new {bot} 开新会话', { bot: n.bot(d.botId) })
        case 'run.task_stop':
          return t('中断 {bot} 的后台任务', { bot })
        case 'tool.cross_group_read':
          return t('{bot} 跨群读取 {n} 个群的内容', { bot, n: count(d.groups) })
      }
      break
    case 'admin':
      if (row.action in PROVIDERS) return t(PROVIDERS[row.action] as MessageKey)
      if (row.action in MCP)
        return t('{verb}{layer} MCP：{state} {name} · {forced}强制新会话', {
          verb: { key: MCP[row.action] as MessageKey },
          layer: { key: LAYER[str(d.layer)] ?? '平台层' },
          state: { key: d.enabled === false ? '停用' : '启用' },
          name: str(d.name),
          forced: { key: d.forceNewSession ? '已勾选' : '未勾选' },
        })
      switch (row.action) {
        case 'bot.create':
          return t('为 {user} 新建 Bot {name}', { user: n.user(d.ownerId), name: str(d.name) })
        case 'bot.update':
          return t('修改 {user} 的 Bot {name}', { user: n.user(d.ownerId), name: str(d.name) })
        case 'bot.delete':
          return t('删除 {user} 的 Bot {name}', { user: n.user(d.ownerId), name: str(d.name) })
        case 'bot.confirm':
          return t('确认 Bot {name}', { name: str(d.name) })
        case 'bot.approval':
          return t('修改 Bot {name} 的审批设置', { name: str(d.name) })
        case 'feishu.app.save':
          return d.kind === 'main'
            ? t('配置飞书主应用 {appId}', { appId: str(d.appId) })
            : t('为 Bot {bot} 绑定飞书应用 {appId}', { bot: n.bot(d.botId), appId: str(d.appId) })
        case 'feishu.app.remove':
          return d.kind === 'main'
            ? t('移除飞书主应用 {appId}', { appId: str(d.appId) })
            : t('解除 Bot {bot} 的飞书应用 {appId}', { bot: n.bot(d.botId), appId: str(d.appId) })
        case 'user.create':
          return t('新建账号 {account}（{role}）', { account: str(d.account), role: role(d.role) })
        case 'user.update': {
          const parts = [
            d.name === undefined ? '' : t('姓名改为 {name}', { name: str(d.name) }),
            d.role === undefined ? '' : t('角色改为 {role}', { role: role(d.role) }),
          ].filter(Boolean)
          return t('修改账号 {user}：{changes}', { user: n.user(d.userId), changes: parts.join(t('，')) })
        }
        case 'user.password.reset':
          return t('重置 {account} 的密码', { account: str(d.account) })
        case 'user.register':
          return d.via === 'feishu'
            ? t('飞书登录新建账号 {account}', { account: str(d.account) })
            : t('自助注册账号 {account}', { account: str(d.account) })
        case 'user.feishu.link':
          return t('绑定飞书身份 {name}', { name: str(d.feishu) })
        case 'user.feishu.unlink':
          return t('解绑飞书身份')
        case 'user.disable':
          return t('停用账号 {account}', { account: str(d.account) })
        case 'team.create':
          return t('新建团队 {name}', { name: str(d.name) })
        case 'team.update':
          return t(d.params === undefined ? '修改团队名称与头像' : '修改团队参数')
        case 'team.archive':
          return t('归档团队 {name}', { name: str(d.name) })
        case 'team.unarchive':
          return t('恢复团队 {name}', { name: str(d.name) })
        case 'team.owner':
          return t('指定 {name} 为团队所有者', { name: str(d.name) })
        case 'team.member.add':
          return t('将 {name} 加入团队（{role}）', { name: str(d.name), role: teamRole(d.role) })
        case 'team.member.role':
          return t('将 {name} 的团队角色改为{role}', { name: str(d.name), role: teamRole(d.role) })
        case 'team.member.remove':
          return t('将 {name} 移出团队', { name: str(d.name) })
        case 'team.leave':
          return t('退出团队')
        case 'team.transfer':
          return t('将团队所有权转让给 {name}', { name: str(d.name) })
        case 'team.invite.create':
          return t('创建团队邀请链接（{role}）', { role: teamRole(d.role) })
        case 'team.invite.revoke':
          return t('撤销团队邀请链接')
        case 'team.invite.accept':
          return t('通过邀请链接加入团队（{role}）', { role: teamRole(d.role) })
        case 'user.enable':
          return t('启用账号 {account}', { account: str(d.account) })
        case 'daemon.release':
          return t('发布 daemon {version}（{platforms}）', {
            version: str(d.version),
            platforms: (d.platforms as string[]).join('、'),
          })
        case 'daemon.release.upload':
        case 'daemon.release.remove':
          return t(
            row.action.endsWith('upload')
              ? '上传 {kind} {version}（{platform}）'
              : '移除 {kind} {version}（{platform}）',
            {
              kind: d.kind === 'cast' ? 'gg-cast' : d.kind === 'desktop' ? t('桌面端') : 'daemon',
              version: str(d.version),
              platform: str(d.platform),
            },
          )
        case 'machine.revoke':
          return t('吊销 {user} 的机器 {name}', { user: n.user(d.ownerId), name: str(d.name) })
        case 'machine.transfer':
          return t('将 {user} 的机器 {name} 转移到名下', { user: n.user(d.fromOwnerId), name: str(d.name) })
        case 'machine.tools.install':
        case 'machine.tools.upgrade':
          return t(row.action.endsWith('install') ? '安装 {tool}' : '升级 {tool}', {
            tool: TOOL[str(d.kind)] ?? str(d.kind),
          })
        case 'machine.tools.settings':
          return t('修改 Agent 工具的镜像源')
        case 'bot.provider':
          return t('设置 Bot {bot} 的供应商', { bot: n.bot(d.botId) })
        case 'params.update':
          return t('修改系统参数：{changes}', { changes: paramChanges(d) })
        case 'group.update':
          return t('修改群名称与公告')
        case 'group.notice.remove':
          return t('删除群公告')
        case 'group.params':
          return t(
            '修改群级参数：审批等待 {approval} 分钟，接力链长上限 {hops} 跳，离线等待 {offline} 分钟',
            {
              approval: String(d.approvalTimeoutMin),
              hops: String(d.chainMaxHops),
              offline: String(d.offlineWaitMin),
            },
          )
        case 'group.admin.grant':
          return t('设 {user} 为群管理员', { user: str(d.userName) })
        case 'group.admin.revoke':
          return t('取消 {user} 的群管理员', { user: str(d.userName) })
        case 'group.dissolve':
          return t('解散群')
        case 'group.takeover':
          return t('以团队管理员身份接管群')
        case 'group.member.add':
          return t('邀请 {name} 入群', { name: str(d.name) })
        case 'group.member.remove':
          return t('将 {name} 移出群', { name: str(d.name) })
        case 'group.bot.add':
          return t('拉入 Bot {name}', { name: str(d.name) })
        case 'group.bot.remove':
          return t('移出 Bot {name}', { name: str(d.name) })
        case 'group.repo.change':
          return t(d.previous ? '更换仓库 {url} · 基准分支 {branch}' : '绑定仓库 {url} · 基准分支 {branch}', {
            url: str(d.url),
            branch: str(d.branch),
          })
      }
      break
    case 'preview':
      switch (row.action) {
        case 'share.create':
          return t('生成预览「{title}」的公开链接，有效 {n} 天', { title: str(d.title), n: Number(d.days) })
        case 'share.revoke':
          return t('收回预览「{title}」的公开链接', { title: str(d.title) })
        case 'share.extend':
          return t('预览「{title}」的公开链接有效期改到 {at}', {
            title: str(d.title),
            at: str(d.expiresAt).slice(0, 16).replace('T', ' '),
          })
        case 'share.visit':
          return t('通过公开链接访问预览「{title}」', { title: str(d.title) })
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
        q.teamId ? eq(auditLogs.teamId, idParam(q.teamId, '团队不存在')) : undefined,
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
