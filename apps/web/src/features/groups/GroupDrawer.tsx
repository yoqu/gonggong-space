import type { BotDto, GroupDto, GroupParams, UserBriefDto } from '@aiws/protocol'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Hash,
  Info,
  Lock,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  User,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { Avatar, Badge, Button, Drawer, Field, IconButton, Input, Switch, Textarea, toast } from '../../ui'
import { AGENT_LABEL, PRESENCE } from '../bots/model'
import { groupsApi, paramsSummary } from './api'
import './groups.css'

export type SettingsTab = 'basic' | 'bots' | 'mode' | 'params'
export type DrawerView = 'main' | 'members' | 'bots' | 'info'

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

const SCOPE_LABEL = (b: BotDto) =>
  b.triggerScope === 'all'
    ? '任何群成员'
    : b.triggerScope === 'self'
      ? '仅主人'
      : `指定名单 ${b.triggerList.length} 人`

function ListRow({
  title,
  count,
  onClick,
  children,
}: {
  title: string
  count: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="gs-row gs-row--stack" onClick={onClick}>
      <span className="gs-row__line">
        <span className="gs-row__key">{title}</span>
        <span className="gs-row__count">{count}</span>
        <span className="spacer" />
        <ChevronRight size={14} className="muted-icon" />
      </span>
      {children}
    </button>
  )
}

function SwitchRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="gs-switch">
      <Switch
        checked={checked}
        onChange={onChange}
        label={
          <span className="gs-switch__text">
            <span>{label}</span>
            {desc ? <span className="gs-desc">{desc}</span> : null}
          </span>
        }
      />
    </div>
  )
}

export function GroupDrawer({
  group,
  initialView = 'main',
  onClose,
  onSettings,
}: {
  group: GroupDto
  initialView?: DrawerView
  onClose: () => void
  onSettings: (tab: SettingsTab) => void
}) {
  const me = useSession((s) => s.user)
  const [view, setView] = useState<DrawerView>(initialView)
  const dm = group.kind === 'dm'
  const isAdmin = group.members.some((m) => m.userId === me?.id && m.isAdmin)
  const label = dm ? '私聊设置' : '群设置'
  const title = {
    main: label,
    members: `群成员 · ${group.members.length}`,
    bots: `Bot · ${group.botIds.length}`,
    info: dm ? '名称' : '群名称与公告',
  }[view]
  return (
    <Drawer
      open
      label={label}
      title={title}
      onClose={onClose}
      leading={
        view === 'main' ? null : (
          <IconButton title="返回" onClick={() => setView('main')}>
            <ChevronLeft size={16} />
          </IconButton>
        )
      }
    >
      {view === 'main' ? (
        <MainView
          group={group}
          isAdmin={isAdmin}
          setView={setView}
          onClose={onClose}
          onSettings={onSettings}
        />
      ) : view === 'members' ? (
        <MembersView group={group} isAdmin={isAdmin} />
      ) : view === 'bots' ? (
        <BotsView group={group} isAdmin={isAdmin} />
      ) : (
        <InfoView group={group} onSaved={onClose} />
      )}
    </Drawer>
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
  setView: (v: DrawerView) => void
  onClose: () => void
  onSettings: (tab: SettingsTab) => void
}) {
  const navigate = useNavigate()
  const allBots = useWorkspace((s) => s.bots)
  const [params, setParams] = useState<GroupParams | null>(null)
  const [confirm, setConfirm] = useState<'leave' | 'dissolve' | null>(null)
  const dm = group.kind === 'dm'
  const admins = group.members.filter((m) => m.isAdmin)
  const onlyAdmin = isAdmin && admins.length === 1 && group.members.length > 1
  const gBots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  const Icon = dm ? User : Hash

  useEffect(() => {
    groupsApi.params(group.id).then(setParams, () => {})
  }, [group.id])

  const prefs = (body: Partial<Pick<GroupDto, 'muted' | 'pinned' | 'foldRuns'>>) =>
    void attempt(() => groupsApi.prefs(group.id, body))

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
    void gone(() => groupsApi.leave(group.id), '已退出群聊')
  }
  const dissolve = () => {
    if (confirm !== 'dissolve') return setConfirm('dissolve')
    void gone(() => groupsApi.dissolve(group.id), dm ? '已删除私聊' : '群已解散')
  }

  const rows: { icon: typeof Info; k: string; v: string; mono?: boolean; onClick: () => void }[] = [
    { icon: Info, k: dm ? '名称' : '群名称与公告', v: group.name, onClick: () => setView('info') },
    {
      icon: GitBranch,
      k: '仓库与基准分支',
      v: group.repo?.url ?? '未绑定',
      mono: !!group.repo,
      onClick: () => onSettings('basic'),
    },
    { icon: RefreshCw, k: '同步模式', v: GROUP_MODE_LABEL[group.mode], onClick: () => onSettings('mode') },
    {
      icon: SlidersHorizontal,
      k: '群级参数',
      v: params ? paramsSummary(params) : '',
      onClick: () => onSettings('params'),
    },
  ]

  return (
    <>
      <div className="gs-card">
        <div className="gs-card__icon">
          <Icon size={20} />
        </div>
        <div className="gs-card__main">
          <span className="gs-card__name">{group.name}</span>
          <span className="gs-card__repo">
            {group.repo ? `${group.repo.url} · ${group.repo.branch}` : '未绑定仓库 · 各 bot 使用本机目录'}
          </span>
        </div>
        <Badge variant="secondary">{GROUP_MODE_LABEL[group.mode]}</Badge>
      </div>

      {dm ? null : (
        <ListRow title="群成员" count={`${group.members.length} 人`} onClick={() => setView('members')}>
          <span className="gs-avatars">
            {group.members.slice(0, 8).map((m) => (
              <Avatar key={m.userId} name={m.name} />
            ))}
          </span>
        </ListRow>
      )}
      <ListRow title="Bot" count={`${group.botIds.length} 个`} onClick={() => setView('bots')}>
        <span className="gs-chips">
          {gBots.map((b) => (
            <span key={b.id} className="gs-chip">
              <span className="dot dot--sm" style={{ background: PRESENCE[b.presence].color }} />
              {b.name}
            </span>
          ))}
        </span>
      </ListRow>

      <div className="gs-gap" />
      <SwitchRow
        label="消息免打扰"
        desc="普通消息不提醒；@我、我的 bot 待审批、向我提问、锁轮到我仍提醒"
        checked={group.muted}
        onChange={(muted) => prefs({ muted })}
      />
      <SwitchRow label="置顶群聊" checked={group.pinned} onChange={(pinned) => prefs({ pinned })} />
      <SwitchRow
        label="运行卡片默认折叠"
        desc="只对我生效，审批与提问卡片始终展开"
        checked={group.foldRuns}
        onChange={(foldRuns) => prefs({ foldRuns })}
      />

      <div className="gs-gap" />
      <div className="gs-section">
        <span className="eyebrow">{dm ? '设置' : '群管理'}</span>
        <span className="spacer" />
        <span className="gs-desc">
          {dm ? '' : isAdmin ? '你是群管理员' : `仅群管理员 · ${admins.map((m) => m.name).join('、')}`}
        </span>
      </div>
      {rows.map((r) => (
        <button key={r.k} type="button" className="gs-row" disabled={!isAdmin} onClick={r.onClick}>
          <r.icon size={14} className="muted-icon" />
          <span className="gs-row__key">{r.k}</span>
          <span className={r.mono ? 'gs-row__val gs-row__val--mono' : 'gs-row__val'}>{r.v}</span>
          {isAdmin ? (
            <ChevronRight size={14} className="muted-icon" />
          ) : (
            <Lock size={14} className="muted-icon" />
          )}
        </button>
      ))}

      <div className="gs-gap" />
      <div className="gs-actions">
        {confirm === 'leave' && !dm ? (
          <div className="gs-note">
            {onlyAdmin
              ? '你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。'
              : '退出后你的 bot 一并移出本群；持锁中的轮次按非主动中断处理。再次点击确认。'}
          </div>
        ) : null}
        {dm ? null : (
          <Button variant="outline" fullWidth onClick={leave}>
            {confirm === 'leave' && !onlyAdmin ? '确认退出' : '退出群聊'}
          </Button>
        )}
        {isAdmin ? (
          <Button variant="destructive" fullWidth onClick={dissolve}>
            {dm
              ? confirm === 'dissolve'
                ? '确认删除'
                : '删除私聊'
              : confirm === 'dissolve'
                ? '确认解散'
                : '解散群'}
          </Button>
        ) : null}
        {confirm === 'dissolve' ? (
          <div className="gs-desc">
            {dm
              ? '删除后消息与审计记录保留；bot 的托管工作区保留在本机，由你决定是否删除。再次点击确认。'
              : '解散后群归档，消息与审计记录保留；强制同步群的权威副本归档 30 天后清除；各 bot 的托管工作区保留，由主人决定是否删除。再次点击确认。'}
          </div>
        ) : null}
      </div>
    </>
  )
}

function MembersView({ group, isAdmin }: { group: GroupDto; isAdmin: boolean }) {
  const me = useSession((s) => s.user)
  const allBots = useWorkspace((s) => s.bots)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [users, setUsers] = useState<UserBriefDto[]>([])
  useEffect(() => {
    if (adding) api.get<UserBriefDto[]>('/users').then(setUsers, () => {})
  }, [adding])
  const candidates = users.filter((u) => !group.members.some((m) => m.userId === u.id))
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))

  return (
    <>
      <div className="gs-toolbar">
        <div className="gs-search">
          <Search size={13} className="muted-icon" />
          <input
            value={q}
            placeholder="搜索成员"
            aria-label="搜索成员"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {isAdmin ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>
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
              <Plus size={11} />
              {u.name}
            </button>
          ))}
          {users.length && !candidates.length ? <span className="gs-desc">所有账号都已在群里</span> : null}
        </div>
      ) : null}
      {group.members
        .filter((m) => !q || m.name.includes(q))
        .map((m) => {
          const theirs = bots.filter((b) => b.ownerId === m.userId).map((b) => b.name)
          return (
            <div key={m.userId} className="gs-member" data-testid={`member-${m.userId}`}>
              <Avatar name={m.name} size={30} />
              <div className="gs-member__main">
                <span className="gs-member__name">
                  {m.name}
                  {m.userId === me?.id ? '（我）' : ''}
                  {m.isAdmin ? (
                    <Badge variant="info" size="xs">
                      群管理员
                    </Badge>
                  ) : null}
                </span>
                <span className="gs-desc">{theirs.length ? `带入 ${theirs.join('、')}` : '未带入 bot'}</span>
              </div>
              {isAdmin && m.userId !== me?.id ? (
                <span className="gs-member__ops">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void attempt(() => groupsApi.setAdmin(group.id, m.userId, !m.isAdmin))}
                  >
                    {m.isAdmin ? '取消管理员' : '设为管理员'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void attempt(() => groupsApi.removeMember(group.id, m.userId))}
                  >
                    移出
                  </Button>
                </span>
              ) : null}
            </div>
          )
        })}
      <div className="gs-foot">移出成员时，其 bot 一并移出；持锁中的 bot 按非主动中断处理。</div>
    </>
  )
}

export function BotsView({ group, isAdmin }: { group: GroupDto; isAdmin: boolean }) {
  const me = useSession((s) => s.user)
  const allBots = useWorkspace((s) => s.bots)
  const [adding, setAdding] = useState(false)
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
          <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>
            {adding ? '完成' : '拉入 bot'}
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
              <Plus size={12} />
              <span className="gs-candidate__name">{b.name}</span>
              <span className="gs-desc">
                {AGENT_LABEL[b.agentKind]} · {b.ownerName}
                {inGroup(b.ownerId) ? '' : ' · 主人将一并加入'}
              </span>
            </button>
          ))}
          {candidates.length ? null : <span className="gs-desc">没有可拉入的 bot</span>}
        </div>
      ) : null}
      {bots.map((b) => (
        <div key={b.id} className="gs-bot">
          <div className="gs-bot__head">
            <span className="gs-bot__icon">
              <Bot size={15} />
            </span>
            <span className="gs-member__main">
              <span className="gs-bot__name">{b.name}</span>
              <span className="gs-desc">
                {AGENT_LABEL[b.agentKind]} · 主人 {b.ownerName}
              </span>
            </span>
            <span className="gs-bot__state">
              <span className="dot dot--sm" style={{ background: PRESENCE[b.presence].color }} />
              {PRESENCE[b.presence].label}
            </span>
          </div>
          <div className="gs-bot__meta">
            <span>档位 {b.tier}</span>
            <span>触发 {SCOPE_LABEL(b)}</span>
            <span className="spacer" />
            {isAdmin ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void attempt(() => groupsApi.removeBot(group.id, b.id))}
              >
                移出
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <div className="gs-foot">档位与触发范围由 bot 主人设置。移出后保留工作区，由主人决定是否删除。</div>
    </>
  )
}

function InfoView({ group, onSaved }: { group: GroupDto; onSaved: () => void }) {
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
      <Field label={dm ? '名称' : '群名称'}>
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Field>
      {dm ? null : (
        <Field label="群公告 · 置顶展示在对话顶部">
          <Textarea
            rows={4}
            value={notice}
            maxLength={500}
            placeholder="如：每个 bot 独立分支，走 PR；退款 v1 下周一下线"
            onChange={(e) => setNotice(e.target.value)}
          />
        </Field>
      )}
      <div className="gs-form__foot">
        <Button variant="primary" size="sm" disabled={!name.trim() || saving} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  )
}
