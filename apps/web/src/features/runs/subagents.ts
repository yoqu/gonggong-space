import type { PersonaRole } from '../bots/avatars'
import { PERSONAS } from '../bots/personas'
import type { Step } from './steps'

export interface SubagentFace {
  role: PersonaRole
  /** The persona's gradient start: the lane's line and highlight. */
  from: string
}

const fnv = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const allSubagents = (steps: Step[]): Step[] =>
  steps.flatMap((s) => [...(s.kind === 'subagent' ? [s] : []), ...allSubagents(s.children ?? [])])

/**
 * Each subagent of a run wears one of the personas, by step key: its agent id hashed, moved on to the next free one
 * in spawn order, so up to twelve never share a face and a reload or a look back gives the same ones.
 */
export function subagentFaces(steps: Step[]): Map<string, SubagentFace> {
  const subs = allSubagents(steps).sort(
    (a, b) => Date.parse(a.at ?? '') - Date.parse(b.at ?? '') || a.key.localeCompare(b.key, 'en'),
  )
  const n = PERSONAS.length
  const used = new Set<number>()
  const faces = new Map<string, SubagentFace>()
  for (const s of subs) {
    if (used.size === n) used.clear()
    let i = fnv(s.agent ?? s.key) % n
    while (used.has(i)) i = (i + 1) % n
    used.add(i)
    const p = PERSONAS[i] as (typeof PERSONAS)[number]
    faces.set(s.key, { role: `role-${p.key}` as PersonaRole, from: p.from })
  }
  return faces
}
