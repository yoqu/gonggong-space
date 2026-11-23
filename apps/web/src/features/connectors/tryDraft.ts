import type { BotDto, ConnectorDto } from '@gonggong/protocol'

/**
 * The composer text after 去试试 / an example: the example appended to what is there, @-ing a bot that can use the
 * connector when nothing @s one yet (the bot only answers when @-ed outside a dm with a single bot). Missing only my
 * connection still counts: the bot then sends me the connect card.
 */
export function tryDraft(
  draft: string,
  example: string,
  c: Pick<ConnectorDto, 'bots'>,
  bots: Pick<BotDto, 'id' | 'name'>[],
  needsMention: boolean,
) {
  const text = draft.trim() ? `${draft.trimEnd()}\n${example}` : example
  if (!needsMention || !bots.length) return text
  const usable = (b: { id: string }) => {
    const blocker = c.bots.find((x) => x.botId === b.id)?.blocker
    return !blocker || blocker === 'secret'
  }
  const bot = bots.find(usable) ?? bots[0]!
  return `@${bot.name} ${text}`
}
