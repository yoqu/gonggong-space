/**
 * A stage of its own for flash checks, so frames pulled for a check never redraw the one on show. It loads the film
 * as the page shows it but without its recut, so it plays at the film's own pace, and is let go once checks rest.
 */

import { RECUT_MODULE, type Film, type FilmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { StageFilm } from '@open-artifact/motion-stage';
import { applyFilmRecords } from '../engine/applied-film.ts';
import { filmStageFaces } from '../engine/film-faces.ts';
import { readFilmRecords } from '../engine/records.ts';
import { StageController } from '../engine/stage-controller.ts';
import { buildStageFilm } from '../engine/stage-film.ts';
import { assetBytes, assetUrl } from '../host/assets.ts';
import { pageFontsIo } from '../host/fonts.ts';
import type { PulledFrame } from './inspect.ts';
import { CHECK_STAGE_TITLE } from './words.ts';

/** The check stage is let go after this long without a check (ms). */
export const CHECK_STAGE_IDLE_MS = 20_000;

/** What the check stage loads for `film`: its code with a person's records applied, its recut left out. */
export async function checkStageFilm(film: Film): Promise<StageFilm> {
  const unrecut = { ...film, modules: film.modules.filter((module) => module.name !== RECUT_MODULE) };
  const applied = applyFilmRecords(unrecut, readFilmRecords(unrecut));
  const fonts = await filmStageFaces(applied.script, applied.modules, pageFontsIo).catch(() => null);
  const code = { script: applied.script, modules: applied.modules, faces: fonts?.faces ?? null };
  const { stageFilm } = await buildStageFilm(unrecut, code, 'final', { bytes: assetBytes, url: assetUrl });
  return stageFilm;
}

export class CheckStage {
  readonly #runtime: string;
  #stage: StageController | null = null;
  #host: HTMLDivElement | null = null;
  #signature: string | null = null;
  #ready: Promise<boolean> | null = null;
  #settle: ((ok: boolean) => void) | null = null;
  #idle: ReturnType<typeof setTimeout> | undefined;

  constructor(runtime: string) {
    this.#runtime = runtime;
  }

  /** Loads the film whose signature is `signature` (built only when it is not the one loaded); false when it fails. */
  prepare(signature: string, film: Film): Promise<boolean> {
    clearTimeout(this.#idle);
    if (this.#ready !== null && this.#signature === signature) return this.#ready;
    this.#signature = signature;
    this.#settle?.(false);
    const retouched = readFilmRecords(film).retouched;
    const ready = new Promise<boolean>((resolve) => {
      this.#settle = (ok) => {
        this.#settle = null;
        if (ok) this.#stage?.send({ type: 'retouch', record: retouched });
        // A film that failed to load is tried again by the next check.
        else if (this.#ready === ready) this.#ready = null;
        resolve(ok);
      };
    });
    this.#ready = ready;
    checkStageFilm(film).then(
      (stageFilm) => {
        if (this.#ready === ready) this.#own().load(stageFilm);
      },
      () => {
        if (this.#ready === ready) this.#settle?.(false);
      },
    );
    return ready;
  }

  pull(t: FilmSeconds, scale: number): Promise<PulledFrame> {
    const stage = this.#stage;
    if (stage === null) return Promise.reject(new Error('no check stage'));
    // Without its recut, the check stage plays the film at its own pace: a moment as played is the film's moment.
    return stage.pullFrame({ t: playSeconds(t), scale, smallMedia: true, readFx: true, smooth: false });
  }

  /** Checks rest: the stage goes after a while unless another check comes. */
  rest(): void {
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => this.dispose(), CHECK_STAGE_IDLE_MS);
  }

  dispose(): void {
    clearTimeout(this.#idle);
    this.#settle?.(false);
    this.#stage?.dispose();
    this.#host?.remove();
    this.#stage = null;
    this.#host = null;
    this.#ready = null;
    this.#signature = null;
  }

  #own(): StageController {
    if (this.#stage !== null) return this.#stage;
    const host = document.createElement('div');
    // On screen but unseen: browsers throttle frames that are off screen or hidden, which would stall the pulls.
    host.style.cssText = 'position:fixed;right:0;bottom:0;width:192px;height:108px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    const stage = new StageController({
      runtime: this.#runtime,
      title: CHECK_STAGE_TITLE,
      events: {
        ready: () => this.#settle?.(true),
        error: (phase) => {
          if (phase === 'load') this.#settle?.(false);
        },
      },
    });
    stage.attach(host);
    this.#host = host;
    this.#stage = stage;
    return stage;
  }
}
