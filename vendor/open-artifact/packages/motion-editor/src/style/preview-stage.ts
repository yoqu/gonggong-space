/**
 * A hidden stage of the Style tab's own, which draws the film in a palette it has not picked, so the previews never
 * redraw the film on show. One film at a time: a load replaces the one before.
 */

import type { StageFilm, StageMeta } from '@open-artifact/motion-stage';
import { playSeconds } from '@open-artifact/motion-core';
import { StageController, type FrameMessage } from '../engine/stage-controller.ts';
import { PREVIEW_STAGE_TITLE } from '../engine/words.ts';

/** How long a preview film may take to load before it counts as failed. */
export const PREVIEW_LOAD_TIMEOUT_MS = 20_000;

export class StylePreviewStage {
  readonly #runtime: string;
  #stage: StageController | null = null;
  #host: HTMLDivElement | null = null;
  #settle: ((meta: StageMeta | null) => void) | null = null;

  constructor(runtime: string) {
    this.#runtime = runtime;
  }

  /** Loads a film; its meta once it is on show, `null` when it failed or took too long. */
  load(film: StageFilm): Promise<StageMeta | null> {
    const stage = this.#stage ?? this.#make();
    this.#settle?.(null);
    return new Promise<StageMeta | null>((resolve) => {
      const timer = setTimeout(() => settle(null), PREVIEW_LOAD_TIMEOUT_MS);
      const settle = (meta: StageMeta | null): void => {
        clearTimeout(timer);
        if (this.#settle === settle) this.#settle = null;
        resolve(meta);
      };
      this.#settle = settle;
      stage.load(film);
    });
  }

  /** A snapshot of the film on show at `t`, `scale` times its size. */
  frame(t: number, scale: number): Promise<FrameMessage> {
    if (this.#stage === null) return Promise.reject(new Error('no preview stage'));
    return this.#stage.pullFrame({ t: playSeconds(t), scale, smallMedia: true, readFx: true, smooth: false });
  }

  dispose(): void {
    this.#settle?.(null);
    this.#stage?.dispose();
    this.#host?.remove();
    this.#stage = null;
    this.#host = null;
  }

  #make(): StageController {
    const host = document.createElement('div');
    // On screen but unseen: browsers throttle frames that are off screen or hidden, which would stall the pulls.
    host.style.cssText = 'position:fixed;right:0;bottom:0;width:192px;height:108px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden';
    host.setAttribute('aria-hidden', 'true');
    host.dataset.stylePreview = '';
    document.body.appendChild(host);
    const stage = new StageController({
      runtime: this.#runtime,
      title: PREVIEW_STAGE_TITLE,
      events: {
        ready: (message) => this.#settle?.(message.meta),
        error: (phase) => {
          if (phase === 'load') this.#settle?.(null);
        },
      },
    });
    stage.attach(host);
    this.#host = host;
    this.#stage = stage;
    return stage;
  }
}
