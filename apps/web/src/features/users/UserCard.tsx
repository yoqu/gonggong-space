import type { UserCardDto } from '@gonggong/protocol'
import {
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Float, ProfileCard, Spinner } from '../../ui'
import { ROLE_LABEL } from '../auth/AccountMenu'
import { mentionInChat } from '../chat/mention'
import { ThreadScope } from '../chat/threadSummary'
import { useHoverCard } from './useHoverCard'
import './users.css'
import { t } from '../../i18n'

/** Loaded cards by `groupId:userId` (group admin differs per group); kept for the session. */
const useCards = create<Record<string, UserCardDto>>()(() => ({}))

function useCard(userId: string, groupId: string | undefined, enabled: boolean) {
  const key = `${groupId ?? ''}:${userId}`
  const card = useCards((s) => s[key])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || card) return
    let live = true
    setError(null)
    api.get<UserCardDto>(`/users/${userId}/card${groupId ? `?groupId=${groupId}` : ''}`).then(
      (c) => useCards.setState({ [key]: c }),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [enabled, card, key, userId, groupId])
  return { card, error }
}

const GAP = 6
const MARGIN = 8

/** Below the anchor, flipped above when it would overflow, and kept inside the viewport horizontally. */
function place(anchor: DOMRect, card: HTMLElement): { style: CSSProperties; above: boolean } {
  const { offsetWidth: w, offsetHeight: h } = card
  const below = anchor.bottom + GAP
  const top = below + h > window.innerHeight - MARGIN ? Math.max(MARGIN, anchor.top - GAP - h) : below
  const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - MARGIN - w))
  return { style: { top, left }, above: top < anchor.top }
}

/**
 * A trigger wrapping a name or avatar; hovering or focusing it shows `card` in the shared popover panel, portaled to
 * <body> and fixed at the anchor so it is neither clipped by the timeline nor sampling a glass ancestor. `version`
 * changes when the card's content (and so its size) does. `tabIndex={-1}` for a second trigger of the same target
 * next to a focusable one.
 */
export function HoverCardTrigger({
  label,
  hover,
  card,
  version,
  tabIndex = 0,
  className,
  children,
}: {
  label: string
  hover: ReturnType<typeof useHoverCard>
  card: ReactNode
  version?: unknown
  tabIndex?: number
  className?: string
  children: ReactNode
}) {
  const { open, close, triggerProps, cardProps } = hover
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<ReturnType<typeof place>>()

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-place when the content (and so the size) changes
  useLayoutEffect(() => {
    if (open && anchor.current && panel.current)
      setSpot(place(anchor.current.getBoundingClientRect(), panel.current))
  }, [open, version])

  useEffect(() => {
    if (!open) return
    // A fixed card would drift from its anchor while the timeline scrolls.
    window.addEventListener('scroll', close, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [open, close])

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={cx('user-card-trigger', className)}
        tabIndex={tabIndex}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...triggerProps}
      >
        {children}
      </button>
      {createPortal(
        <Float
          ref={panel}
          open={open}
          placement={spot?.above ? 'top-start' : 'bottom-start'}
          role="dialog"
          aria-label={label}
          className="ui-popover user-card"
          style={spot?.style}
          {...cardProps}
        >
          {card}
        </Float>,
        document.body,
      )}
    </>
  )
}

/** The @TA action of a card shown in a group: hands the name to that group's composer and closes the card. */
export const mentionAction = (groupId: string, name: string, close: () => void, scope?: string) => ({
  label: t('@TA'),
  onClick: () => {
    mentionInChat(groupId, name, scope)
    close()
  },
})

/** A user's card; in a group it offers @TA, except on my own. */
export function UserCardTrigger({
  userId,
  groupId,
  tabIndex,
  className,
  children,
}: {
  userId: string
  groupId?: string
  tabIndex?: number
  className?: string
  children: ReactNode
}) {
  const hover = useHoverCard()
  const scope = useContext(ThreadScope)
  const me = useSession((s) => s.user?.id)
  const [wanted, setWanted] = useState(false)
  if (hover.open && !wanted) setWanted(true)
  const { card, error } = useCard(userId, groupId, wanted)
  return (
    <HoverCardTrigger
      label={t('用户名片')}
      hover={hover}
      version={card ?? error}
      tabIndex={tabIndex}
      className={className}
      card={
        card ? (
          <ProfileCard
            name={card.name}
            avatar={card.avatar ?? undefined}
            status={card.online ? 'online' : 'offline'}
            statusText={card.online ? t('在线') : t('离线')}
            title={card.account}
            tags={card.groupAdmin ? [{ label: t('群管理员'), tone: 'blue' }] : undefined}
            fields={[{ label: t('角色'), value: ROLE_LABEL[card.role] }]}
            actions={
              groupId && userId !== me ? [mentionAction(groupId, card.name, hover.close, scope)] : undefined
            }
          />
        ) : (
          <div className="user-card__status">{error ?? <Spinner />}</div>
        )
      }
    >
      {children}
    </HoverCardTrigger>
  )
}
