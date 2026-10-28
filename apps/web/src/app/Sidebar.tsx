import type { BotDto, GroupDto, MachineDto, TerminalSpaceDto } from '@gonggong/protocol'
import {
  type MouseEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { type PersonaRole, roleCostume } from '../features/bots/avatars'
import { draftKey } from '../features/chat/MessageComposer'
import { groupsApi } from '../features/groups/api'
import { GroupAvatar } from '../features/groups/GroupAvatar'
import { middle } from '../features/repos/RepoWorkspaceView'
import { t } from '../i18n'
import { api } from '../lib/api'
import { attempt } from '../lib/errors'
import { plainText } from '../lib/plain'
import { useRealtimeStatus } from '../lib/realtime'
import { Badge, Button, ContextMenu, type ConversationActivity, ConversationContent, Icon } from '../ui'
import { keyNav } from '../ui/im/keynav'
import { activityOf } from './convActivity'
import { useInspector } from './inspector'
import { useWorkbench } from './workbench'
import { lastText, useWorkspace } from './workspace'

export const GROUP_MODE_LABEL = { partition: t('分区模式'), force: t('强制同步') }
const CONN = {
  open: { label: t('已连接'), color: 'var(--system-green)' },
  connecting: { label: t('连接中…'), color: 'var(--system-orange)' },
  closed: { label: t('已断开 · 重连中'), color: 'var(--system-red)' },
}

export interface SidebarProps {
  groups: GroupDto[]
  /** My bots and machines: for the 开始使用 guide and the footer (they are managed in 我的机器管理). */
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
}: {
  g: GroupDto
  current: boolean
  tabStop: boolean
}) {
  const dm = g.kind === 'dm'
  const navigate = useNavigate()
  const press = useLongPress()
  const { activity, alert } = useActivity(g)
  const onMenu = (v: string) => {
    if (v === 'pin') void attempt(() => groupsApi.prefs(g.id, { pinned: !g.pinned }))
    else if (v === 'mute') void attempt(() => groupsApi.prefs(g.id, { muted: !g.muted }))
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
        { label: g.pinned ? t('取消置顶') : t('置顶'), value: 'pin', icon: 'pin' },
        { label: g.muted ? t('取消免打扰') : t('消息免打扰'), value: 'mute', icon: 'bell-slash' },
        { label: t('清除未读'), value: 'read', icon: 'check', disabled: !g.unread },
        { label: isDone(g) ? t('移回列表') : t('完成'), value: 'done', icon: 'checkmark-circle' },
        { label: g.flagged ? t('取消标记') : t('标记'), value: 'flag', icon: 'flag' },
        { label: dm ? t('私聊设置') : t('打开群信息'), value: 'info', icon: 'info' },
      ]}
      onSelect={onMenu}
    >
      <NavLink
        {...press}
        to={`/g/${g.id}`}
        className="pn-conv"
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
            tags: dm ? [{ label: 'Bot', tone: 'blue' }] : undefined,
            preview,
            draft: current ? undefined : draftOf(g.id),
            unread: g.unread,
            mention: g.mentioned,
            muted: g.muted,
            pinned: g.pinned,
            flagged: g.flagged,
            activity,
            alert,
          }}
        />
      </NavLink>
    </ContextMenu>
  )
})

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
      label: t('绑定机器'),
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
          <Badge count={g.unread} muted={g.muted} />
        </NavLink>
      ))}
    </nav>
  )
}

/** The collapsed chat (workbench 全屏 mode): messages that arrived since it collapsed, and other chats' unread. */
export function ChatStrip({ group }: { group: GroupDto }) {
  const [seen] = useState(group.lastSeq)
  const others = useWorkspace((s) =>
    s.groups.reduce((n, g) => (g.id === group.id || g.muted ? n : n + g.unread), 0),
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
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const anyFlagged = groups.some((g) => g.flagged)
  // Unflagging the last one hides the filter; don't let it silently re-apply when a flag comes back.
  if (onlyFlagged && !anyFlagged) setOnlyFlagged(false)
  const shown = groups.filter((g) => !onlyFlagged || g.flagged)
  const [hovered, setHovered] = useState(false)
  const done = shown.filter(isDone)
  const open = useHeldOrder(
    byPin<Row>([...shown.filter((g) => !isDone(g)), ...(onlyFlagged ? [] : spaces)]),
    hovered,
  )
  // One tab stop for all conversation rows (the open one, else the first); ↑↓ Home End move and open.
  const rows: Row[] = [...open, ...(showDone ? done : [])]
  const at = rows.findIndex((r) => pathname === pathOf(r))
  const stop = rows[at]?.id ?? rows[0]?.id
  const scroll = useSelectionCapsule(pathname, at)
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
          <section aria-label={t('会话#list')}>
            <div className="sidebar__list sidebar__list--convs">
              {open.length
                ? open.map((r) =>
                    isSpace(r) ? (
                      <SpaceRow key={r.id} s={r} tabStop={r.id === stop} />
                    ) : (
                      <GroupRow key={r.id} g={r} current={pathname === pathOf(r)} tabStop={r.id === stop} />
                    ),
                  )
                : empty(t('还没有会话'))}
            </div>
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
              {showDone ? (
                <div className="sidebar__list">
                  {done.map((g) => (
                    <GroupRow key={g.id} g={g} current={pathname === `/g/${g.id}`} tabStop={g.id === stop} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
      <Footer bots={bots} machines={machines} />
    </div>
  )
}
