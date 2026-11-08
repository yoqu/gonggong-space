import { type ReactNode, useContext } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ProfileCard } from '../../ui'
import { botFace } from '../bots/avatars'
import { agentLine, PRESENCE } from '../bots/model'
import { ThreadScope } from '../chat/threadSummary'
import { HoverCardTrigger, mentionAction } from './UserCard'
import { useHoverCard } from './useHoverCard'

/** A bot's card: owner, agent and state; @TA while it is in the group. Unknown (deleted) bots get no card. */
export function BotCardTrigger({
  botId,
  groupId,
  tabIndex,
  className,
  children,
}: {
  botId: string
  groupId: string
  tabIndex?: number
  className?: string
  children: ReactNode
}) {
  const hover = useHoverCard()
  const scope = useContext(ThreadScope)
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === botId))
  const inGroup = useWorkspace((s) => !!s.groups.find((g) => g.id === groupId)?.botIds.includes(botId))
  if (!bot) return children
  const live = bot.presence === 'online' || bot.presence === 'running'
  return (
    <HoverCardTrigger
      label={t('Bot 名片')}
      hover={hover}
      tabIndex={tabIndex}
      className={className}
      card={
        <ProfileCard
          name={bot.name}
          avatar={botFace(bot)}
          status={bot.presence === 'running' ? 'busy' : live ? 'online' : 'offline'}
          statusText={PRESENCE[bot.presence].label}
          title={agentLine(bot)}
          tags={[{ label: 'Bot', tone: 'blue' }]}
          fields={[{ label: t('主人'), value: bot.ownerName }]}
          actions={inGroup ? [mentionAction(groupId, bot.name, hover.close, scope)] : undefined}
        />
      }
    >
      {children}
    </HoverCardTrigger>
  )
}
