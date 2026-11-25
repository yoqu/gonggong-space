import type { RunDetailDto, RunEvent } from '@gonggong/protocol'
import { desc, eq, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { runEvents } from '../../db/schema.js'
import { open, seal } from '../../lib/seal.js'
import { runAudience } from '../messages/guests.js'
import { runRedactors } from '../secrets/resolve.js'
import { LIVE } from './dto.js'

/** Who a run was found live for: its machine, group, bot and the thread it answers in. */
export type Owner = {
  id: string
  machineId: string
  groupId: string
  botId: string
  threadRootId: string | null
}

/**
 * Runs found live, so their further reports skip the row. Dropped wherever a run ends without its machine's
 * run.done (machine offline, `forgetStream`) and on run.done itself.
 */
const owners = new Map<string, Owner>()
/** Counts drops: a check that raced one is not remembered, as the row it read may predate the end. */
let drops = 0

/**
 * The latest live make-up of each running run's context. Kept in memory, not in run_events: readers refetch the
 * process from its last row on, so a row updated in place would go unseen and new rows would split streamed text.
 */
const liveContexts = new Map<string, NonNullable<RunDetailDto['live']>>()

export const liveContext = (runId: string) => liveContexts.get(runId)

export function setLiveContext(runId: string, live: NonNullable<RunDetailDto['live']>) {
  liveContexts.set(runId, live)
}

export function clearLiveContext(runId: string) {
  liveContexts.delete(runId)
}

/** While a machine is away its runs may end server-side (a /stop while offline): their reports are checked again. */
export function dropMachineOwners(machineId: string) {
  drops++
  for (const [runId, owner] of owners) if (owner.machineId === machineId) owners.delete(runId)
}

/** Resolves the run's live owner from cache or `load`; only an owner seen live is remembered. */
export async function resolveOwner(
  machineId: string,
  runId: string,
  load: () => Promise<
    { groupId: string; botId: string; status: string; threadRootId: string | null } | undefined
  >,
) {
  const known = owners.get(runId)
  if (known?.machineId === machineId) return known
  const seen = drops
  const run = await load()
  if (!run) return
  const owner: Owner = {
    id: runId,
    machineId,
    groupId: run.groupId,
    botId: run.botId,
    threadRootId: run.threadRootId,
  }
  if (LIVE.includes(run.status) && seen === drops) owners.set(runId, owner)
  return owner
}

function forgetOwner(runId: string) {
  owners.delete(runId)
  liveContexts.delete(runId)
  drops++
}

type Redact = (text: string) => string
type Stream = Extract<RunEvent, { kind: 'text' | 'thought' }>
/** A stream row; no `id` until it was first stored. */
type Segment = {
  id?: number
  kind: Stream['kind']
  agentId?: string
  plain: string
  /** Length of the redacted text of `plain` already pushed to viewers. */
  sent: number
  /** The `plain` end last pushed up to: an unchanged end has nothing new to push. */
  upto: number
  /** Length of `plain` already stored. */
  saved: number
}
/** A run's open stream: its latest segment, stored on a debounce through one ordered write chain. */
type Open = {
  ctx: Ctx
  runId: string
  /** The run's redaction (its known secret values). */
  redact: Redact
  seg?: Segment
  timer?: NodeJS.Timeout
  write: Promise<void>
}

/** Rows roll over at a line end past this size, so a store (rewriting the whole row) stays bounded. */
const SEGMENT = 8 * 1024
/** A line that never ends rolls over here anyway, the one place a secret may be cut. */
const SEGMENT_MAX = 32 * 1024
/** Streamed text is stored at most this often per run; readers flush first, so it is never seen stale. */
const STREAM_SAVE_MS = 500
const OPEN_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?![\s\S]*-----END [A-Z0-9 ]*PRIVATE KEY-----)/

const HEADER = /-----BEGIN[^\n]*$/
/** Continuations that turn a still-open quote into a match; a label alone is masked by the cumulative redaction. */
const PROBES = ['a'.repeat(64), 'a"', "a'"]

/** Each live run's stream, so appends skip reading and decrypting the row back. */
const streams = new Map<string, Open>()

/** Stores what the run streamed so far; readers of its process call this first. */
export async function flushStream(runId: string) {
  const st = streams.get(runId)
  if (!st) return
  clearTimeout(st.timer)
  st.timer = undefined
  if (st.seg) await save(st, st.seg)
  await st.write
}

/**
 * A run that ended without run.done (daemon lost, account disabled, force-stopped) no longer streams; what it sent is
 * kept. Its later reports are checked against the row again.
 */
export async function forgetStream(runId: string) {
  forgetOwner(runId)
  await flushStream(runId)
  streams.delete(runId)
}

/** Flushes and drops every open stream belonging to `ctx` (on engine shutdown). */
export async function forgetCtxStreams(ctx: Ctx) {
  for (const [runId, st] of streams) if (st.ctx === ctx) await forgetStream(runId)
}

/** Writes are chained so rows are inserted in stream order; a failed write is retried by the next save. */
function save(st: Open, seg: Segment) {
  const job = st.write.then(async () => {
    const plain = seg.plain
    if (!plain || seg.saved === plain.length) return
    seg.id = await writeSegment(st.ctx, st.runId, { ...seg, plain }, st.redact)
    seg.saved = plain.length
    const owner = seg.agentId && owners.get(st.runId)
    if (owner)
      st.ctx.bus.publish(
        await runAudience(st.ctx, owner),
        {
          t: 'run.progress',
          runId: owner.id,
          groupId: owner.groupId,
          botId: owner.botId,
          lastActivityAt: st.ctx.now().toISOString(),
        },
        owner.groupId,
      )
  })
  st.write = job.catch(() => {})
  return job
}

function saveLater(st: Open) {
  if (st.timer) return
  st.timer = setTimeout(() => {
    st.timer = undefined
    if (st.seg) save(st, st.seg).catch((err) => console.error('run stream save:', err))
  }, STREAM_SAVE_MS).unref()
}

/** Where `plain` rolls over into a new row, if it does: after its last line, never inside a private key block. */
function rollover(plain: string) {
  if (plain.length < SEGMENT) return 0
  const line = plain.lastIndexOf('\n') + 1
  if (line && !OPEN_KEY.test(plain.slice(0, line))) return line
  return plain.length >= SEGMENT_MAX ? plain.length : 0
}

const isToken = (code: number) => code > 32 && code < 127

/** Only the main agent's replies are pushed live; thoughts and subagent text are read from the stored rows. */
const live = ({ kind, agentId }: Segment) => kind === 'text' && !agentId

/** Redacted text of `seg.plain` up to `end` that viewers have not received yet. */
function unsent(seg: Segment, end: number, redact: Redact) {
  if (end === seg.upto) return ''
  seg.upto = end
  const text = redact(seg.plain.slice(0, end)).slice(seg.sent)
  seg.sent += text.length
  return text
}

/**
 * How much of `plain` no later text can rewrite once redacted. Viewers append what they receive, so a secret
 * must never start going out before the rest of it arrives: the trailing token, an open private key block and
 * a value inside an unclosed quote wait for more text.
 */
function settled(plain: string, redact: Redact) {
  let end = Math.min(OPEN_KEY.exec(plain)?.index ?? plain.length, HEADER.exec(plain)?.index ?? plain.length)
  while (end > 0 && isToken(plain.charCodeAt(end - 1))) end--
  while (end > 0 && !closed(plain.slice(0, end), redact)) {
    while (end > 0 && !isToken(plain.charCodeAt(end - 1))) end--
    while (end > 0 && isToken(plain.charCodeAt(end - 1))) end--
  }
  return end
}

/** Quotes and labels do not span lines, so the last two lines tell whether a continuation could rewrite `text`. */
function closed(text: string, redact: Redact) {
  const last = text.lastIndexOf('\n')
  const tail = text.slice(last < 0 ? 0 : text.lastIndexOf('\n', last - 1) + 1)
  const masked = redact(tail)
  return PROBES.every((probe) => redact(tail + probe).startsWith(masked))
}

const segment = (kind: Stream['kind'], agentId: string | undefined, plain: string): Segment => ({
  kind,
  agentId,
  plain,
  sent: 0,
  upto: 0,
  saved: 0,
})

/**
 * Streamed chunks extend the run's latest event of the same kind and agent, so redaction sees whole lines even
 * when a secret is split across chunks. Returns the redacted text now safe to push live.
 */
export async function appendStream(ctx: Ctx, runId: string, { kind, delta, agentId }: Stream) {
  let st = streams.get(runId)
  if (!st) {
    const { redact } = await runRedactors(ctx, runId)
    st = { ctx, runId, redact, seg: await lastSegment(ctx, runId), write: Promise.resolve() }
    streams.set(runId, st)
  }
  const prev = st.seg
  let out = ''
  let seg: Segment
  if (prev?.kind === kind && prev.agentId === agentId) {
    seg = prev
    seg.plain += delta
  } else {
    if (prev) {
      if (live(prev)) out += unsent(prev, prev.plain.length, st.redact)
      await save(st, prev)
    }
    seg = segment(kind, agentId, delta)
  }
  const cut = rollover(seg.plain)
  if (cut) {
    const rest = seg.plain.slice(cut)
    seg.plain = seg.plain.slice(0, cut)
    if (live(seg)) out += unsent(seg, cut, st.redact)
    await save(st, seg)
    seg = segment(kind, agentId, rest)
  }
  st.seg = seg
  if (live(seg)) out += unsent(seg, settled(seg.plain, st.redact), st.redact)
  saveLater(st)
  return out
}

/**
 * The stream ends: it is stored, and what was held back for a possible secret can go out. The run's next chunk
 * starts a new row, known to follow this report, so it is not read back.
 */
export async function closeStream(runId: string) {
  const st = streams.get(runId)
  const seg = st?.seg
  const out = st && seg && live(seg) ? unsent(seg, seg.plain.length, st.redact) : ''
  await flushStream(runId)
  if (st) st.seg = undefined
  return out
}

async function writeSegment(ctx: Ctx, runId: string, { id, kind, agentId, plain }: Segment, redact: Redact) {
  const payload = { kind, delta: seal(redact(plain)), agentId }
  if (id !== undefined) {
    await ctx.db.update(runEvents).set({ payload, createdAt: ctx.now() }).where(eq(runEvents.id, id))
    return id
  }
  const [row] = await ctx.db
    .insert(runEvents)
    .values({ runId, kind, payload, createdAt: ctx.now() })
    .returning({ id: runEvents.id })
  return row?.id
}

/** After a restart the cache is empty: the run's latest row, when it is a stream (a tool row is not read whole). */
async function lastSegment(ctx: Ctx, runId: string): Promise<Segment | undefined> {
  const [last] = await ctx.db
    .select({
      id: runEvents.id,
      kind: runEvents.kind,
      delta: sql<string>`${runEvents.payload} ->> 'delta'`,
      agentId: sql<string | null>`${runEvents.payload} ->> 'agentId'`,
    })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.id))
    .limit(1)
  if (!last || (last.kind !== 'text' && last.kind !== 'thought')) return
  const plain = open(last.delta)
  return {
    id: last.id,
    kind: last.kind,
    agentId: last.agentId ?? undefined,
    plain,
    sent: plain.length,
    upto: -1,
    saved: plain.length,
  }
}
