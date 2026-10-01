import type {
  AgentCatalog,
  BotDto,
  Tier,
  TriggerScope,
  UsageRowDto,
  UserBriefDto,
  UserDto,
} from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { fmtTokens } from '../../lib/format'
import { useGet } from '../../lib/useGet'
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
  Stepper,
  Table,
  Tag,
  TextField,
  TokenField,
  ToolbarButton,
  ToolbarGroup,
  toast,
} from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { TIER_LABEL, TIERS } from '../runs/tier'
import { UsageBars, useUsage } from '../usage/UsagePage'
import { DirPicker } from '../workspaces/DirPicker'
import { type AgentConfig, AgentConfigFields } from './AgentConfig'
import { ApprovalFields, type ApprovalValue } from './ApprovalFields'
import { BotAvatar, RolePicker, roleHint } from './avatars'
import { BotProviderField } from './BotProvider'
import { DeleteBotDialog } from './DeleteBotDialog'
import {
  AGENT_LABEL,
  agentCliVersion,
  agentLine,
  agentOutdated,
  BINDING_LABEL,
  botsApi,
  confirmBot,
  PRESENCE,
  TRIGGER_SCOPE_LABEL,
} from './model'
import { NewBotDialog } from './NewBotDialog'
import './bots.css'
import { t } from '../../i18n'

const FULL_HINT = t('完全访问档位只允许指定名单触发')
const MAX_CONCURRENCY = 8

function warning(bot: BotDto, userName: (id: string) => string) {
  const agent = AGENT_LABEL[bot.agentKind]
  if (bot.presence === 'pending_confirm')
    return {
      title: t('等待 {owner} 确认', { owner: bot.ownerName }),
      desc: t(
        '{creator} 为{owner}创建并绑定到 {machine}。机器主人在 Web 通知或 Bot 详情中确认后才能被触发。',
        {
          creator: userName(bot.createdBy),
          owner: bot.ownerName,
          machine: bot.machineName ?? '',
        },
      ),
    }
  if (bot.presence === 'pending_bind')
    return {
      title: t('待绑定'),
      desc: t('{owner} 绑定第一台机器并上报 {agent} 后自动绑定，无需再操作；此前不能被触发。', {
        owner: bot.ownerName,
        agent,
      }),
    }
  if (bot.presence === 'agent_missing')
    return {
      title: t('{agent} 未安装', { agent }),
      desc: t('{machine} 未上报 {agent}。在该机器安装并重新检测后自动可用。', {
        machine: bot.machineName ?? '',
        agent,
      }),
    }
  if (agentOutdated(bot))
    return {
      title: t('agent 版本低于适配器要求'),
      desc: t('{machine} 上的 {cli} 低于 ACP 适配器要求的 {min}，可能无法正常运行，请升级该 CLI。', {
        machine: bot.machineName ?? '',
        cli: agentCliVersion(bot),
        min: bot.agentMinVersion ?? '',
      }),
    }
  return null
}

/** Why the Bot cannot run yet; its owner confirms a Bot someone else created for them right here. */
export function BotWarning({ bot, users, owner }: { bot: BotDto; users: UserBriefDto[]; owner: boolean }) {
  const warn = warning(bot, (id) => users.find((u) => u.id === id)?.name ?? '--')
  if (!warn) return null
  return (
    <Alert variant="warning" title={warn.title} description={warn.desc}>
      {bot.presence === 'pending_confirm' && owner ? (
        <div className="bots-detail__confirm">
          <Button variant="primary" onClick={() => void confirmBot(bot.id)}>
            {t('确认')}
          </Button>
        </div>
      ) : null}
    </Alert>
  )
}

function weekUsage(rows: UsageRowDto[]) {
  const runs = rows.reduce((n, r) => n + r.runs, 0)
  const tokens = rows.reduce((n, r) => n + r.totalTokens, 0)
  return t('{usage} · {n} 轮', {
    usage: tokens || !runs ? `${fmtTokens(tokens)} tokens` : t('用量未上报'),
    n: runs,
  })
}

/** Path as a clickable NSPathControl; a segment reopens the picker at that folder. */
export function WorkspacePath({ path, onPick }: { path: string; onPick: (start: string) => void }) {
  const parts = path.split('/').filter(Boolean)
  const items = parts.map((p, i) => ({
    id: `/${parts.slice(0, i + 1).join('/')}`,
    label: p,
    icon: 'folder' as const,
  }))
  return <PathControl items={items} maxItems={3} onSelect={onPick} aria-label={t('默认工作区路径')} />
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
  const [avatar, setAvatar] = useState(bot.avatar)
  const [prompt, setPrompt] = useState(bot.systemPrompt)
  const [scope, setScope] = useState<TriggerScope>(bot.triggerScope)
  const [list, setList] = useState(bot.triggerList)
  const [tier, setTier] = useState<Tier>(bot.tier)
  const [config, setConfig] = useState<AgentConfig>({ model: bot.model, effort: bot.effort })
  /** Models of the third-party provider in effect; null = the adapter's own catalog. */
  const [providerCatalog, setProviderCatalog] = useState<AgentCatalog | null>(null)
  const [concurrency, setConcurrency] = useState(bot.concurrency)
  const [approval, setApproval] = useState<ApprovalValue>({
    approval: bot.approval,
    allowlist: bot.allowlist,
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** false = closed; otherwise the folder the picker opens at. */
  const [picking, setPicking] = useState<string | null | false>(false)
  const owner = me.id === bot.ownerId
  const canEdit = owner || me.role === 'sysadmin'
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '--'
  const idOf = (name: string) => users.find((u) => u.name === name)?.id
  const usage = useUsage(`by=user&days=7&botId=${bot.id}`).rows

  const save = async () => {
    setSaving(true)
    try {
      await botsApi.update(bot.id, {
        avatar,
        systemPrompt: prompt,
        triggerScope: scope,
        triggerList: list,
        tier,
        // Unchanged values are left out: one the catalog no longer lists would be refused.
        ...(config.model !== bot.model && { model: config.model }),
        ...(config.effort !== bot.effort && { effort: config.effort }),
        ...(concurrency !== bot.concurrency && { concurrency }),
        // Only the owner may send these (plan J9).
        ...(owner && approval.approval !== bot.approval && { approval: approval.approval }),
        ...(owner &&
          approval.allowlist.join('\n') !== bot.allowlist.join('\n') && { allowlist: approval.allowlist }),
      })
      toast({ type: 'success', message: t('{name} 已保存 · 下一次新开会话时生效', { name: bot.name }) })
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }
  const setDefault = (path: string | null) =>
    botsApi
      .setDefaultWorkspace(bot.id, path)
      .then(() => setPicking(false))
      .catch(toastError)

  return (
    <aside className={cx('bots-detail', plain && 'bots-detail--plain')} aria-label={t('Bot 详情')}>
      <div className="bots-detail__head">
        <BotAvatar id={bot.id} name={bot.name} size={32} />
        <div className="bots-detail__titles">
          <span className="bots-detail__name">{bot.name}</span>
          <span className="bots-detail__meta">
            {AGENT_LABEL[bot.agentKind]} · {bot.ownerName}
          </span>
        </div>
      </div>

      <BotWarning bot={bot} users={users} owner={owner} />

      <Form>
        {canEdit ? (
          <FormRow label={t('角色')} align="top" hint={roleHint(avatar)}>
            <RolePicker value={avatar} onChange={setAvatar} />
          </FormRow>
        ) : null}
        <FormRow
          label={t('系统提示词')}
          align="top"
          hint={t('作为 Bot 的角色说明和群内简介，群内可再补充；下一次新开会话时生效')}
        >
          <TextField
            multiline
            aria-label={t('系统提示词')}
            rows={3}
            value={prompt}
            disabled={!canEdit}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </FormRow>

        {me.id === bot.ownerId && bot.machineId ? (
          <FormRow
            label={t('默认工作区')}
            align="top"
            hint={t('未绑定仓库的群和私聊中自动使用；绑定仓库的群默认托管克隆')}
          >
            <div
              className="bots-detail__workspace"
              data-testid="default-workspace"
              title={bot.defaultWorkspace ?? undefined}
            >
              {bot.defaultWorkspace ? (
                <WorkspacePath path={bot.defaultWorkspace} onPick={setPicking} />
              ) : (
                <span className="bots-detail__unset">{t('未设置')}</span>
              )}
            </div>
            <div className="bots-detail__buttons">
              <Button size="small" onClick={() => setPicking(bot.defaultWorkspace)}>
                {t('选择…')}
              </Button>
              {bot.defaultWorkspace ? (
                <Button size="small" onClick={() => void setDefault(null)}>
                  {t('清除')}
                </Button>
              ) : null}
            </div>
            <Presence>
              {picking !== false ? (
                <DirPicker
                  machineId={bot.machineId}
                  title={t('默认工作区')}
                  start={picking}
                  onPick={(path) => void setDefault(path)}
                  onClose={() => setPicking(false)}
                />
              ) : null}
            </Presence>
          </FormRow>
        ) : null}

        {bot.machineId ? <BotProviderField bot={bot} me={me} onCatalog={setProviderCatalog} /> : null}
        <AgentConfigFields
          catalog={providerCatalog ?? bot.catalog}
          value={config}
          disabled={!canEdit}
          onChange={setConfig}
        />

        <FormRow label={t('触发范围')} hint={tier === 'full' ? FULL_HINT : undefined}>
          <div title={tier === 'full' ? FULL_HINT : undefined}>
            <SegmentedControl<TriggerScope>
              aria-label={t('触发范围')}
              size="small"
              value={scope}
              onChange={setScope}
              items={[
                { value: 'all', label: TRIGGER_SCOPE_LABEL.all, disabled: !canEdit || tier === 'full' },
                { value: 'list', label: TRIGGER_SCOPE_LABEL.list, disabled: !canEdit },
                { value: 'self', label: TRIGGER_SCOPE_LABEL.self, disabled: !canEdit },
              ]}
            />
          </div>
        </FormRow>

        {scope === 'list' ? (
          <FormRow label={t('触发名单')}>
            {canEdit ? (
              <TokenField
                aria-label={t('触发名单')}
                placeholder={t('输入成员姓名')}
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
              <span>{list.map(userName).join(t('、')) || '--'}</span>
            )}
          </FormRow>
        ) : null}

        <FormRow label={t('权限档位')}>
          <SegmentedControl<Tier>
            aria-label={t('默认权限档位')}
            size="small"
            value={tier}
            onChange={(v) => {
              setTier(v)
              if (v === 'full' && scope === 'all') setScope('list')
            }}
            items={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t], disabled: !canEdit }))}
          />
        </FormRow>

        <FormRow label={t('并发上限')} hint={canEdit ? t('同时运行的轮次，超出的在本机排队') : undefined}>
          {canEdit ? (
            <Stepper
              aria-label={t('并发上限')}
              min={1}
              max={Math.max(MAX_CONCURRENCY, bot.concurrency)}
              value={concurrency}
              onChange={setConcurrency}
              width={48}
            />
          ) : (
            t('{n} 个群并行', { n: bot.concurrency })
          )}
        </FormRow>
        <ApprovalFields owner={owner} value={approval} onChange={setApproval} />
        <FormRow label={t('所在群')}>{t('{n} 个', { n: bot.groupCount })}</FormRow>
        <FormRow label={t('agent 版本')}>
          <span className="bots-detail__mono">{agentCliVersion(bot)}</span>
        </FormRow>
        <FormRow label={t('近 7 天用量')}>{usage ? weekUsage(usage) : '--'}</FormRow>
        <FormRow label={t('谁用了')} align="top">
          {usage?.length ? (
            <UsageBars rows={usage} />
          ) : (
            <span className="bots-detail__unset">{usage ? t('近 7 天无人使用') : '--'}</span>
          )}
        </FormRow>
      </Form>

      {canEdit ? (
        <div className="bots-detail__actions">
          <Button variant="plain" className="bots-detail__delete" onClick={() => setDeleting(true)}>
            {t('删除 Bot')}
          </Button>
          <span className="spacer" />
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {t('保存')}
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
  const users = useGet<UserBriefDto[]>('/users').data ?? []
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = bots.filter(
    (b) => !q || `${b.name} ${b.ownerName} ${b.machineName ?? ''}`.toLowerCase().includes(q),
  )
  const selected = shown.find((b) => b.id === selectedId) ?? shown[0]

  return (
    <AdminPage
      title="Bot"
      desc={t('全部 Bot 的归属、绑定与状态；可为任何成员新建，新建时直接绑定归属人的机器与 agent。')}
      subtitle={t('{n} 个 Bot', { n: bots.length })}
      actions={
        <ToolbarGroup>
          <ToolbarButton
            icon="plus"
            label={t('新建 Bot…')}
            text={t('新建 Bot…')}
            onClick={() => setCreating(true)}
          />
        </ToolbarGroup>
      }
      search={<SearchField placeholder={t('搜索 Bot、归属人或机器')} value={query} onChange={setQuery} />}
    >
      {bots.length ? (
        <div className="bots-page__body">
          <Table<BotDto>
            aria-label={t('Bot 列表')}
            className="admin-grid bots-grid"
            rows={shown}
            multiple={false}
            selection={selected ? [selected.id] : []}
            onSelectionChange={(ids) => {
              if (ids[0] != null) setSelectedId(String(ids[0]))
            }}
            defaultSort={{ key: 'name', dir: 'asc' }}
            rowActions={() => [{ label: t('删除 Bot…'), value: 'delete', destructive: true }]}
            onRowAction={(_, b) => setDeleting(b)}
            emptyText={<EmptyState compact title={t('没有匹配的 Bot')} illustration={<NoResultsArt />} />}
            columns={[
              {
                key: 'name',
                title: 'Bot',
                // Beside the detail panel the name keeps its room; Agent and 机器 give way and truncate.
                width: 'minmax(160px, 1fr)',
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
                width: 'minmax(0, 150px)',
                secondary: true,
                sortable: true,
                sortValue: agentLine,
                render: agentLine,
              },
              { key: 'ownerName', title: t('归属人'), width: 96, sortable: true },
              {
                key: 'binding',
                title: t('绑定'),
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
              {
                key: 'machineName',
                title: t('机器'),
                width: 'minmax(0, 200px)',
                mono: true,
                secondary: true,
                sortable: true,
              },
              {
                key: 'presence',
                title: t('状态'),
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
          title={t('还没有 Bot')}
          description={t('Bot 绑定到成员的机器，在群里被 @ 后开工。')}
          action={<Button onClick={() => setCreating(true)}>{t('新建 Bot…')}</Button>}
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
