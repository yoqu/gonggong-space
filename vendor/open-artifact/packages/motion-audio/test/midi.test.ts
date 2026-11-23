import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filmSeconds } from '@open-artifact/motion-core';
import type { ScoreData, ScoreEvent } from '@open-artifact/motion-core';
import { toMidi } from '../src/midi.ts';

const ascii = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

const event = (fields: Partial<ScoreEvent> & Pick<ScoreEvent, 'kind' | 'patch'>): ScoreEvent => ({ t: filmSeconds(0), dur: 0.5, midi: 60, vel: 100, ...fields });

const score = (events: ScoreEvent[], tempo?: ScoreData['tempo']): ScoreData => ({ events, master: { gain: -6, fadeOut: 1 }, ...(tempo !== undefined ? { tempo } : {}) });

interface ParsedEvent {
  tick: number;
  bytes: number[];
}

/** The tracks of a Standard MIDI File, each as its events at absolute ticks. */
function parse(file: Uint8Array): { format: number; division: number; tracks: { bytes: Uint8Array; events: ParsedEvent[] }[] } {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  assert.equal(ascii(file.subarray(0, 4)), 'MThd');
  assert.equal(view.getUint32(4), 6);
  const count = view.getUint16(10);
  const tracks = [];
  let at = 14;
  for (let index = 0; index < count; index++) {
    assert.equal(ascii(file.subarray(at, at + 4)), 'MTrk');
    const length = view.getUint32(at + 4);
    const bytes = file.subarray(at + 8, at + 8 + length);
    const events: ParsedEvent[] = [];
    let tick = 0;
    for (let read = 0; read < bytes.length; ) {
      let delta = 0;
      for (;;) {
        const byte = bytes[read++]!;
        delta = (delta << 7) | (byte & 0x7f);
        if (byte < 0x80) break;
      }
      tick += delta;
      const status = bytes[read]!;
      const size = status === 0xff ? 3 + bytes[read + 2]! : (status & 0xf0) === 0xc0 ? 2 : 3;
      events.push({ tick, bytes: Array.from(bytes.subarray(read, read + size)) });
      read += size;
    }
    assert.deepEqual(events.at(-1)?.bytes, [0xff, 0x2f, 0x00]);
    tracks.push({ bytes, events });
    at += 8 + length;
  }
  assert.equal(at, file.byteLength);
  return { format: view.getUint16(8), division: view.getUint16(12), tracks };
}

const metaText = (events: ParsedEvent[], type: number): string | undefined => {
  const found = events.find((each) => each.bytes[0] === 0xff && each.bytes[1] === type);
  return found === undefined ? undefined : Buffer.from(found.bytes.slice(3)).toString('utf8');
};

describe('the score as MIDI', () => {
  it('writes a format 1 file at 480 ticks a beat, a note as known bytes', () => {
    const file = toMidi(score([event({ kind: 'note', patch: 'marimba' })]));
    assert.deepEqual(Array.from(file.subarray(0, 14)), [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0]);
    const { tracks } = parse(file);
    const conductor = tracks[0]!.events;
    assert.equal(metaText(conductor, 0x03), 'animation score');
    assert.deepEqual(conductor[1]!.bytes, [0xff, 0x51, 3, 0x07, 0xa1, 0x20], '120 bpm is 500000 µs a beat');
    assert.deepEqual(conductor[2]!.bytes, [0xff, 0x58, 4, 4, 2, 24, 8]);
    assert.equal(metaText(conductor, 0x06), 'film t=0 (0.000 s into the file)');
    assert.deepEqual(
      Array.from(tracks[1]!.bytes),
      [0, 0xff, 0x03, 7, ...Buffer.from('marimba'), 0, 0xc0, 12, 0, 0x90, 60, 100, 0x83, 0x5f, 0x80, 60, 0, 0, 0xff, 0x2f, 0],
    );
  });

  it('gives each patch its own channel and program, skipping the drum channel', () => {
    const patches = ['marimba', 'ep', 'bass', 'pad', 'vibes', 'glock', 'pluck', 'keys'];
    const events = [...patches, 'marimba'].map((patch, index) => event({ kind: 'note', patch, t: filmSeconds(index) }));
    const { tracks } = parse(toMidi(score([...events, event({ kind: 'note', patch: 'pad', t: filmSeconds(20) })])));
    const programs = tracks.slice(1).map((track) => track.events.find((each) => (each.bytes[0]! & 0xf0) === 0xc0)!.bytes);
    assert.deepEqual(programs, [
      [0xc0, 12],
      [0xc1, 4],
      [0xc2, 33],
      [0xc3, 89],
      [0xc4, 11],
      [0xc5, 9],
      [0xc6, 108],
      [0xc7, 81],
    ]);
    assert.equal(tracks.length, 9, 'no drum track without drums');
  });

  it('puts drums and effects on channel 10, bells on the glockenspiel, a swell where it is first heard', () => {
    const { tracks } = parse(
      toMidi(
        score([
          event({ kind: 'drum', patch: 'kick', t: filmSeconds(1) }),
          event({ kind: 'fx', patch: 'doubleclick', t: filmSeconds(2) }),
          event({ kind: 'fx', patch: 'revswell', t: filmSeconds(3), dur: 1 }),
          event({ kind: 'fx', patch: 'chime', t: filmSeconds(4), midi: 0 }),
          event({ kind: 'drum', patch: 'nobody-knows', t: filmSeconds(5) }),
        ]),
      ),
    );
    assert.equal(tracks.length, 3);
    assert.equal(metaText(tracks[1]!.events, 0x03), 'glock');
    const bells = tracks[1]!.events.filter((each) => each.bytes[0] === 0x90);
    assert.deepEqual(
      bells.map((each) => [each.tick, each.bytes[1]]),
      [
        [3840, 88],
        [3840 + Math.round(0.09 * 960), 92],
        [3840 + Math.round(0.18 * 960), 95],
        [3840 + Math.round(0.27 * 960), 100],
      ],
    );
    assert.equal(metaText(tracks[2]!.events, 0x03), 'drums + foley');
    const hits = tracks[2]!.events.filter((each) => each.bytes[0] === 0x99).map((each) => [each.tick, each.bytes[1]]);
    assert.deepEqual(hits, [
      [960, 36],
      [1920, 37],
      [1920 + Math.round(0.11 * 960), 37],
      [1920, 55],
    ].sort((first, second) => first[0]! - second[0]!));
  });

  it('starts the file on the beat before film time 0 when the tempo is offset', () => {
    const { tracks } = parse(toMidi(score([event({ kind: 'note', patch: 'bass', t: filmSeconds(0.25) })], { bpm: 60, t0: filmSeconds(0.25) }), { title: 'Orbit' }));
    const conductor = tracks[0]!.events;
    assert.equal(metaText(conductor, 0x03), 'Orbit');
    assert.deepEqual(conductor[1]!.bytes, [0xff, 0x51, 3, 0x0f, 0x42, 0x40]);
    const marker = conductor.find((each) => each.bytes[1] === 0x06)!;
    assert.equal(marker.tick, 360);
    assert.equal(metaText(conductor, 0x06), 'film t=0 (0.750 s into the file)');
    const on = tracks[1]!.events.find((each) => each.bytes[0] === 0x90)!;
    assert.equal(on.tick, 480, 'the beat the tempo names falls on a beat');
  });

  it('ends a note where the same key starts again, and drops what cannot be played', () => {
    const { tracks } = parse(
      toMidi(
        score([
          event({ kind: 'note', patch: 'keys', t: filmSeconds(0), dur: 2 }),
          event({ kind: 'note', patch: 'keys', t: filmSeconds(1), dur: 0.5, vel: 300 }),
          event({ kind: 'note', patch: 'keys', t: filmSeconds(Number.NaN) }),
          event({ kind: 'note', patch: 'keys', t: filmSeconds(200_000) }),
        ]),
      ),
    );
    const notes = tracks[1]!.events.filter((each) => each.bytes[0] === 0x90 || each.bytes[0] === 0x80);
    assert.deepEqual(
      notes.map((each) => [each.tick, each.bytes[0], each.bytes[2]]),
      [
        [0, 0x90, 100],
        [960, 0x80, 0],
        [960, 0x90, 127],
        [1439, 0x80, 0],
      ],
    );
  });
});
