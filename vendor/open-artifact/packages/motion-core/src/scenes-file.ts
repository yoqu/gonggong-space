import { clipCharacters, isFiniteNumber, isPlainObject, parseJsonRecord } from './json.ts';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_FILM_HEIGHT,
  DEFAULT_FILM_WIDTH,
  DEFAULT_FRAME_RATE,
  FILM_FRAME_RATES,
  FILM_SCHEMA_VERSION,
  MAX_BACKGROUND_CHARS,
  MAX_FILM_SECONDS,
  MAX_FILM_SIDE,
  MAX_SCENES,
  MAX_SCENE_DESCRIPTION_CHARS,
  MAX_SCENE_NAME_CHARS,
  MIN_FILM_SIDE,
} from './limits.ts';
import { isSceneId, sceneModuleName } from './names.ts';
import { filmSeconds, type FilmSeconds } from './units.ts';

export type FilmStage = 'rough' | 'final';

/** One scene of `scenes.json`. */
export interface SceneEntry {
  id: string;
  /** What people call it: the given name, trimmed and cut to 48 characters, else the id. */
  name: string;
  dur: FilmSeconds;
  desc?: string;
}

/** `modules/scenes.json`: the list of scenes a film written scene by scene plays. */
export interface ScenesFile {
  stage: FilmStage;
  width: number;
  height: number;
  fps: number;
  background: string;
  scenes: SceneEntry[];
  /** The typeface slots the film names (`sans`, `serif`, `mono`, `display`), as written. */
  fonts?: Record<string, unknown>;
}

export type ScenesFileResult = { ok: true; file: ScenesFile } | { ok: false; error: string };

const SCENES_SHAPE_ERROR = 'scenes.json: must be JSON like {"v": 1, "stage": "rough", "scenes": […]}';

function side(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_FILM_SIDE && value <= MAX_FILM_SIDE ? value : fallback;
}

/** Reads `scenes.json` (its text or parsed value) as the stage does; a film whose file it refuses does not load. */
export function parseScenesFile(input: unknown): ScenesFileResult {
  const record = typeof input === 'string' ? parseJsonRecord(input) : isPlainObject(input) ? input : null;
  if (record === null || record.v !== FILM_SCHEMA_VERSION || (record.stage !== 'rough' && record.stage !== 'final'))
    return { ok: false, error: SCENES_SHAPE_ERROR };
  const list = record.scenes;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SCENES)
    return { ok: false, error: `scenes.json: "scenes" must list 1 to ${MAX_SCENES} scenes` };
  const scenes: SceneEntry[] = [];
  let total = 0;
  for (const [index, item] of list.entries()) {
    const at = index + 1;
    if (!isPlainObject(item) || !isSceneId(item.id))
      return {
        ok: false,
        error: `scenes.json: scene ${at} needs an "id" of lower-case letters, digits and "-", starting with a letter, 32 characters at most`,
      };
    const id = item.id;
    if (scenes.some((scene) => scene.id === id)) return { ok: false, error: `scenes.json: two scenes are called ${id}` };
    if (!isFiniteNumber(item.dur) || !(item.dur > 0)) return { ok: false, error: `scenes.json: scene ${at} needs a "dur" in seconds, above 0` };
    const name = typeof item.name === 'string' ? clipCharacters(item.name.trim(), MAX_SCENE_NAME_CHARS).trim() : '';
    const desc = typeof item.desc === 'string' ? clipCharacters(item.desc.trim(), MAX_SCENE_DESCRIPTION_CHARS) : '';
    scenes.push({ id, name: name || id, dur: filmSeconds(item.dur), ...(desc ? { desc } : {}) });
    total += item.dur;
  }
  if (total > MAX_FILM_SECONDS)
    return { ok: false, error: `scenes.json: the scenes add up to ${Math.round(total * 1000) / 1000} s; an animation is ${MAX_FILM_SECONDS} s at most` };
  const background = typeof record.background === 'string' && record.background.length >= 1 && record.background.length <= MAX_BACKGROUND_CHARS
    ? record.background
    : DEFAULT_BACKGROUND;
  return {
    ok: true,
    file: {
      stage: record.stage,
      width: side(record.width, DEFAULT_FILM_WIDTH),
      height: side(record.height, DEFAULT_FILM_HEIGHT),
      fps: typeof record.fps === 'number' && FILM_FRAME_RATES.includes(record.fps) ? record.fps : DEFAULT_FRAME_RATE,
      background,
      scenes,
      ...(isPlainObject(record.fonts) ? { fonts: record.fonts } : {}),
    },
  };
}

/** The film's length by its scenes, in its own seconds. */
export function scenesTotal(file: ScenesFile): FilmSeconds {
  return filmSeconds(file.scenes.reduce((sum, scene) => sum + scene.dur, 0));
}

/** Where each scene starts, in film time. */
export function sceneStarts(file: ScenesFile): FilmSeconds[] {
  let at = 0;
  return file.scenes.map((scene) => {
    const start = at;
    at += scene.dur;
    return filmSeconds(start);
  });
}

/** A scene listed in `scenes.json` whose module is not written yet (`index` from 0). */
export interface MissingScene {
  index: number;
  id: string;
}

/** The scenes whose `scene-<id>.js` the film lacks. */
export function missingScenes(file: ScenesFile, moduleNames: ReadonlySet<string>): MissingScene[] {
  return file.scenes.flatMap((scene, index) => (moduleNames.has(sceneModuleName(scene.id)) ? [] : [{ index, id: scene.id }]));
}

/** How far a scene is built, as the stage reports it. */
export type SceneBuildState = 'todo' | 'rough' | 'final' | 'failed';
export const SCENE_BUILD_STATES: readonly SceneBuildState[] = ['todo', 'rough', 'final', 'failed'];
export const SCENE_BUILD_RANK: Readonly<Record<SceneBuildState, number>> = { todo: 0, failed: 0, rough: 1, final: 2 };

export interface SceneBuild {
  id: string;
  state: SceneBuildState;
}

export const isSceneBuildState = (value: unknown): value is SceneBuildState =>
  typeof value === 'string' && (SCENE_BUILD_STATES as readonly string[]).includes(value);

/** The stage's report of each scene's state, or `null` when it is not a list of 1 to 24 `{id, state}`. */
export function parseSceneBuilds(input: unknown): SceneBuild[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_SCENES) return null;
  const builds: SceneBuild[] = [];
  for (const item of input) {
    if (!isPlainObject(item) || !isSceneId(item.id) || !isSceneBuildState(item.state)) return null;
    builds.push({ id: item.id, state: item.state });
  }
  return builds;
}

/** What the working bar shows of a film written scene by scene. */
export interface SceneBuildSummary {
  /** Some scene is still a rough sketch. */
  rough: boolean;
  /** Progress while the agent works: scenes made or finalized, of all. */
  count: { what: 'making' | 'finalizing'; n: number; of: number } | null;
  /** The button that asks the agent to go on, when it is not working. */
  button: 'continue' | 'finalize' | null;
  /** Scenes (1-based) still to write: todo or failed. */
  left: number[];
  /** Every scene is final and nothing is left. */
  closing: boolean;
  /** One mark per scene while the agent works. */
  pips: Array<'next' | 'todo' | 'failed' | 'in'> | null;
}

/**
 * What the working bar says of the scenes, or `null` when the film is done. `working`: the agent is on it now;
 * `readOnly`: the viewer may not ask for more.
 */
export function sceneBuildSummary(
  file: ScenesFile | null,
  builds: readonly SceneBuild[] | null,
  working: boolean,
  readOnly: boolean = false,
): SceneBuildSummary | null {
  if (file === null) return null;
  const ids = file.scenes.map((scene) => scene.id);
  const matched = builds !== null && builds.length === ids.length && builds.every((build, index) => build.id === ids[index]) ? builds : null;
  const states = matched ?? [];
  const count = (...wanted: SceneBuildState[]): number => states.filter((build) => wanted.includes(build.state)).length;
  const rough = count('rough') > 0;
  const left = states.flatMap((build, index) => (build.state === 'todo' || build.state === 'failed' ? [index + 1] : []));
  if (file.stage !== 'rough' && !rough && left.length === 0) return null;
  const progress = (what: 'making' | 'finalizing', n: number) => ({ what, n, of: states.length });
  const counted = !working
    ? null
    : count('todo') > 0
      ? progress('making', count('rough', 'final'))
      : count('final') > 0 && count('rough') > 0
        ? progress('finalizing', count('final'))
        : null;
  const pending: 'todo' | 'rough' | null =
    !working || matched === null ? null : count('todo') > 0 ? 'todo' : count('final') > 0 || count('rough') === 0 ? 'rough' : null;
  const next = readOnly ? -1 : states.findIndex((build) => build.state === pending);
  const pips =
    pending === null
      ? null
      : states.map((build, index) => (index === next ? 'next' : build.state === pending ? 'todo' : build.state === 'failed' ? 'failed' : 'in'));
  return {
    rough,
    count: counted,
    button: working || matched === null ? null : left.length > 0 || !rough ? 'continue' : 'finalize',
    left,
    closing: matched !== null && !rough && left.length === 0,
    pips,
  };
}
