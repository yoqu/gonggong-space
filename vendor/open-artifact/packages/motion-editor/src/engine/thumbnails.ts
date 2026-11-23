/**
 * Stills of the film for the timeline, pulled from a second stage of its own so a pull never redraws the one on
 * show. The preview stage is made on the first request and loads a changed film only when a still is asked of it.
 * Stills are kept by film revision and frame; one pull runs at a time.
 */

import type { PlaySeconds } from '@open-artifact/motion-core';
import type { StageFilm } from '@open-artifact/motion-stage';
import { StageController } from './stage-controller.ts';
import { PREVIEW_STAGE_TITLE } from './words.ts';

export const MAX_KEPT_STILLS = 160;

/** The key a still is kept under: the same frame of the same film at the same width is the same still. */
export const stillKey = (revision: number, t: number, fps: number, width: number): string =>
  `${revision}:${Math.round(t * (fps > 0 ? fps : 30))}:${Math.round(width)}`;

export class ThumbnailCache {
  readonly #runtime: string;
  #stage: StageController | null = null;
  #host: HTMLDivElement | null = null;
  #film: StageFilm | null = null;
  #revision = -1;
  #loadedRevision = -1;
  #filmWidth = 0;
  #ready: Promise<boolean> | null = null;
  #settleReady: ((ok: boolean) => void) | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #stills = new Map<string, string>();
  readonly #asked = new Map<string, Promise<string | null>>();

  constructor(runtime: string) {
    this.#runtime = runtime;
  }

  /** A new film to take stills of; stills of the one before are let go. */
  setFilm(film: StageFilm, revision: number): void {
    this.#film = film;
    this.#revision = revision;
    this.#clear();
  }

  /** A still already taken, if any. */
  peek(t: PlaySeconds, fps: number, width: number): string | undefined {
    return this.#stills.get(stillKey(this.#revision, t, fps, width));
  }

  /** A still of the moment `t`, `width` pixels wide, as an image URL; `null` when the stage could not give one. */
  get(t: PlaySeconds, fps: number, width: number): Promise<string | null> {
    const key = stillKey(this.#revision, t, fps, width);
    const kept = this.#stills.get(key);
    if (kept !== undefined) return Promise.resolve(kept);
    const asked = this.#asked.get(key);
    if (asked !== undefined) return asked;
    const revision = this.#revision;
    const pull = this.#queue.then(() => this.#pull(key, revision, t, width));
    this.#queue = pull.catch(() => null);
    this.#asked.set(key, pull);
    void pull.finally(() => this.#asked.delete(key));
    return pull;
  }

  dispose(): void {
    this.#clear();
    this.#stage?.dispose();
    this.#host?.remove();
    this.#stage = null;
    this.#host = null;
  }

  async #pull(key: string, revision: number, t: PlaySeconds, width: number): Promise<string | null> {
    if (revision !== this.#revision) return null;
    const ready = await this.#loaded();
    if (!ready || revision !== this.#revision || this.#stage === null || this.#filmWidth <= 0) return null;
    try {
      const frame = await this.#stage.pullFrame({ t, scale: width / this.#filmWidth, smallMedia: true, readFx: false, smooth: false });
      if (revision !== this.#revision) return null;
      const url = URL.createObjectURL(new Blob([frame.svg], { type: 'image/svg+xml' }));
      this.#keep(key, url);
      return url;
    } catch {
      return null;
    }
  }

  #loaded(): Promise<boolean> {
    if (this.#film === null) return Promise.resolve(false);
    if (this.#ready !== null && this.#loadedRevision === this.#revision) return this.#ready;
    const stage = this.#stage ?? this.#makeStage();
    this.#settleReady?.(false);
    this.#ready = new Promise<boolean>((resolve) => {
      this.#settleReady = resolve;
    });
    this.#loadedRevision = this.#revision;
    stage.load(this.#film);
    return this.#ready;
  }

  #makeStage(): StageController {
    const host = document.createElement('div');
    // On screen but unseen: browsers throttle frames that are off screen or hidden, which would stall the pulls.
    host.style.cssText = 'position:fixed;right:0;bottom:0;width:192px;height:108px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    const stage = new StageController({
      runtime: this.#runtime,
      title: PREVIEW_STAGE_TITLE,
      events: {
        ready: (message) => {
          this.#filmWidth = message.meta.width;
          this.#settleReady?.(true);
          this.#settleReady = null;
        },
        error: (phase) => {
          if (phase !== 'load') return;
          this.#settleReady?.(false);
          this.#settleReady = null;
        },
      },
    });
    stage.attach(host);
    this.#host = host;
    this.#stage = stage;
    return stage;
  }

  #keep(key: string, url: string): void {
    this.#stills.set(key, url);
    while (this.#stills.size > MAX_KEPT_STILLS) {
      const [oldest, oldUrl] = this.#stills.entries().next().value ?? [];
      if (oldest === undefined || oldUrl === undefined) break;
      this.#stills.delete(oldest);
      URL.revokeObjectURL(oldUrl);
    }
  }

  #clear(): void {
    for (const url of this.#stills.values()) URL.revokeObjectURL(url);
    this.#stills.clear();
    this.#asked.clear();
  }
}
