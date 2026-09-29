import { describe, expect, it } from 'vitest'
import { grade, measure, qualityPicks, sample, settle } from '../src/features/previews/stats'

/** An RTCStatsReport as a browser receiver hands it back: the inbound video stream and the ICE candidate pairs. */
const report = (inbound: Record<string, unknown>, rtt = 0.08) =>
  new Map<string, Record<string, unknown>>([
    ['in', { type: 'inbound-rtp', kind: 'video', ...inbound }],
    ['cp-old', { type: 'candidate-pair', state: 'failed', currentRoundTripTime: 2 }],
    ['cp', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: rtt }],
  ]) as unknown as RTCStatsReport

const base = {
  packetsLost: 0,
  packetsReceived: 1000,
  bytesReceived: 500_000,
  framesPerSecond: 30,
  frameWidth: 1920,
  frameHeight: 1080,
  jitter: 0.004,
  freezeCount: 0,
}

describe('实时画面 · 网络指标', () => {
  it('turns two samples a second apart into this second’s figures', () => {
    const prev = sample(report(base), 1000)
    const cur = sample(
      report(
        { ...base, packetsLost: 3, packetsReceived: 1097, bytesReceived: 750_000, freezeCount: 1 },
        0.12,
      ),
      2000,
    )
    expect(measure(cur, prev)).toEqual({
      fps: 30,
      loss: 0.03,
      rtt: 120,
      kbps: 2000,
      jitter: 4,
      width: 1920,
      height: 1080,
      froze: true,
    })
  })

  it('starts over when counters reset (a reconnect) instead of reporting negative loss', () => {
    const prev = sample(report({ ...base, packetsLost: 50, packetsReceived: 9000, bytesReceived: 9e6 }), 1000)
    const cur = sample(report({ ...base, packetsLost: 1, packetsReceived: 99 }), 2000)
    const m = measure(cur, prev)
    expect(m.loss).toBe(0)
    expect(m.kbps).toBe(0)
  })

  it('grades by loss, round trip and freezes', () => {
    const ok = {
      fps: 30,
      loss: 0.01,
      rtt: 80,
      kbps: 2000,
      jitter: 4,
      width: 1920,
      height: 1080,
      froze: false,
    }
    expect(grade(ok)).toBe('good')
    expect(grade({ ...ok, loss: 0.03 })).toBe('fair')
    expect(grade({ ...ok, rtt: 200 })).toBe('fair')
    expect(grade({ ...ok, loss: 0.1 })).toBe('poor')
    expect(grade({ ...ok, rtt: 350 })).toBe('poor')
    expect(grade({ ...ok, froze: true })).toBe('poor')
    // A low layer's few frames a second are by design, not the network.
    expect(grade({ ...ok, fps: 5 })).toBe('good')
  })

  it('turns worse after 3 bad seconds and better after 5 good ones, so the tag does not flicker', () => {
    let s = settle(undefined, 'good')
    for (const g of ['poor', 'poor', 'good', 'poor', 'poor'] as const) s = settle(s, g)
    expect(s.grade).toBe('good')
    s = settle(s, 'poor')
    expect(s.grade).toBe('poor')
    for (let i = 0; i < 4; i++) s = settle(s, 'good')
    expect(s.grade).toBe('poor')
    s = settle(s, 'good')
    expect(s.grade).toBe('good')
  })

  it('offers the quality layers the machine sends, top down', () => {
    const layer = (quality: number, width: number) => ({ quality, width, height: width / 2 })
    expect(qualityPicks([layer(2, 1920), layer(1, 960), layer(0, 960)])).toEqual([
      { value: 'auto', label: '自动', quality: 2 },
      { value: 'high', label: '高清', quality: 2 },
      { value: 'medium', label: '标清', quality: 1 },
      { value: 'low', label: '流畅', quality: 0 },
    ])
    // Two layers from a small window: its top one is reported as medium.
    expect(qualityPicks([layer(0, 195), layer(1, 390)]).map((p) => [p.value, p.quality])).toEqual([
      ['auto', 1],
      ['high', 1],
      ['medium', 0],
    ])
    expect(qualityPicks([layer(2, 1920)])).toEqual([])
  })
})
