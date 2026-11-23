export interface SceneEntry {
  id: string;
  name: string;
  dur: number;
}

export interface ScenesRecord {
  stage: 'rough' | 'final';
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  background: string;
  scenes: SceneEntry[];
}

const MOST_SCENES = 24;
const LONGEST_FILM_S = 36000;
const SCENE_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** One sentence and no stack, for the page to show as it is. */
function fault(why: string): Error {
  const error = new Error('scenes.json: ' + why);
  error.stack = '';
  return error;
}

const fields = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const whole = (value: unknown, fallback: number): number => (Number.isInteger(value) && Number(value) >= 16 && Number(value) <= 4096 ? Number(value) : fallback);

/** `modules/scenes.json` with its list, or a throw. */
export function readScenes(text: string): ScenesRecord {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Said below.
  }
  const record = fields(parsed);
  if (!record || record['v'] !== 1 || (record['stage'] !== 'rough' && record['stage'] !== 'final'))
    throw fault('must be JSON like {"v": 1, "stage": "rough", "scenes": […]}');
  const list = record['scenes'];
  if (!Array.isArray(list) || list.length < 1 || list.length > MOST_SCENES) throw fault('"scenes" must list 1 to ' + MOST_SCENES + ' scenes');
  const seen = new Set<string>();
  let total = 0;
  const scenes = list.map((entry: unknown, i): SceneEntry => {
    const label = 'scene ' + (i + 1);
    const scene = fields(entry);
    const id = scene?.['id'];
    if (!scene || typeof id !== 'string' || !SCENE_ID.test(id))
      throw fault(label + ' needs an "id" of lower-case letters, digits and "-", starting with a letter, 32 characters at most');
    if (seen.has(id)) throw fault('two scenes are called ' + id);
    seen.add(id);
    const dur = scene['dur'];
    if (typeof dur !== 'number' || !isFinite(dur) || !(dur > 0)) throw fault(label + ' needs a "dur" in seconds, above 0');
    total += dur;
    const name = scene['name'];
    return { id, name: (typeof name === 'string' ? name.trim().slice(0, 48).trim() : '') || id, dur };
  });
  if (total > LONGEST_FILM_S)
    throw fault('the scenes add up to ' + Math.round(total * 100) / 100 + ' s; an animation is ' + LONGEST_FILM_S + ' s at most');
  const fps = record['fps'];
  const background = record['background'];
  return {
    stage: record['stage'],
    width: whole(record['width'], 1920),
    height: whole(record['height'], 1080),
    fps: fps === 24 || fps === 30 ? fps : 60,
    background: typeof background === 'string' && background !== '' && background.length <= 64 ? background : '#ffffff',
    scenes,
  };
}
