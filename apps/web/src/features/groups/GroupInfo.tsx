import type { BotDto, GroupDto, GroupParams, UserBriefDto } from '@gonggong/protocol'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import {
  Avatar,
  Button,
  ChatInfoBody,
  type ChatInfoDanger,
  type ChatInfoRow,
  Dialog,
  GroupBox,
  Icon,
  InspectorPanel,
  Presence,
  SearchField,
  Switch,
  Tag,
  TextField,
  toast,
  useEscape,
} from '../../ui'
import { BotDialog } from '../bots/BotDialog'
import { AGENT_LABEL, PRESENCE } from '../bots/model'
import { TIER_LABEL } from '../runs/tier'
import { groupsApi, paramsSummary } from './api'
import './groups.css'

export type SettingsTab = 'basic' | 'bots' | 'mode' | 'params'
export type InfoView = 'main' | 'members' | 'bots' | 'info'

type GroupPrefs = Partial<Pick<GroupDto, 'muted' | 'pinned' | 'foldRuns'>>

/** Runs a settings action, surfacing the server's message on failure. */
async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn()
    return true
  } catch (e) {
    toast({ type: 'error', message: e instanceof ApiError ? e.message : '操作失败，请重试' })
    return false
  }
}

/** Inline replacement for a failed load: one line plus 重试. */
function LoadError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <span className="gs-error">
      {text}
      <Button size="small" onClick={onRetry}>
        重试
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
          <Button onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>
            移出
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
  if (ok) toast({ type: 'success', message: `已移出 ${name}` })
  return ok
}

const SCOPE_LABEL = (b: BotDto) =>
  b.triggerScope === 'all'
    ? '任何群成员'
    : b.triggerScope === 'self'
      ? '仅主人'
      : `指定名单 ${b.triggerList.length} 人`

/**
 * Group settings as the Pane ChatInfoPanel in the chat inspector: identity, shortcuts, members, my switches, 群管理
 * rows and the danger zone; members, Bot and name/notice open as sub-views with a back button.
 */
export function GroupInfo({
  group,
  initialView = 'main',
  onClose,
  onSettings,
}: {
  group: GroupDto
  initialView?: InfoView
  onClose: () => void
  onSettings: (tab: SettingsTab) => void
}) {
  const me = useSession((s) => s.user)
  const [view, setView] = useState<InfoView>(initialView)
  const [adding, setAdding] = useState(false)
  const dm = group.kind === 'dm'
  const isAdmin = group.members.some((m) => m.userId === me?.id && m.isAdmin)
  const label = dm ? '私聊设置' : '群设置'
  useEscape(onClose)
  const title = {
    main: label,
    members: `群成员 · ${group.members.length}`,
    bots: `Bot · ${group.botIds.length}`,
    info: dm ? '名称' : '群名称与公告',
  }[view]
  return (
    <InspectorPanel
      title={title}
      label={label}
      className="gs-panel"
      onBack={view === 'main' ? undefined : () => setView('main')}
      onClose={onClose}
    >
      {view === 'main' ? (
        <MainView
          group={group}
          isAdmin={isAdmin}
          setView={(v, add = false) => {
            setAdding(add)
            setView(v)
          }}
          onClose={onClose}
          onSettings={onSettings}
        />
      ) : view === 'members' ? (
        <MembersView group={group} isAdmin={isAdmin} initialAdding={adding} />
      ) : view === 'bots' ? (
        <BotsView group={group} isAdmin={isAdmin} />
      ) : (
        <InfoForm group={group} onSaved={() => setView('main')} />
      )}
    </InspectorPanel>
  )
}

function MainView({
  group,
  isAdmin,
  setView,
  onClose,
  onSettings,
}: {
  group: GroupDto
  isAdmin: boolean
  setView: (v: InfoView, add?: boolean) => void
  onClose: () => void
  onSettings: (tab: SettingsTab) => void
}) {
  const navigate = useNavigate()
  const allBots = useWorkspace((s) => s.bots)
  const [params, setParams] = useState<GroupParams | null>(null)
  const [paramsFailed, setParamsFailed] = useState(false)
  const [pending, setPending] = useState<GroupPrefs | null>(null)
  const [confirm, setConfirm] = useState<'leave' | 'dissolve' | null>(null)
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
    void gone(() => groupsApi.leave(group.id), '已退出群')
  }
  const dissolve = () => {
    if (confirm !== 'dissolve') return setConfirm('dissolve')
    void gone(() => groupsApi.dissolve(group.id), dm ? '已删除私聊' : '群已解散')
  }

  const manage = (name: string, value: ReactNode, onClick: () => void): ChatInfoRow => ({
    label: name,
    value,
    onClick,
    disabled: !isAdmin,
  })
  const danger: ChatInfoDanger[] = [
    ...(canLeave
      ? [
          {
            label: confirm === 'leave' && !onlyAdmin ? '确认退出' : '退出群',
            onClick: leave,
            note:
              confirm === 'leave'
                ? onlyAdmin
                  ? '你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。'
                  : '退出后你的 Bot 一并移出本群；持锁中的轮次按非主动中断处理。再次点击确认。'
                : undefined,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            label: dm
              ? confirm === 'dissolve'
                ? '确认删除'
                : '删除私聊'
              : confirm === 'dissolve'
                ? '确认解散'
                : '解散群',
            onClick: dissolve,
            note:
              confirm === 'dissolve'
                ? dm
                  ? '删除后消息与审计记录保留；Bot 的托管工作区保留在本机，由你决定是否删除。再次点击确认。'
                  : '解散后群归档，消息与审计记录保留；强制同步群的存档 30 天后清除；各 Bot 的托管工作区保留，由主人决定是否删除。再次点击确认。'
                : undefined,
          },
        ]
      : []),
  ]

  return (
    <ChatInfoBody
      name={group.name}
      tags={[{ label: GROUP_MODE_LABEL[group.mode], tone: 'gray' }]}
      description={
        group.repo ? `${group.repo.url} · ${group.repo.branch}` : '未绑定仓库 · 各 Bot 使用本机目录'
      }
      shortcuts={[
        ...(dm ? [] : [{ icon: 'person-2' as const, label: '成员', onClick: () => setView('members') }]),
        ...(isAdmin
          ? [
              { icon: 'megaphone' as const, label: dm ? '名称' : '公告', onClick: () => setView('info') },
              { icon: 'gear' as const, label: '设置', onClick: () => onSettings('basic') },
            ]
          : []),
      ]}
      members={dm ? [] : group.members.map((m) => ({ name: m.name }))}
      memberCount={group.members.length}
      onAddMember={isAdmin ? () => setView('members', true) : undefined}
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
                      {b.name}
                    </span>
                  ))}
                </span>
              ),
              value: `${group.botIds.length} 个`,
              onClick: () => setView('bots'),
            },
          ],
        },
        {
          rows: [
            pref('muted', '消息免打扰', '普通消息不提醒；@我、我的 Bot 待审批、向我提问、锁轮到我仍提醒'),
            pref('pinned', '置顶群'),
            pref('foldRuns', '运行卡片默认折叠', '只对我生效，审批与提问卡片始终展开'),
          ],
        },
        {
          title: dm ? '设置' : '群管理',
          note: dm
            ? undefined
            : isAdmin
              ? '你是群管理员'
              : `仅群管理员 · ${admins.map((m) => m.name).join('、')}`,
          rows: [
            manage(dm ? '名称' : '群名称与公告', group.name, () => setView('info')),
            manage(
              '仓库与基准分支',
              <span className={group.repo ? 'gs-mono' : undefined}>{group.repo?.url ?? '未绑定'}</span>,
              () => onSettings('basic'),
            ),
            manage('同步模式', GROUP_MODE_LABEL[group.mode], () => onSettings('mode')),
            paramsFailed
              ? { label: '群级参数', value: <LoadError text="群级参数加载失败" onRetry={loadParams} /> }
              : manage('群级参数', params ? paramsSummary(params) : '', () => onSettings('params')),
          ],
        },
      ]}
      danger={danger}
    />
  )
}

function MembersView({
  group,
  isAdmin,
  initialAdding,
}: {
  group: GroupDto
  isAdmin: boolean
  /** Opened from the 添加 tile: the candidate list is shown at once. */
  initialAdding: boolean
}) {
  const me = useSession((s) => s.user)
  const allBots = useWorkspace((s) => s.bots)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(initialAdding)
  const [users, setUsers] = useState<UserBriefDto[]>([])
  const [usersFailed, setUsersFailed] = useState(false)
  const [removing, setRemoving] = useState<GroupDto['members'][number] | null>(null)
  const loadUsers = useCallback(() => {
    setUsersFailed(false)
    api.get<UserBriefDto[]>('/users').then(setUsers, () => setUsersFailed(true))
  }, [])
  useEffect(() => {
    if (adding) loadUsers()
  }, [adding, loadUsers])
  const candidates = users.filter((u) => !group.members.some((m) => m.userId === u.id))
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))

  return (
    <>
      <div className="gs-toolbar">
        <SearchField className="gs-search" placeholder="搜索成员" value={q} onChange={setQ} />
        {isAdmin ? (
          <Button size="small" onClick={() => setAdding(!adding)}>
            {adding ? '完成' : '添加成员'}
          </Button>
        ) : null}
      </div>
      {adding ? (
        <div className="gs-candidates">
          {candidates.map((u) => (
            <button
              key={u.id}
              type="button"
              className="gs-candidate"
              onClick={() => void attempt(() => groupsApi.addMember(group.id, u.id))}
            >
              <Icon name="plus" size={11} weight={2} />
              {u.name}
            </button>
          ))}
          {usersFailed ? <LoadError text="成员列表加载失败" onRetry={loadUsers} /> : null}
          {users.length && !candidates.length ? <span className="gs-desc">所有账号都已在群里</span> : null}
        </div>
      ) : null}
      <GroupBox>
        {group.members
          .filter((m) => !q || m.name.includes(q))
          .map((m) => {
            const theirs = bots.filter((b) => b.ownerId === m.userId).map((b) => b.name)
            return (
              <div key={m.userId} className="gs-member" data-testid={`member-${m.userId}`}>
                <Avatar name={m.name} size={28} />
                <div className="gs-member__main">
                  <span className="gs-member__name">
                    {m.name}
                    {m.userId === me?.id ? '（我）' : ''}
                    {m.isAdmin ? <Tag tone="blue">群管理员</Tag> : null}
                  </span>
                  <span className="gs-desc">
                    {theirs.length ? `带入 ${theirs.join('、')}` : '未带入 Bot'}
                  </span>
                </div>
                {isAdmin && m.userId !== me?.id ? (
                  <span className="gs-member__ops">
                    <Button
                      variant="plain"
                      size="small"
                      onClick={() => void attempt(() => groupsApi.setAdmin(group.id, m.userId, !m.isAdmin))}
                    >
                      {m.isAdmin ? '取消管理员' : '设为管理员'}
                    </Button>
                    <Button variant="plain" size="small" onClick={() => setRemoving(m)}>
                      移出
                    </Button>
                  </span>
                ) : null}
              </div>
            )
          })}
      </GroupBox>
      <div className="gs-foot">移出成员时，其 Bot 一并移出；持锁中的 Bot 按非主动中断处理。</div>
      <Presence>
        {removing ? (
          <ConfirmRemove
            title={`移出成员 ${removing.name}`}
            desc="其 Bot 一并移出本群；持锁中的 Bot 按非主动中断处理。"
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

export function BotsView({ group, isAdmin }: { group: GroupDto; isAdmin: boolean }) {
  const me = useSession((s) => s.user)
  const allBots = useWorkspace((s) => s.bots)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<BotDto | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = allBots.find((b) => b.id === editingId)
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  const candidates = allBots.filter(
    (b) => !group.botIds.includes(b.id) && (group.kind === 'group' || b.ownerId === me?.id),
  )
  const inGroup = (userId: string) => group.members.some((m) => m.userId === userId)

  return (
    <>
      <div className="gs-toolbar">
        <span className="gs-toolbar__text">
          {bots.length} 个 · 在线{' '}
          {bots.filter((b) => b.presence === 'online' || b.presence === 'running').length}
        </span>
        {isAdmin ? (
          <Button size="small" onClick={() => setAdding(!adding)}>
            {adding ? '完成' : '拉入 Bot'}
          </Button>
        ) : null}
      </div>
      {adding ? (
        <div className="gs-candidates gs-candidates--col">
          {candidates.map((b) => (
            <button
              key={b.id}
              type="button"
              className="gs-candidate gs-candidate--bot"
              onClick={() => void attempt(() => groupsApi.addBot(group.id, b.id))}
            >
              <Icon name="plus" size={12} weight={2} />
              <span className="gs-candidate__name">{b.name}</span>
              <span className="gs-desc">
                {AGENT_LABEL[b.agentKind]} · {b.ownerName}
                {inGroup(b.ownerId) ? '' : ' · 主人将一并加入'}
              </span>
            </button>
          ))}
          {candidates.length ? null : <span className="gs-desc">没有可拉入的 Bot</span>}
        </div>
      ) : null}
      <GroupBox>
        {bots.map((b) => (
          <div key={b.id} className="gs-bot">
            <div className="gs-bot__head">
              <Avatar name={b.name} size={28} shape="square" />
              <span className="gs-member__main">
                <span className="gs-bot__name">
                  {b.name}
                  <Tag tone="blue">Bot</Tag>
                </span>
                <span className="gs-desc">
                  {AGENT_LABEL[b.agentKind]} · 主人 {b.ownerName}
                </span>
              </span>
              <span className="gs-bot__state">
                <span className="gs-dot" style={{ background: PRESENCE[b.presence].color }} />
                {PRESENCE[b.presence].label}
              </span>
            </div>
            <div className="gs-bot__meta">
              <span>档位 {TIER_LABEL[b.tier]}</span>
              <span>触发 {SCOPE_LABEL(b)}</span>
              <span className="spacer" />
              {b.ownerId === me?.id || me?.role === 'sysadmin' ? (
                <Button variant="plain" size="small" onClick={() => setEditingId(b.id)}>
                  修改档位
                </Button>
              ) : null}
              {isAdmin ? (
                <Button variant="plain" size="small" onClick={() => setRemoving(b)}>
                  移出
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </GroupBox>
      <div className="gs-foot">
        档位与触发范围由 Bot 主人在 Bot 详情中设置，对所有群生效；想少审批，可在桌面端「Bot →
        命令审批」开启白名单或全部自动。移出后保留工作区，由主人决定是否删除。
      </div>
      <Presence>
        {removing ? (
          <ConfirmRemove
            title={`移出 Bot ${removing.name}`}
            desc="移出后保留其工作区，由主人决定是否删除；运行中的轮次按非主动中断处理。"
            onClose={() => setRemoving(null)}
            onConfirm={() => removeWithToast(() => groupsApi.removeBot(group.id, removing.id), removing.name)}
          />
        ) : null}
      </Presence>
      <Presence>
        {editing && me ? <BotDialog bot={editing} me={me} onClose={() => setEditingId(null)} /> : null}
      </Presence>
    </>
  )
}

function InfoForm({ group, onSaved }: { group: GroupDto; onSaved: () => void }) {
  const [name, setName] = useState(group.name)
  const [notice, setNotice] = useState(group.notice)
  const [saving, setSaving] = useState(false)
  const dm = group.kind === 'dm'
  const save = async () => {
    setSaving(true)
    const body = dm ? { name } : { name, notice }
    if (await attempt(() => groupsApi.update(group.id, body))) onSaved()
    setSaving(false)
  }
  return (
    <div className="gs-form">
      <TextField
        label={dm ? '名称' : '群名称'}
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />
      {dm ? null : (
        <TextField
          multiline
          label="群公告 · 置顶展示在对话顶部"
          rows={4}
          value={notice}
          maxLength={500}
          placeholder="如：每个 Bot 独立分支，走 PR；退款 v1 下周一下线"
          onChange={(e) => setNotice(e.target.value)}
        />
      )}
      <div className="gs-form__foot">
        <Button variant="primary" disabled={!name.trim() || saving} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  )
}
