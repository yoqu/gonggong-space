import { SNAPSHOT_SETTINGS, type PlaySeconds } from '@open-artifact/motion-core';
import { STAGE_SANDBOX, openStagePort, stageDocument } from '../host.ts';
import type { StagePort } from '../host.ts';
import { OFFLINE_RUNTIME_ID } from '../offline/data.ts';
import { STAGE_PROTOCOL_VERSION } from '../protocol.ts';
import type { HostToStage, NarrationReport, PlayedScore, StageFilm, StageMeta, StageToHost } from '../protocol.ts';
import { drawSnapshot, makeHoldFirstDraw, whyNoDecode } from '../raster.ts';
import { toolsFilm } from './film.ts';
import { scoreReport } from './score.ts';
import { TOOLS_GLOBAL } from './types.ts';
import type { FilmTools, ToolsFiles, ToolsLoad, ToolsLogLine } from './types.ts';

type FrameReply = Extract<StageToHost, { type: 'frame' }>;
type FrameAsk = Extract<HostToStage, { type: 'frame' }>;

const LOAD_TIMEOUT_MS = 60000;
/** The stage's own budget for a pull is 12 s, with its render; the page gives it 15. */
const FRAME_TIMEOUT_MS = 15000;
const SHOW_TIMEOUT_MS = 15000;

interface Waiter<T> {
  resolve(value: T): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Loaded {
  meta: StageMeta;
  score: PlayedScore | null;
  narration: NarrationReport | null;
}

interface Mounted {
  frame: HTMLIFrameElement;
  port: StagePort | null;
  film: StageFilm;
  loaded: Loaded | null;
  settle: { resolve(loaded: Loaded): void; reject(error: Error): void };
  shows: Map<number, Waiter<void>>;
  pulls: Map<number, Waiter<FrameReply>>;
}

const holdFirstDraw = makeHoldFirstDraw();
let log: ToolsLogLine[] = [];
let mounted: Mounted | null = null;
let seq = 0;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function wait<T>(waiters: Map<number, Waiter<T>>, at: number, ms: number, late: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(at);
      reject(new Error(late));
    }, ms);
    waiters.set(at, { resolve, reject, timer });
  });
}

function rejectAll<T>(waiters: Map<number, Waiter<T>>, error: Error): void {
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  waiters.clear();
}

function unmount(why: string): void {
  if (mounted === null) return;
  const gone = mounted;
  mounted = null;
  const error = new Error(why);
  gone.settle.reject(error);
  rejectAll(gone.shows, error);
  rejectAll(gone.pulls, error);
  gone.port?.close();
  gone.frame.remove();
}

function hear(own: Mounted, message: StageToHost): void {
  if (mounted !== own) return;
  switch (message.type) {
    case 'hello':
      if (message.version !== STAGE_PROTOCOL_VERSION) own.settle.reject(new Error('the stage speaks version ' + message.version + ', not ' + STAGE_PROTOCOL_VERSION));
      return;
    case 'ready':
      own.settle.resolve({ meta: message.meta, score: message.score, narration: message.narration });
      return;
    case 'presented':
      for (const [at, waiter] of own.shows) {
        if (at > message.seq) continue;
        clearTimeout(waiter.timer);
        own.shows.delete(at);
        waiter.resolve();
      }
      return;
    case 'frame': {
      const waiter = own.pulls.get(message.seq);
      if (waiter === undefined) return;
      clearTimeout(waiter.timer);
      own.pulls.delete(message.seq);
      waiter.resolve(message);
      return;
    }
    case 'frame-error': {
      const waiter = own.pulls.get(message.seq);
      if (waiter === undefined) return;
      clearTimeout(waiter.timer);
      own.pulls.delete(message.seq);
      waiter.reject(new Error(message.message));
      return;
    }
    case 'console':
      log.push({ level: message.level, text: message.text });
      return;
    case 'error':
      log.push({ level: 'error', text: message.message + (message.stack ? '\n' + message.stack : ''), phase: message.phase });
      if (message.phase === 'load' && own.loaded === null) own.settle.reject(new Error(message.message));
      return;
    case 'navigating':
      unmount('the stage navigated away, so the film is gone');
      return;
    case 'texts':
    case 'layers':
    case 'looked':
    case 'link':
      return;
    default: {
      const never: never = message;
      void never;
    }
  }
}

function mount(film: StageFilm, runtime: string): { own: Mounted; ready: Promise<Loaded> } {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', STAGE_SANDBOX);
  frame.title = 'Film';
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent';
  frame.srcdoc = stageDocument(runtime);
  let settle: Mounted['settle'] = { resolve: () => undefined, reject: () => undefined };
  const ready = new Promise<Loaded>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const own: Mounted = { frame, port: null, film, loaded: null, settle, shows: new Map(), pulls: new Map() };
  mounted = own;
  frame.addEventListener(
    'load',
    () => {
      own.port = openStagePort(frame, (message) => hear(own, message));
      own.port?.send({ type: 'load', film });
    },
    { once: true },
  );
  document.body.appendChild(frame);
  const timer = setTimeout(() => settle.reject(new Error('the film did not load within ' + LOAD_TIMEOUT_MS / 1000 + ' s')), LOAD_TIMEOUT_MS);
  return { own, ready: ready.finally(() => clearTimeout(timer)) };
}

function ready(): { own: Mounted; loaded: Loaded } {
  const own = mounted;
  if (own === null || own.loaded === null) throw new Error('no film is loaded: call load(files) first, and wait for it');
  return { own, loaded: own.loaded };
}

const within = (t: number, meta: StageMeta): PlaySeconds => Math.max(0, Math.min(meta.duration, Number.isFinite(t) ? t : 0)) as PlaySeconds;

/** The snapshot drawn as an export draws it, read back as a PNG. */
function raster(reply: FrameReply, waitMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => {
      holdFirstDraw(reply.svg, waitMs, () => {
        drawSnapshot(picture, reply.pw, reply.ph)
          .then((surface) => {
            let canvas = surface;
            if (!(canvas instanceof HTMLCanvasElement)) {
              const copy = document.createElement('canvas');
              copy.width = reply.pw;
              copy.height = reply.ph;
              copy.getContext('2d')?.drawImage(canvas, 0, 0);
              canvas.close();
              canvas = copy;
            }
            resolve(canvas.toDataURL('image/png'));
          })
          .catch((error: unknown) => reject(new Error('the snapshot could not be drawn: ' + messageOf(error))));
      });
    };
    picture.onerror = () => reject(new Error('snapshot decode failed (foreignObject)' + whyNoDecode(reply.svg)));
    picture.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(reply.svg);
  });
}

const tools: FilmTools = {
  version: 1,
  async load(files: ToolsFiles): Promise<ToolsLoad> {
    unmount('another film was loaded');
    log = [];
    const runtime = document.getElementById(OFFLINE_RUNTIME_ID)?.textContent ?? null;
    if (runtime === null) return { error: { message: 'this page has no stage runtime' }, problems: [] };
    const read = toolsFilm(files);
    if (read.film === null) return { error: { message: read.problems[0] ?? 'the film cannot be read' }, problems: read.problems.slice(1) };
    const { own, ready: loading } = mount(read.film, runtime);
    try {
      const loaded = await loading;
      own.loaded = loaded;
      return { meta: loaded.meta, problems: read.problems };
    } catch (error) {
      if (mounted === own) unmount('the film failed to load');
      return { error: { message: messageOf(error) }, problems: read.problems };
    }
  },
  seek(t: number): Promise<void> {
    const { own, loaded } = ready();
    const at = ++seq;
    const shown = wait(own.shows, at, SHOW_TIMEOUT_MS, 'the stage did not show ' + t + ' s in time');
    own.port?.send({ type: 'render', seq: at, t: within(t, loaded.meta), playing: false });
    return shown;
  },
  async frame(t, options = {}): Promise<string> {
    const { own, loaded } = ready();
    const scale = options.scale ?? 1;
    if (!(scale > 0 && scale <= 4)) throw new Error('scale must be above 0 and at most 4, not ' + String(options.scale));
    const at = ++seq;
    const reply = wait(own.pulls, at, FRAME_TIMEOUT_MS, 'the stage did not answer for the frame at ' + t + ' s in time');
    const ask: FrameAsk = {
      type: 'frame',
      seq: at,
      t: within(t, loaded.meta),
      scale,
      smallMedia: false,
      readFx: SNAPSHOT_SETTINGS.fx === 'read',
      smooth: false,
    };
    own.port?.send(ask);
    return raster(await reply, own.film.clippedTextWaitMs);
  },
  scoreReport() {
    const loaded = mounted?.loaded ?? null;
    return loaded === null ? null : scoreReport(loaded.score, loaded.narration);
  },
  consoleLog() {
    return log.slice();
  },
};

Reflect.set(window, TOOLS_GLOBAL, tools);
