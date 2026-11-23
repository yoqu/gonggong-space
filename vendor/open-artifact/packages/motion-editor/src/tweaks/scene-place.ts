/** Which scene Tweaks is about, and where stepping to another scene lands. Pure. */

export interface PlacedPart {
  playStart: number;
  playDur: number;
}

/** Stepping to a scene shows it a little past its middle, where its picture has usually settled. */
export const SCENE_LOOK_AT = 0.6;

/** The part playing at `t` (the last one at or past the end), or -1 when there are none. */
export function partAt(parts: readonly PlacedPart[], t: number): number {
  if (parts.length === 0) return -1;
  for (let index = parts.length - 1; index > 0; index -= 1) if (t >= parts[index]!.playStart - 1e-6) return index;
  return 0;
}

/** The scene `by` steps from `index`, and the moment to show it at; `null` past either end. */
export function sceneStep(parts: readonly PlacedPart[], index: number, by: number): { index: number; time: number } | null {
  const to = index + by;
  const part = parts[to];
  if (part === undefined || by === 0) return null;
  return { index: to, time: part.playStart + part.playDur * SCENE_LOOK_AT };
}

/** Whether the film's parts are scenes a person can step through and change: a film with scenes, or two parts. */
export function hasScenes(partCount: number, sceneFile: boolean): boolean {
  return partCount > 1 || (sceneFile && partCount > 0);
}
