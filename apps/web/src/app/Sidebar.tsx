import type { BotDto, GroupDto, MachineDto } from '@aiws/protocol'
import { BellOff, Hash, Pin, Plus, User } from 'lucide-react'
import { NavLink } from 'react-router'
import { botStateText, PRESENCE } from '../features/bots/model'
import { cx } from '../lib/cx'
import { Button } from '../ui'

export const GROUP_MODE_LABEL = { partition: '分区模式', force: '强制同步' } as const

export interface SidebarProps {
  groups: GroupDto[]
  bots: BotDto[]
  machines: MachineDto[]
  onNewGroup?: () => void
  onNewDm?: () => void
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
        <Icon size={13} className="muted-icon" />
        <span className="sidebar__name">{g.name}</span>
        {g.pinned ? <Pin size={11} className="muted-icon" data-testid="pinned" aria-label="已置顶" /> : null}
        {g.muted ? <BellOff size={11} className="muted-icon" aria-label="消息免打扰" /> : null}
        {g.unread > 0 ? (
          <span className={cx('sidebar__unread', g.muted && 'sidebar__unread--muted')}>{g.unread}</span>
        ) : null}
      </span>
      <span className="sidebar__sub">{sub}</span>
    </NavLink>
  )
}

/** Pinned first; otherwise the server's order (creation time). */
const byPin = (list: GroupDto[]) => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned))

export function Sidebar({ groups, bots, machines, onNewGroup, onNewDm, onConfirmBot }: SidebarProps) {
  const online = machines.find((m) => m.online)
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
      <div className="sidebar__scroll">
        {lists.map((l) => (
          <section key={l.label}>
            <SectionHead label={l.label} onAdd={l.add} addTitle={l.addTitle} />
            <div className="sidebar__list">
              {l.items.length ? (
                l.items.map((g) => <GroupRow key={g.id} g={g} />)
              ) : (
                <div className="sidebar__empty">{l.empty}</div>
              )}
            </div>
          </section>
        ))}
        <section>
          <SectionHead label="我的 BOT" />
          <div className="sidebar__list">
            {bots.length ? (
              bots.map((b) => (
                <div key={b.id} className="sidebar__bot">
                  <span className="dot" style={{ background: PRESENCE[b.presence].color }} />
                  <span className="sidebar__bot-name">{b.name}</span>
                  <span className="sidebar__bot-state">{botStateText(b)}</span>
                  {b.binding === 'pending_confirm' && onConfirmBot ? (
                    <Button size="xs" variant="primary" onClick={() => onConfirmBot(b.id)}>
                      确认
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="sidebar__empty">还没有 bot</div>
            )}
          </div>
        </section>
      </div>
      <div className="sidebar__foot">
        <span className="dot" style={{ background: online ? '#32D74B' : '#636366' }} />
        {online
          ? `本机 daemon 在线${online.daemonVersion ? ` · v${online.daemonVersion}` : ''}`
          : machines.length
            ? '本机 daemon 离线'
            : '尚未绑定机器'}
      </div>
    </div>
  )
}
