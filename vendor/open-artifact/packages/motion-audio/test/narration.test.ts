import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { NarrationData, NarrationLine } from '@open-artifact/motion-core';
import { captionCues, cueAt, voiceoverLines } from '../src/narration/captions.ts';
import { decodeNarration, judgeTakeBytes, judgeTakeSeconds } from '../src/narration/decode.ts';
import type { TakeDecoder } from '../src/narration/decode.ts';
import { DUCK_ATTACK_SECONDS, DUCK_RELEASE_SECONDS, duckEnvelope, sampleEnvelope } from '../src/narration/duck.ts';
import { DEFAULT_NARRATION_LIMITS } from '../src/narration/limits.ts';
import { voicePeaks } from '../src/narration/peaks.ts';
import { clipCaption, planNarration } from '../src/narration/plan.ts';
import { placeSpeech } from '../src/narration/speech.ts';
import { identityTimeline, segmentTimeline } from '../src/timeline.ts';
import { encodePcmWave, parsePcmWave } from '../src/wave.ts';

const film = filmSeconds;
const play = playSeconds;
const line = (at: number, dur: number, audio: string, text = 'Words.'): NarrationLine => ({ at: film(at), dur, audio, text });

/** Enough of an AudioBuffer for the narration code: its length and its first channel. */
function fakeBuffer(seconds: number, sampleRate = 100): AudioBuffer {
  const samples = new Float32Array(Math.round(seconds * sampleRate)).map((_unused, index) => Math.sin(index / 3) * 0.5);
  const fake = { duration: seconds, length: samples.length, sampleRate, numberOfChannels: 1, getChannelData: () => samples };
  return fake as unknown as AudioBuffer;
}

describe('planning narration', () => {
  it('keeps lines that start within the film and fit a line, in time order', () => {
    const data: NarrationData = { lines: [line(5, 2, 'b'), line(1, 2, 'a'), line(-1, 1, 'x'), line(10, 1, 'y'), line(2, 31, 'z'), line(3, 0, 'w')] };
    const plan = planNarration(data, film(10));
    assert.deepEqual(
      plan?.lines.map((kept) => kept.audio),
      ['a', 'b'],
    );
    assert.equal(plan?.duckDb, -12);
  });

  it('takes the narration’s duck within −30…0 dB, and is null with no line', () => {
    assert.equal(planNarration({ lines: [line(1, 1, 'a')], duck: -50 }, film(10))?.duckDb, -30);
    assert.equal(planNarration({ lines: [line(1, 1, 'a')], duck: 3 }, film(10))?.duckDb, 0);
    assert.equal(planNarration({ lines: [line(20, 1, 'a')] }, film(10)), null);
  });

  it('cuts words to 600 units without splitting a surrogate pair', () => {
    assert.equal(clipCaption('a'.repeat(700)).length, 600);
    const emoji = 'a'.repeat(599) + '\u{1F600}' + 'b';
    assert.equal(clipCaption(emoji).length, 599);
  });
});

describe('ducking', () => {
  it('goes down before a line and back up after it', () => {
    const points = duckEnvelope([{ at: play(2), dur: 1 }], -12);
    const low = Math.pow(10, -12 / 20);
    assert.deepEqual(points, [
      { t: 2 - DUCK_ATTACK_SECONDS, v: 1 },
      { t: 2, v: low },
      { t: 3, v: low },
      { t: 3 + DUCK_RELEASE_SECONDS, v: 1 },
    ]);
    assert.equal(sampleEnvelope(points, 0), 1);
    assert.ok(Math.abs(sampleEnvelope(points, 2 - DUCK_ATTACK_SECONDS / 2) - (1 + low) / 2) < 1e-12);
    assert.equal(sampleEnvelope(points, 2.5), low);
    assert.equal(sampleEnvelope(points, 10), 1);
  });

  it('stays down between lines close together', () => {
    const points = duckEnvelope([{ at: play(3.5), dur: 1 }, { at: play(2), dur: 1 }], -12);
    assert.deepEqual(
      points.map((point) => point.t),
      [2 - DUCK_ATTACK_SECONDS, 2, 4.5, 4.5 + DUCK_RELEASE_SECONDS],
    );
  });

  it('is level 1 with no point', () => {
    assert.equal(sampleEnvelope([], 3), 1);
  });
});

describe('captions and the voiceover lane', () => {
  const plan = planNarration({ lines: [line(1, 2, 'a', 'First.'), line(5, 1, 'b', ' '), line(7, 2, 'c', 'Third.')] }, film(10));

  it('shows each line with words from its start for its length, moved by the recut', () => {
    const timeline = segmentTimeline(
      [
        { film: film(0), filmLength: 6, play: play(0), playLength: 3 },
        { film: film(6), filmLength: 4, play: play(3), playLength: 4 },
      ],
      film(10),
    );
    const cues = captionCues(plan, timeline);
    assert.deepEqual(
      cues.map((cue) => [cue.start, cue.end, cue.text]),
      [
        [0.5, 2.5, 'First.'],
        [4, 6, 'Third.'],
      ],
    );
    assert.equal(cueAt(cues, play(1))?.text, 'First.');
    assert.equal(cueAt(cues, play(3)), null);
    assert.equal(cueAt(cues, play(5.5))?.text, 'Third.');
  });

  it('shows none when captions are off', () => {
    assert.ok(plan !== null);
    assert.deepEqual(captionCues({ ...plan, captions: false }, identityTimeline(film(10))), []);
  });

  it('draws the lane with each take’s own length and waveform', async () => {
    assert.ok(plan !== null);
    const decoded = await decodeNarration(plan, new Map([['a', new ArrayBuffer(10)]]), {
      decoder: { decodeAudioData: async () => fakeBuffer(1.5) },
      speechGain: async () => 2,
    });
    assert.ok(decoded !== null);
    const lane = voiceoverLines(decoded, identityTimeline(film(10)));
    assert.deepEqual(
      lane.map((entry) => [entry.audio, entry.at, entry.dur, entry.peaks === null]),
      [
        ['a', 1, 1.5, false],
        ['b', 5, 1, true],
        ['c', 7, 2, true],
      ],
    );
  });
});

describe('decoding takes', () => {
  const limits = DEFAULT_NARRATION_LIMITS;

  it('judges a take by its bytes: big unless a wave, too long, or past the total', () => {
    assert.equal(judgeTakeBytes(300 * 1024, null, 0, limits), 'big');
    assert.equal(judgeTakeBytes(300 * 1024, { seconds: 10, bare: () => new ArrayBuffer(0) }, 0, limits), null);
    assert.equal(judgeTakeBytes(1000, { seconds: 32, bare: () => new ArrayBuffer(0) }, 0, limits), 'long');
    assert.equal(judgeTakeBytes(1000, { seconds: 10, bare: () => new ArrayBuffer(0) }, 35_995, limits), 'total');
    assert.equal(judgeTakeBytes(1000, null, 36_000, limits), 'total');
  });

  it('judges a decoded take by its length', () => {
    assert.equal(judgeTakeSeconds(null, 0, limits), 'undecodable');
    assert.equal(judgeTakeSeconds(0, 0, limits), 'undecodable');
    assert.equal(judgeTakeSeconds(31.5, 0, limits), 'long');
    assert.equal(judgeTakeSeconds(10, 35_995, limits), 'total');
    assert.equal(judgeTakeSeconds(10, 0, limits), null);
  });

  it('decodes each named take once and says what it found', async () => {
    const plan = planNarration({ lines: [line(1, 1, 'a'), line(3, 1, 'a'), line(5, 1, 'bad'), line(7, 1, 'missing')] }, film(10));
    assert.ok(plan !== null);
    let decodes = 0;
    const decoder: TakeDecoder = {
      decodeAudioData: async (bytes) => {
        decodes++;
        if (bytes.byteLength === 3) throw new Error('not audio');
        return fakeBuffer(1);
      },
    };
    const assets = new Map([
      ['a', new ArrayBuffer(10)],
      ['bad', new ArrayBuffer(3)],
    ]);
    const decoded = await decodeNarration(plan, assets, { decoder, speechGain: async () => 1.5 });
    assert.ok(decoded !== null);
    assert.equal(decodes, 2);
    assert.deepEqual([...decoded.found], [
      ['a', 1],
      ['bad', 'undecodable'],
    ]);
    assert.equal(decoded.gain, 1.5);
    const speech = placeSpeech(decoded, identityTimeline(film(10)));
    assert.deepEqual(
      speech?.clips.map((clip) => clip.at),
      [1, 3],
    );
    assert.equal(speech?.gain, 1.5);
    assert.equal(speech?.duck.length, 8);
  });

  it('decodes a plain wave from its bare samples', async () => {
    const take = fakeBuffer(0.5, 8000);
    const wave = encodePcmWave(take);
    const plan = planNarration({ lines: [line(0, 0.5, 'w')] }, film(2));
    assert.ok(plan !== null);
    let given = 0;
    const decoded = await decodeNarration(plan, new Map([['w', wave.buffer]]), {
      decoder: {
        decodeAudioData: async (bytes) => {
          given = bytes.byteLength;
          return take;
        },
      },
      speechGain: async () => 1,
    });
    assert.equal(given, wave.byteLength);
    assert.equal(decoded?.found.get('w'), 0.5);
    assert.ok(parsePcmWave(wave.buffer) !== null);
  });

  it('stops when the film moves on', async () => {
    const plan = planNarration({ lines: [line(0, 1, 'a')] }, film(2));
    assert.ok(plan !== null);
    const decoded = await decodeNarration(plan, new Map([['a', new ArrayBuffer(4)]]), { isCurrent: () => false, decoder: null });
    assert.equal(decoded, null);
  });

  it('speaks no line whose start is cut out', async () => {
    const plan = planNarration({ lines: [line(1, 1, 'a'), line(5, 1, 'a')] }, film(10));
    assert.ok(plan !== null);
    const decoded = await decodeNarration(plan, new Map([['a', new ArrayBuffer(4)]]), {
      decoder: { decodeAudioData: async () => fakeBuffer(1) },
      speechGain: async () => 1,
    });
    assert.ok(decoded !== null);
    const timeline = segmentTimeline(
      [
        { film: film(0), filmLength: 4, play: play(0), playLength: 4 },
        { film: film(6), filmLength: 4, play: play(4), playLength: 4 },
      ],
      film(10),
    );
    assert.deepEqual(
      placeSpeech(decoded, timeline)?.clips.map((clip) => clip.at),
      [1],
    );
  });
});

describe('waveform peaks', () => {
  it('draws 60 bars a second, scaled to the loudest, never under the floor', () => {
    const samples = new Float32Array(1000);
    samples[10] = 0.5;
    samples[600] = 1;
    const peaks = voicePeaks(samples, 0.5);
    assert.equal(peaks.length, 30);
    assert.equal(Math.max(...peaks), 1);
    assert.ok(peaks.every((peak) => peak >= 0.08));
    assert.equal(peaks[0], Number((0.5 ** 0.6).toFixed(3)));
  });

  it('draws at least 8 bars, all at the floor for silence', () => {
    assert.deepEqual(voicePeaks(new Float32Array(100), 0.01), new Array(8).fill(0.08));
  });
});
