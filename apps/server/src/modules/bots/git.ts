import type { bots } from '../../db/schema.js'

type Bot = Pick<typeof bots.$inferSelect, 'id' | 'name' | 'gitName' | 'gitEmail'>

export const defaultGitEmail = (botId: string) =>
  `${botId.slice(0, 8)}@${process.env.GONGGONG_BOT_EMAIL_DOMAIN || 'bots.gonggong.local'}`

/** Author and committer of the bot's git commits (plan G1/G2). */
export const gitIdentity = (bot: Bot) => ({
  name: bot.gitName ?? bot.name,
  email: bot.gitEmail ?? defaultGitEmail(bot.id),
})
