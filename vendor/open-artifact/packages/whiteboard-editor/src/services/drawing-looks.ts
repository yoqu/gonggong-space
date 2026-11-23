/**
 * The look service: paints the textured drawing looks (marker, watercolor,
 * paper) and keeps what it painted.
 *
 * Paintings run in the look worker (on the page when workers are missing),
 * one at a time, only when a view asks for a drawing in view. The paint
 * scale follows the zoom in powers of two, and moves only once the view
 * has been still for {@link LOOK_SETTLE_MS}, so zooming never repaints frame
 * by frame. Each painting is an object URL kept by source, look, scheme and
 * pixel size; a source keeps its two latest paintings per look, and all of
 * them are freed when no drawing on the board uses that source in that
 * look. Until a painting is ready, views draw the plain drawing.
 */

import { decodeSvgDataUrl, imageDrawingLook, unknownSvgParts, type BoardElement, type ColorScheme, type ElementId } from '@open-artifact/whiteboard-core';
import { drawingLookScale, drawingSourceId, isRasterLook, LOOK_SETTLE_MS, lookPaintKey, lookPaintSize, type RasterLook } from '../lib/drawing-looks.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useDrawingLooks } from '../state/drawing-looks.ts';
import { paintLookJob, type LookJob, type LookJobResult } from './drawing-look-paint.ts';

/** A drawing to paint in a look. */
export interface LookRequest {
  src: string;
  look: RasterLook;
  scheme: ColorScheme;
  /** The element's size, board units. */
  w: number;
  h: number;
  scale: number;
}

/** Most paintings kept per source and look. */
const PAINTINGS_PER_SOURCE = 2;
/** How long an export waits for all painted looks, ms. */
export const EXPORT_LOOKS_BUDGET_MS = 12_000;
/** How long an export waits for one painted look, ms. */
export const EXPORT_LOOK_BUDGET_MS = 1_500;

/** A kept painting. */
interface Painting {
  url: string;
  blob: Blob;
  /** Source id and look (`drawingSourceId|look`). */
  group: string;
}

const paintings = new Map<string, Painting>();
const pending = new Map<string, Promise<string | undefined>>();
/** Keys that could not be painted (they stay plain). */
const unpaintable = new Set<string>();

let worker: Worker | null | undefined;
let nextJobId = 1;
const answers = new Map<number, { job: LookJob; resolve: (blob: Blob | null) => void }>();

/** The look worker, started on first use; `null` when this browser cannot run it. */
function lookWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const started = new Worker(new URL('./drawing-look-worker.ts', import.meta.url), { type: 'module', name: 'whiteboard-looks' });
    started.addEventListener('message', (event: MessageEvent<LookJobResult>) => {
      const answer = answers.get(event.data.id);
      answers.delete(event.data.id);
      answer?.resolve(event.data.blob);
    });
    // A worker that fails hands its jobs to the page.
    started.addEventListener('error', () => {
      started.terminate();
      worker = null;
      for (const [id, { job, resolve }] of answers) {
        answers.delete(id);
        void paintLookJob(job).then(resolve);
      }
    });
    worker = started;
  } catch {
    worker = null;
  }
  return worker;
}

/** Paints one job in the worker (or here). */
function runJob(job: LookJob): Promise<Blob | null> {
  const running = lookWorker();
  if (running === null) return paintLookJob(job);
  return new Promise((resolve) => {
    answers.set(job.id, { job, resolve });
    running.postMessage(job);
  });
}

/** The cache key and pixel size of a request. */
export function lookRequestKey(request: LookRequest): { key: string; width: number; height: number } {
  const { width, height } = lookPaintSize(request.w, request.h, request.scale);
  return { key: lookPaintKey(request.src, request.look, request.scheme, width, height), width, height };
}

/** Publishes the kept paintings to the store. */
function publish(): void {
  useDrawingLooks.setState({ painted: new Map([...paintings].map(([key, painting]) => [key, painting.url])) });
}

/** Frees a painting. */
function free(key: string): void {
  const painting = paintings.get(key);
  if (painting === undefined) return;
  paintings.delete(key);
  URL.revokeObjectURL(painting.url);
}

/** Keeps a new painting, letting go of the oldest of its source past {@link PAINTINGS_PER_SOURCE}. */
function keep(key: string, painting: Painting): void {
  paintings.set(key, painting);
  const same = [...paintings].filter(([, other]) => other.group === painting.group).map(([other]) => other);
  for (const old of same.slice(0, Math.max(0, same.length - PAINTINGS_PER_SOURCE))) free(old);
  publish();
}

/**
 * Paints a drawing in a look (once per key; repeated asks share the work).
 * Resolves to its object URL, or `undefined` when it cannot be painted: not
 * a drawing, one that fails vetting (it stays grey), or no canvas to paint on.
 */
export function requestDrawingLook(request: LookRequest): Promise<string | undefined> {
  const { key, width, height } = lookRequestKey(request);
  const ready = paintings.get(key);
  if (ready !== undefined) return Promise.resolve(ready.url);
  if (unpaintable.has(key)) return Promise.resolve(undefined);
  const running = pending.get(key);
  if (running !== undefined) return running;
  const svg = decodeSvgDataUrl(request.src);
  if (svg === undefined || unknownSvgParts(svg).length > 0) {
    unpaintable.add(key);
    return Promise.resolve(undefined);
  }
  const job: LookJob = { id: nextJobId++, svg, look: request.look, scheme: request.scheme, width, height };
  const painting = runJob(job).then((blob) => {
    pending.delete(key);
    if (blob === null) {
      unpaintable.add(key);
      return undefined;
    }
    const url = URL.createObjectURL(blob);
    keep(key, { url, blob, group: `${drawingSourceId(request.src)}|${request.look}` });
    return url;
  });
  pending.set(key, painting);
  return painting;
}

/** Source ids of image elements (elements are immutable, so this is per version). */
const sourceIds = new WeakMap<BoardElement, string>();

/** The `source|look` groups the board's drawings use now. */
function groupsInUse(elements: readonly BoardElement[]): Set<string> {
  const groups = new Set<string>();
  for (const element of elements) {
    if (element.type !== 'image') continue;
    const look = imageDrawingLook(element);
    if (look === undefined || !isRasterLook(look)) continue;
    let id = sourceIds.get(element);
    if (id === undefined) sourceIds.set(element, (id = drawingSourceId(element.src)));
    groups.add(`${id}|${look}`);
  }
  return groups;
}

/** Frees the paintings no drawing on the board uses any more. */
function freeUnused(elements: readonly BoardElement[]): void {
  const groups = groupsInUse(elements);
  const unused = [...paintings].filter(([, painting]) => !groups.has(painting.group)).map(([key]) => key);
  if (unused.length === 0) return;
  for (const key of unused) free(key);
  publish();
}

/**
 * Starts following the zoom (the paint scale moves once the view has been
 * still for {@link LOOK_SETTLE_MS}) and the board (paintings of drawings that
 * left it are freed). Returns a stop function.
 */
export function startDrawingLooks(): () => void {
  const scaleNow = (): number => drawingLookScale(useCamera.getState().camera.zoom, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  useDrawingLooks.setState({ scale: scaleNow() });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offCamera = useCamera.subscribe((state, previous) => {
    if (state.camera === previous.camera) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const scale = scaleNow();
      if (scale !== useDrawingLooks.getState().scale) useDrawingLooks.setState({ scale });
    }, LOOK_SETTLE_MS);
  });
  const offBoard = useBoard.subscribe((state, previous) => {
    if (state.board !== previous.board) freeUnused(state.board.content.elements);
  });
  return () => {
    clearTimeout(timer);
    offCamera();
    offBoard();
    for (const key of [...paintings.keys()]) free(key);
    unpaintable.clear();
    publish();
  };
}

/** Resolves to `undefined` after `ms`, or to what `promise` gives first. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Painted looks for one picture, and how to let them go. */
export interface ExportLooks {
  /** Object URL of each painted drawing, by element id. */
  looks: Map<ElementId, string>;
  release(): void;
}

/**
 * Paints the textured looks of a board's drawings for a picture at `scale`,
 * one by one: each may take {@link EXPORT_LOOK_BUDGET_MS} and all of them
 * {@link EXPORT_LOOKS_BUDGET_MS}. Returns an object URL of its own for each
 * painted drawing (the kept ones may be let go meanwhile); the rest draw
 * plain.
 */
export async function paintLooksForExport(elements: readonly BoardElement[], scheme: ColorScheme, scale: number): Promise<ExportLooks> {
  const looks = new Map<ElementId, string>();
  const deadline = Date.now() + EXPORT_LOOKS_BUDGET_MS;
  for (const element of elements) {
    if (element.type !== 'image') continue;
    const look = imageDrawingLook(element);
    if (look === undefined || !isRasterLook(look)) continue;
    const left = deadline - Date.now();
    if (left <= 0) break;
    const request: LookRequest = { src: element.src, look, scheme, w: element.w, h: element.h, scale: drawingLookScale(scale, 1) };
    await within(requestDrawingLook(request), Math.min(EXPORT_LOOK_BUDGET_MS, left));
    const painting = paintings.get(lookRequestKey(request).key);
    if (painting !== undefined) looks.set(element.id, URL.createObjectURL(painting.blob));
  }
  return {
    looks,
    release() {
      for (const url of looks.values()) URL.revokeObjectURL(url);
      looks.clear();
    },
  };
}
