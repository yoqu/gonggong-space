/** Explicit `@<bot name>` mentions in order of appearance, deduped. Longest name wins at each `@`. */
export function parseMentions(body: string, bots: { id: string; name: string }[]): string[] {
  const byLength = [...bots].sort((a, b) => b.name.length - a.name.length)
  const found: string[] = []
  for (let i = body.indexOf('@'); i !== -1; i = body.indexOf('@', i + 1)) {
    // Skip e-mail addresses like a@b.com.
    if (/[A-Za-z0-9._%+-]/.test(body[i - 1] ?? '')) continue
    const hit = byLength.find((b) => b.name && body.startsWith(b.name, i + 1))
    if (!hit) continue
    if (!found.includes(hit.id)) found.push(hit.id)
    i += hit.name.length
  }
  return found
}
