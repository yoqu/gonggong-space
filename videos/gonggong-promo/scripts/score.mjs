// Procedural score + SFX for the promo. 120 BPM so every scene cut lands on a beat.
// Usage: node scripts/score.mjs  → audio/music.wav, audio/sfx.wav
import { writeFileSync, readFileSync } from 'node:fs'

const SR = 44100
const LEN = 60
const N = SR * LEN
const BEAT = 0.5
const cues = JSON.parse(readFileSync(new URL('../cues.json', import.meta.url)))

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

// ---- arrangement (D major: D A Bm G, one chord per bar)
const PROG = [
  [50, [62, 66, 69]],
  [45, [61, 64, 69]],
  [47, [62, 66, 71]],
  [43, [62, 67, 71]],
]
const ARP = [0, 1, 2, 1, 2, 3, 2, 1]
const music = bus()
const BAR = BEAT * 4
const section = (t) => {
  if (t < 7) return 'intro'
  if (t < 13) return 'roll'
  if (t < 31) return 'groove'
  if (t < 35.5) return 'tension'
  if (t < 46) return 'groove'
  if (t < 52) return 'reveal'
  return 'outro'
}

for (let bar = 0; bar * BAR < LEN; bar++) {
  const t0 = bar * BAR
  const [root, chord] = PROG[bar % 4]
  const sec = section(t0 + 0.01)
  if (sec === 'outro') break
  const padNotes = sec === 'tension' ? [59, 62, 66] : chord
  add(music, t0, pad(padNotes, BAR + 0.4, sec === 'intro' ? 0.03 : 0.06), BAR + 0.4, 0.22)
  for (let s = 0; s < 8; s++) {
    const t = t0 + s * (BAR / 8)
    const sc = section(t)
    if (sc === 'tension') continue
    const note = [...chord, chord[0] + 12][ARP[s]] + 12
    if (sc === 'intro') {
      if (s % 2 === 0) add(music, t, pluck(note), 0.9, 0.16, s % 4 ? 0.3 : -0.3)
    } else {
      add(music, t, marimba(note), 0.5, 0.2, (s % 2 ? 0.35 : -0.35) * (sc === 'reveal' ? 0.5 : 1))
    }
  }
  for (let b = 0; b < 4; b++) {
    const t = t0 + b * BEAT
    const sc = section(t)
    if (sc === 'roll' || sc === 'groove') {
      add(music, t, kick, 0.4, 0.55)
      if (b % 2) add(music, t, clap(), 0.25, 0.18, 0.1)
      add(music, t + BEAT / 2, noiseHit(0.03, true), 0.08, 0.07, 0.4)
    }
    if (sc === 'groove') add(music, t, bass(root - 12 + (b === 3 ? 7 : 0), BEAT * 0.9), BEAT, 0.3)
    if (sc === 'roll') add(music, t, bass(root - 12, BEAT * 0.45), BEAT, 0.28)
  }
}
// tension riser into the stamp, reveal riser into the end card
add(music, 32.5, riser(3), 3, 0.35)
add(music, 49.4, riser(2.6), 2.6, 0.3)
for (const t of [46, 48, 50]) add(music, t, bell(81), 2, 0.12, 0.2)
// finale: big D chord + bells ringing out
add(music, 52, kick, 0.5, 0.7)
add(music, 52, pad([50, 57, 62, 66, 69, 74], 7.6, 0.08), 7.6, 0.32)
add(music, 52, bass(38, 4), 4, 0.35)
;[74, 78, 81, 86].forEach((m, i) => add(music, 52 + i * 0.25, bell(m), 3, 0.13, i % 2 ? 0.3 : -0.3))
add(music, 56, bell(86), 3.5, 0.1)

// ---- SFX
const sfx = bus()
const blip = (f1, f2, d) => (t) => Math.sin(2 * Math.PI * (f1 + ((f2 - f1) * t) / d) * t) * env(t, 0.003, d / 3)
const tick = () => {
  const n = noiseHit(0.012, true)
  return (t) => n(t) * 0.8 + Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t / 0.006) * 0.4
}
const whoosh = (d) => {
  let lp = 0
  return (t) => {
    const k = t / d
    lp += (0.05 + 0.3 * k) * (rnd() - lp)
    return lp * Math.sin(Math.PI * k)
  }
}
const thud = (t) => kick(t) * 1.2 + noiseHit(0.05, false)(t) * 0.25
const SFX = {
  key: [tick, 0.05, 0.22],
  send: [() => whoosh(0.35), 0.35, 0.35],
  pop: [() => blip(880, 1320, 0.12), 0.15, 0.25],
  slam: [() => thud, 0.5, 0.5],
  check: [() => blip(1320, 1760, 0.09), 0.12, 0.18],
  stamp: [() => thud, 0.6, 0.9],
  chime: [() => bell(86), 1.5, 0.22],
}
for (const [name, ts] of Object.entries(cues.sfx))
  for (const t of ts) {
    const [mk, d, g] = SFX[name]
    add(sfx, t, mk(), d, g, name === 'key' ? rnd() * 0.3 : 0)
  }

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
