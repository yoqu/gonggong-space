/**
 * Export packing for the editors: zip archives (deflate), PDFs of page
 * pictures and lossless PNG re-compression, done by `crates/open-artifact-export`
 * compiled to WebAssembly.
 *
 * In a page the work runs in a Worker (started on first use, stopped when
 * idle) so packing never blocks the page; results come back transferred.
 * Where there are no Workers (Node tests, the CLI), or the Worker cannot
 * start, the same code runs in-thread. Either way the module's bytes are
 * embedded: nothing to serve beyond the Worker script itself.
 *
 * Data may be given as bytes, text or Blobs; Blobs travel to the Worker by
 * reference and are read there, so the page never copies a picture.
 */

import type { Job, PdfOptions, PdfPage, PngOptions, Progress, WorkerMessage, ZipEntry, ZipOptions } from './types.ts';

export type { ExportBytes, PdfLink, PdfOptions, PdfPage, PdfTextRun, PngOptions, Progress, ZipEntry, ZipOptions } from './types.ts';

/** CSS pixels to points (96 px = 72 pt, as browsers print). */
export const PT_PER_PX = 0.75;

/** How long an idle Worker is kept (its memory is released when it stops), ms. */
const IDLE_MS = 20_000;

interface Pending {
  job: Job;
  resolve(bytes: Uint8Array): void;
  reject(error: Error): void;
  progress: Progress | undefined;
}

let worker: Worker | null = null;
/** The Worker could not start here: run in-thread from now on. */
let workerBroken = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Where jobs run: in a Worker, or in-thread (no Workers here, or the Worker failed to start). */
export function exportBackend(): 'worker' | 'inline' {
  return typeof Worker === 'undefined' || workerBroken ? 'inline' : 'worker';
}

/** Runs a job in this thread. */
async function runInline(job: Job, progress: Progress | undefined): Promise<Uint8Array> {
  const { runJob } = await import('./run.ts');
  return runJob(job, progress);
}

function stopWorker(): void {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = null;
}

/** Stops the Worker once nothing is pending for a while. */
function scheduleIdle(): void {
  clearTimeout(idleTimer);
  if (pending.size === 0) idleTimer = setTimeout(stopWorker, IDLE_MS);
}

/** The Worker failed to load: run what it held in-thread. */
function abandonWorker(): void {
  workerBroken = true;
  stopWorker();
  const held = [...pending.values()];
  pending.clear();
  for (const job of held) runInline(job.job, job.progress).then(job.resolve, job.reject);
}

function onMessage(event: MessageEvent<WorkerMessage>): void {
  const message = event.data;
  const job = pending.get(message.id);
  if (!job) return;
  if (message.type === 'progress') {
    job.progress?.(message.done, message.total);
    return;
  }
  pending.delete(message.id);
  if (message.type === 'done') job.resolve(message.bytes);
  else {
    // A trapped module is not reused.
    if (message.fatal) stopWorker();
    job.reject(new Error(message.message));
  }
  scheduleIdle();
}

/** The Worker, started on first use; `null` where there is none. */
function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerBroken || typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'open-artifact-export' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    abandonWorker();
  });
  return worker;
}

/** Runs a job in the Worker, or in-thread without one. */
function run(job: Job, progress: Progress | undefined): Promise<Uint8Array> {
  const target = getWorker();
  if (!target) return runInline(job, progress);
  clearTimeout(idleTimer);
  return new Promise<Uint8Array>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { job, resolve, reject, progress });
    try {
      target.postMessage({ id, job });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
      scheduleIdle();
    }
  });
}

/** DOS time and date of a moment (local time, as zip tools show it). */
function dosTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.min(2107, Math.max(1980, date.getFullYear())) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * The bytes of a zip holding the entries (a later entry with a name already
 * used is dropped). Entries are deflated unless stored on request or by
 * their name (pictures, fonts and other compressed files).
 */
export function packZip(entries: readonly ZipEntry[], options: ZipOptions & { onProgress?: Progress } = {}): Promise<Uint8Array> {
  const { time, date } = dosTime(options.date ?? new Date());
  const level = Math.max(1, Math.min(10, Math.round(options.level ?? 6)));
  return run({ kind: 'zip', entries, time, date, level, optimizePng: options.optimizePng ?? false }, options.onProgress);
}

/**
 * The bytes of a PDF with one picture page per entry: the JPEG fills the
 * page, with an invisible text layer, links and an outline entry where the
 * page has them.
 */
export function buildPdf(pages: readonly PdfPage[], options: PdfOptions & { onProgress?: Progress } = {}): Promise<Uint8Array> {
  return run({ kind: 'pdf', pages, title: options.title, date: (options.date ?? new Date()).getTime() }, options.onProgress);
}

/**
 * A PNG re-compressed losslessly (fewer channels, a palette where few
 * colors, filters per row, best deflate); the bytes as they are when that
 * is not smaller or the picture is not one it reads.
 */
export function optimizePng(data: Uint8Array | Blob, options: PngOptions = {}): Promise<Uint8Array> {
  const level = Math.max(1, Math.min(10, Math.round(options.level ?? 9)));
  return run({ kind: 'png', data, level }, undefined);
}
