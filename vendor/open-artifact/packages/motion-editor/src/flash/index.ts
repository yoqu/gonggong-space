/**
 * Whether a scene may be shortened without its flashes coming too fast. Tweaks and the timeline's edge drag ask
 * before they write a shorter length; the answer comes from a check of the scene's frames on a stage of its own,
 * kept for the film as it draws (its recut aside) and the scene.
 */

import runtime from 'virtual:motion-stage-runtime';
import { SCENE_SETTINGS, filmSeconds, type Film, type PlaySeconds } from '@open-artifact/motion-core';
import { snapshotPixels } from '../engine/snapshot-pixels.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { CheckStage } from './check-stage.ts';
import { FlashChecks, type SceneInspector } from './checks.ts';
import { inspectScene, type Rasterize } from './inspect.ts';
import { checkBudgetMs, flashCacheKey, flashSignature, flashVerdict, needsNoCheck, type FlashScene, type FlashVerdict } from './verdict.ts';

export type { FlashVerdict } from './verdict.ts';

/** Frames asked of the check stage before the one being read came (one only on a try given more time). */
const AHEAD = 2;

const checks = new FlashChecks({ idle: () => !usePlayback.getState().playing });
const rasterize: Rasterize = async (frame) => {
  const pixels = await snapshotPixels(frame.svg, frame.pw, frame.ph);
  return pixels === null ? null : { pixels, width: Math.max(1, Math.round(frame.pw)) };
};
let stage: CheckStage | null = null;
const signatures = new WeakMap<Film, string>();

interface SceneJob {
  key: string;
  film: Film;
  signature: string;
  scene: FlashScene;
  filmLength: number;
}

function signatureOf(film: Film): string {
  let signature = signatures.get(film);
  if (signature === undefined) {
    signature = flashSignature(film);
    signatures.set(film, signature);
  }
  return signature;
}

/** The scene at `index` of the film on show, on the film's own clock; `null` when there is none. */
function sceneJob(index: number): SceneJob | null {
  const { film, clock } = useFilm.getState();
  const part = clock?.parts[index];
  if (film === null || clock === null || part === undefined) return null;
  const signature = signatureOf(film);
  const scene: FlashScene = { start: part.filmStart, nat: part.filmDur };
  return { key: flashCacheKey(signature, scene), film, signature, scene, filmLength: clock.filmTotal };
}

function inspector(job: SceneJob): SceneInspector {
  return async (attempt) => {
    const flash = await import('@open-artifact/wasm-motion');
    const sampling = flash.planFlashSampling(job.scene.start, job.scene.nat, job.filmLength);
    if (sampling === null) return 'long';
    const own = (stage ??= new CheckStage(runtime));
    try {
      if (!(await own.prepare(job.signature, job.film))) return 'faulty';
      return await inspectScene({
        sampling,
        pull: (t) => own.pull(filmSeconds(t), flash.FLASH_RASTER_SCALE),
        rasterize,
        analyzer: flash.createFlashAnalyzer,
        budgetMs: checkBudgetMs(job.scene.nat, flash.FLASH_SAMPLE_PADDING_SECONDS, SCENE_SETTINGS.flashWaitMs),
        patienceMs: SCENE_SETTINGS.flashPatienceMs,
        ahead: attempt.slowdown > 1 ? 1 : AHEAD,
        slowdown: attempt.slowdown,
        wanted: attempt.wanted,
      });
    } finally {
      own.rest();
    }
  };
}

/**
 * Whether the scene at `sceneIndex` may play over `playDur`: `too-fast` with the least length it may play over,
 * `safe`, or `unknown` when there is no such scene to check. A check that could not finish is `unchecked`, with the
 * share of its length the scene settings give for unchecked scenes as its least length.
 */
export async function checkShorterScene(input: { sceneIndex: number; playDur: PlaySeconds }): Promise<FlashVerdict> {
  if (!SCENE_SETTINGS.flashCheck) return { kind: 'safe' };
  const job = sceneJob(input.sceneIndex);
  if (job === null) return { kind: 'unknown' };
  // A ratio of the length as played to the film's own: the one place the two clocks meet.
  const nat: number = job.scene.nat;
  const playDur: number = input.playDur;
  if (needsNoCheck(nat, playDur)) return { kind: 'safe' };
  const outcome = await checks.check(job.key, inspector(job));
  return flashVerdict({ outcome, nat, playDur, uncheckedScale: SCENE_SETTINGS.flashUncheckedPct / 100 });
}

/** Checks the scene at `sceneIndex` in the background, so a later {@link checkShorterScene} answers at once. */
export function warmSceneCheck(sceneIndex: number): void {
  if (!SCENE_SETTINGS.flashCheck) return;
  const job = sceneJob(sceneIndex);
  if (job === null || needsNoCheck(job.scene.nat, 0)) return;
  void checks.check(job.key, inspector(job), true);
}

/** Lets the check stage go (the page is closing). */
export function disposeFlashStage(): void {
  stage?.dispose();
  stage = null;
}
