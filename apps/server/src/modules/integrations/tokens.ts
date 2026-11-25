import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'

/** A server-configured token that acts for one team, not for a person. */
export interface IntegrationToken {
  teamId: string
  token: string
}

/** Parses `<teamId>:<token>[,<teamId>:<token>…]`. */
export function integrationTokens(raw: string | undefined): IntegrationToken[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf(':')
      const teamId = pair.slice(0, at).trim()
      const token = pair.slice(at + 1).trim()
      if (at < 1 || token.length < 24)
        throw new Error('integration tokens must look like <teamId>:<token of 24+ chars>')
      return { teamId, token }
    })
}

const same = (a: string, b: string) => timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)))

/** The team the request's Bearer token acts for. */
export function integrationTeam(tokens: IntegrationToken[], req: FastifyRequest) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization?.trim() ?? '')
  const found = m && tokens.find((t) => same(t.token, m[1]!))
  return found ? found.teamId : fail('unauthorized', '集成令牌无效')
}
