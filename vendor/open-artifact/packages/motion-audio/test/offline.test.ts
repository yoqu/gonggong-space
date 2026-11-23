import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { playSeconds } from '@open-artifact/motion-core';
import { OFFLINE_CHUNK_STALL_MS, OFFLINE_RENDER_CHUNK_SECONDS, renderInChunks } from '../src/offline.ts';
import type { ChunkedContext, ScheduleHeard } from '../src/offline.ts';
import type { VoiceBus } from '../src/synth/nodes.ts';
import type { HeardSpan } from '../src/window.ts';

const CHUNK = OFFLINE_RENDER_CHUNK_SECONDS;
const ORIGIN = 0.3;
const contextTime = (play: number): number => ORIGIN + play;

/** A gain that remembers where it is connected. */
class FakeGain {
  channelCount = 2;
  channelCountMode: ChannelCountMode = 'max';
  readonly to = new Set<FakeGain>();
  disconnected = false;
  connect(node: FakeGain): FakeGain {
    this.to.add(node);
    return node;
  }
  disconnect(): void {
    this.to.clear();
    this.disconnected = true;
  }
}

/** A source that ends at a context time: the context sends its 'ended' as it renders past it. */
class FakeSource extends EventTarget {
  onended: (() => void) | null = null;
  ended = false;
  readonly stop: number;
  constructor(stop: number) {
    super();
    this.stop = stop;
  }
}

interface FakeOptions {
  /** Seconds a stop comes after the time asked. */
  late?: number;
  /** Stops are refused (the context renders straight through). */
  ignoresStops?: boolean;
  /** The render never gets anywhere. */
  stalls?: boolean;
}

/** An offline context that renders by jumping from stop to stop, and waits at each until resumed. */
class FakeContext {
  currentTime = 0;
  readonly sampleRate = 1000;
  readonly length: number;
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly stops: number[] = [];
  readonly options: FakeOptions;
  #pending = new Map<number, () => void>();
  #resumed: (() => void) | null = null;

  constructor(seconds: number, options: FakeOptions = {}) {
    this.length = Math.round(seconds * this.sampleRate);
    this.options = options;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  suspend(at: number): Promise<void> {
    this.stops.push(at);
    if (at <= this.currentTime || at >= this.length / this.sampleRate) return Promise.reject(new Error('not a time to stop at'));
    return new Promise((resolve) => this.#pending.set(at, resolve));
  }

  resume(): Promise<void> {
    const resumed = this.#resumed;
    this.#resumed = null;
    resumed?.();
    return Promise.resolve();
  }

  async startRendering(): Promise<AudioBuffer> {
    if (this.options.stalls) return new Promise<AudioBuffer>(() => {});
    for (;;) {
      const at = this.options.ignoresStops ? undefined : [...this.#pending.keys()].sort((a, b) => a - b)[0];
      if (at === undefined) break;
      const stopped = this.#pending.get(at);
      this.#pending.delete(at);
      this.#renderTo(at + (this.options.late ?? 0));
      const resumed = new Promise<void>((resolve) => (this.#resumed = resolve));
      stopped?.();
      await resumed;
    }
    this.#renderTo(this.length / this.sampleRate);
    return { rendered: true } as unknown as AudioBuffer;
  }

  #renderTo(time: number): void {
    this.currentTime = time;
    for (const source of this.sources) {
      if (source.ended || source.stop > time) continue;
      source.ended = true;
      source.dispatchEvent(new Event('ended'));
    }
  }
}

interface Built {
  index: number;
  /** Context time when it was built. */
  when: number;
  dry: FakeGain;
  reverb: FakeGain;
  /** Its gains fed the session's sends when it was built. */
  fed: boolean;
}

function setUp(seconds: number, spans: HeardSpan[], options: FakeOptions = {}, refused = new Set<number>()) {
  const context = new FakeContext(seconds, options);
  const tracked: FakeSource[] = [];
  const dry = new FakeGain();
  const reverb = new FakeGain();
  const bus = {
    context,
    dry,
    reverb,
    noise: null,
    track(source: FakeSource) {
      tracked.push(source);
    },
  } as unknown as VoiceBus;
  const built: Built[] = [];
  const schedule: ScheduleHeard = (on, index) => {
    const stretchDry = on.dry as unknown as FakeGain;
    const stretchReverb = on.reverb as unknown as FakeGain;
    built.push({ index, when: context.currentTime, dry: stretchDry, reverb: stretchReverb, fed: stretchDry.to.has(dry) && stretchReverb.to.has(reverb) });
    if (refused.has(index)) return false;
    const source = new FakeSource(contextTime(spans[index].end));
    context.sources.push(source);
    on.track(source as unknown as AudioScheduledSourceNode);
    return true;
  };
  const run = () => renderInChunks(context as unknown as ChunkedContext, bus, spans, contextTime, schedule);
  return { context, bus, dry, reverb, tracked, built, run };
}

const span = (start: number, end: number): HeardSpan => ({ start: playSeconds(start), end: playSeconds(end) });

describe('rendering a score in chunks', () => {
  it('builds every sound heard once, in start order, a stretch ahead of its start', async () => {
    const spans = [span(-2, 0), span(0, 1), span(1, 1.5), span(3.6, 4), span(5, 5.5), span(5.2, 9), span(8, 8.4), span(11.5, 12)];
    const { context, built, tracked, run } = setUp(ORIGIN + 12, spans, {}, new Set([4]));
    const done = await run();
    assert.ok(done !== null);
    assert.equal(done.voices, 6, 'a sound that built nothing is not a voice');
    assert.deepEqual(
      built.map((b) => b.index),
      [1, 2, 3, 4, 5, 6, 7],
      'the sound over before play time 0 is left out',
    );
    assert.equal(tracked.length, 6, 'the session still keeps every source');
    for (const { index, when } of built) {
      const start = contextTime(spans[index].start);
      assert.ok(when <= start, `sound ${index} built at ${when}, after it starts at ${start}`);
      // Built at the first stop whose stretch after next reaches it: the stop before can not have taken it.
      assert.ok(start < when + 2 * CHUNK, `sound ${index} built too early, at ${when}`);
      if (when > 0) assert.ok(start >= when + CHUNK, `sound ${index} built late, at ${when}`);
    }
    assert.deepEqual(
      built.map((b) => b.when),
      [0, 0, 0, 2, 2, 6, 8],
    );
    // The stretch after the stop at 10 s reaches the render's end, at 12.3 s: it takes the rest, with no stop after it.
    assert.deepEqual(context.stops, [2, 4, 6, 8, 10]);
  });

  it('gives each stretch its own gains into the session’s sends, set to stereo', async () => {
    const spans = [span(0, 0.5), span(3, 3.5), span(4.5, 5)];
    const { dry, reverb, built, run } = setUp(ORIGIN + 10, spans);
    await run();
    for (const send of [dry, reverb]) {
      assert.equal(send.channelCount, 2);
      assert.equal(send.channelCountMode, 'explicit');
    }
    const [first, second, third] = built;
    assert.ok(first && second && third);
    assert.equal(first.dry, second.dry, 'sounds built at one stop share its gains');
    assert.notEqual(second.dry, third.dry);
    assert.ok(built.every((b) => b.fed));
    assert.notEqual(first.dry, dry);
  });

  it('lets a stretch’s gains go once they have been silent at two stops in a row', async () => {
    // Built at 0 and over by 1.3; built at 2 and ringing to 11.3.
    const spans = [span(0, 1), span(4, 11)];
    const { context, built, run } = setUp(ORIGIN + 12, spans);
    const disconnectedBy = new Map<FakeGain, number>();
    const watch = (gain: FakeGain): void => {
      const disconnect = gain.disconnect.bind(gain);
      gain.disconnect = () => {
        disconnectedBy.set(gain, context.currentTime);
        disconnect();
      };
    };
    const createGain = context.createGain.bind(context);
    context.createGain = () => {
      const gain = createGain();
      watch(gain);
      return gain;
    };
    await run();
    const [early, ringing] = built;
    assert.ok(early && ringing);
    // Silent at the stop at 2 s, and still at 4 s: let go there.
    assert.equal(disconnectedBy.get(early.dry), 4);
    assert.equal(disconnectedBy.get(early.reverb), 4);
    assert.equal(disconnectedBy.has(ringing.dry), false, 'a stretch still sounding keeps its gains');
    // A stretch that built nothing is let go two stops on.
    const empty = context.gains.find((gain) => disconnectedBy.get(gain) === 8);
    assert.ok(empty, 'the empty stretch of the stop at 4 s went at 8 s');
  });

  it('gives up when a stop comes more than half a stretch late', async () => {
    const { run } = setUp(ORIGIN + 12, [span(0, 1), span(6, 7)], { late: CHUNK / 2 + 0.25 });
    assert.equal(await run(), null);
  });

  it('keeps going when a stop is late by less than half a stretch', async () => {
    const { run } = setUp(ORIGIN + 12, [span(0, 1), span(6, 7)], { late: CHUNK / 2 - 0.25 });
    const done = await run();
    assert.ok(done !== null);
    assert.equal(done.voices, 2);
  });

  it('gives up when sounds are left unscheduled at the end', async () => {
    const { built, run } = setUp(ORIGIN + 12, [span(0, 1), span(8, 9)], { ignoresStops: true });
    assert.equal(await run(), null);
    assert.equal(built.length, 1);
  });

  it('gives up when a stop is refused', async () => {
    const { context, run } = setUp(ORIGIN + 12, [span(0, 1), span(8, 9)]);
    context.suspend = () => Promise.reject(new Error('refused'));
    assert.equal(await run(), null);
  });

  it('gives up when no stop comes for the stall time', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { run } = setUp(ORIGIN + 12, [span(0, 1), span(8, 9)], { stalls: true });
      const pending = run();
      mock.timers.tick(OFFLINE_CHUNK_STALL_MS);
      assert.equal(await pending, null);
    } finally {
      mock.timers.reset();
    }
  });

  it('schedules a short score all at once, with no stop', async () => {
    const spans = [span(0, 1), span(2, 3.5)];
    const { context, built, run } = setUp(ORIGIN + 3.5, spans);
    const done = await run();
    assert.ok(done !== null);
    assert.equal(done.voices, 2);
    assert.deepEqual(
      built.map((b) => b.when),
      [0, 0],
    );
    assert.deepEqual(context.stops, []);
  });
});
