import { REACTION_EMOJIS } from '@gonggong/protocol'
import { useState } from 'react'
import { Icon, useEscape, usePresence } from '../../ui'
import { type ReactionTarget, toggleReaction, useReactions } from './store'
import './reactions.css'

/** Hover-bar button opening the fixed emoji set; `onOpenChange` lets the bar stay visible while it is open. */
export function ReactionPicker({
  message,
  onOpenChange,
}: {
  message: ReactionTarget
  onOpenChange?: (open: boolean) => void
}) {
  const reactions = useReactions(message)
  const [open, setOpenState] = useState(false)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  useEscape(() => setOpen(false), open)
  const menu = usePresence(open)
  const mine = new Set(reactions.filter((r) => r.mine).map((r) => r.emoji))

  return (
    <div className="reaction-picker">
      <button
        type="button"
        title="添加表情回应"
        aria-label="添加表情回应"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="smile" />
      </button>
      {menu.mounted ? (
        <>
          {open ? (
            <div className="reaction-picker__backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          ) : null}
          <div
            role="menu"
            aria-label="表情回应"
            className="reaction-picker__menu ui-popover"
            data-state={menu.state}
            onAnimationEnd={menu.onAnimationEnd}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="menuitemcheckbox"
                aria-checked={mine.has(emoji)}
                className="reaction-picker__item"
                onClick={() => {
                  setOpen(false)
                  void toggleReaction(message.id, reactions, emoji)
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
