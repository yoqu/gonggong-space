/**
 * Which set of the film's hues shows on its pictures: the film is drawn as its code has it and with each set turned
 * halfway round, and the set whose turn changes the pictures most (and clearly more than the others) is the one
 * whose turns the Palette section offers.
 */

import {
  chooseDistinctRecolorSample,
  compareRecoloredPixels,
  recolorSampleTimes,
  summarizeRecoloredPixels,
  type Film,
  type HueScheme,
  type PixelTally,
  type RecolorSample,
} from '@open-artifact/motion-core';
import { snapshotPixels } from '../engine/snapshot-pixels.ts';
import { buildStageFilm, type AssetReader } from '../engine/stage-film.ts';
import type { StylePreviewStage } from './preview-stage.ts';
import { ownFilm, previewScale, recoloredFilm } from './palette-model.ts';

const yieldToPage = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Pictures {
  frames: (Uint8ClampedArray | null)[];
}

async function drawFilm(stage: StylePreviewStage, film: Film, assets: AssetReader, alive: () => boolean, times?: readonly number[]): Promise<{ pictures: Pictures; times: number[] } | null> {
  const { stageFilm } = await buildStageFilm(film, { script: film.script, modules: film.modules, faces: null }, 'final', assets);
  if (!alive()) return null;
  const meta = await stage.load(stageFilm);
  if (meta === null || !alive() || meta.duration <= 0) return null;
  const at = times === undefined ? recolorSampleTimes(meta.duration) : [...times];
  const scale = previewScale(meta.width, meta.height);
  const frames: (Uint8ClampedArray | null)[] = [];
  for (const t of at) {
    if (!alive()) return null;
    try {
      const frame = await stage.frame(t, scale);
      frames.push(await snapshotPixels(frame.svg, frame.pw, frame.ph));
    } catch {
      frames.push(null);
    }
  }
  // A browser that will not let the page read a picture back cannot compare them.
  if (frames.every((frame) => frame === null)) return null;
  return { pictures: { frames }, times: at };
}

async function sampleScheme(before: Pictures, after: Pictures, scheme: HueScheme, alive: () => boolean): Promise<RecolorSample | null> {
  const tallies: PixelTally[] = [];
  for (const [index, picture] of before.frames.entries()) {
    const turned = after.frames[index];
    if (picture === null || turned == null) continue;
    tallies.push(compareRecoloredPixels(picture, turned, scheme.hues));
    await yieldToPage();
    if (!alive()) return null;
  }
  return summarizeRecoloredPixels(tallies);
}

/**
 * The index of the set of hues to offer turns of (-1: none), or `null` when the previews could not be drawn. The
 * film is drawn without a person's records, so what it shows now does not count.
 */
export async function probePalette(film: Film, schemes: readonly HueScheme[], stage: StylePreviewStage, assets: AssetReader, alive: () => boolean): Promise<number | null> {
  const base = await drawFilm(stage, ownFilm(film), assets, alive);
  if (base === null) return null;
  const samples: RecolorSample[] = [];
  for (const scheme of schemes) {
    const turned = await drawFilm(stage, recoloredFilm(film, scheme.probe), assets, alive, base.times);
    if (turned === null) return null;
    const sample = await sampleScheme(base.pictures, turned.pictures, scheme, alive);
    if (sample === null) return null;
    samples.push(sample);
  }
  return chooseDistinctRecolorSample(samples);
}
