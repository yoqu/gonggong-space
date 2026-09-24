import type { UserCardDto } from '@aiws/protocol'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Avatar, Badge, Spinner, usePresence } from '../../ui'
import { ROLE_LABEL } from '../auth/AccountMenu'
import { useHoverCard } from './useHoverCard'
import './users.css'

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
function place(anchor: DOMRect, card: HTMLElement): CSSProperties {
  const { offsetWidth: w, offsetHeight: h } = card
  const below = anchor.bottom + GAP
  const top = below + h > window.innerHeight - MARGIN ? Math.max(MARGIN, anchor.top - GAP - h) : below
  const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - MARGIN - w))
  return { top, left, transformOrigin: top < anchor.top ? 'bottom left' : 'top left' }
}

/**
 * Wraps a user's name or avatar; hovering or focusing it shows their card (portaled to <body> so its glass samples the
 * page, not a glass ancestor). `tabIndex={-1}` for a second trigger of the same user next to a focusable one.
 */
export function UserCardTrigger({
  userId,
  groupId,
  tabIndex = 0,
  className,
  children,
}: {
  userId: string
  groupId?: string
  tabIndex?: number
  className?: string
  children: ReactNode
}) {
  const { open, close, triggerProps, cardProps } = useHoverCard()
  const presence = usePresence(open)
  const { card, error } = useCard(userId, groupId, presence.mounted)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>()

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-place when the content (and so the size) changes
  useLayoutEffect(() => {
    if (open && anchor.current && panel.current)
      setStyle(place(anchor.current.getBoundingClientRect(), panel.current))
  }, [open, card, error])

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
      {presence.mounted
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              aria-label="用户名片"
              className="user-card ui-popover"
              style={style}
              data-state={presence.state}
              onAnimationEnd={presence.onAnimationEnd}
              {...cardProps}
            >
              {card ? (
                <>
                  <div className="user-card__head">
                    <Avatar name={card.name} size={40} />
                    <div className="user-card__id">
                      <div className="user-card__name">
                        <span>{card.name}</span>
                        {card.groupAdmin ? (
                          <Badge variant="info" size="xs">
                            群管理员
                          </Badge>
                        ) : null}
                      </div>
                      <div className="user-card__account">{card.account}</div>
                    </div>
                  </div>
                  <dl className="user-card__meta">
                    <dt>角色</dt>
                    <dd>{ROLE_LABEL[card.role]}</dd>
                    <dt>状态</dt>
                    <dd>
                      <span className="user-card__dot" data-online={card.online || undefined} />
                      {card.online ? '在线' : '离线'}
                    </dd>
                  </dl>
                </>
              ) : (
                <div className="user-card__status">{error ?? <Spinner />}</div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
