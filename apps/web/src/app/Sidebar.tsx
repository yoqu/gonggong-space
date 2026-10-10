import type { BotDto, GroupDto, MachineDto } from '@gonggong/protocol'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { BotAvatar } from '../features/bots/avatars'
import { botStateText, PRESENCE } from '../features/bots/model'
import { draftKey } from '../features/chat/MessageComposer'
import { GroupAvatar } from '../features/groups/GroupAvatar'
import { OS_LABEL } from '../features/machines/BindMachineDialog'
import { middle } from '../features/repos/RepoWorkspaceView'
import { t } from '../i18n'
import { plainText } from '../lib/plain'
import { useRealtimeStatus } from '../lib/realtime'
import { Badge, Button, ConversationContent, Icon } from '../ui'
import { keyNav } from '../ui/im/keynav'
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
  bots: BotDto[]
  /** Others' bots shared with me. */
  sharedBots?: BotDto[]
  machines: MachineDto[]
  /** Toolbar row and search above the list. */
  header?: ReactNode
  onNewDm?: () => void
  /** All lists have arrived: empty states and the 开始使用 guide wait for it so "not yet" never reads as "none". */
  loaded?: boolean
  /** Show the 开始使用 card; off while the main area shows the full first-run welcome. */
  guide?: boolean
  onBindMachine?: () => void
  onNewBot?: () => void
  onNewGroup?: () => void
  /** Confirms a bot someone else created for me (shown on my pending_confirm bots). */
  onConfirmBot?: (botId: string) => void
}

function SectionHead({ label, onAdd, addTitle }: { label: string; onAdd?: () => void; addTitle?: string }) {
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

function GroupRow({ g, current, tabStop }: { g: GroupDto; current: boolean; tabStop: boolean }) {
  const dm = g.kind === 'dm'
  // The mode lives in the chat header; a group's second line is for the latest message, a DM's for where its Bot works.
  const preview = dm
    ? g.workspacePath
      ? middle(g.workspacePath)
      : t('未选择工作区')
    : (g.last && plainText(lastText(g))) ||
      t('{n} 人 · {mode}', { n: g.members.length, mode: GROUP_MODE_LABEL[g.mode] })
  return (
    <NavLink
      to={`/g/${g.id}`}
      className="pn-conv"
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
          muted: g.muted,
          pinned: g.pinned,
          live: g.liveRunIds.length > 0,
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

/** Pinned first; otherwise the server's order (creation time). */
const byPin = (list: GroupDto[]) => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned))

/** Positions the selection capsule under the current conversation so it slides between rows. */
function useSelectionCapsule(groups: GroupDto[]) {
  const scroll = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the route or the rows change
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el) return
    const measure = () => {
      const item = el.querySelector<HTMLElement>('.pn-conv[aria-current="page"]')
      el.style.setProperty('--capsule-y', `${item?.offsetTop ?? 0}px`)
      el.style.setProperty('--capsule-h', `${item?.offsetHeight ?? 0}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pathname, groups])
  return { scroll, pathname }
}

/** The conversation list folded to avatars and unread badges (workbench 专注 mode). */
export function ConversationStrip({ groups }: { groups: GroupDto[] }) {
  const rows = [
    ...byPin(groups.filter((g) => g.kind === 'group')),
    ...byPin(groups.filter((g) => g.kind === 'dm')),
  ]
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

/** Connection, bots online and machines online, in place of a window status bar. */
function Footer({ machines }: { machines: MachineDto[] }) {
  const conn = CONN[useRealtimeStatus()]
  const bots = useWorkspace(
    (s) => s.bots.filter((b) => b.presence === 'online' || b.presence === 'running').length,
  )
  const online = machines.filter((m) => m.online).length
  return (
    <footer className="sidebar__foot">
      <span className="sidebar__dot" style={{ background: conn.color }} />
      <span>{conn.label}</span>
      <span>{t('{n} 个 Bot 在线', { n: bots })}</span>
      {machines.length ? <span>{t('{n} 台机器在线', { n: online })}</span> : null}
    </footer>
  )
}

function BotRow({ b, meta, action }: { b: BotDto; meta: string; action?: ReactNode }) {
  return (
    <div className="sidebar__row">
      <NavLink to={`/bot/${b.id}`} className="sidebar__open" title={`${b.name} · ${meta}`}>
        <span className="sidebar__avatar">
          <BotAvatar id={b.id} name={b.name} size={28} />
          <span className="sidebar__presence" style={{ background: PRESENCE[b.presence].color }} />
        </span>
        <span className="sidebar__text">
          <span className="sidebar__name">{b.name}</span>
          <span className="sidebar__meta">{meta}</span>
        </span>
      </NavLink>
      {action}
    </div>
  )
}

export function Sidebar({
  groups,
  bots,
  sharedBots = [],
  machines,
  header,
  onNewGroup,
  onNewDm,
  loaded,
  guide = true,
  onBindMachine,
  onNewBot,
  onConfirmBot,
}: SidebarProps) {
  const { scroll, pathname } = useSelectionCapsule(groups)
  // While the main area shows the first-run welcome, "还没有…" in every section would only repeat it.
  const empty = (text: string) => (loaded && guide ? <div className="sidebar__empty">{text}</div> : null)
  const inGroup = groups.some((g) => g.kind === 'group')
  const lists = [
    {
      label: t('群#nav'),
      items: byPin(groups.filter((g) => g.kind === 'group')),
      empty: t('还没有加入任何群'),
    },
    {
      label: t('私聊#nav'),
      add: onNewDm,
      addTitle: t('新建私聊'),
      items: byPin(groups.filter((g) => g.kind === 'dm')),
      empty: t('还没有私聊'),
    },
  ]
  // One tab stop for all conversation rows (the open one, else the first); ↑↓ Home End move and open.
  const rows = lists.flatMap((l) => l.items)
  const stop = rows.find((g) => pathname === `/g/${g.id}`)?.id ?? rows[0]?.id
  return (
    <div className="sidebar">
      {header}
      <div ref={scroll} className="sidebar__scroll">
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
        {lists.map((l) => (
          <section key={l.label}>
            <SectionHead label={l.label} onAdd={l.add} addTitle={l.addTitle} />
            <div className="sidebar__list">
              {l.items.length
                ? l.items.map((g) => (
                    <GroupRow key={g.id} g={g} current={pathname === `/g/${g.id}`} tabStop={g.id === stop} />
                  ))
                : empty(l.empty)}
            </div>
          </section>
        ))}
        <section>
          <SectionHead label={t('我的 Bot')} onAdd={onNewBot} addTitle={onNewBot && t('新建 Bot…')} />
          <div className="sidebar__list">
            {bots.length
              ? bots.map((b) => (
                  <BotRow
                    key={b.id}
                    b={b}
                    meta={botStateText(b)}
                    action={
                      b.binding === 'pending_confirm' && onConfirmBot ? (
                        <Button size="small" variant="primary" onClick={() => onConfirmBot(b.id)}>
                          {t('确认')}
                        </Button>
                      ) : null
                    }
                  />
                ))
              : empty(t('还没有 Bot'))}
          </div>
        </section>
        {sharedBots.length ? (
          <section aria-label={t('共享给我')}>
            <SectionHead label={t('共享给我')} />
            <div className="sidebar__list">
              {sharedBots.map((b) => (
                <BotRow
                  key={b.id}
                  b={b}
                  meta={[t('{owner} 共享', { owner: b.ownerName }), botStateText(b)]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </div>
          </section>
        ) : null}
        <section aria-label={t('我的机器')}>
          <SectionHead
            label={t('我的机器')}
            onAdd={onBindMachine}
            addTitle={onBindMachine && t('绑定新机器')}
          />
          <div className="sidebar__list">
            {machines.length
              ? machines.map((m) => {
                  const bound = bots.filter((b) => b.machineId === m.id).length
                  const meta = [OS_LABEL[m.os], bound && t('{n} 个 Bot', { n: bound })]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <div key={m.id} className="sidebar__row">
                      <NavLink
                        to={`/machine/${m.id}`}
                        className="sidebar__open"
                        title={[m.name, m.online ? t('在线') : t('离线'), meta].filter(Boolean).join(' · ')}
                      >
                        <span
                          className="sidebar__dot"
                          style={{ background: m.online ? 'var(--system-green)' : 'var(--system-gray)' }}
                        />
                        <span className="sidebar__text">
                          <span className="sidebar__name">{m.name}</span>
                          {meta ? <span className="sidebar__meta">{meta}</span> : null}
                        </span>
                      </NavLink>
                    </div>
                  )
                })
              : empty(t('还没有绑定机器'))}
          </div>
        </section>
      </div>
      <Footer machines={machines} />
    </div>
  )
}
