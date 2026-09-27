import type { RunEvent } from '@gonggong/protocol'
import { open, seal } from '../../lib/seal.js'

/** Free text of the run process (streamed output, tool details and MCP I/O, subagent prompts, task summaries) is sealed at rest;
 * kind, status, names, tool titles and steps stay plain so search can match them. */
const mapText = (e: RunEvent, f: (s: string) => string): RunEvent => {
  switch (e.kind) {
    case 'text':
    case 'thought':
      return { ...e, delta: f(e.delta) }
    case 'tool': {
      const { detail, mcp } = e
      return {
        ...e,
        ...(detail !== undefined && { detail: f(detail) }),
        ...(mcp && {
          mcp: {
            ...mcp,
            ...(mcp.input !== undefined && { input: f(mcp.input) }),
            ...(mcp.output !== undefined && { output: f(mcp.output) }),
          },
        }),
      }
    }
    case 'subagent':
      return { ...e, task: f(e.task) }
    case 'task':
      return e.summary === undefined ? e : { ...e, summary: f(e.summary) }
    default:
      return e
  }
}

export const sealEvent = (e: RunEvent) => mapText(e, seal)
export const openEvent = (e: RunEvent) => mapText(e, open)
