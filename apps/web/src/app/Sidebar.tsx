import type { BotDto, GroupDto, MachineDto } from '@aiws/protocol'
import { BellOff, Check, ChevronRight, Hash, Pin, Plus, User } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router'
import { botStateText, PRESENCE } from '../features/bots/model'
import { OS_LABEL } from '../features/machines/BindMachineDialog'
import { cx } from '../lib/cx'
import { Button } from '../ui'

export const GROUP_MODE_LABEL = { partition: '分区模式', force: '强制同步' } as const

export interface SidebarProps {
  groups: GroupDto[]
  bots: BotDto[]
  machines: MachineDto[]
  onNewGroup?: () => void
  onNewDm?: () => void
  /** All lists have arrived: empty states and the 开始使用 guide wait for it so "not yet" never reads as "none". */
  loaded?: boolean
  onBindMachine?: () => void
  onNewBot?: () => void
  onOpenBot?: (botId: string) => void
  onOpenMachine?: (machineId: string) => void
  /** Confirms a bot someone else created for me (shown on my pending_confirm bots). */
  onConfirmBot?: (botId: string) => void
}

function SectionHead({ label, onAdd, addTitle }: { label: string; onAdd?: () => void; addTitle?: string }) {
  return (
    <div className="sidebar__head">
      <span className="eyebrow">{label}</span>
      {addTitle ? (
        <button type="button" className="sidebar__add" title={addTitle} aria-label={addTitle} onClick={onAdd}>
          <Plus size={13} />
        </button>
      ) : null}
    </div>
  )
}

function GroupRow({ g }: { g: GroupDto }) {
  const Icon = g.kind === 'dm' ? User : Hash
  const sub = `${GROUP_MODE_LABEL[g.mode]} · ${g.last || (g.kind === 'dm' ? '仅你和你的 bot' : `${g.members.length} 人`)}`
  return (
    <NavLink to={`/g/${g.id}`} className="sidebar__item" data-testid={`group-item-${g.id}`}>
      <span className="sidebar__row">
        <Icon size={13} className={cx('sidebar__icon', `sidebar__icon--${g.kind}`)} />
        <span className="sidebar__name">{g.name}</span>
        {g.pinned ? <Pin size={11} className="muted-icon" data-testid="pinned" aria-label="已置顶" /> : null}
        {g.muted ? <BellOff size={11} className="muted-icon" aria-label="消息免打扰" /> : null}
        {g.unread > 0 ? (
          <span
            className={cx('sidebar__unread', g.muted && 'sidebar__unread--muted')}
            role="img"
            aria-label={`${g.unread} 条未读`}
          >
            {g.unread}
          </span>
        ) : null}
      </span>
      <span className="sidebar__sub">{sub}</span>
    </NavLink>
  )
}

function SetupGuide({
  bound,
  hasBot,
  onBindMachine,
  onNewBot,
}: {
  bound: boolean
  hasBot: boolean
  onBindMachine?: () => void
  onNewBot?: () => void
}) {
  const steps = [
    { label: '绑定机器', hint: '在机器上运行 daemon，用绑定码关联账号', done: bound, onClick: onBindMachine },
    { label: '新建 Bot', hint: '选择机器上的 Claude Code 或 Codex', done: hasBot, onClick: onNewBot },
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
            {s.done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
          </span>
          <span className="sidebar-guide__text">
            <span className="sidebar-guide__label">{s.label}</span>
            <span className="sidebar-guide__hint">{s.hint}</span>
          </span>
          {s.done ? null : <ChevronRight size={13} className="muted-icon" />}
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
      const item = el.querySelector<HTMLElement>('.sidebar__item[aria-current="page"]')
      el.style.setProperty('--capsule-y', `${item?.offsetTop ?? 0}px`)
      el.style.setProperty('--capsule-h', `${item?.offsetHeight ?? 0}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pathname, groups])
  return scroll
}

export function Sidebar({
  groups,
  bots,
  machines,
  onNewGroup,
  onNewDm,
  loaded,
  onBindMachine,
  onNewBot,
  onOpenBot,
  onOpenMachine,
  onConfirmBot,
}: SidebarProps) {
  const scroll = useSelectionCapsule(groups)
  const online = machines.filter((m) => m.online).length
  const empty = (text: string) => (loaded ? <div className="sidebar__empty">{text}</div> : null)
  const lists = [
    {
      label: '群',
      add: onNewGroup,
      addTitle: '新建群',
      items: byPin(groups.filter((g) => g.kind === 'group')),
      empty: '还没有加入任何群',
    },
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
      <div ref={scroll} className="sidebar__scroll">
        {loaded && !(machines.length && bots.length) ? (
          <SetupGuide
            bound={machines.length > 0}
            hasBot={bots.length > 0}
            onBindMachine={onBindMachine}
            onNewBot={onNewBot}
          />
        ) : null}
        {lists.map((l) => (
          <section key={l.label}>
            <SectionHead label={l.label} onAdd={l.add} addTitle={l.addTitle} />
            <div className="sidebar__list">
              {l.items.length ? l.items.map((g) => <GroupRow key={g.id} g={g} />) : empty(l.empty)}
            </div>
          </section>
        ))}
        <section>
          <SectionHead label="我的 Bot" onAdd={onNewBot} addTitle={onNewBot && '新建 Bot'} />
          <div className="sidebar__list">
            {bots.length
              ? bots.map((b) => (
                  <div key={b.id} className="sidebar__bot">
                    <button
                      type="button"
                      className="sidebar__bot-open"
                      title={`${b.name} · ${botStateText(b)}`}
                      onClick={() => onOpenBot?.(b.id)}
                    >
                      <span className="dot" style={{ background: PRESENCE[b.presence].color }} />
                      <span className="sidebar__bot-name">{b.name}</span>
                      <span className="sidebar__bot-state">{botStateText(b)}</span>
                    </button>
                    {b.binding === 'pending_confirm' && onConfirmBot ? (
                      <Button size="xs" variant="primary" onClick={() => onConfirmBot(b.id)}>
                        确认
                      </Button>
                    ) : null}
                  </div>
                ))
              : empty('还没有 bot')}
          </div>
        </section>
        <section aria-label="我的机器">
          <SectionHead label="我的机器" onAdd={onBindMachine} addTitle={onBindMachine && '绑定新机器'} />
          <div className="sidebar__list">
            {machines.length
              ? machines.map((m) => {
                  const bound = bots.filter((b) => b.machineId === m.id).length
                  const meta = `${OS_LABEL[m.os]}${bound ? ` · ${bound} 个 bot` : ''}`
                  return (
                    <div key={m.id} className="sidebar__bot">
                      <button
                        type="button"
                        className="sidebar__bot-open"
                        title={`${m.name} · ${m.online ? '在线' : '离线'} · ${meta}`}
                        onClick={() => onOpenMachine?.(m.id)}
                      >
                        <span
                          className="dot"
                          style={{
                            background: m.online ? 'var(--color-success)' : 'var(--color-status-offline)',
                          }}
                        />
                        <span className="sidebar__bot-name">{m.name}</span>
                        <span className="sidebar__bot-state">{meta}</span>
                      </button>
                    </div>
                  )
                })
              : empty('还没有绑定机器')}
          </div>
        </section>
      </div>
      {machines.length ? (
        <div className="sidebar__foot">
          <span
            className="dot"
            style={{ background: online ? 'var(--color-success)' : 'var(--color-status-offline)' }}
          />
          {`${online} 台机器在线`}
        </div>
      ) : null}
    </div>
  )
}
