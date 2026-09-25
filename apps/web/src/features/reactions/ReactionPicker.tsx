import { REACTION_EMOJIS, type ReactionEmoji } from '@gonggong/protocol'
import { EmojiPicker, Icon, Popover } from '../../ui'
import { type ReactionTarget, toggleReaction, useReactions } from './store'
import './reactions.css'

/** Hover-bar button opening the Pane EmojiPicker on the fixed set the server accepts; mine are marked. */
export function ReactionPicker({
  message,
  open,
  onOpenChange,
}: {
  message: ReactionTarget
  /** Controlled by the message row, so its context menu can open the picker too. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const reactions = useReactions(message)
  const mine = reactions.filter((r) => r.mine).map((r) => r.emoji)
  return (
    <Popover
      className="reaction-picker"
      placement="top-end"
      open={open}
      onOpenChange={onOpenChange}
      aria-label="表情回应"
      trigger={
        <button type="button" title="添加表情回应" aria-label="添加表情回应">
          <Icon name="smile" />
        </button>
      }
    >
      {(close) => (
        <EmojiPicker
          only={REACTION_EMOJIS}
          selected={mine}
          onSelect={(emoji) => {
            close()
            void toggleReaction(message.id, reactions, emoji as ReactionEmoji)
          }}
        />
      )}
    </Popover>
  )
}
