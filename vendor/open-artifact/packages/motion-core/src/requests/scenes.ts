import type { VideoAgentRequest } from './common.ts';

/** Go on making a film whose scenes are not all drawn yet; `left` names the ones still to make (or that failed). */
export function continueRequest(left: readonly string[] = []): VideoAgentRequest {
  return { title: 'Continue', text: `Continue the animation.${left.length > 0 ? ` Scenes left: ${left.join(', ')}.` : ''}` };
}

/** Turn a rough film into its final one. */
export function finalizeRequest(): VideoAgentRequest {
  return { title: 'Finalize', text: 'Finalize the animation.' };
}

/** Take scene `scene` (from 1) out of a film of `count` scenes. */
export function deleteSceneRequest(scene: number, count: number): VideoAgentRequest {
  return {
    title: `Delete scene ${scene}`,
    text: `Delete scene ${scene} of ${count} from the animation; if its list of scenes no longer has ${count}, change nothing and ask me which one. If there is a score, fit it to the shorter animation: nothing may still be timed to the deleted scene.`,
  };
}

/** A frame shape a film can be made again in. */
export interface FilmShape {
  /** `16:9`. */
  ratio: string;
  width: number;
  height: number;
}

export const FILM_SHAPE_IDS = ['wide', 'vertical', 'square', 'portrait'] as const;
export type FilmShapeId = (typeof FILM_SHAPE_IDS)[number];

export const FILM_SHAPES: Readonly<Record<FilmShapeId, FilmShape>> = {
  wide: { ratio: '16:9', width: 1920, height: 1080 },
  vertical: { ratio: '9:16', width: 1080, height: 1920 },
  square: { ratio: '1:1', width: 1080, height: 1080 },
  portrait: { ratio: '4:5', width: 1080, height: 1350 },
};

const CUSTOM_LONG_SIDE = 1920;
export const MAX_CUSTOM_SHAPE_TERM = 999;
export const MAX_CUSTOM_SHAPE_RATIO = 3;

/** A shape of a ratio a person typed (terms 1 to 999, at most 3:1), its long side 1920 px and its short side even. */
export function customFilmShape(across: number, down: number): FilmShape | null {
  const term = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= MAX_CUSTOM_SHAPE_TERM;
  if (!term(across) || !term(down)) return null;
  const long = Math.max(across, down);
  const short = Math.min(across, down);
  if (long / short > MAX_CUSTOM_SHAPE_RATIO) return null;
  const shortSide = 2 * Math.round((CUSTOM_LONG_SIDE * short) / long / 2);
  return {
    ratio: `${across}:${down}`,
    width: across >= down ? CUSTOM_LONG_SIDE : shortSide,
    height: across >= down ? shortSide : CUSTOM_LONG_SIDE,
  };
}

/** Make the film again in another frame shape. */
export function shapeRequest(shape: FilmShape): VideoAgentRequest {
  return {
    title: `Make this again in ${shape.ratio}`,
    text: `Make this animation again in another aspect ratio: ${shape.ratio}, ${shape.width} by ${shape.height} pixels.`,
  };
}
