import type { BotDto, GroupDto, GroupNoticeDto, GroupParams, Tier, UserBriefDto } from '@gonggong/protocol'
import { type ReactNode, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Avatar,
  Button,
  ChatInfoBody,
  type ChatInfoDanger,
  type ChatInfoRow,
  Dialog,
  EmptyState,
  GroupBox,
  Icon,
  IconButton,
  InspectorPanel,
  MenuButton,
  type MenuItem,
  Presence,
  SearchField,
  Select,
  Switch,
  Tag,
  TextField,
  toast,
  useEscape,
} from '../../ui'
import { APPROVAL_MODE_LABEL, approvalMode } from '../bots/ApprovalFields'
import { BotAvatar } from '../bots/avatars'
import { BotDialog } from '../bots/lazy'
import { AGENT_LABEL, PRESENCE, TRIGGER_SCOPE_LABEL } from '../bots/model'
import { ShareRequestAction } from '../bots/ShareRequest'
import { KnowledgeView } from '../knowledge/KnowledgeView'
import { PreviewsView } from '../previews/PreviewsView'
import { usePreviews } from '../previews/store'
import { BotWorkspaceDialog, blocker, botOnline, isPaused, workspaceText } from '../repos/BotWorkspaceDialog'
import { RepoGit } from '../repos/BotWorkspaces'
import { repoPath } from '../repos/RepoPicker'
import { effectiveTier, TIER_LABEL, TIERS } from '../runs/tier'
import { SchedulesView } from '../schedules/SchedulesView'
import { useSchedules } from '../schedules/store'
import { openSyncPanel, useSyncStatus } from '../sync/store'
import { WorkspacePicker } from '../workspaces/WorkspacePicker'
import { groupsApi, paramsSummary } from './api'
import { GroupAvatar } from './GroupAvatar'
import { hideNotice, RemoveNoticeDialog } from './GroupNotice'
import { NOTIFY_LEVELS } from './notify'
import { BotPicker, MemberPicker } from './pickers'
import './groups.css'

export type SettingsTab =
  | 'basic'
  | 'members'
  | 'bots'
  | 'repo'
  | 'params'
  | 'mcp'
  | 'skill'
  | 'secrets'
  | 'feishu'
  | 'plugins'
export type InfoView =
  | 'main'
  | 'members'
  | 'bots'
  | 'info'
  | 'notices'
  | 'previews'
  | 'schedules'
  | 'knowledge'

type GroupPrefs = Partial<Pick<GroupDto, 'pinned' | 'foldRuns'>>

/** Inline replacement for a failed load: one line plus 重试. */
function LoadError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <span className="gs-error">
      {text}
      <Button size="small" onClick={onRetry}>
        {t('重试')}
      </Button>
    </span>
  )
}

/** Confirms a removal; the action button stays disabled while the request is in flight. */
function ConfirmRemove({
  title,
  desc,
  onConfirm,
  onClose,
}: {
  title: string
  desc: string
  onConfirm: () => Promise<boolean>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    if (await onConfirm()) onClose()
    else setBusy(false)
  }
  return (
    <Dialog
      open
      title={title}
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => void run()}>
            {t('移出')}
          </Button>
        </>
      }
    >
      <p className="gs-note">{desc}</p>
    </Dialog>
  )
}

async function removeWithToast(fn: () => Promise<unknown>, name: string) {
  const ok = await attempt(fn)
  if (ok) toast({ type: 'success', message: t('已移出 {name}', { name }) })
  return ok
}

const SCOPE_LABEL = (b: BotDto) =>
  b.triggerScope === 'list'
    ? t('{scope} {n} 人', { scope: TRIGGER_SCOPE_LABEL.list, n: b.triggerList.length })
    : TRIGGER_SCOPE_LABEL[b.triggerScope]

/**
 * Group settings as the Pane ChatInfoPanel in the chat inspector: identity, shortcuts, members, my switches, 群管理
 * rows and the danger zone; members, Bot and name/notice open as sub-views with a back button.
 */
export function GroupInfo({
  group,
  initialView = 'main',
  readOnly = false,
  onClose,
  onSettings,
}: {
  group: GroupDto
  initialView?: InfoView
  /** A team admin outside the group (plan D19): only its members are shown. */
  readOnly?: boolean
  onClose: () => void
  onSettings: (tab: SettingsTab) => void
}) {
  const me = useSession((s) => s.user)
  const [view, setView] = useState<InfoView>(initialView)
  const [adding, setAdding] = useState(false)
  const dm = group.kind === 'dm'
  const isAdmin = !readOnly && group.members.some((m) => m.userId === me?.id && m.isAdmin)
  const canInvite = !readOnly && !dm && (isAdmin || !group.adminOnlyInvite)
  const label = dm ? t('私聊设置') : t('群设置')
  useEscape(onClose)
  const title = {
    main: label,
    members: t('群成员 · {n}', { n: group.members.length }),
    bots: `Bot · ${group.botIds.length}`,
    info: t('编辑群公告'),
    notices: t('群公告'),
    previews: t('预览与服务'),
    schedules: t('定时任务'),
    knowledge: t('知识库#kb'),
  }[view]
  return (
    <InspectorPanel
      title={title}
      label={label}
      className="gs-panel"
      onBack={view === 'main' || readOnly ? undefined : () => setView('main')}
      onClose={onClose}
    >
      {view === 'main' ? (
        <MainView
          group={group}
          isAdmin={isAdmin}
          canInvite={canInvite}
          setView={(v, add = false) => {
            setAdding(add)
            setView(v)
          }}
          onClose={onClose}
          onSettings={onSettings}
        />
      ) : view === 'members' ? (
        <MembersView group={group} isAdmin={isAdmin} canInvite={canInvite} initialAdding={adding} />
      ) : view === 'bots' ? (
        <BotsView group={group} isAdmin={isAdmin} member={!readOnly} />
      ) : view === 'notices' ? (
        <NoticesView group={group} isAdmin={isAdmin} onEdit={() => setView('info')} />
      ) : view === 'previews' ? (
        <PreviewsView groupId={group.id} onOpen={onClose} />
      ) : view === 'schedules' ? (
        <SchedulesView groupId={group.id} />
      ) : view === 'knowledge' ? (
        <KnowledgeView groupId={group.id} />
      ) : (
        <NoticeForm group={group} onSaved={() => setView('main')} />
      )}
    </InspectorPanel>
  )
}

function MainView({
  group,
  isAdmin,
  canInvite,
  setView,
  onClose,
  onSettings,
}: {
  group: GroupDto
  isAdmin: boolean
  canInvite: boolean
  setView: (v: InfoView, add?: boolean) => void
  onClose: () => void
  onSettings: (tab: SettingsTab) => void
}) {
  const navigate = useNavigate()
  const allBots = useWorkspace((s) => s.bots)
  const previews = usePreviews(group.id)
  const schedules = useSchedules(group.id)
  const [params, setParams] = useState<GroupParams | null>(null)
  const [paramsFailed, setParamsFailed] = useState(false)
  const [pending, setPending] = useState<GroupPrefs | null>(null)
  const [confirm, setConfirm] = useState<'leave' | 'dissolve' | null>(null)
  // A double click must not arm and confirm at once: the armed row takes clicks only after a beat.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    setSettled(false)
    if (!confirm) return
    const id = setTimeout(() => setSettled(true), CONFIRM_DELAY_MS)
    return () => clearTimeout(id)
  }, [confirm])
  const sync = useSyncStatus(group)
  const dm = group.kind === 'dm'
  const admins = group.members.filter((m) => m.isAdmin)
  const onlyAdmin = isAdmin && admins.length === 1 && group.members.length > 1
  // The server refuses leaving for the last member: they dissolve instead.
  const canLeave = !dm && group.members.length > 1
  const gBots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))

  const loadParams = useCallback(() => {
    setParamsFailed(false)
    groupsApi.params(group.id).then(setParams, () => setParamsFailed(true))
  }, [group.id])
  useEffect(loadParams, [loadParams])

  // Optimistic: the switch flips at once and is locked until the server answers; a failure rolls it back.
  const prefs = async (body: GroupPrefs) => {
    setPending(body)
    await attempt(() => groupsApi.prefs(group.id, body))
    setPending(null)
  }
  const pref = (k: keyof GroupPrefs, name: string, description?: string): ChatInfoRow => ({
    label: name,
    description,
    control: (
      <Switch
        aria-label={name}
        checked={pending?.[k] ?? group[k]}
        disabled={!!pending}
        onChange={(v) => void prefs({ [k]: v })}
      />
    ),
  })

  const gone = async (fn: () => Promise<unknown>, message: string) => {
    if (await attempt(fn)) {
      onClose()
      navigate('/')
      toast({ type: 'success', message })
    }
  }
  const leave = () => {
    if (confirm !== 'leave') return setConfirm('leave')
    if (!settled) return
    if (onlyAdmin) return setView('members')
    void gone(() => groupsApi.leave(group.id), t('已退出群'))
  }
  const dissolve = () => {
    if (confirm !== 'dissolve') return setConfirm('dissolve')
    if (!settled) return
    void gone(() => groupsApi.dissolve(group.id), dm ? t('已删除私聊') : t('群已解散'))
  }

  /** The settings dialog, read-only for plain members. */
  const manage = (name: string, value: ReactNode, tab: SettingsTab): ChatInfoRow => ({
    label: name,
    value,
    onClick: () => onSettings(tab),
  })
  const danger: ChatInfoDanger[] = [
    ...(canLeave
      ? [
          {
            label: confirm === 'leave' && !onlyAdmin ? t('确认退出') : t('退出群'),
            armed: confirm === 'leave' && !onlyAdmin,
            settling: confirm === 'leave' && !settled,
            onClick: leave,
            note:
              confirm === 'leave'
                ? onlyAdmin
                  ? t('你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。')
                  : t('退出后你的 Bot 一并移出本群；运行中的轮次按非主动中断处理。再次点击确认。')
                : undefined,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            label: dm
              ? confirm === 'dissolve'
                ? t('确认删除')
                : t('删除私聊')
              : confirm === 'dissolve'
                ? t('确认解散')
                : t('解散群'),
            armed: confirm === 'dissolve',
            settling: confirm === 'dissolve' && !settled,
            onClick: dissolve,
            note:
              confirm === 'dissolve'
                ? dm
                  ? t(
                      '删除后消息与审计记录保留；Bot 的托管工作区保留在本机，由你决定是否删除。再次点击确认。',
                    )
                  : t(
                      '解散后群归档，消息与审计记录保留；强制同步群的存档 30 天后清除；各 Bot 的托管工作区保留，由主人决定是否删除。再次点击确认。',
                    )
                : undefined,
          },
        ]
      : []),
  ]

  return (
    <ChatInfoBody
      avatar={<GroupAvatar group={group} size={56} />}
      name={group.name}
      tags={[
        ...(dm
          ? []
          : [
              group.visibility === 'public'
                ? { label: t('公开频道'), tone: 'blue' as const }
                : { label: t('私有群'), tone: 'gray' as const },
            ]),
        { label: GROUP_MODE_LABEL[group.mode], tone: 'gray' },
      ]}
      description={
        group.repo ? `${group.repo.url} · ${group.repo.branch}` : t('未绑定仓库 · 各 Bot 使用本机目录')
      }
      shortcuts={[
        ...(dm ? [] : [{ icon: 'person-2' as const, label: t('成员'), onClick: () => setView('members') }]),
        ...(isAdmin && !dm
          ? [{ icon: 'megaphone' as const, label: t('公告'), onClick: () => setView('info') }]
          : []),
        { icon: 'gear' as const, label: t('设置'), onClick: () => onSettings('basic') },
      ]}
      members={dm ? [] : group.members.map((m) => ({ name: m.name }))}
      memberCount={group.members.length}
      onAddMember={canInvite ? () => setView('members', true) : undefined}
      onShowAllMembers={() => setView('members')}
      settings={[
        {
          rows: [
            {
              label: 'Bot',
              description: (
                <span className="gs-chips">
                  {gBots.map((b) => (
                    <span key={b.id} className="gs-chip">
                      <span className="gs-dot" style={{ background: PRESENCE[b.presence].color }} />
                      <span className="gs-chip__name">{b.name}</span>
                    </span>
                  ))}
                </span>
              ),
              value: t('{n} 个', { n: group.botIds.length }),
              onClick: () => setView('bots'),
            },
            ...(group.mode === 'force'
              ? [
                  {
                    label: t('同步状态'),
                    value: sync
                      ? `v${sync.headVersion} · ${t('{a}/{b} 一致', { a: sync.consistent, b: sync.total })}`
                      : undefined,
                    onClick: () => openSyncPanel(group.id),
                  },
                ]
              : []),
            {
              label: t('预览与服务'),
              value: previews ? t('{n} 个预览', { n: previews.previews.length }) : undefined,
              onClick: () => setView('previews'),
            },
            {
              label: t('定时任务'),
              value: schedules ? t('{n} 个', { n: schedules.length }) : undefined,
              onClick: () => setView('schedules'),
            },
            { label: t('知识库#kb'), onClick: () => setView('knowledge') },
            ...(dm
              ? []
              : [
                  {
                    label: t('群公告'),
                    description: group.notice || undefined,
                    value: group.noticeHidden ? t('已隐藏') : group.notice ? undefined : t('暂无'),
                    onClick: () => setView('notices'),
                  },
                ]),
          ],
        },
        {
          rows: [
            {
              label: t('通知'),
              control: (
                <Select
                  label={t('通知')}
                  options={NOTIFY_LEVELS}
                  value={group.notifyLevel}
                  onChange={(notifyLevel) => void attempt(() => groupsApi.prefs(group.id, { notifyLevel }))}
                />
              ),
            },
            pref('pinned', t('星标')),
            pref('foldRuns', t('运行卡片默认折叠'), t('只对我生效，审批与提问卡片始终展开')),
          ],
        },
        {
          title: dm ? t('设置') : t('群管理'),
          note: dm
            ? undefined
            : isAdmin
              ? t('你是群管理员')
              : t('仅群管理员 · {names}', { names: admins.map((m) => m.name).join(t('、')) }),
          rows: [
            manage(dm ? t('私聊名称') : t('基本信息'), group.name, 'basic'),
            ...(dm
              ? []
              : [
                  manage(
                    t('成员'),
                    group.adminOnlyInvite ? t('仅群管理员可拉人') : t('所有成员可拉人'),
                    'members',
                  ),
                ]),
            manage(
              t('仓库与同步'),
              <>
                <span className={group.repo ? 'gs-mono' : undefined}>
                  {group.repo ? repoPath(group.repo.url) : t('未绑定仓库')}
                </span>
                {` · ${GROUP_MODE_LABEL[group.mode]}`}
              </>,
              'repo',
            ),
            paramsFailed
              ? {
                  label: t('群级参数'),
                  value: <LoadError text={t('群级参数加载失败')} onRetry={loadParams} />,
                }
              : manage(t('群级参数'), params ? paramsSummary(params) : '', 'params'),
            ...(dm
              ? []
              : [
                  manage('MCP', undefined, 'mcp'),
                  manage('Skill', undefined, 'skill'),
                  manage(t('密钥'), undefined, 'secrets'),
                  ...(isAdmin ? [manage(t('飞书'), undefined, 'feishu')] : []),
                ]),
          ],
        },
      ]}
      danger={danger}
    />
  )
}

export function MembersView({
  group,
  isAdmin,
  canInvite,
  initialAdding,
}: {
  group: GroupDto
  isAdmin: boolean
  canInvite: boolean
  /** Opened from the 添加 tile: the candidate list is shown at once. */
  initialAdding: boolean
}) {
  const me = useSession((s) => s.user)
  const allBots = useWorkspace((s) => s.bots)
  const [q, setQ] = useState('')
  const [removing, setRemoving] = useState<GroupDto['members'][number] | null>(null)
  // Loaded once the picker first opens; reopening refreshes it.
  const [wanted, setWanted] = useState(initialAdding)
  const usersQ = useGet<UserBriefDto[]>(wanted ? '/users' : null)
  const users = usersQ.data ?? []
  const candidates = users.filter((u) => !group.members.some((m) => m.userId === u.id))
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  const [promoting, setPromoting] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = group.members.filter((m) => !needle || m.name.toLowerCase().includes(needle))
  const toggleAdmin = async (m: GroupDto['members'][number]) => {
    setPromoting(m.userId)
    if (await attempt(() => groupsApi.setAdmin(group.id, m.userId, !m.isAdmin)))
      toast({
        type: 'success',
        message: m.isAdmin
          ? t('已取消 {name} 的管理员', { name: m.name })
          : t('已将 {name} 设为管理员', { name: m.name }),
      })
    setPromoting('')
  }
  const add = async (ids: string[]) => {
    if (await attempt(() => groupsApi.addMembers(group.id, ids)))
      toast({ type: 'success', message: t('已添加 {n} 人', { n: ids.length }) })
  }

  return (
    <>
      <div className="gs-toolbar">
        <SearchField className="gs-search" placeholder={t('搜索成员')} value={q} onChange={setQ} />
        {canInvite ? (
          <MemberPicker
            placement="bottom-end"
            trigger={<Button size="small">{t('添加成员')}</Button>}
            users={candidates}
            defaultOpen={initialAdding}
            onOpen={() => (wanted ? usersQ.reload() : setWanted(true))}
            onAdd={(ids) => void add(ids)}
            status={
              usersQ.error ? (
                <LoadError text={t('成员列表加载失败')} onRetry={usersQ.reload} />
              ) : users.length ? (
                <span className="pick__empty">{t('所有账号都已在群里')}</span>
              ) : undefined
            }
          />
        ) : null}
      </div>
      {shown.length ? (
        <GroupBox>
          {shown.map((m) => {
            const theirs = bots.filter((b) => b.ownerId === m.userId).map((b) => b.name)
            return (
              <div key={m.userId} className="gs-member" data-testid={`member-${m.userId}`}>
                <Avatar name={m.name} src={m.avatar ?? undefined} size={28} />
                <div className="gs-member__main">
                  <span className="gs-member__name">
                    {m.name}
                    {m.userId === me?.id ? t('（我）') : ''}
                    {m.isAdmin ? <Tag tone="blue">{t('群管理员')}</Tag> : null}
                  </span>
                  <span className="gs-desc">
                    {theirs.length ? t('带入 {bots}', { bots: theirs.join(t('、')) }) : t('未带入 Bot')}
                  </span>
                </div>
                {isAdmin && m.userId !== me?.id ? (
                  <span className="gs-member__ops">
                    <Button
                      variant="plain"
                      size="small"
                      loading={promoting === m.userId}
                      disabled={!!promoting}
                      onClick={() => void toggleAdmin(m)}
                    >
                      {m.isAdmin ? t('取消管理员') : t('设为管理员')}
                    </Button>
                    <Button variant="plain" size="small" onClick={() => setRemoving(m)}>
                      {t('移出')}
                    </Button>
                  </span>
                ) : null}
              </div>
            )
          })}
        </GroupBox>
      ) : (
        <EmptyState compact icon="search" title={t('没有匹配的成员')} />
      )}
      <div className="gs-foot">{t('移出成员时，其 Bot 一并移出；运行中的 Bot 按非主动中断处理。')}</div>
      <Presence>
        {removing ? (
          <ConfirmRemove
            title={t('移出成员 {name}', { name: removing.name })}
            desc={t('其 Bot 一并移出本群；运行中的 Bot 按非主动中断处理。')}
            onClose={() => setRemoving(null)}
            onConfirm={() =>
              removeWithToast(() => groupsApi.removeMember(group.id, removing.userId), removing.name)
            }
          />
        ) : null}
      </Presence>
    </>
  )
}

export function BotsView({ group, isAdmin, member }: { group: GroupDto; isAdmin: boolean; member: boolean }) {
  const me = useSession((s) => s.user)
  const demo = useSession((s) => s.tenancy?.demoMode)
  const allBots = useWorkspace((s) => s.bots)
  const [removing, setRemoving] = useState<BotDto | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [picking, setPicking] = useState<BotDto | null>(null)
  const states = useWorkspace((s) => s.botStates[group.id])
  const editing = allBots.find((b) => b.id === editingId)
  const inspecting = allBots.find((b) => b.id === workspaceId)
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  // Members pull in only their own bots; admins anyone's (a DM only takes its owner's).
  const choices = allBots.filter((b) => (group.kind === 'group' && isAdmin) || b.ownerId === me?.id)
  const inGroup = (userId: string) => group.members.some((m) => m.userId === userId)
  const stuck = bots.flatMap((b) => {
    const why = blocker(states?.[b.id])
    return why ? [`${b.name} · ${why}`] : []
  })
  const recheck = (bot: BotDto) =>
    attempt(() => groupsApi.recheckBot(group.id, bot.id)).then(
      (ok) =>
        ok && toast({ type: 'info', message: t('正在让 {name} 的机器重新 clone…', { name: bot.name }) }),
    )
  const act = (b: BotDto, v: string) => {
    if (v === 'global') return setEditingId(b.id)
    if (v === 'remove') return setRemoving(b)
    const tier = v.slice(TIER_PREFIX.length)
    void attempt(() => groupsApi.setBotTier(group.id, b.id, tier === FOLLOW ? null : (tier as Tier)))
  }

  return (
    <>
      <div className="gs-toolbar">
        <span className="gs-toolbar__text">
          {t('{n} 个 · 在线 {online}', {
            n: bots.length,
            online: bots.filter((b) => b.presence === 'online' || b.presence === 'running').length,
          })}
        </span>
        {member ? (
          <BotPicker
            placement="bottom-end"
            trigger={<Button size="small">{t('拉入 Bot')}</Button>}
            bots={choices}
            isOn={(id) => group.botIds.includes(id)}
            onPick={(b, close) => {
              if (!group.botIds.includes(b.id)) return void attempt(() => groupsApi.addBot(group.id, b.id))
              if (!isAdmin) return
              close()
              setRemoving(b)
            }}
            note={(b) => (inGroup(b.ownerId) ? '' : t(' · 主人将一并加入'))}
          />
        ) : null}
      </div>
      {stuck.length ? (
        <Alert
          variant="warning"
          title={t('{n} 个 Bot 需要处理', { n: stuck.length })}
          description={stuck.join(t('；'))}
        />
      ) : null}
      <GroupBox>
        {bots.map((b) => {
          const s = states?.[b.id]
          const mine = b.ownerId === me?.id
          const owns = mine || me?.role === 'sysadmin'
          const online = botOnline(b)
          const others = (group.extraRepos?.length ?? 0) + (s?.extraDirs.length ?? 0)
          const tier = s?.tier ?? null
          const items: MenuItem[] = [
            ...(owns
              ? [
                  {
                    label: t('本群审批方式'),
                    submenu: [
                      {
                        value: FOLLOW,
                        label: t('跟随全局（{tier}）', { tier: APPROVAL_MODE_LABEL[approvalMode(b)] }),
                      },
                      ...TIERS.filter((x) => !demo || x !== 'full' || tier === 'full').map((x) => ({
                        value: x,
                        label: TIER_LABEL[x],
                      })),
                    ].map((o) => ({
                      ...o,
                      value: TIER_PREFIX + o.value,
                      checked: (tier ?? FOLLOW) === o.value,
                    })),
                  },
                  { label: t('全局设置'), value: 'global' },
                ]
              : []),
            ...(isAdmin
              ? [
                  ...(owns ? [{ separator: true as const }] : []),
                  { label: t('移出'), value: 'remove', destructive: true },
                ]
              : []),
          ]
          return (
            <div key={b.id} className="gs-bot" data-testid={`bot-${b.id}`}>
              <div className="gs-bot__head">
                <BotAvatar id={b.id} name={b.name} size={28} />
                <span className="gs-member__main">
                  <span className="gs-bot__name">
                    {b.name}
                    <Tag tone="blue">Bot</Tag>
                  </span>
                  <span className="gs-desc">
                    {t('{agent} · 主人 {owner}', { agent: AGENT_LABEL[b.agentKind], owner: b.ownerName })}
                  </span>
                </span>
                <span className="gs-bot__state">
                  <span className="gs-dot" style={{ background: PRESENCE[b.presence].color }} />
                  {PRESENCE[b.presence].label}
                </span>
              </div>
              <div className={cx('gs-bot__ws', blocker(s) && 'gs-bot__ws--warn')}>
                <Icon name="folder-git" size={13} />
                {workspaceText(s, online)}
                <RepoGit s={s?.git} />
                {others ? <span>{t('· 另 {n} 处', { n: others })}</span> : null}
              </div>
              <div className="gs-bot__meta">
                <span>
                  {t('审批 {mode}', {
                    mode: APPROVAL_MODE_LABEL[approvalMode({ ...b, tier: effectiveTier(b, s) })],
                  })}
                  {tier ? t(' · 本群') : ''}
                </span>
                <span>{t('触发 {scope}', { scope: SCOPE_LABEL(b) })}</span>
                <span className="spacer" />
                {isPaused(s) && (mine || isAdmin) ? (
                  <Button size="small" onClick={() => void recheck(b)}>
                    {t('重新检查')}
                  </Button>
                ) : null}
                {mine && (s?.state === 'confirm' || s?.state === 'unbound') && online && b.machineId ? (
                  <Button size="small" variant="primary" onClick={() => setPicking(b)}>
                    {t('选择工作区…')}
                  </Button>
                ) : (
                  <Button size="small" onClick={() => setWorkspaceId(b.id)}>
                    {t('工作区…')}
                  </Button>
                )}
                <ShareRequestAction bot={b} />
                {items.length ? (
                  <MenuButton
                    className="ui-btn ui-btn--plain ui-btn--small"
                    aria-label={t('{name} 的更多操作', { name: b.name })}
                    align="end"
                    items={items}
                    onSelect={(v) => act(b, v)}
                  >
                    <Icon name="more" size={15} />
                  </MenuButton>
                ) : null}
              </div>
            </div>
          )
        })}
      </GroupBox>
      <div className="gs-foot">
        {t('本群审批方式默认跟随 Bot 全局设置，运行中的轮次立即生效；本群为「完全允许」时仅指定名单可触发。')}
      </div>
      <Presence>
        {removing ? (
          <ConfirmRemove
            title={t('移出 Bot {name}', { name: removing.name })}
            desc={t('移出后保留其工作区，由主人决定是否删除；运行中的轮次按非主动中断处理。')}
            onClose={() => setRemoving(null)}
            onConfirm={() => removeWithToast(() => groupsApi.removeBot(group.id, removing.id), removing.name)}
          />
        ) : null}
      </Presence>
      <Presence>
        {inspecting ? (
          <BotWorkspaceDialog group={group} bot={inspecting} onClose={() => setWorkspaceId(null)} />
        ) : null}
      </Presence>
      <Presence>
        {picking?.machineId ? (
          <WorkspacePicker
            group={group}
            bot={{ ...picking, machineId: picking.machineId }}
            onClose={() => setPicking(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {editing && me ? (
          <Suspense fallback={null}>
            <BotDialog bot={editing} me={me} tab="access" onClose={() => setEditingId(null)} />
          </Suspense>
        ) : null}
      </Presence>
    </>
  )
}

/** Every published notice, newest first; the current one can be hidden (members) or removed (admins). */
function NoticesView({ group, isAdmin, onEdit }: { group: GroupDto; isAdmin: boolean; onEdit: () => void }) {
  const [list, setList] = useState<GroupNoticeDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [removing, setRemoving] = useState(false)
  const load = useCallback(() => {
    setFailed(false)
    groupsApi.notices(group.id).then(setList, () => setFailed(true))
  }, [group.id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the current notice changes
  useEffect(load, [load, group.notice])
  return (
    <>
      {isAdmin ? (
        <div className="gs-toolbar">
          <span className="spacer" />
          <Button size="small" onClick={onEdit}>
            {group.notice ? t('编辑公告') : t('发布公告')}
          </Button>
        </div>
      ) : null}
      {failed ? <LoadError text={t('群公告加载失败')} onRetry={load} /> : null}
      {list && !list.length ? <EmptyState compact title={t('暂无群公告')} /> : null}
      {list?.length ? (
        <GroupBox>
          {list.map((n) => {
            const current = !n.removedAt
            return (
              <div key={n.id} className="gs-notice">
                <p className="gs-notice__body">{n.body}</p>
                <div className="gs-bot__meta gs-notice__meta">
                  <span>
                    {n.authorName} · {new Date(n.createdAt).toLocaleString()}
                  </span>
                  {current ? (
                    <Tag tone="blue">{group.noticeHidden ? t('当前 · 已隐藏') : t('当前')}</Tag>
                  ) : null}
                  <span className="spacer" />
                  {current && isAdmin ? (
                    <Button variant="plain" size="small" onClick={() => setRemoving(true)}>
                      {t('移除')}
                    </Button>
                  ) : current ? (
                    <Button
                      variant="plain"
                      size="small"
                      onClick={() => void hideNotice(group.id, !group.noticeHidden)}
                    >
                      {group.noticeHidden ? t('在对话顶部显示') : t('不再显示')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </GroupBox>
      ) : null}
      <div className="gs-foot">
        {t('群管理员移除的公告对所有人隐藏；成员「不再显示」只对自己生效，发布新公告后重新显示。')}
      </div>
      <Presence>
        {removing ? <RemoveNoticeDialog groupId={group.id} onClose={() => setRemoving(false)} /> : null}
      </Presence>
    </>
  )
}

const FOLLOW = 'follow'
const CONFIRM_DELAY_MS = 400
const TIER_PREFIX = 'tier:'

function NoticeForm({ group, onSaved }: { group: GroupDto; onSaved: () => void }) {
  const [notice, setNotice] = useState(group.notice)
  const [saving, setSaving] = useState(false)
  const unchanged = notice.trim() === group.notice.trim()
  const save = async () => {
    setSaving(true)
    if (await attempt(() => groupsApi.update(group.id, { notice }))) {
      toast({ type: 'success', message: notice.trim() ? t('群公告已发布') : t('群公告已清空') })
      onSaved()
    }
    setSaving(false)
  }
  return (
    <div className="gs-form">
      <TextField
        multiline
        label={t('群公告 · 置顶展示在对话顶部')}
        rows={4}
        value={notice}
        maxLength={500}
        placeholder={t('如：每个 Bot 独立分支，走 PR；退款 v1 下周一下线')}
        onChange={(e) => setNotice(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !saving && !unchanged) void save()
        }}
      />
      <div className="gs-form__foot">
        <Button variant="primary" disabled={unchanged} loading={saving} onClick={() => void save()}>
          {t('保存')}
        </Button>
      </div>
    </div>
  )
}
