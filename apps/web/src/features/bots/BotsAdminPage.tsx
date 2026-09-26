import type { BotDto, Tier, TriggerScope, UsageRowDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import {
  Alert,
  Button,
  EmptyState,
  Form,
  FormRow,
  NoBotsArt,
  NoResultsArt,
  PathControl,
  Presence,
  SearchField,
  SegmentedControl,
  Table,
  Tag,
  TextField,
  TokenField,
  ToolbarButton,
  ToolbarGroup,
  toast,
} from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { TIER_LABEL } from '../runs/tier'
import { fmtTokens, UsageBars, useUsage } from '../usage/UsagePage'
import { DirPicker } from '../workspaces/DirPicker'
import { type AgentConfig, AgentConfigFields } from './AgentConfig'
import { AvatarPicker, BotAvatar, botAvatar } from './avatars'
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

/** Path as a clickable NSPathControl; a segment reopens the picker at that folder. */
export function WorkspacePath({ path, onPick }: { path: string; onPick: (start: string) => void }) {
  const parts = path.split('/').filter(Boolean)
  const items = parts.map((p, i) => ({
    id: `/${parts.slice(0, i + 1).join('/')}`,
    label: p,
    icon: 'folder' as const,
  }))
  return <PathControl items={items} maxItems={3} onSelect={onPick} aria-label="默认工作区路径" />
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
  /** Embedded in a dialog: no panel chrome. */
  plain?: boolean
}) {
  const [avatar, setAvatar] = useState(botAvatar(bot))
  const [prompt, setPrompt] = useState(bot.systemPrompt)
  const [scope, setScope] = useState<TriggerScope>(bot.triggerScope)
  const [list, setList] = useState(bot.triggerList)
  const [tier, setTier] = useState<Tier>(bot.tier)
  const [config, setConfig] = useState<AgentConfig>({ model: bot.model, effort: bot.effort })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** false = closed; otherwise the folder the picker opens at. */
  const [picking, setPicking] = useState<string | null | false>(false)
  const canEdit = me.id === bot.ownerId || me.role === 'sysadmin'
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '--'
  const idOf = (name: string) => users.find((u) => u.name === name)?.id
  const warn = warning(bot, userName)
  const usage = useUsage(`by=user&days=7&botId=${bot.id}`).rows

  const save = async () => {
    setSaving(true)
    try {
      await botsApi.update(bot.id, {
        avatar: avatar === botAvatar(bot) ? bot.avatar : avatar,
        systemPrompt: prompt,
        triggerScope: scope,
        triggerList: list,
        tier,
        // Unchanged values are left out: one the catalog no longer lists would be refused.
        ...(config.model !== bot.model && { model: config.model }),
        ...(config.effort !== bot.effort && { effort: config.effort }),
      })
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
        <BotAvatar id={bot.id} name={bot.name} size={32} />
        <div className="bots-detail__titles">
          <span className="bots-detail__name">{bot.name}</span>
          <span className="bots-detail__meta">
            {AGENT_LABEL[bot.agentKind]} · {bot.ownerName}
          </span>
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

      <Form>
        {canEdit ? (
          <FormRow label="头像" align="top">
            <AvatarPicker value={avatar} onChange={setAvatar} />
          </FormRow>
        ) : null}
        <FormRow
          label="系统提示词"
          align="top"
          hint="同时作为群内简介，下一次新开会话时生效。优先级：仓库基线 < 本提示词 < 全局层 < 群层"
        >
          <TextField
            multiline
            aria-label="系统提示词"
            rows={3}
            value={prompt}
            disabled={!canEdit}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </FormRow>

        {me.id === bot.ownerId && bot.machineId ? (
          <FormRow label="默认工作区" align="top" hint="进群时自动使用；群绑定了仓库时需与其 remote 一致">
            <div
              className="bots-detail__workspace"
              data-testid="default-workspace"
              title={bot.defaultWorkspace ?? undefined}
            >
              {bot.defaultWorkspace ? (
                <WorkspacePath path={bot.defaultWorkspace} onPick={setPicking} />
              ) : (
                <span className="bots-detail__unset">未设置</span>
              )}
            </div>
            <div className="bots-detail__buttons">
              <Button size="small" onClick={() => setPicking(bot.defaultWorkspace)}>
                选择…
              </Button>
              {bot.defaultWorkspace ? (
                <Button size="small" onClick={() => void setDefault(null)}>
                  清除
                </Button>
              ) : null}
            </div>
            <Presence>
              {picking !== false ? (
                <DirPicker
                  machineId={bot.machineId}
                  title="默认工作区"
                  start={picking}
                  onPick={(path) => void setDefault(path)}
                  onClose={() => setPicking(false)}
                />
              ) : null}
            </Presence>
          </FormRow>
        ) : null}

        <AgentConfigFields catalog={bot.catalog} value={config} disabled={!canEdit} onChange={setConfig} />

        <FormRow label="触发范围" hint={tier === 'full' ? FULL_HINT : undefined}>
          <div title={tier === 'full' ? FULL_HINT : undefined}>
            <SegmentedControl<TriggerScope>
              aria-label="触发范围"
              size="small"
              value={scope}
              onChange={setScope}
              items={[
                { value: 'all', label: '任何群成员', disabled: !canEdit || tier === 'full' },
                { value: 'list', label: '指定名单', disabled: !canEdit },
                { value: 'self', label: '仅本人', disabled: !canEdit },
              ]}
            />
          </div>
        </FormRow>

        {scope === 'list' ? (
          <FormRow label="触发名单">
            {canEdit ? (
              <TokenField
                aria-label="触发名单"
                placeholder="输入成员姓名"
                value={list.map(userName)}
                suggestions={users.map((u) => ({ label: u.name, detail: u.account }))}
                onChange={(tokens) =>
                  setList(
                    tokens
                      .map((t) => idOf(typeof t === 'string' ? t : t.label))
                      .filter((id): id is string => !!id),
                  )
                }
              />
            ) : (
              <span>{list.map(userName).join('、') || '--'}</span>
            )}
          </FormRow>
        ) : null}

        <FormRow label="权限档位">
          <SegmentedControl<Tier>
            aria-label="默认权限档位"
            size="small"
            value={tier}
            onChange={(v) => {
              setTier(v)
              if (v === 'full' && scope === 'all') setScope('list')
            }}
            items={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t], disabled: !canEdit }))}
          />
        </FormRow>

        <FormRow label="并发上限">{bot.concurrency} 个群并行</FormRow>
        <FormRow label="所在群">{bot.groupCount} 个</FormRow>
        <FormRow label="agent 版本">
          <span className="bots-detail__mono">{agentCliVersion(bot)}</span>
        </FormRow>
        <FormRow label="近 7 天用量">{usage ? weekUsage(usage) : '--'}</FormRow>
        <FormRow label="谁用了" align="top">
          {usage?.length ? (
            <UsageBars rows={usage} />
          ) : (
            <span className="bots-detail__unset">{usage ? '近 7 天无人使用' : '--'}</span>
          )}
        </FormRow>
      </Form>

      {canEdit ? (
        <div className="bots-detail__actions">
          <Button variant="plain" className="bots-detail__delete" onClick={() => setDeleting(true)}>
            删除 Bot
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

/** 管理后台 · Bot: every bot in the system; the selected row shows its detail on the right. */
export function BotsAdminPage() {
  // AdminLayout guarantees a sysadmin.
  const me = useSession((s) => s.user) as UserDto
  const bots = useWorkspace((s) => s.bots)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<BotDto | null>(null)
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
          <ToolbarButton icon="plus" label="新建 Bot…" text="新建 Bot…" onClick={() => setCreating(true)} />
        </ToolbarGroup>
      }
      search={<SearchField placeholder="搜索 Bot、归属人或机器" value={query} onChange={setQuery} />}
    >
      {bots.length ? (
        <div className="bots-page__body">
          <Table<BotDto>
            aria-label="Bot 列表"
            className="admin-grid bots-grid"
            rows={shown}
            multiple={false}
            selection={selected ? [selected.id] : []}
            onSelectionChange={(ids) => {
              if (ids[0] != null) setSelectedId(String(ids[0]))
            }}
            defaultSort={{ key: 'name', dir: 'asc' }}
            rowActions={() => [{ label: '删除 Bot…', value: 'delete', destructive: true }]}
            onRowAction={(_, b) => setDeleting(b)}
            emptyText={<EmptyState compact title="没有匹配的 Bot" illustration={<NoResultsArt />} />}
            columns={[
              {
                key: 'name',
                title: 'Bot',
                sortable: true,
                render: (b) => (
                  <>
                    <BotAvatar id={b.id} name={b.name} size={18} />
                    {b.name}
                  </>
                ),
              },
              {
                key: 'agent',
                title: 'Agent',
                width: 150,
                secondary: true,
                sortable: true,
                sortValue: agentLine,
                render: agentLine,
              },
              { key: 'ownerName', title: '归属人', width: 96, sortable: true },
              {
                key: 'binding',
                title: '绑定',
                width: 64,
                sortable: true,
                sortValue: (b) => BINDING_LABEL[b.binding],
                render: (b) =>
                  b.binding === 'bound' ? (
                    BINDING_LABEL[b.binding]
                  ) : (
                    <Tag tone="orange">{BINDING_LABEL[b.binding]}</Tag>
                  ),
              },
              { key: 'machineName', title: '机器', width: 200, mono: true, secondary: true, sortable: true },
              {
                key: 'presence',
                title: '状态',
                width: 104,
                sortable: true,
                sortValue: (b) => PRESENCE[b.presence].label,
                render: (b) => (
                  <span className="admin-status">
                    <span className="admin-dot" style={{ background: PRESENCE[b.presence].color }} />
                    {PRESENCE[b.presence].label}
                  </span>
                ),
              },
            ]}
          />
          {selected ? <BotDetail key={selected.id} bot={selected} me={me} users={users} /> : null}
        </div>
      ) : (
        <EmptyState
          illustration={<NoBotsArt />}
          title="还没有 Bot"
          description="Bot 绑定到成员的机器，在群里被 @ 后开工。"
          action={<Button onClick={() => setCreating(true)}>新建 Bot…</Button>}
        />
      )}
      <Presence>
        {deleting ? <DeleteBotDialog bot={deleting} onClose={() => setDeleting(null)} /> : null}
      </Presence>
      <Presence>
        {creating ? (
          <NewBotDialog me={me} onClose={() => setCreating(false)} onCreated={(b) => setSelectedId(b.id)} />
        ) : null}
      </Presence>
    </AdminPage>
  )
}
