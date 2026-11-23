/**
 * A score as a Standard MIDI File (format 1, 480 ticks a beat): a conductor
 * track with the tempo and where film time 0 falls, a track per patch with
 * its General MIDI program, and the drums and effects on channel 10.
 * Bells play as the notes they ring; a reverse swell lands where it is first
 * heard. The score's tempo sets the beat, so its bars line up in a DAW.
 */

import type { DrumName, FxName, PatchName, ScoreData } from '@open-artifact/motion-core';
import { MAX_EVENT_SECONDS } from './played-score.ts';
import { soundExtent } from './synth/presets.ts';
import { voiceOf } from './synth/voice.ts';

export const MIDI_TICKS_PER_BEAT = 480;
export const DEFAULT_MIDI_TITLE = 'animation score';
const DEFAULT_BPM = 120;
const BPM_RANGE = [4, 960] as const;
const DRUM_CHANNEL = 9;
const DRUM_TRACK_NAME = 'drums + foley';

/** General MIDI programs (0-based) of the patches. */
const PROGRAMS: Readonly<Record<PatchName, number>> = { marimba: 12, ep: 4, bass: 33, pad: 89, vibes: 11, glock: 9, pluck: 108, keys: 81 };

/** General MIDI percussion keys of the drums. */
const DRUM_KEYS: Readonly<Record<DrumName, number>> = {
  kick: 36,
  snare: 38,
  clap: 39,
  hat: 42,
  openhat: 46,
  shaker: 82,
  sidestick: 37,
  woodblock: 76,
  tamb: 54,
  tom: 45,
  crash: 49,
  ride: 51,
  cowbell: 56,
};
const DRUM_SECONDS = 0.1;

/** Percussion keys that stand in for the effects. */
const FX_KEYS: Readonly<Partial<Record<FxName, number>>> = { tick: 77, click: 37, doubleclick: 37, pop: 76, thud: 41, whoosh: 55, revswell: 55, boing: 47, roll: 77 };
const FX_KEY = 77;

/** Bells: the intervals they ring over their root, one after another. */
const BELLS: Readonly<Partial<Record<FxName, { intervals: readonly number[]; step: number; root: number }>>> = {
  ding: { intervals: [0, 7], step: 0.12, root: 88 },
  chime: { intervals: [0, 4, 7, 12], step: 0.09, root: 88 },
  sparkle: { intervals: [0, 7, 12, 16, 19, 24], step: 0.055, root: 96 },
};
const BELL_SECONDS = 0.3;
const BELL_PATCH: PatchName = 'glock';
const DOUBLE_CLICK_GAP = 0.11;
const DOUBLE_CLICK_SECONDS = 0.05;

export interface MidiOptions {
  /** The conductor track's name (default "animation score"). */
  title?: string;
}

interface Note {
  channel: number;
  key: number;
  velocity: number;
  on: number;
  off: number;
}

interface TrackEvent {
  tick: number;
  /** Ties at a tick: meta first, then note-offs, then note-ons. */
  order: 0 | 1 | 2;
  bytes: readonly number[];
}

interface Lane {
  name: string;
  channel: number;
  program: number | null;
  notes: Note[];
}

const clamp = (value: number, least: number, most: number): number => Math.max(least, Math.min(most, value));

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

const text = (value: string): number[] => Array.from(new TextEncoder().encode(value));

const meta = (tick: number, type: number, data: readonly number[]): TrackEvent => ({ tick, order: 0, bytes: [0xff, type, ...variableLength(data.length), ...data] });

function trackChunk(events: TrackEvent[]): number[] {
  events.sort((first, second) => first.tick - second.tick || first.order - second.order);
  const body: number[] = [];
  let last = 0;
  for (const event of events) {
    body.push(...variableLength(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return [...text('MTrk'), ...word(body.length), ...body];
}

const word = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

/** Ends a note where the same key starts again on its channel; of two starting together, the louder stays. */
function untangle(notes: Note[]): Note[] {
  notes.sort((first, second) => first.on - second.on);
  const sounding = new Map<number, Note>();
  const kept: Note[] = [];
  for (const note of notes) {
    const slot = note.channel * 128 + note.key;
    const before = sounding.get(slot);
    if (before !== undefined && before.on === note.on) {
      before.velocity = Math.max(before.velocity, note.velocity);
      before.off = Math.max(before.off, note.off);
      continue;
    }
    if (before !== undefined && before.off > note.on) before.off = note.on;
    sounding.set(slot, note);
    kept.push(note);
  }
  return kept;
}

/** The score as a Standard MIDI File. */
export function toMidi(score: ScoreData, options: MidiOptions = {}): Uint8Array<ArrayBuffer> {
  const bpm = clamp(Number.isFinite(score.tempo?.bpm) ? score.tempo!.bpm : DEFAULT_BPM, BPM_RANGE[0], BPM_RANGE[1]);
  const t0 = Number.isFinite(score.tempo?.t0) ? score.tempo!.t0 : 0;
  const secondsPerBeat = 60 / bpm;
  const beatsBefore = Math.ceil(Math.max(0, t0) / secondsPerBeat - 1e-9);
  // Film time 0 lands this far into the file, so the score's beat 0 starts a bar.
  const offset = t0 - beatsBefore * secondsPerBeat;
  const tick = (seconds: number): number => Math.max(0, Math.round(((seconds - offset) / secondsPerBeat) * MIDI_TICKS_PER_BEAT));

  const lanes = new Map<PatchName, Lane>();
  const drums: Lane = { name: DRUM_TRACK_NAME, channel: DRUM_CHANNEL, program: null, notes: [] };
  let nextChannel = 0;
  const lane = (patch: PatchName): Lane => {
    let found = lanes.get(patch);
    if (found === undefined) {
      found = { name: patch, channel: nextChannel, program: PROGRAMS[patch], notes: [] };
      nextChannel = Math.min(15, nextChannel + 1 === DRUM_CHANNEL ? DRUM_CHANNEL + 1 : nextChannel + 1);
      lanes.set(patch, found);
    }
    return found;
  };
  const play = (into: Lane, key: number, velocity: number, at: number, seconds: number): void => {
    const on = tick(at);
    into.notes.push({
      channel: into.channel,
      key: clamp(Math.round(key), 0, 127),
      velocity: clamp(Math.round(velocity), 1, 127),
      on,
      off: Math.max(on + 1, tick(at + Math.max(0.02, seconds)) - 1),
    });
  };

  const events = score.events
    .filter((event) => Number.isFinite(event.t) && Number.isFinite(event.dur) && event.t >= 0 && event.t < MAX_EVENT_SECONDS)
    .sort((first, second) => first.t - second.t);
  for (const event of events) {
    const voice = voiceOf(event);
    if (voice === null) continue;
    const { patch, sound } = voice;
    const at: number = voice.t;
    switch (patch.kind) {
      case 'note':
        play(lane(patch.name), sound.midi, sound.vel, at, sound.dur);
        break;
      case 'drum':
        play(drums, DRUM_KEYS[patch.name], sound.vel, at, DRUM_SECONDS);
        break;
      case 'fx': {
        const bell = BELLS[patch.name];
        if (bell !== undefined) {
          const root = typeof event.midi === 'number' && event.midi > 0 ? sound.midi : bell.root;
          bell.intervals.forEach((interval, index) => play(lane(BELL_PATCH), root + interval, sound.vel, at + index * bell.step, BELL_SECONDS));
        } else if (patch.name === 'doubleclick') {
          play(drums, FX_KEYS.doubleclick!, sound.vel, at, DOUBLE_CLICK_SECONDS);
          play(drums, FX_KEYS.doubleclick!, sound.vel, at + DOUBLE_CLICK_GAP, DOUBLE_CLICK_SECONDS);
        } else {
          const [heard] = soundExtent(patch, at, sound.dur);
          play(drums, FX_KEYS[patch.name] ?? FX_KEY, sound.vel, Math.max(0, heard), sound.dur);
        }
        break;
      }
      default: {
        const never: never = patch;
        return never;
      }
    }
  }

  const microsPerBeat = Math.round(60_000_000 / bpm);
  const conductor = [
    meta(0, 0x03, text(options.title?.trim() || DEFAULT_MIDI_TITLE)),
    meta(0, 0x51, [(microsPerBeat >>> 16) & 0xff, (microsPerBeat >>> 8) & 0xff, microsPerBeat & 0xff]),
    meta(0, 0x58, [4, 2, 24, 8]),
    meta(tick(0), 0x06, text(`film t=0 (${(-offset).toFixed(3)} s into the file)`)),
  ];
  const tracks = [trackChunk(conductor)];
  for (const each of [...lanes.values(), ...(drums.notes.length > 0 ? [drums] : [])]) {
    const trackEvents: TrackEvent[] = [meta(0, 0x03, text(each.name))];
    if (each.program !== null) trackEvents.push({ tick: 0, order: 0, bytes: [0xc0 | each.channel, each.program] });
    for (const note of untangle(each.notes)) {
      trackEvents.push({ tick: note.on, order: 2, bytes: [0x90 | note.channel, note.key, note.velocity] });
      trackEvents.push({ tick: note.off, order: 1, bytes: [0x80 | note.channel, note.key, 0] });
    }
    tracks.push(trackChunk(trackEvents));
  }
  const header = [...text('MThd'), ...word(6), 0, 1, (tracks.length >>> 8) & 0xff, tracks.length & 0xff, MIDI_TICKS_PER_BEAT >>> 8, MIDI_TICKS_PER_BEAT & 0xff];
  return new Uint8Array([...header, ...tracks.flat()]);
}
