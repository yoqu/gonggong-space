import { LIVE_FPS, type LiveFps } from '@gonggong/protocol'
import { t } from '../../i18n'

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
  /** bit/s at `LIVE_FPS`'s top rate (gg-cast's cap). */
  bitrate: number
}

const LAYER_PICKS = [
  { value: 'high', label: t('原画') },
  { value: 'medium', label: t('超清') },
  { value: 'low', label: t('高清') },
] as const

const TOP_FPS = Math.max(...LIVE_FPS)

/**
 * What a viewer can choose from, each with the bandwidth it needs at `fps`; nothing when the machine sends a single
 * layer. Auto caps at the top layer and names the one arriving (`width`: the received frame's).
 */
export function qualityPicks(
  layers: Layer[],
  fps: number,
  width: number | null,
): { value: QualityPick; label: string; quality: number }[] {
  const sorted = [...layers].sort((a, b) => b.quality - a.quality)
  const picks = LAYER_PICKS.flatMap((p, i) => {
    const l = sorted[i]
    return l ? [{ ...p, layer: l }] : []
  })
  const top = picks[0]
  if (!top || picks.length < 2) return []
  const arriving =
    width === null
      ? null
      : picks.reduce((a, b) => (Math.abs(b.layer.width - width) < Math.abs(a.layer.width - width) ? b : a))
  return [
    {
      value: 'auto',
      label: arriving ? t('自动（{label}）', { label: arriving.label }) : t('自动'),
      quality: top.layer.quality,
    },
    ...picks.map((p) => ({
      value: p.value,
      label: t('{label} · 约 {mbps} Mbps', {
        label: p.label,
        mbps: ((p.layer.bitrate * fps) / TOP_FPS / 1e6).toFixed(1),
      }),
      quality: p.layer.quality,
    })),
  ]
}

export type FpsPick = 'auto' | `${LiveFps}`

/** The frame rate auto asks for: 90 only when picked, it costs half as much again as 60. */
export const autoFps = (g: Grade): LiveFps => (g === 'good' ? 60 : 30)

export function fpsPicks(auto: LiveFps): { value: FpsPick; label: string }[] {
  return [
    { value: 'auto', label: t('自动（{fps} fps）', { fps: auto }) },
    ...[...LIVE_FPS].reverse().map((f) => ({ value: `${f}` as FpsPick, label: `${f} fps` })),
  ]
}
