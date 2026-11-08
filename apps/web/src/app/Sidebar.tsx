import {
  type BotDto,
  type DirectoryGroupDto,
  type GroupDto,
  type MachineDto,
  type NotifyLevel,
  SECTION_MAX_DEPTH,
  type SidebarSectionDto,
  type TerminalSpaceDto,
} from '@gonggong/protocol'
import {
  type DragEvent,
  type MouseEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { type PersonaRole, roleCostume } from '../features/bots/avatars'
import { draftKey } from '../features/chat/MessageComposer'
import { useThreadUnread, useThreadUnreadSync } from '../features/chat/threadUnread'
import { UnreadsRow } from '../features/chat/UnreadsRow'
import { groupsApi } from '../features/groups/api'
import { channelKind } from '../features/groups/channel'
import { GroupAvatar } from '../features/groups/GroupAvatar'
import { NOTIFY_LEVELS } from '../features/groups/notify'
import { BrowseChannelsDialog, SectionNameDialog } from '../features/groups/SidebarDialogs'
import { sectionsApi, teamSectionsApi, useSections, useTeamSections } from '../features/groups/sections'
import { middle } from '../features/repos/repo-access'
import { LaterRow } from '../features/saved/LaterRow'
import { t } from '../i18n'
import { api } from '../lib/api'
import { copyWithToast } from '../lib/clipboard'
import { cx } from '../lib/cx'
import { attempt } from '../lib/errors'
import { plainText } from '../lib/plain'
import { useRealtimeStatus } from '../lib/realtime'
import {
  AlertDialog,
  Avatar,
  Badge,
  Button,
  ContextMenu,
  type ConversationActivity,
  ConversationContent,
  Icon,
  Presence,
  PullDownButton,
  ShortcutContent,
  toast,
} from '../ui'
import { keyNav } from '../ui/im/keynav'
import { activityOf } from './convActivity'
import { useInspector } from './inspector'
import { useSession } from './session'
import { useWorkbench } from './workbench'
import { alertCount, lastText, rowCount, useWorkspace } from './workspace'

export const GROUP_MODE_LABEL = { partition: t('分区模式'), force: t('强制同步') }
const CONN = {
  open: { label: t('已连接'), color: 'var(--system-green)' },
  connecting: { label: t('连接中…'), color: 'var(--system-orange)' },
  closed: { label: t('已断开 · 重连中'), color: 'var(--system-red)' },
}

export interface SidebarProps {
  groups: GroupDto[]
  /** My bots and machines: for the 开始使用 guide and the footer (they are managed in 机器与 Bot). */
  bots: BotDto[]
  machines: MachineDto[]
  /** My machine terminals, listed among the conversations. */
  spaces?: TerminalSpaceDto[]
  /** Toolbar row and search above the list. */
  header?: ReactNode
  /** All lists have arrived: empty states and the 开始使用 guide wait for it so "not yet" never reads as "none". */
  loaded?: boolean
  /** Show the 开始使用 card; off while the main area shows the full first-run welcome. */
  guide?: boolean
  onBindMachine?: () => void
  onNewBot?: () => void
  onNewGroup?: () => void
}

export function SectionHead({
  label,
  onAdd,
  addTitle,
}: {
  label: string
  onAdd?: () => void
  addTitle?: string
}) {
  return (
    <div className="sidebar__head">
      <span>{label}</span>
      {addTitle ? (
        <button type="button" className="sidebar__add" title={addTitle} aria-label={addTitle} onClick={onAdd}>
          <Icon name="plus" size={14} />
        </button>
      ) : null}
    </div>
  )
}

/** Unsent text MessageComposer keeps per group. */
const draftOf = (groupId: string) => {
  try {
    return sessionStorage.getItem(draftKey(groupId)) ?? undefined
  } catch {
    return undefined
  }
}

const LONG_PRESS_MS = 500

/** A touch long-press opens the row's context menu, as a right-click does; the tap that follows is swallowed. */
function useLongPress() {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const fired = useRef(false)
  const cancel = () => clearTimeout(timer.current)
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      fired.current = false
      if (e.pointerType !== 'touch') return
      const { currentTarget: el, clientX, clientY } = e
      timer.current = setTimeout(() => {
        fired.current = true
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
      }, LONG_PRESS_MS)
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerMove: cancel,
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (fired.current) e.preventDefault()
    },
  }
}

/** The row's live runs as its tag and preview show them, each bot in its own costume. */
function useActivity(g: GroupDto) {
  const bots = useWorkspace((s) => s.bots)
  const a = activityOf(g.liveRuns)
  if (!a) return { activity: undefined, alert: undefined }
  const bot = (id: string) => bots.find((b) => b.id === id)
  const costume = (id: string) => {
    const role = bot(id)?.avatar
    return role && role !== 'role-gong' ? roleCostume(role as PersonaRole) : undefined
  }
  const activity: ConversationActivity = {
    tone: a.tone,
    label: a.label,
    title: a.title,
    actors: a.actors.map((x) => ({ key: x.runId, action: x.action, costume: costume(x.botId) })),
    more: a.more,
  }
  const alert = a.alert && {
    flag: a.alert.flag,
    text: t('{name}：{line}', { name: bot(a.alert.botId)?.name ?? 'Bot', line: a.alert.title }),
  }
  return { activity, alert: alert ?? undefined }
}

/** Memoized: realtime events keep unchanged groups' identity, so only the changed row re-renders. */
const GroupRow = memo(function GroupRow({
  g,
  current,
  tabStop,
  tagged = true,
  onNewSection,
}: {
  g: GroupDto
  current: boolean
  tabStop: boolean
  /** Off under 私信, whose head already says it. */
  tagged?: boolean
  onNewSection: () => void
}) {
  const dm = g.kind === 'dm'
  const navigate = useNavigate()
  const press = useLongPress()
  const { activity, alert } = useActivity(g)
  const own = useSections((s) => s.sections)
  const filed = own.some((x) => x.id === g.sectionId)
  const teamSections = useTeamSections((s) => s.sections)
  const canFile = useCanFile(g) && teamSections.length > 0
  const me = useSession((s) => s.user?.id)
  const [leaving, setLeaving] = useState(false)
  const admins = g.members.filter((m) => m.isAdmin)
  // The group's only admin hands the role over first (as 群信息 asks).
  const onlyAdmin = admins.length === 1 && admins[0]?.userId === me && g.members.length > 1
  const leave = async () => {
    setLeaving(false)
    if (await attempt(() => groupsApi.leave(g.id))) {
      if (current) navigate('/')
      toast({ type: 'success', message: t('已离开 {name}', { name: g.name }) })
    }
  }
  const onMenu = (v: string) => {
    if (v.startsWith('team:')) void attempt(() => teamSectionsApi.file(g.id, v.slice(5) || null))
    else if (v === 'section:new') onNewSection()
    else if (v.startsWith('section:')) {
      const id = v.slice(8) || null
      void attempt(() => groupsApi.prefs(g.id, { sectionId: id, ...(id && { pinned: false }) }))
    } else if (v === 'pin') void attempt(() => groupsApi.prefs(g.id, { pinned: !g.pinned }))
    else if (v.startsWith('notify:'))
      void attempt(() => groupsApi.prefs(g.id, { notifyLevel: v.slice(7) as NotifyLevel }))
    else if (v === 'done') void attempt(() => groupsApi.prefs(g.id, { done: !isDone(g) }))
    else if (v === 'flag') void attempt(() => groupsApi.prefs(g.id, { flagged: !g.flagged }))
    else if (v === 'read')
      void attempt(async () =>
        useWorkspace
          .getState()
          .applyEvent({ t: 'group.updated', group: await api.post<GroupDto>(`/groups/${g.id}/read`, {}) }),
      )
    else if (v === 'info') {
      navigate(`/g/${g.id}`)
      useInspector.getState().open('group-info', 'main')
    } else if (v === 'link') void copyWithToast(`${location.origin}/g/${g.id}`, t('链接已复制'))
    else if (v === 'leave') {
      if (!onlyAdmin) return setLeaving(true)
      toast({ type: 'warning', message: t('你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。') })
      navigate(`/g/${g.id}`)
      useInspector.getState().open('group-info', 'members')
    }
  }
  // The mode lives in the chat header; the second line is the latest message, else what the chat is.
  const where = dm
    ? g.workspacePath
      ? middle(g.workspacePath)
      : t('未选择工作区')
    : t('{n} 人 · {mode}', { n: g.members.length, mode: GROUP_MODE_LABEL[g.mode] })
  const preview = (g.last && plainText(lastText(g))) || where
  return (
    <ContextMenu
      className="sidebar__ctx"
      items={[
        { label: g.pinned ? t('取消星标') : t('加星标'), value: 'pin', icon: 'star' },
        {
          label: t('移到分区'),
          icon: 'folder',
          submenu: [
            ...own.map((x) => ({
              label: pathOfSection(own, x),
              value: `section:${x.id}`,
              checked: g.sectionId === x.id,
            })),
            ...(own.length ? [{ separator: true as const }] : []),
            ...(filed ? [{ label: t('移出分区'), value: 'section:' }] : []),
            { label: t('新建分区…'), value: 'section:new', icon: 'plus' as const },
          ],
        },
        ...(canFile
          ? [
              {
                label: t('归入团队分区'),
                icon: 'person' as const,
                submenu: [
                  ...teamSections.map((x) => ({
                    label: pathOfSection(teamSections, x),
                    value: `team:${x.id}`,
                    checked: g.teamSectionId === x.id,
                  })),
                  ...(g.teamSectionId
                    ? [{ separator: true as const }, { label: t('移出团队分区'), value: 'team:' }]
                    : []),
                ],
              },
            ]
          : []),
        {
          label: t('通知'),
          icon: g.notifyLevel === 'off' ? 'bell-slash' : 'bell',
          submenu: NOTIFY_LEVELS.map((x) => ({
            label: x.label,
            value: `notify:${x.value}`,
            checked: g.notifyLevel === x.value,
          })),
        },
        { label: t('清除未读'), value: 'read', icon: 'check', disabled: !g.unread },
        { label: isDone(g) ? t('移回列表') : t('完成'), value: 'done', icon: 'checkmark-circle' },
        { label: g.flagged ? t('取消标记') : t('标记'), value: 'flag', icon: 'flag' },
        { label: dm ? t('私聊设置') : t('打开群信息'), value: 'info', icon: 'info' },
        ...(dm
          ? []
          : [
              { label: t('复制频道链接'), value: 'link', icon: 'link' as const },
              ...(g.members.length > 1
                ? [
                    { separator: true as const },
                    { label: t('离开频道'), value: 'leave', icon: 'arrow-left' as const, destructive: true },
                  ]
                : []),
            ]),
      ]}
      onSelect={onMenu}
    >
      <NavLink
        {...press}
        to={`/g/${g.id}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, g.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        // Its bot was unshared or deleted: history only, so it steps back behind the live conversations.
        className={cx('pn-conv', dm && !g.botIds.length && 'pn-conv--closed')}
        title={dm ? where : undefined}
        data-testid={`group-item-${g.id}`}
        tabIndex={tabStop ? 0 : -1}
        onKeyDown={(e) =>
          keyNav(e, e.currentTarget.closest<HTMLElement>('.sidebar__scroll'), '.pn-conv', { select: true })
        }
      >
        <ConversationContent
          item={{
            id: g.id,
            name: g.name,
            group: true,
            avatarNode: <GroupAvatar group={g} size={40} />,
            kind: dm ? undefined : channelKind(g.visibility),
            tags: dm && tagged ? [{ label: 'Bot', tone: 'blue' }] : undefined,
            preview,
            draft: current ? undefined : draftOf(g.id),
            unread: rowCount(g),
            bold: g.unread > 0 && g.notifyLevel !== 'off',
            mention: !!g.mentionCount,
            muted: g.notifyLevel === 'off',
            flagged: g.flagged,
            activity,
            alert,
          }}
        />
      </NavLink>
      <Presence>
        {leaving ? (
          <AlertDialog
            open
            title={t('离开「{name}」？', { name: g.name })}
            message={
              g.visibility === 'public'
                ? t('你的 Bot 会一并移出；这是公开频道，之后可在「浏览频道」重新加入。')
                : t('你的 Bot 会一并移出；这是私有群，之后需要成员重新邀请。')
            }
            onClose={() => setLeaving(false)}
            actions={[
              { label: t('取消'), onClick: () => setLeaving(false) },
              { label: t('离开#leave'), variant: 'destructive', onClick: () => void leave() },
            ]}
          />
        ) : null}
      </Presence>
    </ContextMenu>
  )
})

/** 话题: the threads I follow. Only an @ in one shows a count; new replies alone just say so (plan 话题). */
function ThreadsRow() {
  useThreadUnreadSync()
  const { unread, mentioned } = useThreadUnread()
  const detail = unread ? t('{n} 个话题有新回复', { n: unread }) : t('我关注的话题')
  return (
    <NavLink to="/threads" className="pn-shortcut" data-testid="threads-item" title={detail} tabIndex={-1}>
      <ShortcutContent
        icon="thread"
        label={t('话题#inbox')}
        detail={detail}
        count={mentioned}
        bold={unread > 0}
      />
    </NavLink>
  )
}

/** A machine terminal in the conversation list: its machine and directory under its name. */
function SpaceRow({ s, tabStop }: { s: TerminalSpaceDto; tabStop: boolean }) {
  return (
    <NavLink
      to={`/t/${s.id}`}
      className="pn-conv"
      title={s.cwd}
      data-testid={`terminal-item-${s.id}`}
      tabIndex={tabStop ? 0 : -1}
      onKeyDown={(e) =>
        keyNav(e, e.currentTarget.closest<HTMLElement>('.sidebar__scroll'), '.pn-conv', { select: true })
      }
    >
      <ConversationContent
        item={{
          id: s.id,
          name: s.name,
          group: true,
          avatarNode: (
            <span className="sidebar-terminal">
              <Icon name="terminal" size={18} />
            </span>
          ),
          tags: [{ label: t('终端'), tone: 'gray' }],
          preview: `${s.machineName} · ${middle(s.cwd)}`,
        }}
      />
    </NavLink>
  )
}

/** A group filed under a 团队分区 that I have not joined: opens its preview to join or ask to. */
function DirectoryRow({ d }: { d: DirectoryGroupDto }) {
  return (
    <NavLink
      to={`/g/${d.id}`}
      className="pn-conv pn-conv--closed"
      data-testid={`directory-item-${d.id}`}
      tabIndex={-1}
      onKeyDown={(e) =>
        keyNav(e, e.currentTarget.closest<HTMLElement>('.sidebar__scroll'), '.pn-conv', { select: true })
      }
    >
      <ConversationContent
        item={{
          id: d.id,
          name: d.name,
          group: true,
          avatarNode: <Avatar name={d.name} src={d.avatar ?? undefined} shape="square" size={40} />,
          kind: channelKind(d.visibility),
          tags: [{ label: d.requestId ? t('已申请') : t('未加入'), tone: d.requestId ? 'orange' : 'gray' }],
          preview: d.notice || t('{n} 人', { n: d.memberCount }),
        }}
      />
    </NavLink>
  )
}

function SetupGuide({
  bound,
  hasBot,
  inGroup,
  onBindMachine,
  onNewBot,
  onNewGroup,
}: {
  bound: boolean
  hasBot: boolean
  inGroup: boolean
  onBindMachine?: () => void
  onNewBot?: () => void
  onNewGroup?: () => void
}) {
  const steps = [
    {
      label: t('绑定新机器'),
      hint: t('在机器上安装共工空间客户端，打开接入链接关联账号'),
      done: bound,
      onClick: onBindMachine,
    },
    { label: t('新建 Bot'), hint: t('选择机器上的 Claude Code 或 Codex'), done: hasBot, onClick: onNewBot },
    { label: t('建群并 @ Bot'), hint: t('拉上同事、绑定仓库，分配任务'), done: inGroup, onClick: onNewGroup },
  ]
  return (
    <section className="sidebar-guide" aria-label={t('开始使用')}>
      <div className="sidebar-guide__title">{t('开始使用')}</div>
      {steps.map((s, i) => (
        <button
          key={s.label}
          type="button"
          className="sidebar-guide__step"
          data-done={s.done || undefined}
          disabled={s.done}
          onClick={s.onClick}
        >
          <span className="sidebar-guide__mark">
            {s.done ? <Icon name="check" size={11} weight={2.4} /> : i + 1}
          </span>
          <span className="sidebar-guide__text">
            <span className="sidebar-guide__label">{s.label}</span>
            <span className="sidebar-guide__hint">{s.hint}</span>
          </span>
          {s.done ? null : <Icon name="chevron-right" size={13} className="sidebar__chevron" />}
        </button>
      ))}
    </section>
  )
}

/** 完成: marked done and no message since; a new one brings it back to its list. */
const isDone = (g: GroupDto) => g.doneSeq != null && g.lastSeq <= g.doneSeq

type Row = GroupDto | TerminalSpaceDto
const isSpace = (r: Row): r is TerminalSpaceDto => 'cwd' in r
const pathOf = (r: Row) => (isSpace(r) ? `/t/${r.id}` : `/g/${r.id}`)

/**
 * Groups, DMs and machine terminals together: pinned first, then the latest message (a terminal: its last opening)
 * first; a run waiting on me shows on its row.
 */
const byPin = <R extends Row>(list: R[]) => {
  const pinned = (r: Row) => !isSpace(r) && r.pinned
  const at = (r: Row) => (isSpace(r) ? r.lastActiveAt : r.lastAt) ?? ''
  return [...list].sort((a, b) => Number(pinned(b)) - Number(pinned(a)) || at(b).localeCompare(at(a)))
}

/** While `held` (the pointer is over the list) rows keep their places so a click lands where it aimed; newcomers go last. */
function useHeldOrder<R extends { id: string }>(list: R[], held: boolean) {
  const shown = useRef<string[]>([])
  if (!held) {
    shown.current = list.map((g) => g.id)
    return list
  }
  const at = new Map(shown.current.map((id, i) => [id, i]))
  const place = (r: R) => at.get(r.id) ?? at.size
  return [...list].sort((a, b) => place(a) - place(b))
}

/** 星标 / 团队分区 / my own sections / 频道 / 私信 hold the conversations; 终端 sits below them. */
type BuiltIn = 'star' | 'group' | 'dm'
type Section = {
  key: string
  label: string
  custom?: boolean
  team?: boolean
  /** My own or a team section; absent for 星标 / 频道 / 私信. */
  sec?: SidebarSectionDto
  depth: number
  children: Section[]
}
const BUILT_IN: Record<BuiltIn, string> = { star: t('星标'), group: t('频道'), dm: t('私信') }
const SPACES = 'space'
/** Team sections' keys, apart from my own sections' ids. */
const TEAM = 't:'
const sectionOf = (g: GroupDto, own: Set<string>, team: Set<string>) =>
  g.pinned
    ? 'star'
    : g.sectionId && own.has(g.sectionId)
      ? g.sectionId
      : g.teamSectionId && team.has(g.teamSectionId)
        ? TEAM + g.teamSectionId
        : g.kind === 'dm'
          ? 'dm'
          : 'group'
/** 研发 › 支付线 › 结算: where a nested section sits, for the 移到分区 menus. */
const pathOfSection = (list: SidebarSectionDto[], sec: SidebarSectionDto): string => {
  const parent = sec.parentId && list.find((x) => x.id === sec.parentId)
  return parent ? `${pathOfSection(list, parent)} › ${sec.name}` : sec.name
}

/** Group admins file their group under a 团队分区; team admins file any group. */
const useCanFile = (g: GroupDto) => {
  const me = useSession((s) => s.user?.id)
  const manage = useTeamSections((s) => s.canManage)
  return g.kind === 'group' && (manage || !!g.members.find((m) => m.userId === me)?.isAdmin)
}
const FOLDED_KEY = 'gonggong.sidebarFolded'
const DRAG_TYPE = 'application/x-gg-group'

/**
 * Dropped on a section: 星标 stars it, a 团队分区 files it there for everyone, my section files it there for me,
 * 频道 / 私信 take it back to its default place.
 */
const fileUnder = (g: GroupDto, key: string) =>
  attempt(async () => {
    if (key === 'star') return groupsApi.prefs(g.id, { pinned: true })
    if (key.startsWith(TEAM)) {
      await teamSectionsApi.file(g.id, key.slice(TEAM.length))
      if (g.pinned || g.sectionId) await groupsApi.prefs(g.id, { pinned: false, sectionId: null })
      return
    }
    return groupsApi.prefs(g.id, { pinned: false, sectionId: key === 'group' || key === 'dm' ? null : key })
  })

/** Folded sections, kept in this browser. */
function useFolded() {
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
    } catch {
      return []
    }
  })
  const toggle = (key: string) => {
    const next = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key]
    setFolded(next)
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable (private mode): the fold lasts for this page only
    }
  }
  return [folded, toggle] as const
}

/**
 * Positions the selection capsule under the current conversation so it slides between rows.
 * `at` is the current row's place in the list: rows reordering around it move it without resizing anything.
 */
function useSelectionCapsule(pathname: string, at: number) {
  const scroll = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the route or the current row's place changes
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el) return
    const measure = () => {
      const item = el.querySelector<HTMLElement>('.pn-conv[aria-current="page"]')
      // On-screen offset, not offsetTop: rows sit in wrappers (the context menu) that would become their offsetParent.
      const box = item?.getBoundingClientRect()
      const y = box ? box.top - el.getBoundingClientRect().top + el.scrollTop : 0
      el.style.setProperty('--capsule-y', `${y}px`)
      el.style.setProperty('--capsule-h', `${box?.height ?? 0}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // The content box resizes whenever rows above the current one appear or go (setup guide, filter, 已完成 fold).
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [pathname, at])
  return scroll
}

/** The conversation list folded to avatars and unread badges (workbench 专注 mode). */
export function ConversationStrip({ groups }: { groups: GroupDto[] }) {
  const rows = byPin(groups)
  return (
    <nav aria-label={t('会话列表')} className="conv-strip">
      <button
        type="button"
        className="conv-strip__item"
        title={t('展开会话列表')}
        aria-label={t('展开会话列表')}
        onClick={() => useWorkbench.getState().setMode('split')}
      >
        <Icon name="sidebar" size={18} />
      </button>
      {rows.map((g) => (
        <NavLink key={g.id} to={`/g/${g.id}`} className="conv-strip__item" title={g.name} aria-label={g.name}>
          <GroupAvatar group={g} size={32} />
          <Badge count={rowCount(g)} muted={g.notifyLevel === 'off'} />
        </NavLink>
      ))}
    </nav>
  )
}

/** The collapsed chat (workbench 全屏 mode): messages that arrived since it collapsed, and other chats' unread. */
export function ChatStrip({ group }: { group: GroupDto }) {
  const [seen] = useState(group.lastSeq)
  const others = useWorkspace((s) =>
    s.groups.reduce((n, g) => (g.id === group.id ? n : n + alertCount(g)), 0),
  )
  const fresh = group.lastSeq - seen
  return (
    <>
      <span key={group.lastSeq} className={fresh > 0 ? 'chat__strip-flash' : undefined}>
        <GroupAvatar group={group} size={28} />
      </span>
      <Badge count={fresh} />
      <Badge count={others} muted />
    </>
  )
}

/** Connection, my bots online and my machines online, in place of a window status bar. */
export function Footer({ bots, machines }: { bots: BotDto[]; machines: MachineDto[] }) {
  const conn = CONN[useRealtimeStatus()]
  const live = bots.filter((b) => b.presence === 'online' || b.presence === 'running').length
  const online = machines.filter((m) => m.online).length
  return (
    <footer className="sidebar__foot">
      <span className="sidebar__dot" style={{ background: conn.color }} />
      <span>{conn.label}</span>
      <span>{t('{n} 个 Bot 在线', { n: live })}</span>
      {machines.length ? <span>{t('{n} 台机器在线', { n: online })}</span> : null}
    </footer>
  )
}

export function Sidebar({
  groups,
  bots,
  machines,
  spaces = [],
  header,
  onNewGroup,
  loaded,
  guide = true,
  onBindMachine,
  onNewBot,
}: SidebarProps) {
  const { pathname } = useLocation()
  // While the main area shows the first-run welcome, "还没有…" in every section would only repeat it.
  const empty = (text: string) => (loaded && guide ? <div className="sidebar__empty">{text}</div> : null)
  const inGroup = groups.some((g) => g.kind === 'group')
  const own = useSections((s) => s.sections)
  const team = useTeamSections()
  const me = useSession((s) => s.user?.id)
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [showDone, setShowDone] = useState(false)
  /** 浏览频道, or a section to create (under `parent`) or rename. */
  const [dialog, setDialog] = useState<
    'browse' | { team: boolean; parent?: SidebarSectionDto; rename?: SidebarSectionDto } | null
  >(null)
  const [dropAt, setDropAt] = useState('')
  const newSection = useCallback(() => setDialog({ team: false }), [])
  const anyFlagged = groups.some((g) => g.flagged)
  // Unflagging the last one hides the filter; don't let it silently re-apply when a flag comes back.
  if (onlyFlagged && !anyFlagged) setOnlyFlagged(false)
  const shown = groups.filter((g) => !onlyFlagged || g.flagged)
  const [hovered, setHovered] = useState(false)
  const done = shown.filter(isDone)
  const open = useHeldOrder(byPin(shown.filter((g) => !isDone(g))), hovered)
  const terminals = useHeldOrder(byPin(onlyFlagged ? [] : spaces), hovered)
  const [folded, toggleFold] = useFolded()
  const ownIds = new Set(own.map((x) => x.id))
  const teamIds = new Set(team.sections.map((x) => x.id))
  const isOpen = (r: Row) => pathname === pathOf(r)
  const canFile = (g: GroupDto) =>
    g.kind === 'group' && (team.canManage || !!g.members.find((m) => m.userId === me)?.isAdmin)
  const outside = onlyFlagged ? [] : team.directory
  // A folded section still shows what needs reading and the conversation that is open.
  const fold = <R extends Row>(key: string, all: R[]) =>
    folded.includes(key) ? all.filter((r) => isOpen(r) || (!isSpace(r) && r.unread > 0)) : all
  const keyOf = (sec: SidebarSectionDto, isTeam: boolean) => (isTeam ? TEAM + sec.id : sec.id)
  const tree = (
    list: SidebarSectionDto[],
    isTeam: boolean,
    parentId: string | null,
    depth: number,
  ): Section[] =>
    list
      .filter((x) => x.parentId === parentId)
      .map((x) => ({
        key: keyOf(x, isTeam),
        label: x.name,
        team: isTeam || undefined,
        custom: !isTeam || undefined,
        sec: x,
        depth,
        children: tree(list, isTeam, x.id, depth + 1),
      }))
  const roots: Section[] = [
    { key: 'star', label: BUILT_IN.star, depth: 1, children: [] },
    ...tree(team.sections, true, null, 1),
    ...tree(own, false, null, 1),
    { key: 'group', label: BUILT_IN.group, depth: 1, children: [] },
    { key: 'dm', label: BUILT_IN.dm, depth: 1, children: [] },
  ]
  const keysUnder = (sec: Section): string[] => [sec.key, ...sec.children.flatMap(keysUnder)]
  /** Rows filed right here, and the groups I am not in after them. */
  const direct = (key: string) => open.filter((g) => sectionOf(g, ownIds, teamIds) === key)
  const outsideIn = (key: string) => outside.filter((d) => TEAM + d.teamSectionId === key)
  /** Groups in the section and the ones nested under it: joined, and (团队分区) all of them. */
  const countOf = (sec: Section) => {
    const keys = new Set(keysUnder(sec))
    if (sec.team) {
      const joined = groups.filter((g) => g.teamSectionId && keys.has(TEAM + g.teamSectionId)).length
      return `${joined}/${joined + outside.filter((d) => keys.has(TEAM + d.teamSectionId)).length}`
    }
    return String(groups.filter((g) => g.sectionId && keys.has(g.sectionId)).length)
  }
  // 频道 and my own sections stay as places to drop into and to browse from; 团队分区 too for team admins.
  const kept = (sec: Section): boolean =>
    (sec.key === 'group' && !onlyFlagged) ||
    !!sec.custom ||
    (!!sec.team && team.canManage) ||
    keysUnder(sec).some((k) => direct(k).length || outsideIn(k).length)
  type Shown = Section & { rows: GroupDto[]; others: DirectoryGroupDto[]; fold: boolean; nested: Shown[] }
  /** What each section shows; a folded one keeps its whole subtree's unread and open rows, without the heads. */
  const view = (sec: Section): Shown => {
    const fold_ = folded.includes(sec.key)
    const keys = fold_ ? keysUnder(sec) : [sec.key]
    const rows = keys.flatMap(direct)
    const others = keys.flatMap(outsideIn)
    return {
      ...sec,
      fold: fold_,
      rows: fold_ ? rows.filter((g) => isOpen(g) || g.unread > 0) : rows,
      others: fold_ ? others.filter((d) => pathname === `/g/${d.id}`) : others,
      nested: fold_ ? [] : sec.children.filter(kept).map(view),
    }
  }
  const sections = roots.filter(kept).map(view)
  const flat = (sec: Shown): GroupDto[] => [...sec.rows, ...sec.nested.flatMap(flat)]
  const shownSpaces = fold(SPACES, terminals)
  // One tab stop for all conversation rows (the open one, else the first); ↑↓ Home End move and open.
  const rows: Row[] = [...sections.flatMap(flat), ...(showDone ? done : []), ...shownSpaces]
  const at = rows.findIndex(isOpen)
  const stop = rows[at]?.id ?? rows[0]?.id
  const scroll = useSelectionCapsule(pathname, at)
  const anything = open.length || own.length || team.sections.length || terminals.length
  const dropProps = (key: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      setDropAt(key)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt('')
    },
    onDrop: (e: DragEvent) => {
      e.stopPropagation()
      setDropAt('')
      const g = groups.find((x) => x.id === e.dataTransfer.getData(DRAG_TYPE))
      if (!g || sectionOf(g, ownIds, teamIds) === key || (key.startsWith(TEAM) && !canFile(g))) return
      void fileUnder(g, key)
    },
  })
  const onSectionMenu = (sec: SidebarSectionDto, isTeam: boolean) => (v: string) => {
    const ops = isTeam ? teamSectionsApi : sectionsApi
    if (v === 'rename') setDialog({ rename: sec, team: isTeam })
    else if (v === 'child') setDialog({ parent: sec, team: isTeam })
    else if (v === 'up' || v === 'down') void attempt(() => ops.move(sec.id, v === 'up' ? -1 : 1))
    else if (v === 'delete') void attempt(() => ops.remove(sec.id))
  }
  const head = (key: string, label: ReactNode, collapsed: boolean, actions?: ReactNode) => (
    <div className="sidebar__sechead">
      <button
        type="button"
        className="sidebar__head sidebar__fold"
        aria-expanded={!collapsed}
        onClick={() => toggleFold(key)}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={11} />
        {label}
      </button>
      {actions}
    </div>
  )
  const actionsOf = (sec: Section) => {
    if (sec.key === 'group')
      return (
        <>
          <button
            type="button"
            className="sidebar__add"
            title={t('浏览频道')}
            aria-label={t('浏览频道')}
            onClick={() => setDialog('browse')}
          >
            <Icon name="globe" size={13} />
          </button>
          {onNewGroup ? (
            <button
              type="button"
              className="sidebar__add"
              title={t('发起会话')}
              aria-label={t('发起会话')}
              onClick={onNewGroup}
            >
              <Icon name="plus" size={14} />
            </button>
          ) : null}
        </>
      )
    const mine = sec.sec
    if (!mine || (sec.team && !team.canManage)) return null
    const siblings = (sec.team ? team.sections : own).filter((x) => x.parentId === mine.parentId)
    const i = siblings.indexOf(mine)
    return (
      <PullDownButton
        icon="more"
        size="small"
        variant="plain"
        indicator={false}
        align="end"
        portal
        aria-label={t('{name} 分区操作', { name: mine.name })}
        items={[
          { label: t('重命名…'), value: 'rename', icon: 'textformat' },
          ...(sec.depth < SECTION_MAX_DEPTH
            ? [{ label: t('新建子分区…'), value: 'child', icon: 'plus' as const }]
            : []),
          { label: t('上移'), value: 'up', icon: 'chevron-up', disabled: i === 0 },
          { label: t('下移'), value: 'down', icon: 'chevron-down', disabled: i === siblings.length - 1 },
          { separator: true },
          { label: t('删除分区'), value: 'delete', icon: 'trash', destructive: true },
        ]}
        onSelect={onSectionMenu(mine, !!sec.team)}
      />
    )
  }
  const renderSection = (sec: Shown): ReactNode => (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls; this groups links
    <div
      key={sec.key}
      role="group"
      aria-label={sec.label}
      className={cx('sidebar__section', dropAt === sec.key && 'sidebar__section--drop')}
      style={sec.depth > 1 ? { paddingLeft: (sec.depth - 1) * 12 } : undefined}
      {...dropProps(sec.key)}
    >
      {head(
        sec.key,
        <>
          {sec.label}
          {sec.team && sec.depth === 1 ? <span className="sidebar__teamtag">{t('团队')}</span> : null}
          {sec.sec ? <span className="sidebar__count">{countOf(sec)}</span> : null}
        </>,
        sec.fold,
        actionsOf(sec),
      )}
      <div className="sidebar__list sidebar__list--convs">
        {sec.rows.map((g) => row(g, sec.key !== 'dm'))}
        {sec.others.map((d) => (
          <DirectoryRow key={d.id} d={d} />
        ))}
        {sec.sec && !sec.fold && !keysUnder(sec).some((k) => direct(k).length || outsideIn(k).length) ? (
          <div className="sidebar__drophint">{t('把会话拖到这里')}</div>
        ) : null}
      </div>
      {sec.nested.map(renderSection)}
    </div>
  )
  const row = (g: GroupDto, tagged = true) => (
    <GroupRow
      key={g.id}
      g={g}
      current={isOpen(g)}
      tabStop={g.id === stop}
      tagged={tagged}
      onNewSection={newSection}
    />
  )
  return (
    <div className="sidebar">
      {header}
      <div
        ref={scroll}
        className="sidebar__scroll"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <div>
          {guide && loaded && !(machines.length && bots.length && inGroup) ? (
            <SetupGuide
              bound={machines.length > 0}
              hasBot={bots.length > 0}
              inGroup={inGroup}
              onBindMachine={onBindMachine}
              onNewBot={onNewBot}
              onNewGroup={onNewGroup}
            />
          ) : null}
          {anyFlagged ? (
            <div className="sidebar__filter">
              <Button
                size="small"
                variant={onlyFlagged ? 'primary' : 'plain'}
                aria-pressed={onlyFlagged}
                onClick={() => setOnlyFlagged(!onlyFlagged)}
              >
                <Icon name="flag" size={12} />
                {t('只看已标记')}
              </Button>
            </div>
          ) : null}
          {anything ? (
            <nav className="sidebar__shortcuts" aria-label={t('快捷入口')}>
              <ThreadsRow />
              <UnreadsRow />
              <LaterRow />
            </nav>
          ) : null}
          <section aria-label={t('会话#list')}>
            {anything ? (
              sections.map(renderSection)
            ) : (
              <div className="sidebar__list sidebar__list--convs">{empty(t('还没有会话'))}</div>
            )}
            {anything && !onlyFlagged ? (
              team.canManage ? (
                <div className="sidebar__newsection-menu">
                  <PullDownButton
                    label={t('新建分区')}
                    icon="plus"
                    size="small"
                    variant="plain"
                    indicator={false}
                    items={[
                      { label: t('个人分区…'), value: 'section', icon: 'person' },
                      { label: t('团队分区…'), value: 'teamSection', icon: 'contacts' },
                    ]}
                    onSelect={(v) => setDialog({ team: v === 'teamSection' })}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="sidebar__newsection"
                  onClick={() => setDialog({ team: false })}
                >
                  <Icon name="plus" size={11} />
                  {t('新建分区')}
                </button>
              )
            ) : null}
          </section>
          {done.length ? (
            <section>
              <button
                type="button"
                className="sidebar__head sidebar__fold"
                aria-expanded={showDone}
                onClick={() => setShowDone(!showDone)}
              >
                <Icon name={showDone ? 'chevron-down' : 'chevron-right'} size={11} />
                {t('已完成 · {n}', { n: done.length })}
              </button>
              {showDone ? <div className="sidebar__list">{done.map((g) => row(g))}</div> : null}
            </section>
          ) : null}
          {terminals.length ? (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls; this groups links
            <div role="group" aria-label={t('终端')} className="sidebar__section">
              {head(SPACES, t('终端 · {n}', { n: terminals.length }), folded.includes(SPACES))}
              <div className="sidebar__list sidebar__list--convs">
                {shownSpaces.map((s) => (
                  <SpaceRow key={s.id} s={s} tabStop={s.id === stop} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Footer bots={bots} machines={machines} />
      {dialog === 'browse' ? <BrowseChannelsDialog onClose={() => setDialog(null)} /> : null}
      {dialog && typeof dialog === 'object' ? (
        <SectionNameDialog
          initial={dialog.rename?.name}
          team={dialog.team}
          parent={dialog.parent?.name}
          onSave={(name) => {
            const ops = dialog.team ? teamSectionsApi : sectionsApi
            return dialog.rename ? ops.rename(dialog.rename.id, name) : ops.create(name, dialog.parent?.id)
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}
