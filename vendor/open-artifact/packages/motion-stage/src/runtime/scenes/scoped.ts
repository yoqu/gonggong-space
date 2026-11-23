import type { Kit, VideoOptions } from '../kit/index.ts';

/** A scene being brought up: what deferred code threw meanwhile, and how to cut its init short. */
export interface Mounting {
  late: { error: unknown } | null;
  no: ((error: unknown) => void) | null;
  soon: ReturnType<typeof setTimeout> | 0;
  /** It failed: what its init still does is not the film's. */
  gone: boolean;
}

/** The film's kit on the scene's clock and in the scene's box. */
export function scopedKit(
  kit: Kit,
  box: HTMLElement,
  start: number,
  dur: number,
  me: Mounting,
  run: (name: string, kit: Kit, own: boolean) => unknown,
): Kit {
  const scoped: Kit = Object.create(kit);
  const into = <T extends Node>(node: T): T => {
    box.appendChild(node);
    return node;
  };
  Object.defineProperties(scoped, {
    stage: { value: box },
    start: { value: start },
    dur: { value: dur },
  });
  scoped.css = (text) => into(kit.el('style', { text: String(text) }) as HTMLStyleElement);
  scoped.cursor = (glyph) => {
    const cursor = kit.cursor(glyph);
    into(cursor.el);
    return cursor;
  };
  scoped.svgLayer = () => into(kit.svgLayer());
  scoped.chip = (text, options) => into(kit.chip(text, options));
  scoped.video = (source, options: VideoOptions = {}) => kit.video(source, { ...options, start: start + (Number(options.start) || 0) });
  scoped.typist = (text, at, cps, seed) => {
    const times = kit.typing.times;
    const before = times.length;
    const made = kit.typist(text, at, cps, seed);
    // A failed scene's init may run on: what it types then is not the film's.
    if (me.gone) times.length = before;
    for (let i = before; i < times.length; i++) times[i] = (times[i] ?? 0) + start;
    return made;
  };
  // Rethrown, so the scene's code that called exec can catch it. It runs as in any film, with no scope of its own: its functions land on window.
  scoped.exec = (name) => {
    const thrown = run(name, scoped, false);
    if (thrown) throw thrown;
  };
  return scoped;
}
