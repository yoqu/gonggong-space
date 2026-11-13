import type { RunEvent } from '@gonggong/protocol'
import { open, seal } from '../../lib/seal.js'

/** Free text of the run process (streamed output, tool details, MCP I/O and web search hits, subagent prompts, task and compaction summaries) is sealed at rest;
 * kind, status, names, tool titles and steps stay plain so search can match them. */
const mapText = (e: RunEvent, f: (s: string) => string): RunEvent => {
  switch (e.kind) {
    case 'text':
    case 'thought':
      return { ...e, delta: f(e.delta) }
    case 'tool': {
      const { detail, mcp, web } = e
      return {
        ...e,
        ...(web?.hits && {
          web: { ...web, hits: web.hits.map((h) => ({ title: f(h.title), url: f(h.url) })) },
        }),
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
    case 'compaction': {
      const { summary, error } = e
      return {
        ...e,
        ...(summary !== undefined && { summary: f(summary) }),
        ...(error !== undefined && { error: f(error) }),
      }
    }
    default:
      return e
  }
}

export const sealEvent = (e: RunEvent) => mapText(e, seal)
export const openEvent = (e: RunEvent) => mapText(e, open)
