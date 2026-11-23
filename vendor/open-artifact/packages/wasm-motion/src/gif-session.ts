/**
 * GIF encoding off the page's thread. A session takes sample frames for
 * its palette, then the frames themselves, and hands back the file.
 *
 * In a page the steps run in a Worker (started on first use, stopped when
 * idle). Where there are no Workers (Node tests, the CLI), or the Worker
 * cannot start, the same steps run in-thread. Steps of a session run in
 * the order they were asked for.
 */

import type { GifAnswer, GifStep, GifStepMessage, GifWorkerMessage } from './gif-jobs.ts';
import { pixelBytes, type RgbaPixels } from './module.ts';

/** Options of a GIF session. */
export interface GifSessionOptions {
  width: number;
  height: number;
  /** Plays after the first (default 0: loop for ever). */
  repeat?: number;
  /** A palette to use (RGB triples); otherwise one is picked from the samples, or from the first frame. */
  palette?: Uint8Array;
}

/**
 * A GIF being written. The pixels given are handed over (moved to the
 * Worker where they can be): do not use the arrays afterwards.
 */
export interface GifSession {
  /** Adds a frame the palette is picked from; ignored once frames are added or with a palette given. */
  sample(pixels: RgbaPixels): Promise<void>;
  /** Adds a frame shown for `delayCs` hundredths of a second; the GIF's size so far, in bytes. */
  add(pixels: RgbaPixels, delayCs: number): Promise<number>;
  /** Ends the GIF: its bytes. */
  finish(): Promise<Uint8Array>;
  /** Drops the session unfinished. */
  close(): void;
}

/** How long an idle Worker is kept, ms. */
const IDLE_MS = 20_000;

interface Pending {
  message: GifStepMessage;
  resolve(answer: GifAnswer): void;
  reject(error: Error): void;
}

let worker: Worker | null = null;
let workerReady = false;
/** The Worker could not start here: run in-thread from now on. */
let workerBroken = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
let nextSession = 1;
let openSessions = 0;
const pending = new Map<number, Pending>();
/** Steps asked for before the Worker said it is ready. */
const waiting: Pending[] = [];
let inlineQueue: Promise<unknown> = Promise.resolve();

/** Where sessions run: in a Worker, or in-thread. */
export function gifBackend(): 'worker' | 'inline' {
  return typeof Worker === 'undefined' || workerBroken ? 'inline' : 'worker';
}

function runInline(job: Pending): void {
  inlineQueue = inlineQueue.then(async () => {
    const { runGifStep } = await import('./gif-jobs.ts');
    try {
      job.resolve(runGifStep(job.message.session, job.message.step));
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function stopWorker(): void {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = null;
  workerReady = false;
}

function scheduleIdle(): void {
  clearTimeout(idleTimer);
  if (worker && pending.size === 0 && waiting.length === 0 && openSessions === 0) idleTimer = setTimeout(stopWorker, IDLE_MS);
}

/** Moves a step's pixels to the Worker when the array owns its whole buffer; copies them otherwise. */
function transferOf(step: GifStep): Transferable[] {
  if (step.kind !== 'sample' && step.kind !== 'add') return [];
  const { buffer, byteOffset, byteLength } = step.pixels;
  return buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength ? [buffer] : [];
}

function post(target: Worker, job: Pending): void {
  pending.set(job.message.id, job);
  try {
    target.postMessage(job.message, transferOf(job.message.step));
  } catch (error) {
    pending.delete(job.message.id);
    job.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The Worker failed: before it was ready, its steps run in-thread; after, they fail. */
function onWorkerError(event: Event): void {
  event.preventDefault();
  const held = waiting.splice(0);
  const lost = [...pending.values()];
  pending.clear();
  if (!workerReady) {
    workerBroken = true;
    for (const job of held) runInline(job);
  } else {
    for (const job of [...lost, ...held]) job.reject(new Error('The GIF worker stopped.'));
  }
  stopWorker();
}

function onMessage(event: MessageEvent<GifWorkerMessage>): void {
  const message = event.data;
  if (message.type === 'ready') {
    workerReady = true;
    const target = worker;
    for (const job of waiting.splice(0)) if (target) post(target, job);
    return;
  }
  const job = pending.get(message.id);
  if (!job) return;
  pending.delete(message.id);
  if (message.type === 'done') job.resolve(message.answer);
  else {
    // A trapped module is not reused.
    if (message.fatal) stopWorker();
    job.reject(new Error(message.message));
  }
  scheduleIdle();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerBroken || typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'open-artifact-gif' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onWorkerError);
  return worker;
}

function run(session: number, step: GifStep): Promise<GifAnswer> {
  return new Promise<GifAnswer>((resolve, reject) => {
    const job: Pending = { message: { id: nextId++, session, step }, resolve, reject };
    const target = getWorker();
    if (!target) return runInline(job);
    clearTimeout(idleTimer);
    if (workerReady) post(target, job);
    else waiting.push(job);
  });
}

const toUint16 = (value: number): number => Math.max(0, Math.min(65535, Math.round(value) || 0));

/** Starts a GIF of `width` × `height`. */
export function openGifSession(options: GifSessionOptions): GifSession {
  const session = nextSession++;
  let open = true;
  openSessions++;
  const end = (): void => {
    if (!open) return;
    open = false;
    openSessions--;
    scheduleIdle();
  };
  const step = (next: GifStep): Promise<GifAnswer> => {
    if (!open) return Promise.reject(new Error('The GIF session is closed.'));
    const answer = run(session, next);
    answer.catch(end);
    return answer;
  };
  void step({
    kind: 'open',
    width: options.width,
    height: options.height,
    repeat: toUint16(options.repeat ?? 0),
    palette: options.palette ?? null,
  }).catch(() => {});
  return {
    sample: async (pixels) => {
      await step({ kind: 'sample', pixels: pixelBytes(pixels) });
    },
    add: async (pixels, delayCs) => {
      const answer = await step({ kind: 'add', pixels: pixelBytes(pixels), delayCs: toUint16(delayCs) });
      return typeof answer === 'number' ? answer : 0;
    },
    finish: async () => {
      const answer = await step({ kind: 'finish' });
      end();
      if (!(answer instanceof Uint8Array)) throw new Error('The GIF did not finish.');
      return answer;
    },
    close: () => {
      if (!open) return;
      void run(session, { kind: 'close' }).catch(() => {});
      end();
    },
  };
}
