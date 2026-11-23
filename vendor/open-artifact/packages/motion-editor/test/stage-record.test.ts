import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playSeconds, type RetouchedRecord } from '@open-artifact/motion-core';
import type { HostToStage, StageFilm, StageMeta, StageToHost } from '@open-artifact/motion-stage';
import { StageController } from '../src/engine/stage-controller.ts';

/*
 * A film loaded again in place comes up in a new frame, which loads it without the record of what a person did by
 * hand to how things look. Its `ready` sets off a reading of the layers at once (the stores change, and the reader
 * asks), so the frame must have the record by then, or the reading tells of no hide while the picture hides things.
 */

const hide = (id: string): RetouchedRecord => ({ layers: [{ id, cls: 'fish', kin: '0/1', at: 0, hidden: { was: 0, v: 1 } }] });
const RECORD = hide('hello:0.0.0.1/g');
const OTHER = hide('hello:0.0.0.2/g');

const FILM: StageFilm = {
  script: 'window.CUT = { duration: 1, render() {} };',
  modules: [{ name: 'base.css', kind: 'css', text: '.a{}' }],
  assets: [],
  faces: null,
  narration: null,
  clippedTextWaitMs: 0,
  mode: 'final',
};
/** The same film after a change that has nothing to do with the record. */
const CHANGED: StageFilm = { ...FILM, modules: [{ name: 'base.css', kind: 'css', text: '.b{}' }] };

const META = {
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 1,
  filmDuration: 1,
  chapters: [],
  scenes: null,
  background: ['rgb(255, 255, 255)', 'none'],
  parts: [{ key: null, label: 'Film', own: 'Film', a0: 0, nat: 1, p0: 0, dur: 1 }],
} as unknown as StageMeta;
const READY: StageToHost = { type: 'ready', meta: META, score: null, narration: null, loadMs: 1 };
const LAYERS: HostToStage = { type: 'layers', seq: 1, from: playSeconds(0), to: playSeconds(1), at: playSeconds(0), scene: null, stop: false };

/** A frame as the controller makes one, holding the far end of its port: what its stage hears, and a way to answer. */
class FakeFrame {
  className = '';
  title = '';
  srcdoc = '';
  referrerPolicy = '';
  dataset: Record<string, string> = {};
  readonly heard: HostToStage[] = [];
  #loaded: (() => void) | null = null;
  #port: MessagePort | null = null;
  readonly contentWindow = {
    postMessage: (_data: unknown, _origin: string, transfer: MessagePort[]): void => {
      const port = transfer[0] ?? null;
      this.#port = port;
      if (port !== null) port.onmessage = (event: MessageEvent) => this.heard.push(event.data as HostToStage);
    },
  };
  setAttribute(): void {}
  addEventListener(type: string, listener: () => void): void {
    if (type === 'load') this.#loaded = listener;
  }
  remove(): void {
    this.#port?.close();
  }
  load(): void {
    this.#loaded?.();
  }
  say(message: StageToHost): void {
    this.#port?.postMessage(message);
  }
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(done(), 'the frame did not hear it in time');
}

const kinds = (frame: FakeFrame): string[] => frame.heard.map((message) => message.type);

/** A controller whose `ready` asks the frame on show for a reading, as the stores' listeners do when a film comes up. */
function stageWithFrames(): { controller: StageController; frames: FakeFrame[]; done: () => void } {
  const frames: FakeFrame[] = [];
  const before = Reflect.get(globalThis, 'document');
  Reflect.set(globalThis, 'document', { createElement: () => new FakeFrame() });
  const controller = new StageController({ runtime: '', title: 'Film', origin: 'opaque', events: { ready: () => controller.send(LAYERS) } });
  controller.attach({ appendChild: (frame: FakeFrame) => frames.push(frame) } as unknown as HTMLElement);
  return {
    controller,
    frames,
    done: () => {
      controller.dispose();
      Reflect.set(globalThis, 'document', before);
    },
  };
}

/** Loads a frame's stage and has it say it is ready; settles once the reading its `ready` sets off has reached it. */
async function comeUp(frame: FakeFrame): Promise<void> {
  frame.load();
  await until(() => frame.heard.length > 0);
  frame.say(READY);
  await until(() => kinds(frame).includes('layers'));
}

test('a film loaded again in place takes the record before the reading its ready sets off', async () => {
  const { controller, frames, done } = stageWithFrames();
  try {
    controller.retouch(RECORD);
    controller.load(FILM);
    await comeUp(frames[0]!);
    assert.deepEqual(kinds(frames[0]!), ['load', 'retouch', 'layers']);
    assert.deepEqual(frames[0]!.heard[1], { type: 'retouch', record: RECORD });
    // An unrelated change: the record decoded again is the same, so the frame on show is not sent it again.
    controller.retouch(structuredClone(RECORD));
    controller.load(CHANGED);
    await comeUp(frames[1]!);
    assert.deepEqual(kinds(frames[1]!), ['load', 'retouch', 'layers']);
    assert.deepEqual(frames[1]!.heard[1], { type: 'retouch', record: RECORD });
    assert.deepEqual(kinds(frames[0]!), ['load', 'retouch', 'layers']);
  } finally {
    done();
  }
});

test('a record changed while a film loads goes to the frame on show, and to the new frame as it comes up', async () => {
  const { controller, frames, done } = stageWithFrames();
  try {
    controller.retouch(RECORD);
    controller.load(FILM);
    await comeUp(frames[0]!);
    controller.load(CHANGED);
    frames[1]!.load();
    await until(() => frames[1]!.heard.length > 0);
    controller.retouch(OTHER);
    await until(() => frames[0]!.heard.length === 4);
    assert.deepEqual(frames[0]!.heard[3], { type: 'retouch', record: OTHER });
    frames[1]!.say(READY);
    await until(() => kinds(frames[1]!).includes('layers'));
    assert.deepEqual(kinds(frames[1]!), ['load', 'retouch', 'layers']);
    assert.deepEqual(frames[1]!.heard[1], { type: 'retouch', record: OTHER });
  } finally {
    done();
  }
});

test('a record taken off goes to the frame on show; a frame that comes up after has none to take', async () => {
  const { controller, frames, done } = stageWithFrames();
  try {
    controller.retouch(RECORD);
    controller.load(FILM);
    await comeUp(frames[0]!);
    controller.retouch(null);
    await until(() => frames[0]!.heard.length === 4);
    assert.deepEqual(frames[0]!.heard[3], { type: 'retouch', record: null });
    controller.load(CHANGED);
    await comeUp(frames[1]!);
    assert.deepEqual(kinds(frames[1]!), ['load', 'layers']);
  } finally {
    done();
  }
});
