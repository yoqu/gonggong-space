import type { BotDto, UserBriefDto } from '@gonggong/protocol'
import { type ReactElement, type ReactNode, useState } from 'react'
import { Icon, type Placement, Popover, SearchField } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { AGENT_LABEL, BINDING_LABEL, PRESENCE } from '../bots/model'
import './pickers.css'

/** Presence dot and label; an unbound Bot shows its binding state instead. */
export function BotPresence({ bot }: { bot: BotDto }) {
  const st =
    bot.binding === 'bound'
      ? PRESENCE[bot.presence]
      : { label: BINDING_LABEL[bot.binding], color: 'var(--system-orange)' }
  return (
    <span className="pick-presence">
      <span className="dot dot--sm" style={{ background: st.color }} />
      {st.label}
    </span>
  )
}

/** Checklist of Bots in a popover; stays open so several can be toggled (`close` hands off to a dialog). Unbound Bots cannot be picked. */
export function BotPicker({
  trigger,
  bots,
  isOn,
  onPick,
  note,
  placement,
  className,
}: {
  trigger: ReactElement
  bots: BotDto[]
  isOn: (id: string) => boolean
  onPick: (bot: BotDto, close: () => void) => void
  note?: (bot: BotDto) => string
  placement?: Placement
  className?: string
}) {
  return (
    <Popover
      portal
      width={360}
      aria-label="添加 Bot"
      placement={placement}
      className={className}
      trigger={trigger}
    >
      {(close) => (
        <fieldset className="pick" aria-label="可添加的 Bot">
          {bots.map((b) => {
            const on = isOn(b.id)
            return (
              <button
                key={b.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                disabled={b.binding !== 'bound'}
                title={b.binding === 'bound' ? undefined : `${BINDING_LABEL[b.binding]}，暂不能拉入`}
                className="pick__row"
                onClick={() => onPick(b, close)}
              >
                <span className="pick__check">{on ? <Icon name="check" size={12} weight={2} /> : null}</span>
                <BotAvatar id={b.id} name={b.name} size={20} />
                <span className="pick__main">
                  <span className="pick__name">{b.name}</span>
                  <span className="pick__sub">
                    {AGENT_LABEL[b.agentKind]} · {b.ownerName}
                    {note?.(b)}
                  </span>
                </span>
                <BotPresence bot={b} />
              </button>
            )
          })}
          {bots.length ? null : <span className="pick__empty">还没有可拉入的 Bot</span>}
        </fieldset>
      )}
    </Popover>
  )
}

/** Searchable user list in a popover; closes on pick. `status` replaces the empty hint (e.g. a load error). */
export function MemberPicker({
  trigger,
  users,
  onAdd,
  status,
  defaultOpen,
  onOpen,
  placement,
  className,
}: {
  trigger: ReactElement
  users: UserBriefDto[]
  onAdd: (id: string) => void
  status?: ReactNode
  defaultOpen?: boolean
  onOpen?: () => void
  placement?: Placement
  className?: string
}) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const list = users.filter((u) => !needle || `${u.name} ${u.account}`.toLowerCase().includes(needle))
  return (
    <Popover
      portal
      width={240}
      aria-label="添加成员"
      placement={placement}
      className={className}
      defaultOpen={defaultOpen}
      onOpenChange={(open) => open && onOpen?.()}
      trigger={trigger}
    >
      {(close) => (
        <div className="pick">
          <SearchField aria-label="搜索成员" value={q} onChange={setQ} />
          {list.map((u) => (
            <button
              key={u.id}
              type="button"
              className="pick__row"
              onClick={() => {
                onAdd(u.id)
                setQ('')
                close()
              }}
            >
              <span className="pick__main">
                <span className="pick__name">{u.name}</span>
                <span className="pick__sub">{u.account}</span>
              </span>
            </button>
          ))}
          {list.length ? null : (status ?? <span className="pick__empty">没有可添加的成员</span>)}
        </div>
      )}
    </Popover>
  )
}
