import type { PlaySeconds } from '@open-artifact/motion-core';
import { STAGE_SANDBOX, openStagePort, stageDocument } from '../host.ts';
import type { StagePort } from '../host.ts';
import { STAGE_PROTOCOL_VERSION } from '../protocol.ts';
import type { StageFilm, StageMeta, StageToHost } from '../protocol.ts';
import type { ScorePlayer } from './audio.ts';

export interface PlayerOptions {
  container: HTMLElement;
  film: StageFilm;
  /** The stage runtime's script text. */
  runtime: string;
  audio: ScorePlayer | null;
}

export interface OfflinePlayer {
  ready: Promise<StageMeta>;
  seek(t: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  readonly playing: boolean;
  readonly time: PlaySeconds;
  /** Told when playing starts or stops, by a call or at the end. */
  onChange: (() => void) | null;
}

const played = (t: number): PlaySeconds => t as PlaySeconds;

/** A film on its own page: the stage in a sandboxed frame, a clock, and the sound it is given. */
export function mountPlayer(options: PlayerOptions): OfflinePlayer {
  const { container, film, audio } = options;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', STAGE_SANDBOX);
  frame.title = 'Film';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent';
  frame.srcdoc = stageDocument(options.runtime);

  let port: StagePort | null = null;
  let meta: StageMeta | null = null;
  let seq = 0;
  let at = 0;
  let playing = false;
  let wantsPlay = false;
  /** While playing without sound: the real moment and played time it started from. */
  let started = { real: 0, t: 0 };
  let ticking = 0;
  let settle: { resolve(meta: StageMeta): void; reject(error: Error): void } = { resolve: () => undefined, reject: () => undefined };
  const ready = new Promise<StageMeta>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // A failed load is told through the console as well; an unheard rejection would only add noise.
  ready.catch(() => undefined);

  const duration = (): number => meta?.duration ?? 0;
  const show = (): void => port?.send({ type: 'render', seq: ++seq, t: played(at), playing });

  const tick = (): void => {
    ticking = 0;
    if (!playing) return;
    const heard = audio?.now() ?? null;
    at = heard ?? started.t + (performance.now() - started.real) / 1000;
    if (at >= duration()) {
      at = duration();
      stop();
      show();
      return;
    }
    show();
    ticking = requestAnimationFrame(tick);
  };

  const begin = (): void => {
    if (!meta) {
      wantsPlay = true;
      return;
    }
    if (at >= duration()) at = 0;
    playing = true;
    started = { real: performance.now(), t: at };
    try {
      audio?.start(played(at));
    } catch (error) {
      console.warn('the film’s sound did not start: ' + String(error));
    }
    if (!ticking) ticking = requestAnimationFrame(tick);
    handle.onChange?.();
  };

  function stop(): void {
    wantsPlay = false;
    if (!playing) return;
    playing = false;
    audio?.stop();
    if (ticking) cancelAnimationFrame(ticking);
    ticking = 0;
    handle.onChange?.();
  }

  const hear = (message: StageToHost): void => {
    switch (message.type) {
      case 'hello':
        if (message.version !== STAGE_PROTOCOL_VERSION) settle.reject(new Error('the stage speaks version ' + message.version + ', not ' + STAGE_PROTOCOL_VERSION));
        return;
      case 'ready': {
        meta = message.meta;
        const loaded = message.meta;
        void (audio?.prepare(message.score, message.narration, loaded.duration) ?? Promise.resolve()).then(
          () => undefined,
          (error: unknown) => console.warn('the film’s sound could not be prepared, so it plays silent: ' + String(error)),
        );
        settle.resolve(loaded);
        show();
        if (wantsPlay) begin();
        return;
      }
      case 'console':
        console[message.level](message.text);
        return;
      case 'error':
        console.error(message.message + (message.stack ? '\n' + message.stack : ''));
        if (message.phase === 'load' && !meta) settle.reject(new Error(message.message));
        return;
      case 'link':
        window.open(message.href, '_blank', 'noopener,noreferrer');
        return;
      case 'navigating':
        stop();
        return;
      case 'presented':
      case 'frame':
      case 'frame-error':
      case 'texts':
      case 'layers':
      case 'looked':
        return;
      default: {
        const never: never = message;
        void never;
      }
    }
  };

  frame.addEventListener(
    'load',
    () => {
      port = openStagePort(frame, hear);
      port?.send({ type: 'load', film });
    },
    { once: true },
  );
  container.appendChild(frame);

  const handle: OfflinePlayer = {
    ready,
    seek(t) {
      at = Math.max(0, Math.min(duration(), Number(t) || 0));
      if (playing) {
        audio?.stop();
        started = { real: performance.now(), t: at };
        audio?.start(played(at));
      }
      show();
    },
    play: begin,
    pause() {
      stop();
      show();
    },
    toggle() {
      if (playing) {
        stop();
        show();
      } else begin();
    },
    get playing() {
      return playing;
    },
    get time() {
      return played(at);
    },
    onChange: null,
  };
  return handle;
}
