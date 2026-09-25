import type { BotDto, GroupDto, MachineDto } from '@gonggong/protocol'
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router'
import { botStateText, PRESENCE } from '../features/bots/model'
import { OS_LABEL } from '../features/machines/BindMachineDialog'
import { useRealtimeStatus } from '../lib/realtime'
import { Button, ConversationContent, Icon } from '../ui'
import { useWorkspace } from './workspace'

export const GROUP_MODE_LABEL = { partition: '分区模式', force: '强制同步' } as const
export const GROUP_MODE_HINT = {
  partition: '每个 Bot 在自己的工作区里改代码，彼此靠 git 交换',
  force: '同一时刻只有一个 Bot 持锁写入，全员文件保持一致',
} as const

const CONN = {
  open: { label: '已连接', color: 'var(--system-green)' },
  connecting: { label: '连接中…', color: 'var(--system-orange)' },
  closed: { label: '已断开 · 重连中', color: 'var(--system-red)' },
}

export interface SidebarProps {
  groups: GroupDto[]
  bots: BotDto[]
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
  onOpenBot?: (botId: string) => void
  onOpenMachine?: (machineId: string) => void
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

/** Unsent text MessageComposer keeps per group (its `gonggong:draft:<id>` sessionStorage key). */
const draftOf = (groupId: string) => {
  try {
    return sessionStorage.getItem(`gonggong:draft:${groupId}`) ?? undefined
  } catch {
    return undefined
  }
}

function GroupRow({ g, current }: { g: GroupDto; current: boolean }) {
  const dm = g.kind === 'dm'
  // The mode lives in the chat header; the row's second line is for the latest message.
  const preview = g.last || (dm ? '仅你和你的 Bot' : `${g.members.length} 人 · ${GROUP_MODE_LABEL[g.mode]}`)
  return (
    <NavLink to={`/g/${g.id}`} className="pn-conv" data-testid={`group-item-${g.id}`}>
      <ConversationContent
        item={{
          id: g.id,
          name: g.name,
          group: true,
          tags: dm ? [{ label: 'Bot', tone: 'blue' }] : undefined,
          preview,
          draft: current ? undefined : draftOf(g.id),
          unread: g.unread,
          muted: g.muted,
          pinned: g.pinned,
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
    { label: '绑定机器', hint: '在机器上安装 gg，用绑定码关联账号', done: bound, onClick: onBindMachine },
    { label: '新建 Bot', hint: '选择机器上的 Claude Code 或 Codex', done: hasBot, onClick: onNewBot },
    { label: '建群并 @ Bot', hint: '拉上同事、绑定仓库，分配任务', done: inGroup, onClick: onNewGroup },
  ]
  return (
    <section className="sidebar-guide" aria-label="开始使用">
      <div className="sidebar-guide__title">开始使用</div>
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
      <span>{`${bots} 个 Bot 在线`}</span>
      {machines.length ? <span>{`${online} 台机器在线`}</span> : null}
    </footer>
  )
}

export function Sidebar({
  groups,
  bots,
  machines,
  header,
  onNewGroup,
  onNewDm,
  loaded,
  guide = true,
  onBindMachine,
  onNewBot,
  onOpenBot,
  onOpenMachine,
  onConfirmBot,
}: SidebarProps) {
  const { scroll, pathname } = useSelectionCapsule(groups)
  // While the main area shows the first-run welcome, "还没有…" in every section would only repeat it.
  const empty = (text: string) => (loaded && guide ? <div className="sidebar__empty">{text}</div> : null)
  const inGroup = groups.some((g) => g.kind === 'group')
  const lists = [
    { label: '群', items: byPin(groups.filter((g) => g.kind === 'group')), empty: '还没有加入任何群' },
    {
      label: '私聊',
      add: onNewDm,
      addTitle: '新建私聊',
      items: byPin(groups.filter((g) => g.kind === 'dm')),
      empty: '还没有私聊',
    },
  ]
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
                ? l.items.map((g) => <GroupRow key={g.id} g={g} current={pathname === `/g/${g.id}`} />)
                : empty(l.empty)}
            </div>
          </section>
        ))}
        <section>
          <SectionHead label="我的 Bot" onAdd={onNewBot} addTitle={onNewBot && '新建 Bot'} />
          <div className="sidebar__list">
            {bots.length
              ? bots.map((b) => (
                  <div key={b.id} className="sidebar__row">
                    <button
                      type="button"
                      className="sidebar__open"
                      title={`${b.name} · ${botStateText(b)}`}
                      onClick={() => onOpenBot?.(b.id)}
                    >
                      <span className="sidebar__dot" style={{ background: PRESENCE[b.presence].color }} />
                      <span className="sidebar__name">{b.name}</span>
                      <span className="sidebar__meta">{botStateText(b)}</span>
                    </button>
                    {b.binding === 'pending_confirm' && onConfirmBot ? (
                      <Button size="small" variant="primary" onClick={() => onConfirmBot(b.id)}>
                        确认
                      </Button>
                    ) : null}
                  </div>
                ))
              : empty('还没有 Bot')}
          </div>
        </section>
        <section aria-label="我的机器">
          <SectionHead label="我的机器" onAdd={onBindMachine} addTitle={onBindMachine && '绑定新机器'} />
          <div className="sidebar__list">
            {machines.length
              ? machines.map((m) => {
                  const bound = bots.filter((b) => b.machineId === m.id).length
                  const meta = `${OS_LABEL[m.os]}${bound ? ` · ${bound} 个 Bot` : ''}`
                  return (
                    <div key={m.id} className="sidebar__row">
                      <button
                        type="button"
                        className="sidebar__open"
                        title={`${m.name} · ${m.online ? '在线' : '离线'} · ${meta}`}
                        onClick={() => onOpenMachine?.(m.id)}
                      >
                        <span
                          className="sidebar__dot"
                          style={{ background: m.online ? 'var(--system-green)' : 'var(--system-gray)' }}
                        />
                        <span className="sidebar__name">{m.name}</span>
                        <span className="sidebar__meta">{meta}</span>
                      </button>
                    </div>
                  )
                })
              : empty('还没有绑定机器')}
          </div>
        </section>
      </div>
      <Footer machines={machines} />
    </div>
  )
}
