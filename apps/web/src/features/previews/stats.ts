/** Cumulative counters from one read of the video receiver's RTCStatsReport. */
export interface StatsSample {
  at: number
  lost: number
  received: number
  bytes: number
  freezes: number
  fps: number | null
  rtt: number | null
  jitter: number | null
  width: number | null
  height: number | null
}

/** The picture's last second: loss as a fraction, times in ms. */
export interface LiveStats {
  fps: number | null
  loss: number
  rtt: number | null
  kbps: number
  jitter: number | null
  width: number | null
  height: number | null
  froze: boolean
}

export type Grade = 'good' | 'fair' | 'poor'

type Stat = Record<string, unknown> & { type: string }
const num = (v: unknown) => (typeof v === 'number' ? v : null)

export function sample(report: RTCStatsReport, at: number): StatsSample {
  let inbound: Stat | undefined
  let pair: Stat | undefined
  report.forEach((s: Stat) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s
  })
  const rtt = num(pair?.currentRoundTripTime)
  const jitter = num(inbound?.jitter)
  return {
    at,
    lost: num(inbound?.packetsLost) ?? 0,
    received: num(inbound?.packetsReceived) ?? 0,
    bytes: num(inbound?.bytesReceived) ?? 0,
    freezes: num(inbound?.freezeCount) ?? 0,
    fps: num(inbound?.framesPerSecond),
    rtt: rtt === null ? null : Math.round(rtt * 1000),
    jitter: jitter === null ? null : Math.round(jitter * 1000),
    width: num(inbound?.frameWidth),
    height: num(inbound?.frameHeight),
  }
}

export function measure(cur: StatsSample, prev: StatsSample): LiveStats {
  // Counters that went backwards were reset by a reconnect: nothing to compare this second against.
  const delta = (k: 'lost' | 'received' | 'bytes' | 'freezes') => Math.max(0, cur[k] - prev[k])
  const reset = cur.received < prev.received
  const [lost, received] = reset ? [0, 0] : [delta('lost'), delta('received')]
  const seconds = (cur.at - prev.at) / 1000
  return {
    fps: cur.fps,
    loss: lost + received ? lost / (lost + received) : 0,
    rtt: cur.rtt,
    kbps: reset || seconds <= 0 ? 0 : Math.round((delta('bytes') * 8) / seconds / 1000),
    jitter: cur.jitter,
    width: cur.width,
    height: cur.height,
    froze: !reset && delta('freezes') > 0,
  }
}

/** Frame rate is left out: the lower quality layers send few frames a second by design. */
export function grade(s: LiveStats): Grade {
  const rtt = s.rtt ?? 0
  if (s.loss >= 0.08 || rtt >= 300 || s.froze) return 'poor'
  if (s.loss >= 0.02 || rtt >= 150) return 'fair'
  return 'good'
}

const RANK: Record<Grade, number> = { good: 0, fair: 1, poor: 2 }
/** Seconds a new grade must hold before it shows: bad news quickly, recovery only once it is steady. */
const WORSE_AFTER = 3
const BETTER_AFTER = 5

export interface Settled {
  grade: Grade
  next: Grade
  count: number
}

export function settle(s: Settled | undefined, g: Grade): Settled {
  if (!s || g === s.grade) return { grade: g, next: g, count: 0 }
  const count = g === s.next ? s.count + 1 : 1
  const needed = RANK[g] > RANK[s.grade] ? WORSE_AFTER : BETTER_AFTER
  return count >= needed ? { grade: g, next: g, count: 0 } : { grade: s.grade, next: g, count }
}

export type QualityPick = 'auto' | 'high' | 'medium' | 'low'

/** Quality layers as a track's info lists them; `quality` uses livekit-client's VideoQuality numbering. */
export interface Layer {
  quality: number
  width: number
  height: number
}

const LAYER_PICKS = [
  { value: 'high', label: '高清' },
  { value: 'medium', label: '标清' },
  { value: 'low', label: '流畅' },
] as const

/** What a viewer can choose from; nothing when the machine sends a single layer. Auto caps at the top layer. */
export function qualityPicks(layers: Layer[]): { value: QualityPick; label: string; quality: number }[] {
  const sorted = [...layers].sort((a, b) => b.quality - a.quality)
  const picks = LAYER_PICKS.flatMap((p, i) => {
    const l = sorted[i]
    return l ? [{ ...p, quality: l.quality }] : []
  })
  const top = picks[0]
  return top && picks.length > 1 ? [{ value: 'auto', label: '自动', quality: top.quality }, ...picks] : []
}
