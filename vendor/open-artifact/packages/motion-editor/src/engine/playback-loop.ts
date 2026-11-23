/**
 * The playhead. While playing, every animation frame reads the time from the sound player (its audio clock, or the
 * visible clock while there is no sound) and sends the stage a render, as backpressure allows. Paused, a seek sends
 * one render. At the end the film loops or stops ("ended").
 */

import { playSeconds, type PlaySeconds } from '@open-artifact/motion-core';
import type { FilmSoundPlayer } from '@open-artifact/motion-audio';
import { canSendRender, createRenderGate, markHeld, markPresented, markSent, resetGate } from './render-gate.ts';
import type { StageController } from './stage-controller.ts';

/** Playing, the stage counts as behind once renders have waited this long. */
export const BUFFERING_AFTER_MS = 300;

export interface PlaybackTick {
  time: PlaySeconds;
  playing: boolean;
  ended: boolean;
  buffering: boolean;
}

export interface PlaybackLoopOptions {
  stage: StageController;
  sound: FilmSoundPlayer;
  /** The film's length as played (0 while nothing is loaded). */
  duration(): number;
  onTick(tick: PlaybackTick): void;
}

export const clampTime = (t: number, duration: number): PlaySeconds => playSeconds(Math.min(Math.max(0, Number.isFinite(t) ? t : 0), Math.max(0, duration)));

export class PlaybackLoop {
  readonly #stage: StageController;
  readonly #sound: FilmSoundPlayer;
  readonly #duration: () => number;
  readonly #onTick: (tick: PlaybackTick) => void;
  readonly #gate = createRenderGate();
  #time: PlaySeconds = playSeconds(0);
  #playing = false;
  #ended = false;
  #loop = false;
  #wantsPlay = false;
  #frame = 0;
  #heldSince: number | null = null;

  constructor(options: PlaybackLoopOptions) {
    this.#stage = options.stage;
    this.#sound = options.sound;
    this.#duration = options.duration;
    this.#onTick = options.onTick;
  }

  get time(): PlaySeconds {
    return this.#time;
  }

  get playing(): boolean {
    return this.#playing;
  }

  setLoop(loop: boolean): void {
    this.#loop = loop;
  }

  play(): void {
    const duration = this.#duration();
    if (!this.#stage.live || duration <= 0) {
      this.#wantsPlay = true;
      return;
    }
    if (this.#time >= duration) this.#time = playSeconds(0);
    this.#sound.play(this.#time);
    this.#playing = true;
    this.#ended = false;
    this.#push();
    this.#schedule();
  }

  pause(): void {
    this.#wantsPlay = false;
    if (!this.#playing) return;
    this.#sound.pause();
    this.#time = clampTime(this.#sound.now(), this.#duration());
    this.#playing = false;
    this.#push();
  }

  seek(t: number): void {
    this.#time = clampTime(t, this.#duration());
    this.#ended = false;
    this.#sound.seek(this.#time);
    this.#push();
  }

  /** A film is on show: show the playhead's moment on it, and play if asked to before it was ready. */
  stageReady(): void {
    resetGate(this.#gate, this.#stage.lastSent);
    this.#time = clampTime(this.#time, this.#duration());
    this.#push();
    if (this.#wantsPlay || this.#playing) {
      this.#wantsPlay = false;
      if (!this.#playing) this.play();
    }
  }

  presented(seq: number): void {
    if (markPresented(this.#gate, seq)) this.#push();
  }

  /** The stage stopped with an error: stop where it is. */
  halt(): void {
    this.pause();
    this.#wantsPlay = false;
  }

  dispose(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#playing = false;
  }

  #schedule(): void {
    if (this.#frame === 0) this.#frame = requestAnimationFrame(this.#tick);
  }

  readonly #tick = (): void => {
    this.#frame = 0;
    if (!this.#playing) return;
    if (this.#sound.state.interrupted) {
      this.pause();
      return;
    }
    const duration = this.#duration();
    const heard = this.#sound.now();
    if (heard >= duration) {
      if (this.#loop && duration > 0) {
        this.#time = playSeconds(0);
        this.#sound.play(this.#time);
      } else {
        this.#sound.pause();
        this.#sound.seek(playSeconds(duration));
        this.#time = playSeconds(duration);
        this.#playing = false;
        this.#ended = true;
        this.#push();
        return;
      }
    } else this.#time = clampTime(heard, duration);
    this.#push();
    this.#schedule();
  };

  #push(): void {
    if (this.#stage.live && canSendRender(this.#gate)) {
      markSent(this.#gate, this.#stage.render(this.#time, this.#playing));
      this.#heldSince = null;
    } else if (this.#stage.live) {
      markHeld(this.#gate);
      this.#heldSince ??= performance.now();
    }
    const buffering = this.#playing && this.#heldSince !== null && performance.now() - this.#heldSince > BUFFERING_AFTER_MS;
    this.#onTick({ time: this.#time, playing: this.#playing, ended: this.#ended, buffering });
  }
}
