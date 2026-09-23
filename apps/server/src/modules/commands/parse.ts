import { scanMentions } from '../messages/mentions.js'

export interface ParsedCommand {
  /** Case-sensitive, as typed after `/`. */
  name: string
  /** Mentioned bot ids, deduped. */
  mentions: string[]
  /** Everything else with mentions removed, trimmed. */
  args: string
}

/** `/<name> [@bot …] [args]` at the start of a message (leading whitespace allowed); null otherwise. */
export function parseCommand(body: string, bots: { id: string; name: string }[]): ParsedCommand | null {
  const m = /^\s*\/(\S+)/.exec(body)
  const name = m?.[1]
  if (!m || !name) return null
  const rest = body.slice(m[0].length)
  const spans = scanMentions(rest, bots)
  let args = ''
  let from = 0
  for (const s of spans) {
    args += rest.slice(from, s.start)
    from = s.end
  }
  args += rest.slice(from)
  return { name, mentions: [...new Set(spans.map((s) => s.id))], args: args.trim() }
}
