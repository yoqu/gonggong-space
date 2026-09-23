import type { BotDto, Tier, TriggerScope, UsageRowDto, UserBriefDto, UserDto } from '@aiws/protocol'
import { Bot, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Alert, Button, EmptyState, Select, Tabs, Textarea, toast } from '../../ui'
import { fmtTokens, UsageBars, useUsage } from '../usage/UsagePage'
import { AGENT_LABEL, agentCliVersion, agentLine, BINDING_LABEL, botsApi, PRESENCE } from './model'
import { NewBotDialog } from './NewBotDialog'
import './bots.css'

const TIERS: { value: Tier; label: string }[] = [
  { value: 'full', label: 'full' },
  { value: 'workspace', label: 'workspace' },
  { value: 'read-only', label: 'read-only' },
]

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
  return null
}

function weekUsage(rows: UsageRowDto[]) {
  const runs = rows.reduce((n, r) => n + r.runs, 0)
  const tokens = rows.reduce((n, r) => n + r.totalTokens, 0)
  return `${tokens || !runs ? `${fmtTokens(tokens)} tokens` : '用量未上报'} · ${runs} 轮`
}

function BotDetail({ bot, me, users }: { bot: BotDto; me: UserDto; users: UserBriefDto[] }) {
  const [prompt, setPrompt] = useState(bot.systemPrompt)
  const [scope, setScope] = useState<TriggerScope>(bot.triggerScope)
  const [list, setList] = useState(bot.triggerList)
  const [tier, setTier] = useState<Tier>(bot.tier)
  const [saving, setSaving] = useState(false)
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
  const confirm = () =>
    botsApi
      .confirm(bot.id)
      .then((b) => toast({ type: 'success', message: `${b.name} 已确认` }))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  return (
    <aside className="bots-detail" aria-label="bot 详情">
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

      <div className="bots-detail__field">
        <span className="bots-detail__label">触发范围</span>
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
                    <X size={10} />
                  </button>
                ) : null}
              </span>
            ))}
            {canEdit ? (
              <div className="bots-chip__add">
                <Select
                  placeholder="添加"
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
          items={TIERS.map((t) => ({ ...t, disabled: !canEdit }))}
        />
        {tier === 'full' ? (
          <Alert
            variant="warning"
            title="full 档位强制使用指定名单"
            description="触发范围已自动切换为「指定名单」。"
          />
        ) : null}
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
              <Button size="sm" variant="primary" onClick={() => void confirm()}>
                确认
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      <div className="bots-detail__field">
        <span className="bots-detail__label">谁用了这个 bot · 近 7 天</span>
        {usage?.length ? (
          <UsageBars rows={usage} compact />
        ) : (
          <span className="bots-detail__hint">{usage ? '近 7 天无人使用' : '—'}</span>
        )}
      </div>

      {canEdit ? (
        <div className="bots-detail__actions">
          <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
            保存
          </Button>
        </div>
      ) : null}
    </aside>
  )
}

/** 管理后台 · Bot. Sysadmins see every bot; members manage their own. */
export function BotsAdminPage() {
  // RequireSession guarantees a user on every app route.
  const me = useSession((s) => s.user) as UserDto
  const all = useWorkspace((s) => s.bots)
  const bots = me.role === 'sysadmin' ? all : all.filter((b) => b.ownerId === me.id)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [users, setUsers] = useState<UserBriefDto[]>([])
  const selected = bots.find((b) => b.id === selectedId) ?? bots[0]

  useEffect(() => {
    api
      .get<UserBriefDto[]>('/users')
      .then(setUsers)
      .catch((e: Error) => toast({ type: 'error', message: e.message }))
  }, [])

  return (
    <div className="bots-page">
      <div className="bots-page__inner">
        <div className="bots-page__head">
          <div>
            <h1 className="bots-page__title">Bot</h1>
            <p className="bots-page__desc">
              新建时直接绑定归属人的机器与 agent；成员本人只能为自己创建，管理员可为任何人创建。
            </p>
          </div>
          <span className="spacer" />
          <Button variant="primary" onClick={() => setCreating(true)}>
            新建 bot
          </Button>
        </div>

        <div className="bots-page__body">
          <div className="bots-table">
            <div className="bots-table__row bots-table__head">
              <span>bot</span>
              <span>归属人</span>
              <span>绑定</span>
              <span>机器</span>
              <span>状态</span>
            </div>
            {bots.length ? (
              bots.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cx('bots-table__row', b.id === selected?.id && 'is-selected')}
                  onClick={() => setSelectedId(b.id)}
                >
                  <span className="bots-table__bot">
                    <span className="bots-table__name">{b.name}</span>
                    <span className="bots-table__agent">{agentLine(b)}</span>
                  </span>
                  <span>{b.ownerName}</span>
                  <span className={cx(b.binding !== 'bound' && 'bots-table__pending')}>
                    {BINDING_LABEL[b.binding]}
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
                icon={<Bot size={24} />}
                title="还没有 bot"
                description="点击「新建 bot」开始。"
              />
            )}
          </div>
          {selected ? <BotDetail key={selected.id} bot={selected} me={me} users={users} /> : null}
        </div>
      </div>
      {creating ? (
        <NewBotDialog me={me} onClose={() => setCreating(false)} onCreated={(b) => setSelectedId(b.id)} />
      ) : null}
    </div>
  )
}
