import { Suspense, useEffect, useRef } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { named } from '../../lib/lazy'
import { Presence } from '../../ui'
import { useBotDialog } from './dialogStore'

const BotDialog = named(() => import('./BotDialog'), 'BotDialog')

/** Mounted once in the shell; `useBotDialog().open(target)` opens BotDialog in place from anywhere. */
export function BotDialogHost() {
  const target = useBotDialog((s) => s.target)
  const close = useBotDialog((s) => s.close)
  const me = useSession((s) => s.user)
  const loaded = useWorkspace((s) => s.loaded)
  const bot = useWorkspace((s) => (target ? s.bots.find((b) => b.id === target.botId) : undefined))
  const seenBotForTarget = useRef<string | null>(null)

  useEffect(() => {
    if (!target) {
      seenBotForTarget.current = null
      return
    }
    if (bot) {
      seenBotForTarget.current = target.botId
      return
    }
    if (seenBotForTarget.current === target.botId || loaded) close()
  }, [target, bot, loaded, close])

  useEffect(() => () => useBotDialog.getState().close(), [])

  return (
    <Presence>
      {target && bot && me ? (
        <Suspense fallback={null}>
          <BotDialog
            key={`${bot.id}:${target.groupId ?? ''}:${target.focus ?? ''}`}
            bot={bot}
            me={me}
            tab={target.tab}
            groupId={target.groupId}
            focus={target.focus}
            onClose={close}
          />
        </Suspense>
      ) : null}
    </Presence>
  )
}
