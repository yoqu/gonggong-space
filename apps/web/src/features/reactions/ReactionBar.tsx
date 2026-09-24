import { AnimatePresence, motion } from 'motion/react'
import { Fragment } from 'react'
import { SPRING } from '../../lib/motion'
import { UserCardTrigger } from '../users'
import { type ReactionTarget, toggleReaction, useReactions } from './store'
import './reactions.css'

const POP = { opacity: 0, scale: 0.6 }
/** Feishu shows up to three reactor names, then the total. */
const SHOWN = 3

/** Emoji pills under a message with who reacted; clicking the emoji toggles mine. Renders nothing without reactions. */
export function ReactionBar({ message }: { message: ReactionTarget }) {
  const reactions = useReactions(message)
  return (
    <AnimatePresence initial={false}>
      {reactions.length ? (
        <motion.div
          key="bar"
          className="reaction-bar"
          role="group"
          aria-label="表情回应"
          initial={POP}
          animate={{ opacity: 1, scale: 1 }}
          exit={POP}
          transition={SPRING.snappy}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {reactions.map((r) => (
              <motion.div
                key={r.emoji}
                layout
                className="reaction-pill"
                data-mine={r.mine || undefined}
                initial={POP}
                animate={{ opacity: 1, scale: 1 }}
                exit={POP}
                transition={SPRING.snappy}
              >
                <button
                  type="button"
                  className="reaction-pill__emoji"
                  aria-pressed={r.mine}
                  aria-label={`${r.emoji} ${r.count}`}
                  onClick={() => void toggleReaction(message.id, reactions, r.emoji)}
                >
                  {r.emoji}
                </button>
                <span className="reaction-pill__users">
                  {r.users.slice(0, SHOWN).map((u, i) => (
                    <Fragment key={u.id}>
                      {i ? '、' : null}
                      <UserCardTrigger
                        userId={u.id}
                        groupId={message.groupId}
                        className="reaction-pill__user"
                      >
                        {u.name}
                      </UserCardTrigger>
                    </Fragment>
                  ))}
                  {r.count > SHOWN ? ` 等 ${r.count} 人` : null}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
