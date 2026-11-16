import { type ReactNode, useContext } from 'react'
import { Link } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { ProfileCard } from '../../ui'
import { botFace } from '../bots/avatars'
import { agentLine, PRESENCE, presenceBadge } from '../bots/model'
import { startNewSession } from '../chat/newSession'
import { ThreadScope } from '../chat/threadSummary'
import { HoverCardTrigger, mentionAction } from './UserCard'
import { useHoverCard } from './useHoverCard'

const INTRO_MAX = 50

/**
 * The system prompt as a one-paragraph intro, cut at INTRO_MAX: a heading leads what follows (`角色：`), list and
 * emphasis marks go without leaving gaps, and no space follows Chinese punctuation.
 */
export function botIntro(prompt: string) {
  const text = prompt
    .replace(/^\s*#+\s*(.*?)\s*#*\s*$/gm, '$1：')
    .replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*|__|[*`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/([：，。；！？、）])\s+/g, '$1')
    .replace(/：$/, '')
    .trim()
  if (!text) return null
  const cut = [...text].length > INTRO_MAX
  return { text: cut ? `${[...text].slice(0, INTRO_MAX).join('')}…` : text, cut }
}

/**
 * A bot's card: owner, agent, state and its system prompt as intro; @TA and 新对话 while it is in the group.
 * Unknown (deleted) bots get no card.
 */
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
  const intro = botIntro(bot.systemPrompt)
  const renew = () => {
    hover.close()
    startNewSession(groupId, bot.name, scope).catch(toastError)
  }
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
          status={presenceBadge(bot).status}
          statusText={PRESENCE[bot.presence].label}
          title={agentLine(bot)}
          tags={[{ label: 'Bot', tone: 'blue' }]}
          fields={[
            { label: t('主人'), value: bot.ownerName },
            ...(intro
              ? [
                  {
                    label: t('简介'),
                    value: (
                      <span className="bot-card__intro">
                        {intro.text}
                        {intro.cut ? (
                          <Link to={`/bot/${bot.id}`} onClick={hover.close}>
                            {t('完整内容见 Bot 详情')}
                          </Link>
                        ) : null}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
          actions={
            inGroup
              ? [
                  mentionAction(groupId, bot.name, hover.close, scope),
                  { label: t('新对话'), icon: 'arrow-clockwise', variant: 'default', onClick: renew },
                ]
              : undefined
          }
        />
      }
    >
      {children}
    </HoverCardTrigger>
  )
}
