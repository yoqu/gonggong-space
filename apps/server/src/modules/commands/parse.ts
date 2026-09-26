import { scanMentions } from '../messages/mentions.js'

export interface ParsedCommand {
  /** Case-sensitive, as typed after `/`. */
  name: string
  /** Mentioned bot ids, deduped, in order of appearance. */
  mentions: string[]
  /** Everything else with mentions removed, trimmed. */
  args: string
}

/**
 * `/<name> [@bot …] [args]`, optionally after leading mentions (`@bot /<name> …`) — the composer offers `/`
 * candidates in both positions; null otherwise.
 */
export function parseCommand(body: string, bots: { id: string; name: string }[]): ParsedCommand | null {
  const spans = scanMentions(body, bots)
  // Consume mentions typed before the slash: they are targets too.
  let head = 0
  let lead = 0
  for (const s of spans) {
    if (body.slice(head, s.start).trim()) break
    head = s.end
    lead += 1
  }
  const m = /^\s*\/(\S+)/.exec(body.slice(head))
  const name = m?.[1]
  if (!m || !name) return null
  // Mentions inside the command token itself (`/new@codex`) stay part of the name.
  const start = head + m[0].length
  const after = spans.slice(lead).filter((s) => s.start >= start)
  let args = ''
  let from = start
  for (const s of after) {
    args += body.slice(from, s.start)
    from = s.end
  }
  args += body.slice(from)
  const mentions = [...spans.slice(0, lead), ...after].map((s) => s.id)
  return { name, mentions: [...new Set(mentions)], args: args.trim() }
}
