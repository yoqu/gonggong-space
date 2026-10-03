// Procedural score + SFX for the promo. 120 BPM so every scene cut lands on a beat.
// Usage: node scripts/score.mjs  → audio/music.wav, audio/sfx.wav
import { writeFileSync, readFileSync } from 'node:fs'

const SR = 44100
const TL = JSON.parse(readFileSync(new URL('../timeline.json', import.meta.url)))
const LEN = TL.total
const N = SR * LEN
const BEAT = 0.5

let seed = 7
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
const hz = (m) => 440 * 2 ** ((m - 69) / 12)

function bus() {
  return [new Float32Array(N), new Float32Array(N)]
}
function add(b, t, sig, dur, gain = 1, pan = 0) {
  const s0 = Math.floor(t * SR)
  const n = Math.floor(dur * SR)
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4)
  for (let i = 0; i < n && s0 + i < N; i++) {
    if (s0 + i < 0) continue
    const v = sig(i / SR, i)
    b[0][s0 + i] += v * gl
    b[1][s0 + i] += v * gr
  }
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d))

// ---- instruments
const kick = (t) => Math.sin(2 * Math.PI * (45 * t + (75 / 18) * (1 - Math.exp(-18 * t)))) * Math.exp(-t / 0.18)
function noiseHit(decay, hp) {
  let prev = 0
  return (t) => {
    const n = rnd()
    const v = hp ? n - prev : n
    prev = n
    return v * Math.exp(-t / decay)
  }
}
const clap = () => {
  const n = noiseHit(0.09, true)
  return (t) => n(t) * (t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.6 : 1) : 1)
}
const marimba = (m) => (t) =>
  (Math.sin(2 * Math.PI * hz(m) * t) + 0.25 * Math.sin(2 * Math.PI * hz(m) * 4 * t) * Math.exp(-t / 0.05)) *
  env(t, 0.002, 0.28)
const bell = (m) => (t) =>
  (Math.sin(2 * Math.PI * hz(m) * t) + 0.4 * Math.sin(2 * Math.PI * hz(m) * 2.76 * t) * Math.exp(-t / 0.4)) *
  env(t, 0.002, 1.1)
function pluck(m, decay = 0.996) {
  const p = Math.round(SR / hz(m))
  const buf = Float32Array.from({ length: p }, () => rnd())
  return (t, i) => {
    const k = i % p
    const v = buf[k]
    buf[k] = decay * 0.5 * (buf[k] + buf[(k + 1) % p])
    return v
  }
}
function saw(m, detune = 0) {
  const f = hz(m) * 2 ** (detune / 1200)
  return (t) => 2 * ((t * f) % 1) - 1
}
function pad(notes, dur, bright = 0.06) {
  const oscs = notes.flatMap((m) => [saw(m, -7), saw(m, 7)])
  let lp1 = 0
  let lp2 = 0
  return (t) => {
    let v = 0
    for (const o of oscs) v += o(t)
    v /= oscs.length
    lp1 += bright * (v - lp1)
    lp2 += bright * (lp1 - lp2)
    const a = Math.min(1, t / 0.6)
    const r = Math.min(1, Math.max(0, (dur - t) / 0.5))
    return lp2 * a * r
  }
}
function bass(m, dur) {
  const f = hz(m)
  return (t) => {
    const v = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t)
    return v * Math.min(1, t / 0.01) * Math.min(1, Math.max(0, (dur - t) / 0.05)) * (0.7 + 0.3 * Math.exp(-t / 0.15))
  }
}
function riser(dur) {
  let lp = 0
  return (t) => {
    const k = t / dur
    lp += (0.02 + 0.5 * k * k) * (rnd() - lp)
    return lp * k * k
  }
}


// ---- arrangement: chapter-driven, 120 BPM, D major loop (D A Bm G)
const PROG = [
  [50, [62, 66, 69]],
  [45, [61, 64, 69]],
  [47, [62, 66, 71]],
  [43, [62, 67, 71]],
]
const ARP = [0, 1, 2, 1, 2, 3, 2, 1]
const music = bus()
const BAR = BEAT * 4
const chs = TL.chapters
const outro = chs.at(-1)
const chapterAt = (t) => chs.findLast((c) => t >= c.start)
const tense = (t) => {
  const c = chapterAt(t)
  return c.id === 'c5' && t < c.start + 5.6
}
// intensity: intro light, chapters alternate groove/light, last 4 bars of each chapter lighter
function level(t) {
  const c = chapterAt(t)
  if (c.id === 'intro') return t < 8 ? 0 : 1
  if (c.id === 'outro') return 3
  if (t < c.start + 1.9) return 2
  const i = chs.indexOf(c)
  return i % 2 ? 2 : 1
}
for (let bar = 0; bar * BAR < outro.start; bar++) {
  const t0 = bar * BAR
  const [root, chord] = PROG[bar % 4]
  const lv = level(t0 + 0.01)
  const padNotes = tense(t0 + 0.01) ? [59, 62, 66] : chord
  add(music, t0, pad(padNotes, BAR + 0.4, lv === 0 ? 0.03 : 0.05), BAR + 0.4, 0.2)
  for (let s = 0; s < 8; s++) {
    const t = t0 + s * (BAR / 8)
    if (t >= outro.start || tense(t)) continue
    const note = [...chord, chord[0] + 12][ARP[s]] + 12
    if (level(t) === 0) {
      if (s % 2 === 0) add(music, t, pluck(note), 0.9, 0.15, s % 4 ? 0.3 : -0.3)
    } else add(music, t, marimba(note), 0.5, level(t) === 2 ? 0.19 : 0.15, s % 2 ? 0.35 : -0.35)
  }
  for (let b = 0; b < 4; b++) {
    const t = t0 + b * BEAT
    if (t >= outro.start || tense(t)) continue
    const lv2 = level(t)
    if (lv2 >= 1) {
      add(music, t, kick, 0.4, lv2 === 2 ? 0.5 : 0.38)
      add(music, t + BEAT / 2, noiseHit(0.03, true), 0.08, 0.06, 0.4)
    }
    if (lv2 === 2 && b % 2) add(music, t, clap(), 0.25, 0.16, 0.1)
    if (lv2 >= 1) add(music, t, bass(root - 12 + (b === 3 && lv2 === 2 ? 7 : 0), BEAT * 0.9), BEAT, lv2 === 2 ? 0.28 : 0.22)
  }
}
// level-up stinger on every chapter card, risers into them
for (const c of chs.slice(1, -1)) {
  add(music, c.start - 1.5, riser(1.5), 1.5, 0.18)
  ;[74, 78, 81, 86].forEach((m, i) => add(music, c.start + i * 0.12, bell(m), 1.6, 0.11, i % 2 ? 0.3 : -0.3))
}
// finale
const F = outro.start
add(music, F - 2, riser(2), 2, 0.3)
add(music, F, kick, 0.5, 0.7)
add(music, F, bass(38, 4), 4, 0.33)
for (let k = 0; k < 2; k++) add(music, F + k * 6, pad([50, 57, 62, 66, 69, 74], 6.4, 0.08), 6.4, 0.3)
for (let b = 0; b < 16; b++) {
  const t = F + b * BEAT
  add(music, t, kick, 0.4, 0.45)
  if (b % 2) add(music, t, clap(), 0.25, 0.16)
  const [, chord] = PROG[Math.floor(b / 4) % 4]
  add(music, t, marimba(chord[b % 3] + 12), 0.5, 0.18, b % 2 ? 0.3 : -0.3)
}
;[74, 78, 81, 86].forEach((m, i) => add(music, F + 8 + i * 0.25, bell(m), 3, 0.13, i % 2 ? 0.3 : -0.3))
add(music, F + 8, pad([50, 57, 62, 66, 69, 74], LEN - F - 8, 0.06), LEN - F - 8, 0.28)

// ---- SFX (convention: each line's beat enters with a whoosh, its key point pops 0.6s later)
const sfx = bus()
const blip = (f1, f2, d) => (t) => Math.sin(2 * Math.PI * (f1 + ((f2 - f1) * t) / d) * t) * env(t, 0.003, d / 3)
const whoosh = (d) => {
  let lp = 0
  return (t) => {
    const k = t / d
    lp += (0.05 + 0.3 * k) * (rnd() - lp)
    return lp * Math.sin(Math.PI * k)
  }
}
const boing = (t) => Math.sin(2 * Math.PI * (220 + 180 * Math.sin(t * 30) * Math.exp(-t * 6)) * t) * env(t, 0.005, 0.12)
for (const c of chs) {
  if (c.id !== 'intro' && c.id !== 'outro') add(sfx, c.start + 0.05, whoosh(0.5), 0.5, 0.25)
  for (const l of c.lines) {
    if (l.voice === 'N') {
      add(sfx, l.start - 0.15, whoosh(0.35), 0.35, 0.18)
      add(sfx, l.start + 0.6, blip(880, 1320, 0.12), 0.15, 0.22)
    } else add(sfx, l.start - 0.2, boing, 0.4, 0.3)
  }
}
add(sfx, F + 3.4, (t) => kick(t) * 1.2 + noiseHit(0.05, false)(t) * 0.25, 0.9, 0.9)
const cues = { vo: chs.flatMap((c) => c.lines.map((l) => [l.start, l.start + l.dur])) }

// ---- reverb send on music (Schroeder combs), duck under voice-over, normalise
function reverb(b) {
  const out = bus()
  for (let ch = 0; ch < 2; ch++) {
    const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: d + ch * 23, buf: new Float32Array(d + ch * 23), i: 0 }))
    for (let n = 0; n < N; n++) {
      let v = 0
      for (const c of combs) {
        const y = c.buf[c.i]
        c.buf[c.i] = b[ch][n] + y * 0.78
        c.i = (c.i + 1) % c.d
        v += y
      }
      out[ch][n] = v * 0.12
    }
  }
  return out
}
const wet = reverb(music)
const duck = (t) => {
  let g = 1
  for (const [s, e] of cues.vo) {
    const k = Math.min(Math.max((t - (s - 0.25)) / 0.25, 0), 1) * Math.min(Math.max((e + 0.35 - t) / 0.35, 0), 1)
    g = Math.min(g, 1 - 0.55 * k)
  }
  return g
}
for (let n = 0; n < N; n++) {
  const g = duck(n / SR) * Math.min(1, (LEN - n / SR) / 1.5)
  for (let ch = 0; ch < 2; ch++) music[ch][n] = (music[ch][n] + wet[ch][n]) * g
}

function write(path, b, peak) {
  let max = 0
  for (const ch of b) for (const v of ch) max = Math.max(max, Math.abs(v))
  const k = peak / (max || 1)
  const buf = Buffer.alloc(44 + N * 4)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + N * 4, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(N * 4, 40)
  for (let n = 0; n < N; n++)
    for (let ch = 0; ch < 2; ch++)
      buf.writeInt16LE(Math.round(Math.tanh(b[ch][n] * k) * 32767), 44 + n * 4 + ch * 2)
  writeFileSync(new URL(`../${path}`, import.meta.url), buf)
}
write('audio/music.wav', music, 0.7)
write('audio/sfx.wav', sfx, 0.8)
