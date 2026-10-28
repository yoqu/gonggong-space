import type { BotDto, MachineDto } from '@gonggong/protocol'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { BotAvatar } from '../features/bots/avatars'
import { botStateText, PRESENCE } from '../features/bots/model'
import { OS_LABEL } from '../features/machines/model'
import { t } from '../i18n'
import { Button, Toolbar, ToolbarButton, ToolbarGroup } from '../ui'
import { Footer, SectionHead } from './Sidebar'

/** Routes shown with 我的机器管理 in place of the conversation list. */
export const isMachinesPath = (pathname: string) => /^\/(machines|machine\/|bot\/)/.test(pathname)

function BotRow({
  b,
  meta,
  nested,
  action,
}: {
  b: BotDto
  meta: string
  nested?: boolean
  action?: ReactNode
}) {
  return (
    <div className={nested ? 'sidebar__row sidebar__row--nested' : 'sidebar__row'}>
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

function MachineRow({ m, bots }: { m: MachineDto; bots: number }) {
  const meta = [OS_LABEL[m.os], bots && t('{n} 个 Bot', { n: bots })].filter(Boolean).join(' · ')
  return (
    <div className="sidebar__row">
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
}

/** 我的机器管理: my machines, each with the bots on it, then my bots without one of my machines and those shared with me. */
export function MachineSidebar({
  bots,
  sharedBots,
  machines,
  loaded,
  onBindMachine,
  onNewBot,
  onConfirmBot,
}: {
  bots: BotDto[]
  sharedBots: BotDto[]
  machines: MachineDto[]
  loaded?: boolean
  onBindMachine: () => void
  onNewBot: () => void
  /** Confirms a bot someone else created for me (shown on my pending_confirm bots). */
  onConfirmBot: (botId: string) => void
}) {
  const row = (b: BotDto, nested?: boolean) => (
    <BotRow
      key={b.id}
      b={b}
      nested={nested}
      meta={botStateText(b)}
      action={
        b.binding === 'pending_confirm' ? (
          <Button size="small" variant="primary" onClick={() => onConfirmBot(b.id)}>
            {t('确认')}
          </Button>
        ) : null
      }
    />
  )
  const unplaced = bots.filter((b) => !machines.some((m) => m.id === b.machineId))
  return (
    <div className="sidebar">
      <div className="shellbar">
        <Toolbar title={t('我的机器管理')} scrolled={false}>
          <ToolbarGroup>
            <ToolbarButton icon="bot" label={t('新建 Bot…')} onClick={onNewBot} />
            <ToolbarButton icon="plus" label={t('绑定新机器')} onClick={onBindMachine} />
          </ToolbarGroup>
        </Toolbar>
      </div>
      <div className="sidebar__scroll">
        <div>
          <section aria-label={t('我的机器')}>
            <SectionHead label={t('我的机器')} />
            <div className="sidebar__list">
              {machines.length
                ? machines.map((m) => {
                    const on = bots.filter((b) => b.machineId === m.id)
                    return (
                      <div key={m.id} className="sidebar__machine">
                        <MachineRow m={m} bots={on.length} />
                        {on.map((b) => row(b, true))}
                      </div>
                    )
                  })
                : loaded
                  ? <div className="sidebar__empty">{t('还没有绑定机器')}</div>
                  : null}
            </div>
          </section>
          {unplaced.length ? (
            <section aria-label={t('未绑定机器的 Bot')}>
              <SectionHead label={t('未绑定机器的 Bot')} />
              <div className="sidebar__list">{unplaced.map((b) => row(b))}</div>
            </section>
          ) : null}
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
        </div>
      </div>
      <Footer bots={bots} machines={machines} />
    </div>
  )
}
