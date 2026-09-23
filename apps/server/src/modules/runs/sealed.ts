import type { RunEvent } from '@aiws/protocol'
import { open, seal } from '../../lib/seal.js'

/** Free text of the run process (streamed output, tool details) is sealed at rest; kind, status, tool titles and
 * steps stay plain so search can match them. */
const mapText = (e: RunEvent, f: (s: string) => string): RunEvent =>
  e.kind === 'text' || e.kind === 'thought'
    ? { ...e, delta: f(e.delta) }
    : e.kind === 'tool' && e.detail !== undefined
      ? { ...e, detail: f(e.detail) }
      : e

export const sealEvent = (e: RunEvent) => mapText(e, seal)
export const openEvent = (e: RunEvent) => mapText(e, open)
