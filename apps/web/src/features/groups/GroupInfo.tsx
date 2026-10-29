import type { BotDto, GroupDto, GroupNoticeDto, GroupParams, Tier, UserBriefDto } from '@gonggong/protocol'
import { type ReactNode, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Avatar,
  Button,
  ChatInfoBody,
  type ChatInfoDanger,
  type ChatInfoRow,
  Dialog,
  EmptyState,
  GroupBox,
  IconButton,
  InspectorPanel,
  PopUpButton,
  Presence,
  SearchField,
  Switch,
  Tag,
  TextField,
  toast,
  useEscape,
} from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { BotDialog } from '../bots/lazy'
import { AGENT_LABEL, PRESENCE, TRIGGER_SCOPE_LABEL } from '../bots/model'
import { ShareRequestAction } from '../bots/ShareRequest'
import { GroupConfigView } from '../config/GroupConfigView'
import { KnowledgeView } from '../knowledge/KnowledgeView'
import { PreviewsView } from '../previews/PreviewsView'
import { usePreviews } from '../previews/store'
import { repoPath } from '../repos/RepoPicker'
import { RepoWorkspaceView } from '../repos/RepoWorkspaceView'
import { effectiveTier, TIER_LABEL, TIERS } from '../runs/tier'
import { SchedulesView } from '../schedules/SchedulesView'
import { useSchedules } from '../schedules/store'
import { GroupSecrets } from '../secrets/GroupSecrets'
import { openSyncPanel, useSyncStatus } from '../sync/store'
import { DirPicker } from '../workspaces/DirPicker'
import { groupsApi, paramsSummary } from './api'
import { GroupAvatar } from './GroupAvatar'
import { hideNotice, RemoveNoticeDialog } from './GroupNotice'
import { BotPicker, MemberPicker } from './pickers'
import './groups.css'

export type SettingsTab =
  | 'basic'
  | 'bots'
  | 'repo'
  | 'mode'
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
  | 'repo'
  | 'info'
  | 'notices'
  | 'previews'
  | 'schedules'
  | 'knowledge'
  | 'mcp'
  | 'skill'
  | 'secrets'

type GroupPrefs = Partial<Pick<GroupDto, 'muted' | 'pinned' | 'foldRuns'>>

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
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>
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
    repo: t('仓库与工作区'),
    info: t('编辑群公告'),
    notices: t('群公告'),
    previews: t('预览与服务'),
    schedules: t('定时任务'),
    knowledge: t('知识库#kb'),
    mcp: 'MCP',
    skill: 'Skill',
    secrets: t('密钥'),
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
      ) : view === 'repo' ? (
        <RepoWorkspaceView group={group} isAdmin={isAdmin} />
      ) : view === 'notices' ? (
        <NoticesView group={group} isAdmin={isAdmin} onEdit={() => setView('info')} />
      ) : view === 'previews' ? (
        <PreviewsView groupId={group.id} onOpen={onClose} />
      ) : view === 'schedules' ? (
        <SchedulesView groupId={group.id} />
      ) : view === 'knowledge' ? (
        <KnowledgeView groupId={group.id} />
      ) : view === 'mcp' || view === 'skill' ? (
        <GroupConfigView groupId={group.id} kind={view} />
      ) : view === 'secrets' ? (
        <GroupSecrets group={group} editable={false} />
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
    if (onlyAdmin) return setView('members')
    void gone(() => groupsApi.leave(group.id), t('已退出群'))
  }
  const dissolve = () => {
    if (confirm !== 'dissolve') return setConfirm('dissolve')
    void gone(() => groupsApi.dissolve(group.id), dm ? t('已删除私聊') : t('群已解散'))
  }

  /** Admins jump to the settings dialog; members may only read what has a read-only view here. */
  const manage = (name: string, value: ReactNode, tab: SettingsTab, readView?: InfoView): ChatInfoRow => ({
    label: name,
    value,
    onClick: () => (isAdmin ? onSettings(tab) : readView && setView(readView)),
    disabled: !isAdmin && !readView,
  })
  const danger: ChatInfoDanger[] = [
    ...(canLeave
      ? [
          {
            label: confirm === 'leave' && !onlyAdmin ? t('确认退出') : t('退出群'),
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
      tags={[{ label: GROUP_MODE_LABEL[group.mode], tone: 'gray' }]}
      description={
        group.repo ? `${group.repo.url} · ${group.repo.branch}` : t('未绑定仓库 · 各 Bot 使用本机目录')
      }
      shortcuts={[
        ...(dm ? [] : [{ icon: 'person-2' as const, label: t('成员'), onClick: () => setView('members') }]),
        ...(isAdmin
          ? [
              ...(dm
                ? []
                : [{ icon: 'megaphone' as const, label: t('公告'), onClick: () => setView('info') }]),
              { icon: 'gear' as const, label: t('设置'), onClick: () => onSettings('basic') },
            ]
          : []),
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
            pref('muted', t('消息免打扰'), t('普通消息不提醒；@我、我的 Bot 待审批、向我提问仍提醒')),
            pref('pinned', t('置顶群')),
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
                    t('成员与 Bot'),
                    group.adminOnlyInvite ? t('仅群管理员可拉人') : t('所有成员可拉人'),
                    'bots',
                  ),
                ]),
            manage(
              t('仓库与工作区'),
              <span className={group.repo ? 'gs-mono' : undefined}>
                {group.repo ? repoPath(group.repo.url) : t('未绑定')}
              </span>,
              'repo',
              'repo',
            ),
            manage(t('同步模式'), GROUP_MODE_LABEL[group.mode], 'mode'),
            paramsFailed
              ? {
                  label: t('群级参数'),
                  value: <LoadError text={t('群级参数加载失败')} onRetry={loadParams} />,
                }
              : manage(t('群级参数'), params ? paramsSummary(params) : '', 'params'),
            ...(dm
              ? []
              : [
                  manage('MCP', undefined, 'mcp', 'mcp'),
                  manage('Skill', undefined, 'skill', 'skill'),
                  manage(t('密钥'), undefined, 'secrets', 'secrets'),
                  manage(t('飞书'), undefined, 'feishu'),
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
            onAdd={(ids) => void attempt(() => groupsApi.addMembers(group.id, ids))}
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
      <GroupBox>
        {group.members
          .filter((m) => !q || m.name.includes(q))
          .map((m) => {
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
                      onClick={() => void attempt(() => groupsApi.setAdmin(group.id, m.userId, !m.isAdmin))}
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
  const allBots = useWorkspace((s) => s.bots)
  const [removing, setRemoving] = useState<BotDto | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dirsOf, setDirsOf] = useState<BotDto | null>(null)
  const states = useWorkspace((s) => s.botStates[group.id])
  const editing = allBots.find((b) => b.id === editingId)
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  // Members pull in only their own bots; admins anyone's (a DM only takes its owner's).
  const choices = allBots.filter((b) => (group.kind === 'group' && isAdmin) || b.ownerId === me?.id)
  const inGroup = (userId: string) => group.members.some((m) => m.userId === userId)

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
      <GroupBox>
        {bots.map((b) => (
          <div key={b.id} className="gs-bot">
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
            <div className="gs-bot__meta">
              <span>
                {t('档位 {tier}', { tier: TIER_LABEL[effectiveTier(b, states?.[b.id])] })}
                {states?.[b.id]?.tier ? t(' · 本群') : ''}
              </span>
              <span>{t('触发 {scope}', { scope: SCOPE_LABEL(b) })}</span>
              {b.ownerId !== me?.id && states?.[b.id]?.extraDirs.length ? (
                <span title={states[b.id]?.extraDirs.join('\n')}>
                  {t('附加目录 {n}', { n: states[b.id]?.extraDirs.length ?? 0 })}
                </span>
              ) : null}
              <span className="spacer" />
              <ShareRequestAction bot={b} />
              {b.ownerId === me?.id ? (
                <Button
                  variant="plain"
                  size="small"
                  title={states?.[b.id]?.extraDirs.join('\n') || undefined}
                  onClick={() => setDirsOf(b)}
                >
                  {states?.[b.id]?.extraDirs.length
                    ? t('附加目录 {n}', { n: states[b.id]?.extraDirs.length ?? 0 })
                    : t('附加目录')}
                </Button>
              ) : null}
              {b.ownerId === me?.id || me?.role === 'sysadmin' ? (
                <>
                  <GroupTierPicker groupId={group.id} bot={b} tier={states?.[b.id]?.tier ?? null} />
                  <Button variant="plain" size="small" onClick={() => setEditingId(b.id)}>
                    {t('全局设置')}
                  </Button>
                </>
              ) : null}
              {isAdmin ? (
                <Button variant="plain" size="small" onClick={() => setRemoving(b)}>
                  {t('移出')}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </GroupBox>
      <div className="gs-foot">
        {t(
          '档位默认跟随 Bot 全局设置，Bot 主人可为本群单独指定，运行中的轮次立即生效；本群为「完全访问」时仅指定名单可触发。 想少审批，Bot 主人可在 Bot 详情的「命令审批」中开启白名单或全部自动。移出后保留工作区，由主人决定是否删除。',
        )}
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
        {editing && me ? (
          <Suspense fallback={null}>
            <BotDialog bot={editing} me={me} tab="access" onClose={() => setEditingId(null)} />
          </Suspense>
        ) : null}
      </Presence>
      <Presence>
        {dirsOf ? (
          <ExtraDirsDialog
            groupId={group.id}
            bot={dirsOf}
            dirs={states?.[dirsOf.id]?.extraDirs ?? []}
            onClose={() => setDirsOf(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}

/** Machines whose daemon is connected: their directories can be browsed. */
const BROWSABLE: BotDto['presence'][] = ['online', 'running', 'agent_missing']

/** The directories on the owner's machine the bot also works in here, picked on that machine rather than typed. */
function ExtraDirsDialog({
  groupId,
  bot,
  dirs,
  onClose,
}: {
  groupId: string
  bot: BotDto
  dirs: string[]
  onClose: () => void
}) {
  const [list, setList] = useState(dirs)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const browsable = !!bot.machineId && BROWSABLE.includes(bot.presence)
  const save = async () => {
    setBusy(true)
    if (await attempt(() => groupsApi.setBotExtraDirs(groupId, bot.id, list))) onClose()
    else setBusy(false)
  }
  return (
    <>
      <Dialog
        open
        title={t('{bot} 的附加目录', { bot: bot.name })}
        width={480}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('取消')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {t('保存')}
            </Button>
          </>
        }
      >
        {list.length ? (
          <GroupBox>
            {list.map((dir) => (
              <div key={dir} className="gs-dir">
                <span className="gs-dir__path" title={dir}>
                  {dir}
                </span>
                <IconButton
                  size="small"
                  title={t('移除 {name}', { name: dir })}
                  onClick={() => setList(list.filter((d) => d !== dir))}
                >
                  {'minus' as const}
                </IconButton>
              </div>
            ))}
          </GroupBox>
        ) : null}
        <div className="gs-dir-add">
          <Button size="small" icon="folder" disabled={!browsable} onClick={() => setPicking(true)}>
            {t('添加目录…')}
          </Button>
          {browsable ? null : (
            <span className="gs-note">
              {bot.machineId
                ? t('机器离线，暂时无法浏览目录；已有目录仍可移除')
                : t('Bot 未绑定机器，无法浏览目录；已有目录仍可移除')}
            </span>
          )}
        </div>
        <p className="gs-note">
          {t(
            '除工作区外，Bot 在本群也可读写这些目录，其中 git 仓库的改动在「改动」里按目录分组显示。附加目录不参与强制同步群的版本同步。修改后下一轮开启新会话。',
          )}
        </p>
      </Dialog>
      {picking && bot.machineId ? (
        <DirPicker
          machineId={bot.machineId}
          title={t('为 {bot} 选择附加目录', { bot: bot.name })}
          onPick={(path) => {
            setList((l) => (l.includes(path) ? l : [...l, path]))
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
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

/** This group's tier override; 跟随全局 clears it. */
function GroupTierPicker({ groupId, bot, tier }: { groupId: string; bot: BotDto; tier: Tier | null }) {
  const demo = useSession((s) => s.tenancy?.demoMode)
  const options = [
    { value: FOLLOW, label: t('跟随全局（{tier}）', { tier: TIER_LABEL[bot.tier] }) },
    ...TIERS.filter((x) => !demo || x !== 'full' || tier === 'full').map((x) => ({
      value: x,
      label: TIER_LABEL[x],
    })),
  ]
  return (
    <PopUpButton
      aria-label={t('本群档位')}
      size="small"
      value={tier ?? FOLLOW}
      options={options}
      onChange={(v) =>
        void attempt(() => groupsApi.setBotTier(groupId, bot.id, v === FOLLOW ? null : (v as Tier)))
      }
    />
  )
}

function NoticeForm({ group, onSaved }: { group: GroupDto; onSaved: () => void }) {
  const [notice, setNotice] = useState(group.notice)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    if (await attempt(() => groupsApi.update(group.id, { notice }))) onSaved()
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
      />
      <div className="gs-form__foot">
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {t('保存')}
        </Button>
      </div>
    </div>
  )
}
