import type { BotDto, Tier, TriggerScope, UsageRowDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useEffect, useId, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  Icon,
  Presence,
  SearchField,
  Select,
  Tabs,
  Tag,
  Textarea,
  ToolbarButton,
  ToolbarGroup,
  toast,
} from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { TIER_LABEL } from '../runs/tier'
import { fmtTokens, UsageBars, useUsage } from '../usage/UsagePage'
import { DirPicker } from '../workspaces/DirPicker'
import { DeleteBotDialog } from './DeleteBotDialog'
import {
  AGENT_LABEL,
  agentCliVersion,
  agentLine,
  agentOutdated,
  BINDING_LABEL,
  botsApi,
  PRESENCE,
} from './model'
import { NewBotDialog } from './NewBotDialog'
import './bots.css'

const TIERS: Tier[] = ['read-only', 'workspace', 'full']
const FULL_HINT = '完全访问档位只允许指定名单触发'

function warning(bot: BotDto, userName: (id: string) => string) {
  const agent = AGENT_LABEL[bot.agentKind]
  if (bot.presence === 'pending_confirm')
    return {
      title: `等待 ${bot.ownerName} 确认`,
      desc: `${userName(bot.createdBy)} 为${bot.ownerName}创建并绑定到 ${bot.machineName}。机器主人在 daemon 或 Web 通知中确认后才能被触发。`,
    }
  if (bot.presence === 'pending_bind')
    return {
      title: '待绑定',
      desc: `${bot.ownerName} 绑定第一台机器并上报 ${agent} 后自动绑定，无需再操作；此前不能被触发。`,
    }
  if (bot.presence === 'agent_missing')
    return {
      title: `${agent} 未安装`,
      desc: `${bot.machineName} 未上报 ${agent}。在该机器安装并重新检测后自动可用。`,
    }
  if (agentOutdated(bot))
    return {
      title: 'agent 版本低于适配器要求',
      desc: `${bot.machineName} 上的 ${agentCliVersion(bot)} 低于 ACP 适配器要求的 ${bot.agentMinVersion}，可能无法正常运行，请升级该 CLI。`,
    }
  return null
}

function weekUsage(rows: UsageRowDto[]) {
  const runs = rows.reduce((n, r) => n + r.runs, 0)
  const tokens = rows.reduce((n, r) => n + r.totalTokens, 0)
  return `${tokens || !runs ? `${fmtTokens(tokens)} tokens` : '用量未上报'} · ${runs} 轮`
}

export function BotDetail({
  bot,
  me,
  users,
  plain,
}: {
  bot: BotDto
  me: UserDto
  users: UserBriefDto[]
  /** Embedded in a dialog: no card chrome. */
  plain?: boolean
}) {
  const [prompt, setPrompt] = useState(bot.systemPrompt)
  const [scope, setScope] = useState<TriggerScope>(bot.triggerScope)
  const [list, setList] = useState(bot.triggerList)
  const [tier, setTier] = useState<Tier>(bot.tier)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [picking, setPicking] = useState(false)
  const promptId = useId()
  const canEdit = me.id === bot.ownerId || me.role === 'sysadmin'
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'
  const warn = warning(bot, userName)
  const usage = useUsage(`by=user&days=7&botId=${bot.id}`).rows

  const save = async () => {
    setSaving(true)
    try {
      await botsApi.update(bot.id, { systemPrompt: prompt, triggerScope: scope, triggerList: list, tier })
      toast({ type: 'success', message: `${bot.name} 已保存 · 下一次新开会话时生效` })
    } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }
  const setDefault = (path: string | null) =>
    botsApi
      .setDefaultWorkspace(bot.id, path)
      .then(() => setPicking(false))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))
  const confirm = () =>
    botsApi
      .confirm(bot.id)
      .then((b) => toast({ type: 'success', message: `${b.name} 已确认` }))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  return (
    <aside className={cx('bots-detail', plain && 'bots-detail--plain')} aria-label="Bot 详情">
      <div className="bots-detail__head">
        <span className="bots-detail__name">{bot.name}</span>
        <span className="bots-detail__meta">
          {AGENT_LABEL[bot.agentKind]} · {bot.ownerName}
        </span>
      </div>

      <div className="bots-detail__field">
        <label className="bots-detail__label" htmlFor={promptId}>
          系统提示词 · 同时作为群内简介
        </label>
        <Textarea
          id={promptId}
          rows={3}
          value={prompt}
          disabled={!canEdit}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <span className="bots-detail__hint">
          下一次新开会话时生效 · 优先级：仓库基线 &lt; 本提示词 &lt; 全局层 &lt; 群层
        </span>
      </div>

      {me.id === bot.ownerId && bot.machineId ? (
        <div className="bots-detail__field">
          <span className="bots-detail__label">默认工作区</span>
          <div className="bots-detail__workspace">
            <span className="bots-detail__path" data-testid="default-workspace">
              {bot.defaultWorkspace ?? '未设置'}
            </span>
            <Button size="small" onClick={() => setPicking(true)}>
              选择
            </Button>
            {bot.defaultWorkspace ? (
              <Button size="small" onClick={() => void setDefault(null)}>
                清除
              </Button>
            ) : null}
          </div>
          <span className="bots-detail__hint">进群时自动使用；群绑定了仓库时需与其 remote 一致</span>
          <Presence>
            {picking ? (
              <DirPicker
                machineId={bot.machineId}
                title="默认工作区"
                start={bot.defaultWorkspace}
                onPick={(path) => void setDefault(path)}
                onClose={() => setPicking(false)}
              />
            ) : null}
          </Presence>
        </div>
      ) : null}

      <div className="bots-detail__field">
        <span className="bots-detail__label">触发范围</span>
        <div title={tier === 'full' ? FULL_HINT : undefined}>
          <Tabs<TriggerScope>
            size="sm"
            value={scope}
            onChange={setScope}
            items={[
              { value: 'all', label: '任何群成员', disabled: !canEdit || tier === 'full' },
              { value: 'list', label: '指定名单', disabled: !canEdit },
              { value: 'self', label: '仅本人', disabled: !canEdit },
            ]}
          />
        </div>
        {tier === 'full' ? <span className="bots-detail__hint">{FULL_HINT}</span> : null}
        {scope === 'list' ? (
          <div className="bots-detail__chips">
            {list.map((id) => (
              <span key={id} className="bots-chip">
                {userName(id)}
                {canEdit ? (
                  <button
                    type="button"
                    className="bots-chip__remove"
                    aria-label={`移除 ${userName(id)}`}
                    onClick={() => setList(list.filter((x) => x !== id))}
                  >
                    <Icon name="xmark" size={10} weight={2} />
                  </button>
                ) : null}
              </span>
            ))}
            {canEdit ? (
              <div className="bots-chip__add">
                <Select
                  label="添加触发人"
                  placeholder="+ 添加成员"
                  value={null}
                  options={users
                    .filter((u) => !list.includes(u.id))
                    .map((u) => ({ value: u.id, label: u.name }))}
                  onChange={(id) => setList([...list, id])}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="bots-detail__field">
        <span className="bots-detail__label">默认权限档位</span>
        <Tabs<Tier>
          size="sm"
          value={tier}
          onChange={(v) => {
            setTier(v)
            if (v === 'full' && scope === 'all') setScope('list')
          }}
          items={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t], disabled: !canEdit }))}
        />
      </div>

      <div className="bots-detail__grid">
        <div>
          <span>并发上限</span>
          {bot.concurrency} 个群并行
        </div>
        <div>
          <span>所在群</span>
          {bot.groupCount} 个
        </div>
        <div>
          <span>agent 版本</span>
          <code>{agentCliVersion(bot)}</code>
        </div>
        <div>
          <span>近 7 天用量</span>
          {usage ? weekUsage(usage) : '—'}
        </div>
      </div>

      {warn ? (
        <Alert variant="warning" title={warn.title} description={warn.desc}>
          {bot.presence === 'pending_confirm' && me.id === bot.ownerId ? (
            <div className="bots-detail__confirm">
              <Button variant="primary" onClick={() => void confirm()}>
                确认
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      <div className="bots-detail__field">
        <span className="bots-detail__label">谁用了这个 Bot · 近 7 天</span>
        {usage?.length ? (
          <UsageBars rows={usage} compact />
        ) : (
          <span className="bots-detail__hint">{usage ? '近 7 天无人使用' : '—'}</span>
        )}
      </div>

      {canEdit ? (
        <div className="bots-detail__actions">
          <Button variant="plain" className="bots-detail__delete" onClick={() => setDeleting(true)}>
            删除
          </Button>
          <span className="spacer" />
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            保存
          </Button>
        </div>
      ) : null}
      <Presence>
        {deleting ? <DeleteBotDialog bot={bot} onClose={() => setDeleting(false)} /> : null}
      </Presence>
    </aside>
  )
}

/** 管理后台 · Bot: every bot in the system. */
export function BotsAdminPage() {
  // AdminLayout guarantees a sysadmin.
  const me = useSession((s) => s.user) as UserDto
  const bots = useWorkspace((s) => s.bots)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [users, setUsers] = useState<UserBriefDto[]>([])
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = bots.filter(
    (b) => !q || `${b.name} ${b.ownerName} ${b.machineName ?? ''}`.toLowerCase().includes(q),
  )
  const selected = shown.find((b) => b.id === selectedId) ?? shown[0]

  useEffect(() => {
    api
      .get<UserBriefDto[]>('/users')
      .then(setUsers)
      .catch((e: Error) => toast({ type: 'error', message: e.message }))
  }, [])

  return (
    <AdminPage
      title="Bot"
      desc="全部 Bot 的归属、绑定与状态；可为任何成员新建，新建时直接绑定归属人的机器与 agent。"
      subtitle={`${bots.length} 个 Bot`}
      actions={
        <ToolbarGroup>
          <ToolbarButton icon="plus" label="新建 Bot" text="新建 Bot" onClick={() => setCreating(true)} />
        </ToolbarGroup>
      }
      search={<SearchField placeholder="搜索 Bot、归属人或机器" value={query} onChange={setQuery} />}
    >
      <div className="bots-page__body">
        <div className="bots-table">
          <div className="bots-table__row bots-table__head">
            <span>Bot</span>
            <span>归属人</span>
            <span>绑定</span>
            <span>机器</span>
            <span>状态</span>
          </div>
          {shown.length ? (
            shown.map((b) => (
              <button
                key={b.id}
                type="button"
                className="bots-table__row"
                aria-current={b.id === selected?.id || undefined}
                onClick={() => setSelectedId(b.id)}
              >
                <span className="bots-table__bot">
                  <Avatar name={b.name} size={24} shape="square" />
                  <span className="bots-table__text">
                    <span className="bots-table__name">{b.name}</span>
                    <span className="bots-table__agent">{agentLine(b)}</span>
                  </span>
                </span>
                <span>{b.ownerName}</span>
                <span>
                  {b.binding === 'bound' ? (
                    BINDING_LABEL[b.binding]
                  ) : (
                    <Tag tone="orange">{BINDING_LABEL[b.binding]}</Tag>
                  )}
                </span>
                <span className="bots-table__machine">{b.machineName ?? '—'}</span>
                <span className="bots-table__state">
                  <span className="dot" style={{ background: PRESENCE[b.presence].color }} />
                  {PRESENCE[b.presence].label}
                </span>
              </button>
            ))
          ) : (
            <EmptyState
              bare
              icon={<Icon name="bot" size={24} />}
              title={bots.length ? '没有匹配的 Bot' : '还没有 Bot'}
              description={bots.length ? undefined : '点击「新建 Bot」开始。'}
            />
          )}
        </div>
        {selected ? <BotDetail key={selected.id} bot={selected} me={me} users={users} /> : null}
      </div>
      <Presence>
        {creating ? (
          <NewBotDialog me={me} onClose={() => setCreating(false)} onCreated={(b) => setSelectedId(b.id)} />
        ) : null}
      </Presence>
    </AdminPage>
  )
}
