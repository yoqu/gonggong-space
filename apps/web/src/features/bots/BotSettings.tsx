import {
  type BotDto,
  INHERIT_PROVIDER,
  OFFICIAL_PROVIDER,
  type ProviderStoreView,
  type Tier,
  type TriggerScope,
  type UsageRowDto,
  type UserBriefDto,
  type UserDto,
} from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { fmtTokens } from '../../lib/format'
import {
  Alert,
  Button,
  Form,
  FormRow,
  PathControl,
  Presence,
  SegmentedControl,
  Stepper,
  TabView,
  TextField,
  TokenField,
  toast,
} from '../../ui'
import { FeishuAppForm } from '../feishu/FeishuAppForm'
import { effectiveProvider, providerBlocked, useProviderSwitch } from '../machines/providers'
import { TIER_LABEL, TIERS } from '../runs/tier'
import { UsageBars, useUsage } from '../usage/UsagePage'
import { DirPicker } from '../workspaces/DirPicker'
import { type AgentConfig, AgentConfigFields, useBotCatalog } from './AgentConfig'
import { ApprovalFields, type ApprovalValue } from './ApprovalFields'
import { BotAvatar, RolePicker, roleHint } from './avatars'
import { ProviderModelFields, useMachineProviders, useProviderCatalog } from './BotProvider'
import { DeleteBotDialog } from './DeleteBotDialog'
import {
  AGENT_LABEL,
  agentCliVersion,
  agentOutdated,
  BINDING_LABEL,
  type BotPatch,
  botsApi,
  confirmBot,
  TRIGGER_SCOPE_LABEL,
} from './model'
import './bots.css'

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

function weekUsage(rows: UsageRowDto[]) {
  const runs = rows.reduce((n, r) => n + r.runs, 0)
  const tokens = rows.reduce((n, r) => n + r.totalTokens, 0)
  return t('{usage} · {n} 轮', {
    usage: tokens || !runs ? `${fmtTokens(tokens)} tokens` : t('用量未上报'),
    n: runs,
  })
}

/** Read-only usage for the admin panel; a bot opened from the sidebar shows it on its page instead. */
function UsageTab({ bot }: { bot: BotDto }) {
  const usage = useUsage(`by=user&days=7&botId=${bot.id}`).rows
  return (
    <Form>
      <FormRow label={t('所在群')}>{t('{n} 个', { n: bot.groupCount })}</FormRow>
      <FormRow label={t('近 7 天用量')}>{usage ? weekUsage(usage) : '--'}</FormRow>
      <FormRow label={t('谁用了')} align="top">
        {usage?.length ? (
          <UsageBars rows={usage} />
        ) : (
          <span className="bots-detail__unset">{usage ? t('近 7 天无人使用') : '--'}</span>
        )}
      </FormRow>
    </Form>
  )
}

export type BotTab = 'basic' | 'run' | 'access' | 'advanced'

const sameList = (a: string[], b: string[]) => a.join('\n') === b.join('\n')

/**
 * Settings of a bot, in tabs: who it is, where and with what it runs, who may use it and what it may do, the rest.
 * Every change, the provider and default workspace included, waits for 保存.
 */
export function BotDetail({
  bot,
  me,
  users,
  plain,
  tab: initialTab = 'basic',
}: {
  bot: BotDto
  me: UserDto
  users: UserBriefDto[]
  /** Embedded in a dialog: no panel chrome, no usage tab (the bot page shows it). */
  plain?: boolean
  tab?: BotTab
}) {
  const owner = me.id === bot.ownerId
  const canEdit = owner || me.role === 'sysadmin'
  const demo = useSession((s) => s.tenancy?.demoMode)
  const [tab, setTab] = useState<string>(initialTab)
  const [name, setName] = useState(bot.name)
  const [avatar, setAvatar] = useState(bot.avatar)
  const [prompt, setPrompt] = useState(bot.systemPrompt)
  const [workspace, setWorkspace] = useState(bot.defaultWorkspace)
  /** null = the bot's provider is kept. */
  const [provider, setProvider] = useState<string | null>(null)
  const [config, setConfig] = useState<AgentConfig>({ model: bot.model, effort: bot.effort })
  const [scope, setScope] = useState<TriggerScope>(bot.triggerScope)
  const [list, setList] = useState(bot.triggerList)
  const [tier, setTier] = useState<Tier>(bot.tier)
  const [concurrency, setConcurrency] = useState(bot.concurrency)
  const [approval, setApproval] = useState<ApprovalValue>({
    approval: bot.approval,
    allowlist: bot.allowlist,
    alwaysAllow: bot.alwaysAllow,
  })
  const [gitName, setGitName] = useState(bot.gitName ?? '')
  const [gitEmail, setGitEmail] = useState(bot.gitEmail ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** false = closed; otherwise the folder the picker opens at. */
  const [picking, setPicking] = useState<string | null | false>(false)
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '--'
  const idOf = (name: string) => users.find((u) => u.name === name)?.id

  const machine = useWorkspace((s) => s.machines.find((m) => m.id === bot.machineId))
  const reason = providerBlocked(me.id, bot.ownerId, machine)
  const [view, setView] = useMachineProviders(bot.machineId, !!reason)
  const savedProvider = view?.bots[bot.id] ?? INHERIT_PROVIDER
  const picked = provider !== null && provider !== savedProvider ? provider : null
  const effective = view && !reason ? effectiveProvider(view, bot.agentKind, bot.id) : OFFICIAL_PROVIDER
  const live = useBotCatalog(bot.id, effective)
  const pickedCatalog = useProviderCatalog(bot.machineId, bot.agentKind, picked)
  const catalog = picked ? pickedCatalog : (live?.catalog ?? bot.catalog)

  // Unchanged values are left out: one the catalog no longer lists would be refused.
  const patch: BotPatch = {
    ...(name.trim() !== bot.name && { name: name.trim() }),
    ...(avatar !== bot.avatar && { avatar }),
    ...(prompt !== bot.systemPrompt && { systemPrompt: prompt }),
    ...(tier !== bot.tier && { tier }),
    ...(scope !== bot.triggerScope && { triggerScope: scope }),
    ...(!sameList(list, bot.triggerList) && { triggerList: list }),
    ...(config.model !== bot.model && { model: config.model }),
    ...(config.effort !== bot.effort && { effort: config.effort }),
    ...(concurrency !== bot.concurrency && { concurrency }),
    // Only the owner may send these (plan J9).
    ...(owner && approval.approval !== bot.approval && { approval: approval.approval }),
    ...(owner && !sameList(approval.allowlist, bot.allowlist) && { allowlist: approval.allowlist }),
    ...(owner && !sameList(approval.alwaysAllow, bot.alwaysAllow) && { alwaysAllow: approval.alwaysAllow }),
    ...(owner && (gitName.trim() || null) !== bot.gitName && { gitName: gitName.trim() || null }),
    ...(owner && (gitEmail.trim() || null) !== bot.gitEmail && { gitEmail: gitEmail.trim() || null }),
  }
  const dirty = Object.keys(patch).length > 0 || workspace !== bot.defaultWorkspace || picked !== null

  const commit = async () => {
    setSaving(true)
    try {
      if (Object.keys(patch).length) await botsApi.update(bot.id, patch)
      if (workspace !== bot.defaultWorkspace) await botsApi.setDefaultWorkspace(bot.id, workspace)
      toast({ type: 'success', message: t('{name} 已保存 · 下一次新开会话时生效', { name: name.trim() }) })
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }
  // The provider goes first: the models picked are checked against the catalog of the provider in effect.
  const switcher = useProviderSwitch(async ({ choice }) => {
    setSaving(true)
    try {
      setView(await api.put<ProviderStoreView>(`/bots/${bot.id}/provider`, { choice }))
      setProvider(null)
    } catch (e) {
      setSaving(false)
      toastError(e)
      return
    }
    await commit()
  })
  const save = () =>
    picked && view
      ? switcher.request({ agent: bot.agentKind, choice: picked, botId: bot.id }, view)
      : void commit()

  const basic = (
    <Form>
      <FormRow label={t('名称')}>
        {canEdit ? (
          <TextField
            aria-label={t('名称')}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <span>{bot.name}</span>
        )}
      </FormRow>
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
          rows={4}
          value={prompt}
          disabled={!canEdit}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </FormRow>
    </Form>
  )

  const run = (
    <Form>
      <FormRow label={t('执行机器')}>
        <span className="bots-detail__mono">{bot.machineName ?? BINDING_LABEL.pending_bind}</span>
      </FormRow>
      <FormRow label="Agent">
        <span className="bots-detail__mono">{agentCliVersion(bot)}</span>
      </FormRow>
      {bot.machineId ? (
        <ProviderModelFields
          reason={reason}
          view={view}
          agent={bot.agentKind}
          provider={provider ?? savedProvider}
          catalog={catalog}
          config={config}
          disabled={!canEdit}
          onChange={(next) => {
            setProvider(next.provider)
            setConfig(next.config)
          }}
        />
      ) : (
        <AgentConfigFields catalog={catalog} value={config} disabled={!canEdit} onChange={setConfig} />
      )}
      {owner && bot.machineId ? (
        <FormRow
          label={t('默认工作区')}
          align="top"
          hint={t('未绑定仓库的群和私聊中自动使用；绑定仓库的群默认托管克隆')}
        >
          <div
            className="bots-detail__workspace"
            data-testid="default-workspace"
            title={workspace ?? undefined}
          >
            {workspace ? (
              <WorkspacePath path={workspace} onPick={setPicking} />
            ) : (
              <span className="bots-detail__unset">{t('未设置')}</span>
            )}
          </div>
          <div className="bots-detail__buttons">
            <Button size="small" onClick={() => setPicking(workspace)}>
              {t('选择…')}
            </Button>
            {workspace ? (
              <Button size="small" onClick={() => setWorkspace(null)}>
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
                onPick={(path) => {
                  setWorkspace(path)
                  setPicking(false)
                }}
                onClose={() => setPicking(false)}
              />
            ) : null}
          </Presence>
        </FormRow>
      ) : null}
    </Form>
  )

  const access = (
    <Form>
      <FormRow label={t('权限档位')}>
        <SegmentedControl<Tier>
          aria-label={t('默认权限档位')}
          size="small"
          value={tier}
          onChange={(v) => {
            setTier(v)
            if (v === 'full' && scope === 'all') setScope('list')
          }}
          items={TIERS.map((t) => ({
            value: t,
            label: TIER_LABEL[t],
            disabled: !canEdit || (demo && t === 'full'),
          }))}
        />
      </FormRow>
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
      <ApprovalFields owner={owner} value={approval} onChange={setApproval} />
    </Form>
  )

  const advanced = (
    <Form>
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
      {owner ? (
        <FormRow
          label={t('Git 提交身份')}
          align="top"
          hint={t('Bot 提交代码时的作者名和邮箱，留空用默认值；下次启动 agent 时生效')}
        >
          <div className="bots-detail__git">
            <TextField
              aria-label={t('Git 提交名')}
              value={gitName}
              placeholder={bot.name}
              onChange={(e) => setGitName(e.target.value)}
            />
            <TextField
              aria-label={t('Git 提交邮箱')}
              type="email"
              value={gitEmail}
              placeholder={bot.gitDefaultEmail}
              onChange={(e) => setGitEmail(e.target.value)}
            />
          </div>
        </FormRow>
      ) : (
        <FormRow label={t('Git 提交身份')} hint={t('只有 Bot 主人能修改 Git 提交身份')}>
          <span className="bots-detail__mono">
            {`${bot.gitName ?? bot.name} <${bot.gitEmail ?? bot.gitDefaultEmail}>`}
          </span>
        </FormRow>
      )}
      {canEdit ? (
        <FormRow
          label={t('飞书应用')}
          align="top"
          hint={t('该 Bot 专属的飞书自建应用，用于在飞书群里被 @；单独保存，不随下方「保存」')}
        >
          <FeishuAppForm path={`/bots/${bot.id}/feishu`} removeLabel={t('解除飞书应用')} />
        </FormRow>
      ) : null}
    </Form>
  )

  const tabs = [
    { value: 'basic', label: t('基本信息'), content: basic },
    { value: 'run', label: t('运行配置'), content: run },
    { value: 'access', label: t('权限'), content: access },
    { value: 'advanced', label: t('高级'), content: advanced },
    ...(plain ? [] : [{ value: 'usage', label: t('用量'), content: <UsageTab bot={bot} /> }]),
  ]

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

      <TabView tabs={tabs} value={tab} onChange={setTab} />

      {canEdit ? (
        <div className="bots-detail__actions">
          <Button variant="plain" className="bots-detail__delete" onClick={() => setDeleting(true)}>
            {t('删除 Bot')}
          </Button>
          <span className="spacer" />
          {tab === 'usage' ? null : (
            <Button variant="primary" disabled={!dirty || saving || !name.trim()} onClick={save}>
              {t('保存')}
            </Button>
          )}
        </div>
      ) : null}
      {switcher.dialog}
      <Presence>
        {deleting ? <DeleteBotDialog bot={bot} onClose={() => setDeleting(false)} /> : null}
      </Presence>
    </aside>
  )
}
