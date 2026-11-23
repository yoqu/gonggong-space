import { EXPORT_SETTINGS } from '@open-artifact/motion-core';
import { STAGE_SANDBOX } from '@open-artifact/motion-stage';
import { RasterDecodeError, RasterGoneError, RasterStallError, SnapshotLimitError } from '../errors.ts';
import { words } from '../words.ts';
import { FOREIGN_OBJECT_TEST_SVG, rasterDocument } from './document.ts';
import { readRasterReply } from './messages.ts';
import type { RasterRequest } from './messages.ts';

/** Turns a snapshot's SVG into an ImageBitmap, in a hidden frame of its own. */
export interface RasterHost {
  raster(svg: string, pw: number, ph: number): Promise<ImageBitmap>;
  dispose(): void;
}

/** When a raster frame is replaced by a fresh one: browsers keep every picture a frame decoded until it goes. */
export interface RasterCache {
  /** How many requests ahead a replacement frame is made. */
  nextAhead: number;
  /** Requests at most in one frame, however it fares. */
  keepMax: number;
  /** Characters of SVG at most in one frame, however it fares. */
  keepMaxChars: number;
}

export const RASTER_USES = 120;
export const RASTER_CHARS = 167_772_160;
export const RASTER_REPLY_TIMEOUT_MS = 15_000;
export const MAX_RASTER_SVG_CHARS = 67_108_864;
export const MAX_RASTER_SIDE = 8192;

export const DEFAULT_RASTER_CACHE: RasterCache = {
  nextAhead: EXPORT_SETTINGS.rasterNextAhead,
  keepMax: EXPORT_SETTINGS.rasterKeepMax,
  keepMaxChars: EXPORT_SETTINGS.rasterKeepMaxMb * 1_048_576,
};

export interface RasterHostOptions {
  /** The raster frame's script (`virtual:motion-raster-frame`, or `buildRasterFrame()`). */
  script: string;
  document?: Document;
  clippedTextWaitMs?: () => number;
  cache?: RasterCache;
}

interface Pending {
  resolve(bitmap: ImageBitmap): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Session {
  frame: HTMLIFrameElement;
  ready: Promise<void>;
  drew: boolean;
  waited: number;
  born: number;
  stalled: boolean;
  uses: number;
  chars: number;
  pending: Map<number, Pending>;
  off(): void;
}

const HIDDEN_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  left: '-10000px',
  top: '0',
  width: '4px',
  height: '4px',
  border: '0',
  opacity: '0',
  pointerEvents: 'none',
};

export function createRasterHost(options: RasterHostOptions): RasterHost {
  const page = options.document ?? document;
  const view = page.defaultView ?? window;
  const cache = options.cache ?? DEFAULT_RASTER_CACHE;
  const waitMs = options.clippedTextWaitMs ?? (() => EXPORT_SETTINGS.clippedTextWaitMs);
  const html = rasterDocument(options.script);
  const sessions = new Set<Session>();
  let active: Session | null = null;
  let queued: Session | null = null;
  // How many replacements in a row may time out before making one waits longer.
  let generation = 1;
  let sequence = 0;
  let disposed = false;

  function close(session: Session): void {
    for (const [, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RasterGoneError(words.rasterGone));
    }
    session.pending.clear();
    session.frame.remove();
    session.off();
    sessions.delete(session);
  }

  function take(session: Session, rid: number): Pending | undefined {
    const pending = session.pending.get(rid);
    if (!pending) return undefined;
    session.pending.delete(rid);
    clearTimeout(pending.timer);
    if (session !== active && session.pending.size === 0) close(session);
    return pending;
  }

  const worn = (session: Session, extraChars: number): boolean =>
    session.stalled || session.uses >= RASTER_USES || session.chars + extraChars > RASTER_CHARS;

  function rotate(): Session {
    const old = active;
    const next = queued ?? open();
    active = next;
    queued = null;
    if (old !== null && old.pending.size === 0) close(old);
    return next;
  }

  function open(): Session {
    const frame = page.createElement('iframe');
    frame.setAttribute('sandbox', STAGE_SANDBOX);
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('inert', '');
    frame.tabIndex = -1;
    Object.assign(frame.style, HIDDEN_FRAME_STYLE);
    const session: Session = {
      frame,
      ready: Promise.resolve(),
      drew: false,
      waited: 0,
      born: sequence,
      stalled: false,
      uses: 0,
      chars: 0,
      pending: new Map(),
      off: () => undefined,
    };
    session.ready = new Promise<void>((resolve) => {
      const listen = (event: MessageEvent<unknown>): void => {
        if (event.source === null || event.source !== frame.contentWindow) return;
        const reply = readRasterReply(event.data);
        switch (reply.kind) {
          case 'ready': {
            const warmUp: RasterRequest = { rid: 0, svg: FOREIGN_OBJECT_TEST_SVG, pw: 2, ph: 2 };
            frame.contentWindow?.postMessage(warmUp, '*');
            resolve();
            return;
          }
          case 'bitmap': {
            session.drew = true;
            if (session === queued && active !== null && worn(active, 0)) rotate();
            const pending = take(session, reply.rid);
            if (pending) pending.resolve(reply.bitmap);
            else reply.bitmap.close();
            return;
          }
          case 'error':
            take(session, reply.rid)?.reject(new RasterDecodeError(reply.message));
            return;
          case 'other':
            return;
          default: {
            const never: never = reply;
            return never;
          }
        }
      };
      session.off = () => view.removeEventListener('message', listen);
      view.addEventListener('message', listen);
    });
    frame.srcdoc = html;
    (page.body ?? page.documentElement).appendChild(frame);
    sessions.add(session);
    return session;
  }

  function pick(chars: number): Session {
    if (active !== null && (active.uses >= RASTER_USES - cache.nextAhead || active.chars + chars * cache.nextAhead > RASTER_CHARS)) queued ??= open();
    const replace =
      active === null ||
      (worn(active, chars) && queued?.drew === true) ||
      active.uses >= cache.keepMax ||
      active.chars + chars > cache.keepMaxChars;
    return replace || active === null ? rotate() : active;
  }

  return {
    raster(svg, pw, ph) {
      if (disposed) return Promise.reject(new RasterGoneError(words.rasterGone));
      if (svg.length > MAX_RASTER_SVG_CHARS) return Promise.reject(new SnapshotLimitError(words.snapshotTooLarge));
      if (!(pw >= 1 && pw <= MAX_RASTER_SIDE && ph >= 1 && ph <= MAX_RASTER_SIDE))
        return Promise.reject(new SnapshotLimitError(words.snapshotOutOfRange));
      const session = pick(svg.length);
      session.uses += 1;
      session.chars += svg.length;
      const rid = ++sequence;
      return new Promise<ImageBitmap>((resolve, reject) => {
        const late = (): void => {
          if (session === active) {
            session.stalled = true;
            if (queued?.drew === true) rotate();
            else if (queued !== null && queued.born < rid) {
              // A replacement that never drew either: drop it, and wait twice as long for the next one.
              queued.born = sequence;
              queued.waited += 1;
              if (queued.waited >= generation) {
                close(queued);
                queued = null;
                generation = Math.min(16, generation * 2);
              }
            }
            if (session === active) queued ??= open();
          }
          if (take(session, rid)) reject(new RasterStallError(words.rasterTimedOut));
        };
        session.pending.set(rid, { resolve, reject, timer: setTimeout(late, RASTER_REPLY_TIMEOUT_MS) });
        void session.ready.then(() => {
          if (!session.pending.has(rid)) return;
          const request: RasterRequest = { rid, svg, pw: Math.round(pw), ph: Math.round(ph), waitMs: waitMs() };
          session.frame.contentWindow?.postMessage(request, '*');
        });
      });
    },
    dispose() {
      disposed = true;
      active = null;
      queued = null;
      for (const session of [...sessions]) close(session);
    },
  };
}
