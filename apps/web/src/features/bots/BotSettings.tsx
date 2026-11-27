import {
  AGENT_META,
  type BotAccess,
  type BotDto,
  INHERIT_PROVIDER,
  type MachineDto,
  OFFICIAL_PROVIDER,
  type ProviderStoreView,
  type Tier,
  type UsageRowDto,
  type UserBriefDto,
  type UserDto,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { loadBotStates, useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { fmtTokens } from '../../lib/format'
import {
  AgentIcon,
  Alert,
  Avatar,
  AvatarEditor,
  Button,
  Form,
  FormRow,
  Presence,
  Stepper,
  TabView,
  Tag,
  TextField,
  toast,
} from '../../ui'
import { FeishuAppForm } from '../feishu/FeishuAppForm'
import { groupsApi } from '../groups/api'
import { effectiveProvider, providerBlocked, useProviderSwitch } from '../machines/providers'
import { graduateApprovalGuide } from '../runs/approvalGuide'
import { UsageBars, useUsage } from '../usage/UsagePage'
import { type AgentConfig, AgentConfigFields, useBotCatalog } from './AgentConfig'
import { APPROVAL_MODE_LABEL, ApprovalFields, type ApprovalValue, approvalMode } from './ApprovalFields'
import { AudienceFields, type AudienceValue, audiencePatch, audienceValue } from './AudienceFields'
import type { AccessFocus } from './accessScope'
import { avatarSrc, BotAvatar, botRole, RolePicker, roleFace, roleHint } from './avatars'
import { BotAgentSettingRows, cleanOverrides } from './BotAgentSettings'
import { choiceProvider, ProviderModelFields, useMachineProviders, useProviderCatalog } from './BotProvider'
import { BotShares } from './BotShares'
import { DefaultWorkspaceRow } from './DefaultWorkspaceField'
import { DeleteBotDialog } from './DeleteBotDialog'
import { MachineLink } from './MachineLink'
import {
  agentCliVersion,
  agentOutdated,
  agentsUndetected,
  agentUnavailableText,
  type BotPatch,
  botsApi,
  confirmBot,
} from './model'
import './bots.css'

const MAX_CONCURRENCY = 8

function warning(bot: BotDto, userName: (id: string) => string, machine: MachineDto | undefined) {
  const agent = AGENT_META[bot.agentKind].name
  if (bot.presence === 'pending_confirm')
    return {
      title: t('等待 {owner} 确认', { owner: bot.ownerName }),
      desc: t('{creator} 为 {owner} 创建并绑定到 {machine}。电脑主人在通知或 Bot 详情中确认后才能使用。', {
        creator: userName(bot.createdBy),
        owner: bot.ownerName,
        machine: bot.machineName ?? '',
      }),
    }
  if (bot.presence === 'pending_bind')
    return {
      title: t('待绑定'),
      desc: t('{owner} 绑定第一台电脑并上报 {agent} 后会自动绑定；此前还不能被触发。', {
        owner: bot.ownerName,
        agent,
      }),
    }
  if (bot.presence === 'agent_missing') {
    const undetected = !!machine && agentsUndetected(machine)
    return {
      title: undetected ? t('{agent} 待检测', { agent }) : t('{agent} 未安装', { agent }),
      desc: agentUnavailableText(machine, agent, machine?.name ?? bot.machineName ?? ''),
    }
  }
  if (agentOutdated(bot))
    return {
      title: t('{agent} 版本过低', { agent }),
      desc: t('{machine} 上的 {cli} 低于需要的 {min}，可能无法正常运行，请升级。', {
        machine: bot.machineName ?? '',
        cli: agentCliVersion(bot),
        min: bot.agentMinVersion ?? '',
      }),
    }
  return null
}

/** Why the Bot cannot run yet; its owner confirms a Bot someone else created for them right here. */
export function BotWarning({ bot, users, owner }: { bot: BotDto; users: UserBriefDto[]; owner: boolean }) {
  const machine = useWorkspace((s) => s.machines.find((m) => m.id === bot.machineId))
  const [confirming, setConfirming] = useState(false)
  const warn = warning(bot, (id) => users.find((u) => u.id === id)?.name ?? '--', machine)
  if (!warn) return null
  const onConfirm = async () => {
    if (confirming) return
    setConfirming(true)
    try {
      await confirmBot(bot.id)
    } finally {
      setConfirming(false)
    }
  }
  return (
    <Alert variant="warning" title={warn.title} description={warn.desc}>
      {bot.presence === 'pending_confirm' && owner ? (
        <div className="bots-detail__confirm">
          <Button
            variant="primary"
            loading={confirming}
            disabled={confirming}
            onClick={() => void onConfirm()}
          >
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

export type BotTab = 'basic' | 'run' | 'access' | 'advanced' | 'feishu' | 'share'

const sameList = (a: string[], b: string[]) => a.join('\n') === b.join('\n')
const sameAccess = (a: BotAccess, b: BotAccess) => a.trusted === b.trusted && a.others === b.others
const sameMap = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)

const hasPermissionChange = (patch: BotPatch) =>
  'tier' in patch ||
  'aiReview' in patch ||
  'alwaysAllow' in patch ||
  'triggerScope' in patch ||
  'triggerList' in patch ||
  'access' in patch

function saveToastMessage(
  botName: string,
  patch: BotPatch,
  workspaceChanged: boolean,
  providerChanged: boolean,
) {
  const hasLive = 'tier' in patch || 'access' in patch
  // 审批方式 is one control: aiReview moving along with tier is that same switch, not a separate rule.
  const hasNextRun =
    ('aiReview' in patch && !('tier' in patch)) ||
    'alwaysAllow' in patch ||
    'triggerScope' in patch ||
    'triggerList' in patch ||
    'concurrency' in patch
  const hasNextSession =
    'systemPrompt' in patch ||
    'model' in patch ||
    'effort' in patch ||
    'gitName' in patch ||
    'gitEmail' in patch ||
    'agentSettings' in patch ||
    workspaceChanged ||
    providerChanged
  if (hasLive && !hasNextRun && !hasNextSession)
    return t('{name} 已保存 · 运行中的任务立即生效', { name: botName })
  if (hasLive) return t('{name} 已保存 · 权限改动立即生效，其余稍后生效', { name: botName })
  if (!hasLive && hasNextRun && !hasNextSession)
    return t('{name} 已保存 · 下一轮运行起生效', { name: botName })
  if (!hasLive && !hasNextRun && !hasNextSession) return t('{name} 已保存', { name: botName })
  return t('{name} 已保存 · 下一次新开会话时生效', { name: botName })
}

const scrollIntoViewRef = (el: HTMLDivElement | null) => el?.scrollIntoView?.({ block: 'nearest' })

const GROUP_TIER_LABEL = (tier: Tier, aiReview: boolean, focus?: AccessFocus) =>
  tier === 'full'
    ? t('完全允许')
    : tier === 'read-only'
      ? t('只读')
      : focus === 'trusted' || focus === 'others'
        ? t('需要审批')
        : APPROVAL_MODE_LABEL[approvalMode({ tier, aiReview })]

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
  groupId,
  focus,
  onDirtyChange,
  onChanged,
}: {
  bot: BotDto
  me: UserDto
  users: UserBriefDto[]
  /** Embedded in a dialog: no panel chrome, no usage tab (the bot page shows it). */
  plain?: boolean
  tab?: BotTab
  groupId?: string
  focus?: AccessFocus
  onDirtyChange?: (dirty: boolean) => void
  onChanged?: () => void
}) {
  const owner = me.id === bot.ownerId
  const canEdit = owner || me.role === 'sysadmin'
  const demo = useSession((s) => s.tenancy?.demoMode)
  const group = useWorkspace((s) => (groupId ? s.groups.find((g) => g.id === groupId) : undefined))
  const groupStates = useWorkspace((s) => (groupId ? s.botStates[groupId] : undefined))
  const groupState = groupStates?.[bot.id]
  const groupTier = groupState?.tier ?? null
  useEffect(() => {
    if (groupId && group && !groupStates) void loadBotStates(groupId).catch(() => {})
  }, [groupId, group, groupStates])
  const [resettingGroupTier, setResettingGroupTier] = useState(false)
  const [tab, setTab] = useState<string>(initialTab)
  useEffect(() => setTab(initialTab), [initialTab])
  const [name, setName] = useState(bot.name)
  const [avatar, setAvatar] = useState(botRole(bot))
  const [prompt, setPrompt] = useState(bot.systemPrompt)
  const [workspace, setWorkspace] = useState(bot.defaultWorkspace)
  /** null = the bot's provider is kept. */
  const [provider, setProvider] = useState<string | null>(null)
  const [config, setConfig] = useState<AgentConfig>({ model: bot.model, effort: bot.effort })
  const [audience, setAudience] = useState<AudienceValue>(audienceValue(bot))
  const [list, setList] = useState(bot.triggerList)
  const [concurrency, setConcurrency] = useState(bot.concurrency)
  const [approval, setApproval] = useState<ApprovalValue>({
    tier: bot.tier,
    alwaysAllow: bot.alwaysAllow,
    aiReview: bot.aiReview,
  })
  const tier = approval.tier
  const [gitName, setGitName] = useState(bot.gitName ?? '')
  const [gitEmail, setGitEmail] = useState(bot.gitEmail ?? '')
  const [overrides, setOverrides] = useState(bot.agentSettings)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const machine = useWorkspace((s) => s.machines.find((m) => m.id === bot.machineId))
  const reason = providerBlocked(me.id, bot.ownerId, machine)
  const [view, setView] = useMachineProviders(bot.machineId, !!reason)
  const savedProvider = view?.bots[bot.id] ?? INHERIT_PROVIDER
  const picked = provider !== null && provider !== savedProvider ? provider : null
  const effective =
    view && !reason ? effectiveProvider(view, bot.agentKind, bot.id).provider : OFFICIAL_PROVIDER
  const live = useBotCatalog(bot.id, effective)
  const pickedCatalog = useProviderCatalog(
    bot.machineId,
    bot.agentKind,
    picked && view ? choiceProvider(view, bot.agentKind, picked) : null,
  )
  const catalog = picked ? pickedCatalog : (live?.catalog ?? bot.catalog)
  // Only on the owner's own machine: it alone sees the machine, and a picked provider declares its own models.
  const refresh =
    !picked && machine?.online && machine.features.includes('reprobe') ? live?.refresh : undefined
  // The owner on their own machine sets provider, model and level in one go (PUT /bots/:id/provider).
  const together = !reason && !!view
  const modelChanged = config.model !== bot.model
  const effortChanged = config.effort !== bot.effort

  const scoped = audiencePatch(audience, bot.access, !!demo)
  // Unchanged values are left out: one the catalog no longer lists would be refused.
  const patch: BotPatch = {
    ...(name.trim() !== bot.name && { name: name.trim() }),
    ...(avatar !== botRole(bot) && { avatar }),
    ...(prompt !== bot.systemPrompt && { systemPrompt: prompt }),
    ...(tier !== bot.tier && { tier }),
    ...(scoped.triggerScope !== bot.triggerScope && { triggerScope: scoped.triggerScope }),
    ...(!sameAccess(scoped.access, bot.access) && { access: scoped.access }),
    ...(!sameList(list, bot.triggerList) && { triggerList: list }),
    ...(!together && modelChanged && { model: config.model }),
    ...(!together && effortChanged && { effort: config.effort }),
    ...(concurrency !== bot.concurrency && { concurrency }),
    // Only the owner may send these (plan J9).
    ...(owner && !sameList(approval.alwaysAllow, bot.alwaysAllow) && { alwaysAllow: approval.alwaysAllow }),
    ...(owner && approval.aiReview !== bot.aiReview && { aiReview: approval.aiReview }),
    ...(owner && (gitName.trim() || null) !== bot.gitName && { gitName: gitName.trim() || null }),
    ...(owner && (gitEmail.trim() || null) !== bot.gitEmail && { gitEmail: gitEmail.trim() || null }),
    ...(owner &&
      !sameMap(cleanOverrides(overrides), bot.agentSettings) && { agentSettings: cleanOverrides(overrides) }),
  }
  const providerDirty = together && (picked !== null || modelChanged || effortChanged)
  const dirty = Object.keys(patch).length > 0 || workspace !== bot.defaultWorkspace || providerDirty
  useEffect(() => {
    onDirtyChange?.(canEdit && dirty)
  }, [canEdit, dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const commit = async (providerSwitched = false) => {
    setSaving(true)
    let changed = false
    const workspaceChanged = workspace !== bot.defaultWorkspace
    try {
      if (Object.keys(patch).length) {
        await botsApi.update(bot.id, patch)
        changed = true
        if (hasPermissionChange(patch)) graduateApprovalGuide(me.id)
      }
      if (workspaceChanged) {
        await botsApi.setDefaultWorkspace(bot.id, workspace)
        changed = true
      }
      changed = true
      toast({
        type: 'success',
        message: saveToastMessage(name.trim(), patch, workspaceChanged, providerSwitched),
      })
    } catch (e) {
      toastError(e)
    } finally {
      if (changed) onChanged?.()
      setSaving(false)
    }
  }
  // Provider, model and level go first, in one request: the model is checked against the provider in effect.
  const switcher = useProviderSwitch(async ({ choice }) => {
    setSaving(true)
    try {
      const body = {
        choice,
        ...(modelChanged && { model: config.model }),
        ...(effortChanged && { effort: config.effort }),
      }
      setView(await api.put<ProviderStoreView>(`/bots/${bot.id}/provider`, body))
      setProvider(null)
    } catch (e) {
      setSaving(false)
      toastError(e)
      return
    }
    await commit(true)
  })
  const save = () =>
    providerDirty && view
      ? switcher.request({ agent: bot.agentKind, choice: picked ?? savedProvider, botId: bot.id }, view)
      : void commit(false)

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
        <FormRow label={t('头像')} hint={t('上传的图片代替角色形象显示')}>
          <AvatarEditor
            name={bot.name}
            shape="square"
            src={bot.avatarUrl ?? undefined}
            preview={
              <Avatar
                name={bot.name}
                shape="square"
                size={40}
                src={bot.avatarUrl ?? avatarSrc(roleFace(avatar, bot.agentKind))}
              />
            }
            onUpload={async (image) => {
              await botsApi.uploadAvatar(bot.id, image)
              onChanged?.()
            }}
            onRemove={async () => {
              await botsApi.removeAvatar(bot.id)
              onChanged?.()
            }}
          />
        </FormRow>
      ) : null}
      {canEdit ? (
        <FormRow label={t('角色')} align="top" hint={roleHint(avatar, bot.agentKind)}>
          <RolePicker value={avatar} agent={bot.agentKind} onChange={setAvatar} />
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
      <FormRow label={t('运行电脑')}>
        <span className="bots-detail__mono">
          <MachineLink id={bot.machineId} name={bot.machineName} />
        </span>
      </FormRow>
      <FormRow label="Agent">
        <span className="bots-detail__mono">{agentCliVersion(bot)}</span>
      </FormRow>
      {bot.machineId ? (
        <ProviderModelFields
          reason={reason}
          view={view}
          machine={machine}
          agent={bot.agentKind}
          value={{ provider: provider ?? savedProvider, config }}
          catalog={catalog}
          disabled={!canEdit}
          refresh={refresh}
          onChange={(next) => {
            setProvider(next.provider)
            setConfig(next.config)
          }}
        />
      ) : (
        <AgentConfigFields
          catalog={catalog}
          value={config}
          disabled={!canEdit}
          refresh={refresh}
          onChange={setConfig}
        />
      )}
      <BotAgentSettingRows
        agent={bot.agentKind}
        value={overrides}
        machine={view && !reason ? (view.agentSettings[bot.agentKind]?.values ?? {}) : undefined}
        outdated={!!machine?.online && !machine.features.includes('agentSettings')}
        editable={owner}
        onChange={setOverrides}
      />
      {owner && bot.machineId ? (
        <DefaultWorkspaceRow
          machineId={bot.machineId}
          value={workspace}
          hint={t('未绑定仓库的群和私聊中自动使用；绑定仓库的群默认自动克隆')}
          onChange={setWorkspace}
        />
      ) : null}
    </Form>
  )

  const resetGroupTier = async () => {
    if (!groupId) return
    setResettingGroupTier(true)
    const previous = groupTier
    const apply = async (tier: Tier | null) => {
      await groupsApi.setBotTier(groupId, bot.id, tier)
      if (groupState)
        useWorkspace.getState().applyEvent({ t: 'group.botState', groupId, state: { ...groupState, tier } })
    }
    try {
      await apply(null)
      graduateApprovalGuide(me.id)
      toast({
        type: 'success',
        message: t('已恢复本群跟随全局审批方式'),
        action: {
          label: t('撤销#undo'),
          onClick: () =>
            void apply(previous)
              .then(() => toast({ type: 'success', message: t('已撤销') }))
              .catch(toastError),
        },
      })
    } catch (e) {
      toastError(e)
    } finally {
      setResettingGroupTier(false)
    }
  }

  const groupOverride = !!groupId && groupTier !== null
  // While this group overrides the approval mode, the override (not the global row) is what applied to the request.
  const overrideApplies = groupOverride && focus === 'owner'
  const access = (
    <Form>
      {groupOverride ? (
        <div
          ref={overrideApplies ? scrollIntoViewRef : undefined}
          className="bot-settings__banner"
          data-focus-row={overrideApplies ? 'owner' : undefined}
        >
          <Alert
            variant="warning"
            title={
              group?.name
                ? t('当前群「{group}」已单独设为「{tier}」', {
                    group: group.name,
                    tier: GROUP_TIER_LABEL(groupTier, bot.aiReview, focus),
                  })
                : t('当前群已单独设为「{tier}」', {
                    tier: GROUP_TIER_LABEL(groupTier, bot.aiReview, focus),
                  })
            }
            description={
              focus === 'trusted' || focus === 'others'
                ? t(
                    '本群审批方式会作为信任名单和其他成员的权限上限覆盖全局设置；恢复跟随全局会立即生效，不用保存。',
                  )
                : t(
                    '本群单独设置了审批方式，下方全局「审批方式」在本群不生效；恢复跟随全局会立即生效，不用保存。',
                  )
            }
          >
            {canEdit || overrideApplies ? (
              <div className="bot-settings__banner-actions">
                {overrideApplies ? <Tag tone="blue">{t('本次请求适用')}</Tag> : null}
                {canEdit ? (
                  <Button size="small" loading={resettingGroupTier} onClick={() => void resetGroupTier()}>
                    {t('恢复跟随全局')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Alert>
        </div>
      ) : null}
      <ApprovalFields
        owner={owner}
        canEdit={canEdit}
        demo={demo}
        value={approval}
        focus={overrideApplies ? undefined : focus}
        outdated={
          machine?.online && !machine.features.includes('approvalGates') ? (bot.machineName ?? '') : undefined
        }
        builtin={
          (bot.agentKind === 'claude' || bot.agentKind === 'codex') &&
          !!machine?.features.includes('builtinReview')
        }
        onChange={setApproval}
      />
      <AudienceFields
        canEdit={canEdit}
        demo={demo}
        value={audience}
        onChange={setAudience}
        list={list}
        users={users}
        ownerId={bot.ownerId}
        focus={focus}
        onListChange={setList}
      />
    </Form>
  )

  const advanced = (
    <Form>
      <FormRow
        label={t('并发上限')}
        hint={canEdit ? t('同时执行的任务上限，超出的在这台电脑排队') : undefined}
      >
        {canEdit ? (
          <Stepper
            live
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
          hint={t('Bot 提交代码时的作者名和邮箱，留空用默认值；下次启动 Agent 时生效')}
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
    </Form>
  )

  const feishu = (
    <Form>
      <FormRow
        label={t('飞书应用')}
        align="top"
        hint={
          <>
            {t('该 Bot 专属的飞书自建应用，用于在飞书群里被 @')}
            <span style={{ display: 'block' }}>{t('本页修改即时生效，无需点击底部「保存」。')}</span>
          </>
        }
      >
        <FeishuAppForm path={`/bots/${bot.id}/feishu`} removeLabel={t('移除飞书应用')} />
      </FormRow>
    </Form>
  )

  const tabs = [
    { value: 'basic', label: t('基本信息'), content: basic },
    { value: 'run', label: t('运行配置'), content: run },
    { value: 'access', label: t('权限'), content: access },
    { value: 'advanced', label: t('高级'), content: advanced },
    ...(canEdit
      ? [
          { value: 'feishu', label: t('飞书'), content: feishu },
          { value: 'share', label: t('共享'), content: <BotShares bot={bot} users={users} /> },
        ]
      : []),
    ...(plain ? [] : [{ value: 'usage', label: t('用量'), content: <UsageTab bot={bot} /> }]),
  ]

  return (
    <aside className={cx('bots-detail', plain && 'bots-detail--plain')} aria-label={t('Bot 详情')}>
      <div className="bots-detail__head">
        <BotAvatar id={bot.id} name={bot.name} size={32} />
        <div className="bots-detail__titles">
          <span className="bots-detail__name">{bot.name}</span>
          <span className="bots-detail__meta">
            <AgentIcon kind={bot.agentKind} size={14} /> {AGENT_META[bot.agentKind].name} · {bot.ownerName}
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
          {(tab === 'usage' || tab === 'share' || tab === 'feishu') && dirty ? (
            <span className="bots-detail__meta" style={{ marginRight: 'var(--space-8)' }}>
              {t('其他标签页有未保存的更改')}
            </span>
          ) : null}
          {(tab === 'usage' || tab === 'share' || tab === 'feishu') && !dirty ? null : (
            <Button
              variant="primary"
              disabled={!dirty || saving || !name.trim()}
              loading={saving}
              onClick={save}
            >
              {t('保存')}
            </Button>
          )}
        </div>
      ) : null}
      {switcher.dialog}
      <Presence>
        {deleting ? (
          <DeleteBotDialog
            bot={bot}
            onDone={() => {
              setDeleting(false)
              onChanged?.()
            }}
            onClose={() => setDeleting(false)}
          />
        ) : null}
      </Presence>
    </aside>
  )
}
