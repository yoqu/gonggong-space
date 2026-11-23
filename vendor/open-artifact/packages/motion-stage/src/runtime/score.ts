import type { FilmSeconds, ScoreData, ScoreEvent, ScoreEventKind, VoiceParameters } from '@open-artifact/motion-core';

/** What a score call is given: film code's own object, read field by field. */
export type ScoreOptions = Record<string, unknown>;

export interface ScoreBuilder {
  tempo(bpm?: number, options?: ScoreOptions): ScoreBuilder;
  beat(beat: number): number;
  toBeat(time: number): number;
  seed(seed: number): ScoreBuilder;
  rand(): number;
  program(track: string, patch?: string, options?: ScoreOptions): ScoreBuilder;
  note(track: string, pitch: unknown, options?: ScoreOptions): ScoreBuilder;
  chord(track: string, pitches: unknown, options?: ScoreOptions): ScoreBuilder;
  pattern(track: string, pattern: string, options?: ScoreOptions): ScoreBuilder;
  run(track: string, pitches: unknown, options?: ScoreOptions): ScoreBuilder;
  drum(name: string, options?: ScoreOptions): ScoreBuilder;
  drums(patterns: Record<string, string>, options?: ScoreOptions): ScoreBuilder;
  fx(name: string, time: number, options?: ScoreOptions): ScoreBuilder;
  ticks(times: ArrayLike<number>, options?: ScoreOptions): ScoreBuilder;
  master(options?: ScoreOptions): ScoreBuilder;
}

export type ScoreParameters = VoiceParameters;

const MOST_EVENTS = 20000;
const LONGEST_S = 72000;
const NOTE_STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const VOICE_KEYS = ['pan', 'gain', 'rev', 'detune', 'bright'] as const;
const FX_KEYS = [...VOICE_KEYS, 'into', 'rate'] as const;
type ParameterKey = (typeof FX_KEYS)[number];

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && isFinite(value) ? value : fallback);
const field = (options: ScoreOptions | undefined, key: string): unknown => (options ? options[key] : undefined);

function textOf(value: unknown): string {
  try {
    return String(value);
  } catch {
    return typeof value;
  }
}

function isListLike(value: unknown): value is ArrayLike<unknown> {
  return value !== null && typeof value === 'object' && typeof Reflect.get(value, 'length') === 'number' && Number(Reflect.get(value, 'length')) >= 0;
}

/**
 * Runs `write(S)` and gives back plain score data on the film's own clock. A pitch that cannot be read costs its
 * own note, not the score; past MOST_EVENTS refusals it throws all the same, so an endless list ends.
 */
export function recordScore(write: (builder: ScoreBuilder) => void): ScoreData {
  const events: ScoreEvent[] = [];
  let master: ScoreData['master'] = { gain: -6, fadeOut: 1, loudness: -16 };
  const grid = { bpm: 120, t0: 0 };
  const tracks = new Map<string, { patch: string; params: ScoreParameters | null }>();
  const refused = { count: 0, names: [] as string[] };
  let seed = 7;

  const random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const secondsPerBeat = (): number => 60 / grid.bpm;
  const beatTime = (beat: number): number => grid.t0 + beat * secondsPerBeat();

  const refuse = (pitch: unknown, where: string): null => {
    if (refused.count >= MOST_EVENTS) throw new Error('score: over 20,000 pitches could not be read');
    const name = (pitch === null || pitch === undefined || typeof pitch === 'number' ? String(pitch) : JSON.stringify(textOf(pitch).slice(0, 24))) + where;
    refused.count++;
    if (refused.names.length < 6 && !refused.names.includes(name)) refused.names.push(name);
    return null;
  };
  const midiOf = (pitch: unknown): number | null => {
    let midi = NaN;
    if (typeof pitch === 'number') midi = pitch;
    else {
      const found = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(textOf(pitch).trim());
      if (found) {
        const [, letter = 'C', accidental = '', octave = '0'] = found;
        midi = 12 * (Number(octave) + 1) + (NOTE_STEPS[letter.toUpperCase()] ?? 0) + (/[#♯]/.test(accidental) ? 1 : accidental ? -1 : 0);
      }
    }
    return Number.isNaN(midi) ? refuse(pitch, '') : Math.max(0, Math.min(127, Math.round(midi)));
  };
  // Anything that is not a list is refused whole: a chord's name such as "G7" would otherwise play as one very high note.
  const listOf = (pitches: unknown, call: string): ArrayLike<unknown> => (isListLike(pitches) ? pitches : (refuse(pitches, ' where ' + call + ' takes a list'), []));
  /** {beat, beats} on the grid or {t, dur} in seconds. */
  const when = (options: ScoreOptions | undefined, defaultDur: number): [number, number] => {
    const t = field(options, 't') !== undefined ? num(field(options, 't'), 0) : beatTime(num(field(options, 'beat'), 0));
    const given = field(options, 'dur');
    const beats = field(options, 'beats');
    const dur = given !== undefined ? num(given, defaultDur) : beats !== undefined ? num(beats, 1) * secondsPerBeat() : defaultDur;
    return [t, Math.max(0.01, dur)];
  };
  const push = (kind: ScoreEventKind, patch: string, midi: number | null, at: number, dur: number, vel: unknown, params: ScoreParameters | null): void => {
    if (midi === null) return;
    // Humanized jitter round beat 0.
    const t = at < 0 && at > -0.1 ? 0 : at;
    if (!(t >= 0) || t > LONGEST_S) return;
    const event: ScoreEvent = { t: t as FilmSeconds, dur, kind, patch: String(patch), midi, vel: Math.max(1, Math.min(127, Math.round(num(vel, 64)))) };
    if (params) event.params = params;
    events.push(event);
  };
  const notes = (patch: string, pitch: unknown, t: number, dur: number, vel: unknown, params: ScoreParameters | null): void => {
    for (const each of Array.isArray(pitch) ? pitch : [pitch]) push('note', patch, midiOf(each), t, dur, vel, params);
  };
  const trackOf = (name: string): { patch: string; params: ScoreParameters | null } => tracks.get(name) ?? { patch: String(name), params: null };
  const merged = (base: ScoreParameters | null, options: ScoreOptions | undefined, keys: readonly ParameterKey[]): ScoreParameters | null => {
    let out: ScoreParameters | null = base ? { ...base } : null;
    for (const key of keys) {
      const value = field(options, key);
      if (typeof value === 'number') out = { ...(out ?? {}), [key]: value };
    }
    return out;
  };

  const builder: ScoreBuilder = {
    // The grid: beats per minute and where beat 0 sits on the film clock.
    tempo(bpm, options) {
      grid.bpm = Math.max(20, Math.min(300, num(bpm, 120)));
      grid.t0 = num(field(options, 't0'), 0);
      return builder;
    },
    beat: (beat) => beatTime(beat),
    toBeat: (time) => (time - grid.t0) / secondsPerBeat(),
    seed(next) {
      seed = num(next, 7) | 0;
      return builder;
    },
    rand: random,
    program(track, patch, options) {
      tracks.set(track, { patch: String(patch || track), params: merged(null, options, VOICE_KEYS) });
      return builder;
    },
    note(track, pitch, options) {
      const chosen = trackOf(track);
      const [t, dur] = when(options, 0.3);
      notes(chosen.patch, pitch, t, dur, field(options, 'vel'), merged(chosen.params, options, VOICE_KEYS));
      return builder;
    },
    chord(track, pitches, options) {
      const chosen = trackOf(track);
      const [t, dur] = when(options, 1);
      const spread = num(field(options, 'spread'), 0);
      const list = listOf(pitches, 'chord');
      for (let i = 0; i < list.length; i++)
        notes(chosen.patch, list[i], t + i * spread, Math.max(0.02, dur - i * spread), field(options, 'vel'), merged(chosen.params, options, VOICE_KEYS));
      return builder;
    },
    // 'x.x.x-xx' on a step grid from beat `from`: x a hit (the pitch list cycles), X an accent, anything else a rest.
    pattern(track, pattern, options = {}) {
      const chosen = trackOf(track);
      const step = num(options['step'], 0.5);
      const from = num(options['from'], 0);
      const repeats = Math.max(1, num(options['repeat'], 1));
      const given = options['pitch'];
      const pitches: unknown[] = Array.isArray(given) ? given : [given !== undefined ? given : 'C4'];
      const vel = num(options['vel'], 64);
      const human = num(options['humanize'], 0.004);
      let hit = 0;
      for (let r = 0; r < repeats; r++)
        for (let i = 0; i < pattern.length; i++) {
          const mark = pattern.charAt(i);
          if (mark !== 'x' && mark !== 'X') continue;
          const beat = from + (r * pattern.length + i) * step;
          notes(
            chosen.patch,
            pitches[hit % pitches.length],
            beatTime(beat) + (random() * 2 - 1) * human,
            num(options['dur'], step * secondsPerBeat() * 0.9),
            vel + (mark === 'X' ? 12 : 0) + Math.round((random() * 2 - 1) * num(options['velJitter'], 4)),
            merged(chosen.params, options, VOICE_KEYS),
          );
          hit++;
        }
      return builder;
    },
    // Evenly stepped, in seconds.
    run(track, pitches, options = {}) {
      const chosen = trackOf(track);
      const t = num(options['t'], 0);
      const step = num(options['step'], 0.1);
      const list = listOf(pitches, 'run');
      for (let i = 0; i < list.length; i++)
        notes(chosen.patch, list[i], t + i * step, num(options['dur'], 0.3), num(options['vel'], 64) + num(options['cresc'], 0) * i, merged(chosen.params, options, VOICE_KEYS));
      return builder;
    },
    drum(name, options) {
      const [t, dur] = when(options, 0.1);
      push('drum', name, 0, t, dur, field(options, 'vel'), merged(null, options, VOICE_KEYS));
      return builder;
    },
    drums(patterns, options = {}) {
      const step = num(options['step'], 0.5);
      const from = num(options['from'], 0);
      const repeats = Math.max(1, num(options['repeat'], 1));
      for (const [name, written] of Object.entries(patterns)) {
        const pattern = String(written);
        for (let r = 0; r < repeats; r++)
          for (let i = 0; i < pattern.length; i++) {
            const mark = pattern.charAt(i);
            if (mark !== 'x' && mark !== 'X' && mark !== 'o') continue;
            const accent = mark === 'X' ? 16 : mark === 'o' ? -22 : 0;
            push('drum', name, 0, beatTime(from + (r * pattern.length + i) * step), 0.1, num(options['vel'], 70) + accent + Math.round((random() * 2 - 1) * 4), merged(null, options, VOICE_KEYS));
          }
      }
      return builder;
    },
    // Foley at an exact film time, off the grid.
    fx(name, time, options = {}) {
      const pitch = options['pitch'];
      push('fx', name, (pitch !== undefined && midiOf(pitch)) || 0, num(time, 0), Math.max(0.01, num(options['dur'], 0.25)), num(options['vel'], 64), merged(null, options, FX_KEYS));
      return builder;
    },
    // One tick per time: typing.
    ticks(times, options = {}) {
      const jitter = num(options['jitter'], 6);
      const name = typeof options['name'] === 'string' ? options['name'] : 'tick';
      for (let i = 0; i < times.length; i++) builder.fx(name, num(times[i], 0), { vel: num(options['vel'], 36) + Math.round((random() * 2 - 1) * jitter), pan: options['pan'] });
      return builder;
    },
    // gain trims before the master; loudness is the integrated LUFS the host normalizes to (false leaves it raw).
    master(options = {}) {
      const loudness = options['loudness'];
      master = {
        gain: Math.max(-40, Math.min(6, num(options['gain'], -6))),
        fadeOut: Math.max(0, Math.min(10, num(options['fadeOut'], 1))),
        loudness: loudness === false || loudness === null ? null : Math.max(-40, Math.min(-6, num(loudness, -16))),
      };
      return builder;
    },
  };

  write(builder);
  if (refused.count > 0)
    console.error(
      'score: ' +
        refused.count +
        (refused.count === 1 ? ' pitch could not be read and was' : ' pitches could not be read and were') +
        ' left out: ' +
        refused.names.slice(0, 5).join(', ') +
        (refused.names.length > 5 ? ' and others' : '') +
        ' (write "C4", "F#3", "Bb2" or a MIDI number)',
    );
  events.sort((a, b) => a.t - b.t);
  if (events.length > MOST_EVENTS) events.length = MOST_EVENTS;
  return { events, master, tempo: { bpm: grid.bpm, t0: grid.t0 as FilmSeconds } };
}
