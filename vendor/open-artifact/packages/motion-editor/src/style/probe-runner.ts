/**
 * Runs the palette previews on the Style tab's hidden stage, one film at a time, and remembers what they chose for
 * the film. A run that fails is tried once more; one that fails again offers no turns of the film's hues.
 */

import type { Film, HueScheme } from '@open-artifact/motion-core';
import { assetBytes, assetUrl } from '../host/assets.ts';
import { probePalette } from './palette-probe.ts';
import { StylePreviewStage } from './preview-stage.ts';
import { rememberFilm, useStyle } from './store.ts';

let runtime: string | null = null;
let stage: StylePreviewStage | null = null;
let running: { signature: string; cancel: () => void } | null = null;

/** Gives the previews the stage runtime; the stage itself is made on the first run. */
export function startPreviewStage(stageRuntime: string): () => void {
  runtime = stageRuntime;
  return () => {
    running?.cancel();
    running = null;
    stage?.dispose();
    stage = null;
    runtime = null;
  };
}

/** Starts the previews of the film under `signature`, unless they are running already; returns how to stop them. */
export function runPaletteProbe(film: Film, signature: string, schemes: readonly HueScheme[]): () => void {
  if (runtime === null) return () => undefined;
  if (running?.signature === signature) return running.cancel;
  running?.cancel();
  stage ??= new StylePreviewStage(runtime);
  const on = stage;
  let alive = true;
  const cancel = (): void => {
    alive = false;
    if (running?.signature === signature) running = null;
    if (useStyle.getState().probing === signature) useStyle.setState({ probing: null });
  };
  running = { signature, cancel };
  useStyle.setState({ probing: signature });
  const assets = { bytes: assetBytes, url: assetUrl };
  const attempt = (): Promise<number | null> => probePalette(film, schemes, on, assets, () => alive).catch(() => null);
  void attempt()
    .then((chosen) => (chosen === null && alive ? attempt() : chosen))
    .then((chosen) => {
      if (!alive) return;
      rememberFilm(signature, (memory) => ({ ...memory, probed: chosen ?? -1 }));
      cancel();
    });
  return cancel;
}
