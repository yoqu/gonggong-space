import type { StudioSound } from './hero3d'

/** Procedural sound for the studio hero: a low room tone, key clicks, a chat ping and the approval stamp. */
export function createStudioSound() {
  const ctx = new AudioContext()
  const master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)

  // One second of white noise feeds the room tone (looped, heavily filtered) and every click and thunk.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const play = (offset: number) => {
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.start(ctx.currentTime, offset)
    return src
  }

  const room = ctx.createBufferSource()
  room.buffer = noise
  room.loop = true
  const roomLp = ctx.createBiquadFilter()
  roomLp.type = 'lowpass'
  roomLp.frequency.value = 220
  const roomGain = ctx.createGain()
  roomGain.gain.value = 0.18
  room.connect(roomLp).connect(roomGain).connect(master)
  room.start()

  const envelope = (level: number, attack: number, decay: number) => {
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    g.connect(master)
    return g
  }

  const sounds: Record<StudioSound, () => void> = {
    // A soft plastic key: a short band-passed noise tick at a slightly different pitch each time.
    type() {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 2200 + Math.random() * 1800
      bp.Q.value = 2.5
      const src = play(Math.random() * 0.9)
      src.connect(bp).connect(envelope(0.22 + Math.random() * 0.1, 0.002, 0.035))
      src.stop(ctx.currentTime + 0.06)
    },
    // A two-note chat ping, like a message arriving in the group.
    ping() {
      ;[1318.5, 1760].forEach((f, i) => {
        const osc = ctx.createOscillator()
        osc.frequency.value = f
        const g = ctx.createGain()
        const t = ctx.currentTime + i * 0.09
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.12, t + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
        osc.connect(g).connect(master)
        osc.start(t)
        osc.stop(t + 0.4)
      })
    },
    // The seal coming down: a falling low thump plus a dull paper slap.
    stamp() {
      const osc = ctx.createOscillator()
      const t = ctx.currentTime
      osc.frequency.setValueAtTime(150, t)
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18)
      osc.connect(envelope(0.6, 0.004, 0.28))
      osc.start(t)
      osc.stop(t + 0.35)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      const src = play(0)
      src.connect(lp).connect(envelope(0.35, 0.002, 0.09))
      src.stop(t + 0.12)
    },
  }

  return {
    set(on: boolean) {
      const t = ctx.currentTime
      if (on) void ctx.resume()
      master.gain.cancelScheduledValues(t)
      master.gain.setTargetAtTime(on ? 0.7 : 0, t, 0.2)
    },
    play(s: StudioSound) {
      if (ctx.state === 'running') sounds[s]()
    },
    dispose() {
      void ctx.close()
    },
  }
}
