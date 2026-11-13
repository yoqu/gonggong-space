import type { BotDto, BotRecentDto, UserBriefDto } from '@gonggong/protocol'
import { type ReactElement, type ReactNode, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { matchAny } from '../../lib/match'
import { useGet } from '../../lib/useGet'
import { Button, Icon, type Placement, Popover, SearchField } from '../../ui'
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

/** Mine first, the most recently used on top (then by name); everyone else's by name. */
export function groupBots(bots: BotDto[], meId: string | undefined, recent: BotRecentDto[]) {
  const byName = (a: BotDto, b: BotDto) => a.name.localeCompare(b.name, 'zh-CN')
  const used = new Map(recent.map((r) => [r.botId, r.lastUsedAt]))
  const mine = bots
    .filter((b) => b.ownerId === meId)
    .sort((a, b) => (used.get(b.id) ?? '').localeCompare(used.get(a.id) ?? '') || byName(a, b))
  return { mine, others: bots.filter((b) => b.ownerId !== meId).sort(byName) }
}

/**
 * Checklist of Bots in a popover, mine and others' in two sections; stays open so several can be toggled (`close`
 * hands off to a dialog). Unbound Bots cannot be picked.
 */
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
  const meId = useSession((s) => s.user?.id)
  const [q, setQ] = useState('')
  const [opened, setOpened] = useState(false)
  const recent = useGet<BotRecentDto[]>(opened ? '/bots/recent' : null)
  const shown = bots.filter((b) => matchAny(q, b.name, b.ownerName, AGENT_LABEL[b.agentKind]))
  const { mine, others } = groupBots(shown, meId, recent.data ?? [])
  const row = (b: BotDto, close: () => void) => {
    const on = isOn(b.id)
    return (
      <button
        key={b.id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        disabled={b.binding !== 'bound'}
        title={
          b.binding === 'bound' ? undefined : t('{state}，暂不能拉入', { state: BINDING_LABEL[b.binding] })
        }
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
  }
  const section = (label: string, list: BotDto[], close: () => void) =>
    list.length ? (
      <fieldset className="pick__group" aria-label={label}>
        <legend className="pick__heading">{label}</legend>
        {list.map((b) => row(b, close))}
      </fieldset>
    ) : null
  return (
    <Popover
      portal
      width={360}
      aria-label={t('添加 Bot')}
      placement={placement}
      className={className}
      onOpenChange={(open) => {
        if (!open) return
        setQ('')
        if (opened) recent.reload()
        else setOpened(true)
      }}
      trigger={trigger}
    >
      {(close) => (
        <fieldset className="pick" aria-label={t('可添加的 Bot')}>
          <SearchField aria-label={t('搜索 Bot')} value={q} onChange={setQ} />
          {section(t('我的 Bot'), mine, close)}
          {section(t('其他成员的 Bot'), others, close)}
          {shown.length ? null : (
            <span className="pick__empty">{bots.length ? t('没有匹配的 Bot') : t('还没有可拉入的 Bot')}</span>
          )}
        </fieldset>
      )}
    </Popover>
  )
}

/** Searchable checklist of users in a popover; 添加 hands over the ticked ones at once and closes. `status` replaces
 * the empty hint (e.g. a load error). */
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
  onAdd: (ids: string[]) => void
  status?: ReactNode
  defaultOpen?: boolean
  onOpen?: () => void
  placement?: Placement
  className?: string
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const list = users.filter((u) => matchAny(q, u.name, u.account))
  // Candidates that left the list (added elsewhere meanwhile) are not handed over.
  const chosen = picked.filter((id) => users.some((u) => u.id === id))
  return (
    <Popover
      portal
      width={260}
      aria-label={t('添加成员')}
      placement={placement}
      className={className}
      defaultOpen={defaultOpen}
      onOpenChange={(open) => {
        if (!open) return
        setQ('')
        setPicked([])
        onOpen?.()
      }}
      trigger={trigger}
    >
      {(close) => (
        <>
          <div className="pick">
            <SearchField aria-label={t('搜索成员')} value={q} onChange={setQ} />
            {list.map((u) => {
              const on = picked.includes(u.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  className="pick__row"
                  onClick={() => setPicked(on ? picked.filter((id) => id !== u.id) : [...picked, u.id])}
                >
                  <span className="pick__check">
                    {on ? <Icon name="check" size={12} weight={2} /> : null}
                  </span>
                  <span className="pick__main">
                    <span className="pick__name">{u.name}</span>
                    <span className="pick__sub">{u.account}</span>
                  </span>
                </button>
              )
            })}
            {list.length ? null : (status ?? <span className="pick__empty">{t('没有可添加的成员')}</span>)}
          </div>
          <div className="pick__foot">
            <Button
              size="small"
              variant="primary"
              disabled={!chosen.length}
              onClick={() => {
                onAdd(chosen)
                close()
              }}
            >
              {chosen.length ? t('添加 {n} 人', { n: chosen.length }) : t('添加')}
            </Button>
          </div>
        </>
      )}
    </Popover>
  )
}
