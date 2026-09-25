import type { MessageDto } from '@gonggong/protocol'
import { filePaths } from '../runs/paths'

/** Consecutive messages of one author within this window share one avatar and name. */
export const MERGE_MS = 5 * 60_000

export const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()

/** `m` continues `prev`'s group: same author, same day, within MERGE_MS, and neither is a system event. */
export function continues(prev: MessageDto | undefined, m: MessageDto) {
  return (
    !!prev &&
    prev.kind !== 'event' &&
    m.kind === prev.kind &&
    m.authorId === prev.authorId &&
    sameDay(prev.createdAt, m.createdAt) &&
    Date.parse(m.createdAt) - Date.parse(prev.createdAt) <= MERGE_MS
  )
}

/**
 * First unread message when entering a group. The server's unread count skips system events and my own
 * messages, so it is counted back over the same messages.
 */
export function unreadStart(messages: MessageDto[], unread: number, meId: string | undefined) {
  if (unread <= 0) return null
  const counted = messages.filter((m) => m.kind !== 'event' && m.authorId !== meId)
  return (counted.at(-unread) ?? counted[0])?.id ?? null
}

const CODE_OR_TABLE = /```|^\s*\|?\s*:?-{3,}:?\s*\|/m

/** Replies with code, tables, attachments or file paths need the wide run card; plain text stays a bubble (C2). */
export const isRich = (m: MessageDto) =>
  m.attachments.length > 0 || CODE_OR_TABLE.test(m.body) || filePaths(m.body).length > 0

/** Shortest run of consecutive system events that folds into one expandable row. */
export const EVENT_FOLD_MIN = 3

/**
 * Runs of ≥ EVENT_FOLD_MIN consecutive events on the same day, as start index → end index (inclusive).
 * A run breaks at a day change and at `breakAt` (the unread divider), so no marker ends up inside a fold.
 */
export function eventFolds(messages: MessageDto[], breakAt?: string | null) {
  const folds = new Map<number, number>()
  let start = -1
  const close = (end: number) => {
    if (start >= 0 && end - start + 1 >= EVENT_FOLD_MIN) folds.set(start, end)
    start = -1
  }
  messages.forEach((m, i) => {
    const prev = messages[i - 1]
    const joins = start >= 0 && !!prev && sameDay(prev.createdAt, m.createdAt) && m.id !== breakAt
    const event = m.kind === 'event' && !m.recalled
    if (!event || !joins) close(i - 1)
    if (event && start < 0) start = i
  })
  close(messages.length - 1)
  return folds
}
