/**
 * The stretch of the film the layers are read over: the scene (or chapter) the playhead is in, as played. Pure.
 */

import type { ClockPart } from '@open-artifact/motion-core';
import type { SceneReport } from '@open-artifact/motion-stage/protocol';

export interface LayerStretch {
  /** Its ends, as played. */
  from: number;
  to: number;
  /** The scene's id, in a film made of scenes; null otherwise. */
  scene: string | null;
  /** Which part it is (from 0), and of how many; -1 of 0 where the film has no parts. */
  index: number;
  count: number;
  /** Tells one stretch from another. */
  key: string;
}

/** The part the moment `t` (as played) lies in: the last that starts by it. */
export function partIndexAt(parts: readonly ClockPart[], t: number): number {
  if (parts.length === 0) return -1;
  let index = 0;
  while (index + 1 < parts.length && t >= parts[index + 1]!.playStart - 1e-6) index += 1;
  return index;
}

export function layerStretch(parts: readonly ClockPart[], scenes: readonly SceneReport[] | null, t: number, duration: number): LayerStretch {
  const index = partIndexAt(parts, t);
  const part = index >= 0 ? parts[index]! : null;
  if (part === null) return { from: 0, to: Math.max(0, duration), scene: null, index: -1, count: 0, key: `film:0:${duration}` };
  const scene = scenes !== null ? part.key : null;
  const from = part.playStart;
  const to = part.playStart + part.playDur;
  return { from, to, scene, index, count: parts.length, key: `${scene ?? 'film'}#${index}:${from}:${to}` };
}

/**
 * Changes by hand (Appearance, hiding, text styles) are laid on a film not made of scenes, or on a finished scene;
 * the stage lays nothing on a scene still being made.
 */
export function stretchTakesRetouch(stretch: LayerStretch, scenes: readonly SceneReport[] | null): boolean {
  if (scenes === null || stretch.scene === null) return scenes === null;
  return scenes.some((scene) => scene.id === stretch.scene && scene.state === 'final');
}
