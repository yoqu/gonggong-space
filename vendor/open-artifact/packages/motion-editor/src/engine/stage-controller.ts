/**
 * Owns the stage: a sandboxed frame running the stage runtime, and the port to it. A frame loads one film only, so
 * every load builds a new frame; the frame on show stays until the new one is ready, so a change never flashes
 * white. Answers from a frame that is gone, and stale answers (`seq` below the last one heard), are dropped. A frame
 * loads its film without the record of what a person did by hand to how things look, which it is given as it comes up.
 *
 * The frame runs on an opaque origin of its own, or on the page's origin (the `stageSameOrigin` flag), under a policy
 * that loads nothing but what it is given and the page's own files.
 */

import { STAGE_PERMISSIONS, STAGE_PROTOCOL_VERSION, openStagePort, stageDocument, stageSandbox } from '@open-artifact/motion-stage';
import type { PlaySeconds, RetouchedRecord } from '@open-artifact/motion-core';
import type { ErrorPhase, HostToStage, RenderMode, StageFilm, StageOrigin, StagePort, StageToHost } from '@open-artifact/motion-stage';
import { videoFlags } from '../host/flags.ts';
import { StageFrameError, StageGoneError } from './frame-errors.ts';
import { ANOTHER_FILM_LOADED, LOAD_TOO_SLOW, NO_FILM_ON_STAGE, STAGE_GONE, STAGE_NAVIGATED, STAGE_VERSION_MISMATCH, frameTimedOut } from './words.ts';

export type ReadyMessage = Extract<StageToHost, { type: 'ready' }>;
export type FrameMessage = Extract<StageToHost, { type: 'frame' }>;

export const STAGE_LOAD_TIMEOUT_MS = 20_000;
export const STAGE_FRAME_TIMEOUT_MS = 15_000;

export interface StageEvents {
  /** A film is on show (the frame that was loading replaced the one before). */
  ready(message: ReadyMessage): void;
  presented(seq: number, t: PlaySeconds, ok: boolean): void;
  error(phase: ErrorPhase, message: string, stack: string): void;
  console(level: 'log' | 'info' | 'warn' | 'error', text: string): void;
  link(href: string): void;
  /** Anything else the stage says (`texts`, `layers`, `looked`, `frame-error` beyond pulls), for later parts of the page. */
  other(message: StageToHost): void;
}

type FramePull = {
  resolve(message: FrameMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Takes a film's failure to load in place of the error event: `true` when it is handled (another film is tried), and
 * the frame that failed is let go without replacing the one on show.
 */
export type LoadFailure = (phase: ErrorPhase, message: string, stack: string) => boolean;

interface StageInstance {
  frame: HTMLIFrameElement;
  port: StagePort | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  film: StageFilm;
  failed: LoadFailure | undefined;
}

export interface StageControllerOptions {
  /** The stage runtime's script text. */
  runtime: string;
  /** The frame's accessible title. */
  title: string;
  events: Partial<StageEvents>;
  /** Where the frames run; the `stageSameOrigin` flag by default. */
  origin?: StageOrigin;
}

/** The origin the flags give the stage. */
export const flaggedStageOrigin = (): StageOrigin => (videoFlags().stageSameOrigin ? 'same' : 'opaque');

export class StageController {
  readonly #runtime: string;
  readonly #title: string;
  readonly #events: Partial<StageEvents>;
  readonly #origin: StageOrigin;
  #container: HTMLElement | null = null;
  #current: StageInstance | null = null;
  #pending: StageInstance | null = null;
  #film: StageFilm | null = null;
  #failed: LoadFailure | undefined;
  /** What a person did by hand to how things look (`retouched.json`), as last given. */
  #retouched: RetouchedRecord | null = null;
  #seq = 0;
  #heard = 0;
  readonly #pulls = new Map<number, FramePull>();

  constructor(options: StageControllerOptions) {
    this.#runtime = options.runtime;
    this.#title = options.title;
    this.#events = options.events;
    this.#origin = options.origin ?? flaggedStageOrigin();
  }

  /** Where the frames run. */
  get origin(): StageOrigin {
    return this.#origin;
  }

  /** The last `seq` sent. */
  get lastSent(): number {
    return this.#seq;
  }

  /** A film is on show and can be sent renders. */
  get live(): boolean {
    return this.#current?.port != null;
  }

  /** The frames live in `container`; moving a frame reloads it, so a new container loads the film again. */
  attach(container: HTMLElement): void {
    if (this.#container === container) return;
    this.#drop();
    this.#container = container;
    if (this.#film !== null) this.load(this.#film, this.#failed);
  }

  detach(container: HTMLElement): void {
    if (this.#container !== container) return;
    this.#drop();
    this.#container = null;
  }

  /**
   * Loads a film in a new frame; the frame on show stays until it is ready. `failed` hears the film's failure to
   * load first (see {@link LoadFailure}).
   */
  load(film: StageFilm, failed?: LoadFailure): void {
    this.#film = film;
    this.#failed = failed;
    const container = this.#container;
    if (container === null) return;
    this.#discard(this.#pending);
    const frame = document.createElement('iframe');
    frame.className = 'vid-stage-frame';
    frame.setAttribute('sandbox', stageSandbox(this.#origin));
    frame.setAttribute('allow', STAGE_PERMISSIONS);
    frame.setAttribute('aria-label', this.#title);
    frame.title = this.#title;
    frame.dataset.state = 'loading';
    if (this.#origin === 'same') frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = stageDocument(this.#runtime, this.#origin);
    const instance: StageInstance = { frame, port: null, timer: undefined, film, failed };
    this.#pending = instance;
    let loads = 0;
    frame.addEventListener('load', () => {
      loads += 1;
      // A frame loads its stage once; another load is the film navigating it (a same-origin film may first drop
      // the frame's sandbox), so it is let go and the film loaded afresh.
      if (loads > 1) return this.#navigated(instance);
      if (this.#pending !== instance) return;
      instance.port = openStagePort(frame, (message) => this.#hear(instance, message), undefined, this.#origin);
      instance.port?.send({ type: 'load', film });
      this.#arm(instance);
    });
    container.appendChild(frame);
  }

  /** Loads the film on show again in a new frame (after the stage navigated away, or by request). */
  reload(): void {
    if (this.#film !== null) this.load(this.#film, this.#failed);
  }

  send(message: HostToStage): void {
    this.#current?.port?.send(message);
  }

  /**
   * Gives the frame on show the record of what a person did by hand to how things look, when it changed. A frame that
   * comes up later takes it before its `ready` is heard, so what that sets off (a reading of the layers) is asked of
   * the film with the record laid. Give it before the stores tell of it, for the same reason.
   */
  retouch(record: RetouchedRecord | null): void {
    if (JSON.stringify(record) === JSON.stringify(this.#retouched)) return;
    this.#retouched = record;
    this.send({ type: 'retouch', record });
  }

  /** Shows the moment `t`; returns the render's `seq`. */
  render(t: PlaySeconds, playing: boolean): number {
    const seq = ++this.#seq;
    this.send({ type: 'render', seq, t, playing });
    return seq;
  }

  setMode(mode: RenderMode): void {
    if (this.#film !== null) this.#film = { ...this.#film, mode };
    this.send({ type: 'mode', mode });
  }

  /**
   * A snapshot of the stage at `t` (an SVG document). Rejects with a {@link StageFrameError} when the stage fails it,
   * does not answer in time or loads another film meanwhile, and with a {@link StageGoneError} when there is no film.
   */
  pullFrame(request: { t: PlaySeconds; scale: number; smallMedia?: boolean; readFx?: boolean; smooth?: boolean }): Promise<FrameMessage> {
    const port = this.#current?.port;
    if (port == null) return Promise.reject(new StageGoneError(NO_FILM_ON_STAGE));
    const seq = ++this.#seq;
    return new Promise<FrameMessage>((resolve, reject) => {
      const late = (): void =>
        this.#settlePull(seq, new StageFrameError(frameTimedOut(request.t, STAGE_FRAME_TIMEOUT_MS / 1000), { hold: true, env: true }));
      const timer = setTimeout(late, STAGE_FRAME_TIMEOUT_MS);
      this.#pulls.set(seq, { resolve, reject, timer });
      port.send({
        type: 'frame',
        seq,
        t: request.t,
        scale: request.scale,
        smallMedia: request.smallMedia ?? true,
        readFx: request.readFx ?? false,
        smooth: request.smooth ?? false,
      });
    });
  }

  dispose(): void {
    this.#drop();
    this.#container = null;
    this.#film = null;
    this.#failed = undefined;
  }

  #arm(instance: StageInstance): void {
    if (instance.timer !== undefined) clearTimeout(instance.timer);
    instance.timer = setTimeout(() => {
      instance.timer = undefined;
      if (this.#pending !== instance) return;
      this.#loadFailed(instance, LOAD_TOO_SLOW, '');
    }, STAGE_LOAD_TIMEOUT_MS);
  }

  /** A pending film failed to load: tried again as its caller says, else shown as the error. */
  #loadFailed(instance: StageInstance, message: string, stack: string): void {
    if (instance.failed?.('load', message, stack) === true) {
      if (this.#pending === instance) this.#discard(instance);
      return;
    }
    this.#promote(instance);
    this.#events.error?.('load', message, stack);
  }

  #navigated(instance: StageInstance): void {
    if (this.#pending === instance) return this.#loadFailed(instance, STAGE_NAVIGATED, '');
    if (this.#current !== instance) return;
    this.#discard(instance);
    // The stage said it was going (`navigating`), and its film is loading again already.
    if (this.#pending === null) this.reload();
  }

  #hear(instance: StageInstance, message: StageToHost): void {
    const isPending = this.#pending === instance;
    if (!isPending && this.#current !== instance) return;
    switch (message.type) {
      case 'hello':
        if (message.version !== STAGE_PROTOCOL_VERSION) {
          if (isPending) this.#promote(instance);
          this.#events.error?.('load', STAGE_VERSION_MISMATCH, '');
          return;
        }
        if (isPending) this.#arm(instance);
        return;
      case 'ready':
        if (isPending) {
          this.#promote(instance);
          if (this.#retouched !== null) instance.port?.send({ type: 'retouch', record: this.#retouched });
        }
        this.#events.ready?.(message);
        return;
      case 'error':
        if (isPending && message.phase === 'load') return this.#loadFailed(instance, message.message, message.stack);
        this.#events.error?.(message.phase, message.message, message.stack);
        return;
      case 'console':
        this.#events.console?.(message.level, message.text);
        return;
      case 'presented':
        if (isPending || message.seq < this.#heard) return;
        this.#heard = message.seq;
        this.#events.presented?.(message.seq, message.t, message.ok);
        return;
      case 'frame':
        this.#settlePull(message.seq, message);
        return;
      case 'frame-error':
        if (this.#pulls.has(message.seq)) this.#settlePull(message.seq, new StageFrameError(message.message, message));
        else this.#events.other?.(message);
        return;
      case 'navigating':
        if (!isPending) this.reload();
        return;
      case 'link':
        this.#events.link?.(message.href);
        return;
      case 'texts':
      case 'layers':
      case 'looked':
        this.#events.other?.(message);
        return;
      default: {
        const never: never = message;
        void never;
      }
    }
  }

  #settlePull(seq: number, outcome: FrameMessage | Error): void {
    const pull = this.#pulls.get(seq);
    if (pull === undefined) return;
    this.#pulls.delete(seq);
    clearTimeout(pull.timer);
    if (outcome instanceof Error) pull.reject(outcome);
    else pull.resolve(outcome);
  }

  #promote(instance: StageInstance): void {
    if (instance.timer !== undefined) clearTimeout(instance.timer);
    instance.timer = undefined;
    this.#rejectPulls(new StageFrameError(ANOTHER_FILM_LOADED, { hold: true, env: true }));
    this.#discard(this.#current);
    this.#current = instance;
    this.#pending = null;
    this.#heard = this.#seq;
    instance.frame.dataset.state = 'ready';
  }

  #rejectPulls(error: Error): void {
    for (const seq of [...this.#pulls.keys()]) this.#settlePull(seq, error);
  }

  #discard(instance: StageInstance | null): void {
    if (instance === null) return;
    if (instance.timer !== undefined) clearTimeout(instance.timer);
    instance.port?.close();
    instance.frame.remove();
    if (this.#pending === instance) this.#pending = null;
    if (this.#current === instance) this.#current = null;
  }

  #drop(): void {
    this.#rejectPulls(new StageGoneError(STAGE_GONE));
    this.#discard(this.#pending);
    this.#discard(this.#current);
  }
}
