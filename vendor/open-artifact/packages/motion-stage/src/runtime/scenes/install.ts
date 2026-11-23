import type { RenderMode, SceneReport } from '../../protocol.ts';
import type { Kit } from '../kit/index.ts';
import { sceneSeed } from '../kit/random.ts';
import { inkOn } from './card.ts';
import { readScenes } from './read.ts';
import type { SceneEntry } from './read.ts';
import { scopedKit } from './scoped.ts';
import type { Mounting } from './scoped.ts';

/** Outlines a rough scene's box as pen strokes; gives back the pen that draws them again after each render. */
export type Sketcher = (box: HTMLElement, id: string) => () => void;

export interface SceneSystem {
  /** Runs a js module with `kit` in reach (`own`: strict, in a scope of its own); gives back what it threw, or null. */
  run(name: string, kit: Kit, own: boolean): unknown;
  reseed(seed: number): void;
  /** Hears what deferred code throws while the film loads. */
  late(handler: ((error: unknown) => void) | null): void;
  now(): number;
  /** Gives the fx canvas its own width again; done by the film it would count as a touch of the canvas. */
  resetFx(): void;
  /** This viewer gets narration. */
  voice: boolean;
  /** Told each scene's box once the scene has come up. */
  box(node: HTMLElement): void;
  sketch: Sketcher | null;
  mode(): RenderMode;
}

export interface SceneApi {
  scene(id: unknown, definition: unknown): void;
  score(write: unknown): void;
  narration(speak: unknown): void;
  scenes(): SceneCut;
}

/** What `kit.scenes()` gives the film to set as window.CUT. */
export interface SceneCut {
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: string;
  chapters: Array<{ t: number; label: string }>;
  init(): Promise<void>;
  render(t: number): unknown;
  score?: (builder: unknown) => void;
  narration?: unknown;
}

interface SceneDefinition {
  init: ((kit: Kit) => unknown) | null;
  render: (t: number, kit: Kit) => unknown;
  rough: boolean;
}

// Of the 20 s the page gives a film to load, 15 are for the scenes' inits; one may take 5 at most, and never what is kept for those after it.
const LOAD_MS = 15000;
const MOST_MS = 5000;
const KEPT_MS = 250;
const LATE = 'a timer, a listener or an unawaited promise threw while the film loaded: ';

const sceneFile = (id: string): string => 'scene-' + id + '.js';

function words(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : error;
    return String(message || error || 'error').slice(0, 300);
  } catch {
    return 'error';
  }
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && typeof Reflect.get(value, 'then') === 'function';

function definitionOf(given: unknown): SceneDefinition | null {
  if (given === null || typeof given !== 'object') return null;
  const render: unknown = Reflect.get(given, 'render');
  const init: unknown = Reflect.get(given, 'init');
  if (typeof render !== 'function') return null;
  return {
    render: (t, kit) => Reflect.apply(render, given, [t, kit]),
    init: typeof init === 'function' ? (kit) => Reflect.apply(init, given, [kit]) : null,
    rough: Reflect.get(given, 'rough') === true,
  };
}

/** A film written one scene at a time. Adds kit.scene, kit.scenes, kit.score and kit.narration. */
export function installScenes(kit: Kit, sys: SceneSystem): { api: SceneApi; states: () => SceneReport[] | null } {
  const definitions = new Map<string, SceneDefinition>();
  const boxes = new Map<string, HTMLElement>();
  const kits = new Map<string, Kit>();
  const cards = new Map<string, HTMLElement>();
  const pens = new Map<string, () => void>();
  const said = new Set<string>();
  const greys = new WeakSet<HTMLElement>();
  let list: SceneEntry[] | null = null;
  let open: string | null = null;
  let mounting: Mounting | null = null;
  let scoreWrite: ((builder: unknown, times: Record<string, number>) => void) | null = null;
  let speak: ((times: Record<string, number>) => unknown) | null = null;
  let shown: HTMLElement | null = null;
  let ground = '#ffffff';
  let rough = false;
  let frames = 0;
  let toned: { filter: string; round: string } | null = null;

  // Logged once per scene and kind of fault: a message may hold the time, and render runs every frame.
  const tell = (id: string, when: string, error: unknown): void => {
    if (said.has(id + when)) return;
    said.add(id + when);
    console.error('scene ' + id + ': ' + words(error));
  };
  // A scene's randomness follows from its id and its own clock, never from the scenes round it.
  const seed = (id: string, t: number): void => sys.reseed(sceneSeed(id, t * 1000));
  const box = (): HTMLElement => kit.el('div', { style: 'position:absolute;inset:0;overflow:hidden;isolation:isolate' });
  const sketching = (): boolean => sys.mode() === 'rough';

  /*
   * While a greyed box is on show, one filter on the stage greys the ground, the box, the canvas and what shared.js
   * put beside them alike, and a snapshot carries it. #film-root takes the ground's grey meanwhile, where that can
   * be told, so no hairline of colour shows round the stage.
   */
  const tone = (): void => {
    const on = !!shown && greys.has(shown) && sketching();
    if (on === (toned !== null)) return;
    const root = kit.stage.parentElement;
    if (on) toned = { filter: kit.stage.style.filter, round: root?.style.background ?? '' };
    kit.stage.style.filter = on ? 'grayscale(1)' : (toned?.filter ?? '');
    if (root) {
      const grey = greyGround();
      if (grey !== null) root.style.background = on ? `rgb(${grey}, ${grey}, ${grey})` : (toned?.round ?? '');
    }
    if (!on) toned = null;
  };
  const greyGround = (): number | null => {
    const context = kit.fx;
    const before = context.fillStyle;
    context.fillStyle = '#ffffff';
    context.fillStyle = ground;
    const light = String(context.fillStyle);
    context.fillStyle = '#000000';
    context.fillStyle = ground;
    const dark = String(context.fillStyle);
    context.fillStyle = before;
    const found = light === dark ? /^#(..)(..)(..)$/.exec(light) : null;
    if (!found) return null;
    const [r, g, b] = [found[1], found[2], found[3]].map((hex) => parseInt(hex ?? '0', 16));
    return Math.round(0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0));
  };
  const grey = (node: HTMLElement): HTMLElement => {
    greys.add(node);
    tone();
    return node;
  };
  const show = (node: HTMLElement): void => {
    if (shown === node) {
      tone();
      return;
    }
    shown?.remove();
    // A scene may have taken the canvas into its box.
    if (kit.fxCanvas.parentNode !== kit.stage) kit.stage.appendChild(kit.fxCanvas);
    kit.stage.insertBefore(node, kit.fxCanvas);
    shown = node;
    tone();
  };
  const card = (scene: SceneEntry): HTMLElement => {
    // Every film's stage is "rough" until its last write, so only a scene that says rough: true marks a rough cut.
    const greyed = rough && sketching() && (list ?? []).some((each) => definitions.get(each.id)?.rough === true);
    const key = scene.id + (greyed ? ':grey' : '');
    const made = cards.get(key);
    if (made) return made;
    const node = greyed ? grey(box()) : box();
    node.appendChild(
      kit.el('div', {
        text: scene.name,
        style: `position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:0 8%;font:500 ${Math.round(kit.H / 19)}px ${kit.fonts.sans};color:${inkOn(kit.fx, ground, greyed)}`,
      }),
    );
    cards.set(key, node);
    return node;
  };
  // After the first throw of deferred code, init is waited for only a little longer: long enough for what else the same fault throws to fall to this scene.
  const hurry = (me: Mounting): void => {
    if (me.no && !me.soon) {
      const no = me.no;
      const late = me.late;
      me.soon = setTimeout(() => no(late?.error), KEPT_MS);
    }
  };
  const within = (returned: unknown, ms: number, me: Mounting): unknown => {
    if (!isThenable(returned)) return returned;
    const why = 'init was cut off after ' + (ms / 1000).toFixed(2) + ' s' + (ms < MOST_MS ? ', when the film’s time to load ran out' : '');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cut = new Promise<never>((_, no) => {
      me.no = no;
      if (me.late) hurry(me);
      timer = setTimeout(() => no(new Error(why + (document.hidden === true ? ' (this tab was in the background)' : ''))), ms);
    });
    return Promise.race([returned, cut]).finally(() => {
      clearTimeout(timer);
      if (me.soon) clearTimeout(me.soon);
      me.no = null;
    });
  };
  // The scene's box is on the stage while it loads, so init can measure. A scene that fails leaves nothing behind.
  const mount = async (scene: SceneEntry, start: number, ms: number): Promise<void> => {
    const me: Mounting = { late: null, no: null, soon: 0, gone: false };
    mounting = me;
    const stage = box();
    const scoped = scopedKit(kit, stage, start, scene.dur, me, sys.run);
    const typed = kit.typing.times.length;
    const fail = (error: unknown): void => {
      mounting = null;
      me.gone = true;
      kit.typing.times.length = typed;
      tell(scene.id, 'load', error);
      if (me.late && me.late.error !== error) console.error(LATE + words(me.late.error));
    };
    sys.resetFx();
    show(stage);
    seed(scene.id, 0);
    open = scene.id;
    const thrown = sys.run(sceneFile(scene.id), scoped, true);
    open = null;
    if (thrown) return fail(thrown);
    const definition = definitions.get(scene.id);
    if (!definition) return fail("the module must call kit.scene('" + scene.id + "', { render(t, kit) { … } })");
    try {
      if (definition.rough) grey(stage);
      if (definition.init) await within(definition.init(scoped), ms, me);
      // Its first frame is tried, so a render that can never draw is a scene that failed. A promise is not waited for.
      seed(scene.id, 0);
      const first = definition.render(0, scoped);
      if (isThenable(first)) first.then(undefined, () => undefined);
      if (me.late) throw me.late.error;
      if (definition.rough && sys.sketch) {
        const pen = sys.sketch(stage, scene.id);
        pens.set(scene.id, pen);
        if (sketching()) pen();
      }
      boxes.set(scene.id, stage);
      kits.set(scene.id, scoped);
      mounting = null;
      sys.box(stage);
    } catch (error) {
      fail(error);
    }
  };

  const api: SceneApi = {
    scene(id, given) {
      if (open === null || id !== open) {
        console.warn('kit.scene: ' + String(id).slice(0, 40) + ' is not this module’s own scene; ignored');
        return;
      }
      const definition = definitionOf(given);
      if (definition) definitions.set(open, definition);
    },
    score(write) {
      if (typeof write === 'function') scoreWrite = (builder, times) => Reflect.apply(write, undefined, [builder, times]);
    },
    narration(given) {
      if (typeof given === 'function') speak = (times) => Reflect.apply(given, undefined, [times]);
    },
    scenes() {
      return scenesCut();
    },
  };

  const blank = (init: () => Promise<void>): SceneCut => ({
    width: 1920,
    height: 1080,
    fps: 60,
    duration: 1,
    background: '#ffffff',
    chapters: [],
    init,
    render: () => undefined,
  });

  const scenesCut = (): SceneCut => {
    const text = kit.module('scenes.json');
    // The script may reach the page ahead of the list, whose arrival loads the film again.
    if (text === null) {
      console.warn('kit.scenes: no modules/scenes.json yet');
      return blank(async () => undefined);
    }
    let record;
    try {
      record = readScenes(text);
    } catch (error) {
      // Thrown from init, which the stage calls itself: of what a script throws as it is read, a browser may pass on no more than "Script error."
      return blank(async () => {
        throw error;
      });
    }
    const scenes = record.scenes;
    list = scenes;
    ground = record.background;
    rough = record.stage === 'rough';
    const starts: number[] = [];
    const times: Record<string, number> = Object.create(null);
    let end = 0;
    for (const scene of scenes) {
      starts.push(end);
      times[scene.id] = end;
      end += scene.dur;
    }
    times['END'] = end;
    const cut: SceneCut = {
      width: record.width,
      height: record.height,
      fps: record.fps,
      duration: end,
      background: ground,
      chapters: scenes.map((scene, i) => ({ t: starts[i] ?? 0, label: scene.name })),
      async init() {
        const have = kit.modules();
        const css = kit.module('base.css');
        const began = sys.now();
        let unwritten = scenes.filter((scene) => have.includes(sceneFile(scene.id))).length;
        // The first thing deferred code throws is put down to the scene being brought up; the rest is logged. Either way the film comes up.
        sys.late((error) => {
          if (!mounting || mounting.late) {
            console.error(LATE + words(error));
            return;
          }
          mounting.late = { error: error || new Error('error') };
          hurry(mounting);
        });
        const aside = (name: string): void => {
          const thrown = have.includes(name) ? sys.run(name, kit, true) : null;
          if (thrown) console.error(name + ': ' + words(thrown));
        };
        if (css !== null) kit.css(css);
        aside('shared.js');
        for (const [i, scene] of scenes.entries()) {
          if (!have.includes(sceneFile(scene.id))) continue;
          unwritten--;
          await mount(scene, starts[i] ?? 0, Math.max(KEPT_MS, Math.min(MOST_MS, LOAD_MS - (sys.now() - began) - KEPT_MS * unwritten)));
        }
        seed('score.js', 0);
        aside('score.js');
        const write = scoreWrite;
        if (write)
          cut.score = (builder) => {
            seed('score.js', 0);
            write(builder, times);
          };
        if (sys.voice) {
          // narration.js gets a copy of the times, and a kit.score call it makes is undone: the score is the same with the voice or without it.
          const kept = scoreWrite;
          aside('narration.js');
          let lines: unknown = null;
          try {
            lines = speak ? speak({ ...times }) : null;
          } catch (error) {
            console.error('narration.js: ' + words(error));
          }
          scoreWrite = kept;
          if (lines) cut.narration = lines;
        }
      },
      render(t) {
        let i = 0;
        while (i + 1 < scenes.length && t >= (starts[i + 1] ?? Infinity)) i++;
        const scene = scenes[i];
        if (!scene) return undefined;
        const start = starts[i] ?? 0;
        const frame = ++frames;
        // The one canvas starts every frame blank and in its default state, so nothing one scene sets on kit.fx reaches another.
        sys.resetFx();
        const sceneBox = boxes.get(scene.id);
        const definition = definitions.get(scene.id);
        const sceneKit = kits.get(scene.id);
        if (!sceneBox || !definition || !sceneKit) return show(card(scene));
        show(sceneBox);
        seed(scene.id, t - start);
        // A fault shows the card for this frame alone: a frame follows from t, never from the frames before it.
        const fail = (error: unknown): void => {
          tell(scene.id, 'render', error);
          if (frame !== frames) return;
          sys.resetFx();
          show(card(scene));
        };
        try {
          const drawn = definition.render(t - start, sceneKit);
          const pen = sketching() ? pens.get(scene.id) : undefined;
          // At once, and again when a promise settles: the browser may paint in between.
          pen?.();
          if (isThenable(drawn)) return Promise.resolve(drawn).then(pen ? () => pen() : undefined).then(undefined, fail);
          return drawn;
        } catch (error) {
          fail(error);
          return undefined;
        }
      },
    };
    return cut;
  };

  const states = (): SceneReport[] | null => {
    if (!list) return null;
    const have = kit.modules();
    return list.map((scene) => ({
      id: scene.id,
      state: !have.includes(sceneFile(scene.id)) ? 'todo' : !boxes.has(scene.id) ? 'failed' : definitions.get(scene.id)?.rough ? 'rough' : 'final',
    }));
  };

  return { api, states };
}
