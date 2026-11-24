import { useRef } from 'react'
import { t } from '../../i18n'
import { Icon, RollingNumber, usePresence } from '../../ui'

/** Top jump-to-first-unread pill with smooth enter/exit presence. */
export function TopUnreadPill({
  show,
  count,
  onClick,
}: {
  show: boolean
  count: number
  onClick: () => void
}) {
  const { mounted, state, onAnimationEnd } = usePresence(show)
  const lastCount = useRef(count)
  if (count > 0) lastCount.current = count
  if (!mounted) return null
  const shown = count > 0 ? count : lastCount.current
  const closing = state === 'closed'
  return (
    <button
      type="button"
      className="chat-scroll__pill chat-scroll__pill--top"
      data-state={state}
      aria-hidden={closing || undefined}
      inert={closing}
      onAnimationEnd={onAnimationEnd}
      onClick={onClick}
    >
      <Icon name="chevron-up" size={13} />
      {t('{n} 条新消息 · 跳到首条', { n: shown >= 100 ? '99+' : shown })}
    </button>
  )
}

/** Bottom unseen-count pill and jump-to-bottom button with smooth enter/exit presence. */
export function BottomScrollPill({
  unseen,
  away,
  onClick,
}: {
  unseen: number
  away: boolean
  onClick: () => void
}) {
  const pill = usePresence(unseen > 0)
  const bottom = usePresence(unseen === 0 && away)
  const lastUnseen = useRef(unseen)
  if (unseen > 0) lastUnseen.current = unseen
  const shownUnseen = unseen > 0 ? unseen : lastUnseen.current
  const pillClosing = pill.state === 'closed'
  const bottomClosing = bottom.state === 'closed'
  return (
    <>
      {pill.mounted ? (
        <button
          type="button"
          className="chat-scroll__pill"
          data-state={pill.state}
          aria-hidden={pillClosing || undefined}
          inert={pillClosing}
          onAnimationEnd={pill.onAnimationEnd}
          onClick={onClick}
        >
          <Icon name="chevron-down" size={13} />
          <span className="chat-scroll__count">
            <RollingNumber value={t('{n} 条新消息', { n: shownUnseen })} />
          </span>
        </button>
      ) : null}
      {bottom.mounted ? (
        <button
          type="button"
          className="chat-scroll__bottom"
          data-state={bottom.state}
          aria-hidden={bottomClosing || undefined}
          inert={bottomClosing}
          aria-label={t('回到底部')}
          title={t('回到底部')}
          onAnimationEnd={bottom.onAnimationEnd}
          onClick={onClick}
        >
          <Icon name="chevron-down" size={16} weight={2} />
        </button>
      ) : null}
    </>
  )
}
