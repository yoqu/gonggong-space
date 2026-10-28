import type { LiveRun } from '@gonggong/protocol'
import { t } from '../i18n'
import type { MascotAction, TagTone } from '../ui'

/** What a live run needs, most urgent first: the conversation shows the top one. */
const LEVELS = ['approve_me', 'answer', 'approve_other', 'running', 'queued'] as const
export type ActivityLevel = (typeof LEVELS)[number]

export function levelOf(r: LiveRun): ActivityLevel {
  if (r.status === 'awaiting_approval') return r.needsMe ? 'approve_me' : 'approve_other'
  if (r.status === 'awaiting_answer') return 'answer'
  return r.status === 'queued' ? 'queued' : 'running'
}

const LOOK: Record<ActivityLevel, { label: () => string; tone: TagTone; action: MascotAction }> = {
  approve_me: { label: () => t('待审批'), tone: 'orange', action: 'raise' },
  answer: { label: () => t('待回答'), tone: 'orange', action: 'ask' },
  approve_other: { label: () => t('等待审批'), tone: 'gray', action: 'raise' },
  running: { label: () => t('运行中'), tone: 'blue', action: 'carry' },
  queued: { label: () => t('排队中'), tone: 'blue', action: 'wait' },
}

/** Bot figures stacked in the tag; the rest are counted as +N. */
export const MAX_ACTORS = 3

export interface Activity {
  tone: TagTone
  /** The top state, short enough for the tag; the figures and +N show how many run. */
  label: string
  /** 「待审批 · 2 个运行中」: the top state, then how many other runs. */
  title: string
  /** Most urgent first; only the first one moves. */
  actors: { runId: string; botId: string; action: MascotAction }[]
  more: number
  /** The viewer has to act on the top run: the preview says so, e.g. [待审批] codex：rm -rf build. */
  alert: { flag: string; botId: string; title: string } | null
}

/** The conversation's live runs as its tag and preview show them; null when nothing runs. */
export function activityOf(runs: LiveRun[]): Activity | null {
  const sorted = [...runs].sort((a, b) => LEVELS.indexOf(levelOf(a)) - LEVELS.indexOf(levelOf(b)))
  const top = sorted[0]
  if (!top) return null
  const level = levelOf(top)
  const look = LOOK[level]
  const others = sorted.length - 1
  const title =
    level === 'running' && others
      ? t('{n} 个运行中', { n: sorted.length })
      : others
        ? t('{label} · {n} 个运行中', { label: look.label(), n: others })
        : look.label()
  const needs = top.needsMe && (level === 'approve_me' || level === 'answer')
  return {
    tone: look.tone,
    label: look.label(),
    title,
    actors: sorted
      .slice(0, MAX_ACTORS)
      .map((r) => ({ runId: r.id, botId: r.botId, action: LOOK[levelOf(r)].action })),
    more: Math.max(0, sorted.length - MAX_ACTORS),
    alert: needs
      ? {
          flag: level === 'approve_me' ? t('[待审批] ') : t('[待回答] '),
          botId: top.botId,
          title: top.title ?? '',
        }
      : null,
  }
}

/** Something waits on the viewer here: the conversation goes up, below the pinned ones, until it is handled. */
export const needsMe = (runs: LiveRun[]) => runs.some((r) => r.needsMe)
