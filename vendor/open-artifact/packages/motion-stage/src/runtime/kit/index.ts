import { assetStore, assetUrl } from '../assets.ts';
import type { AssetStore } from '../assets.ts';
import { fontFamilies } from '../fonts.ts';
import type { StackName } from '../fonts.ts';
import { findModule, injectScript, moduleNames } from '../modules.ts';
import { plateStats, raster } from '../snapshot/plate.ts';
import type { PlateOptions } from '../snapshot/plate.ts';
import { builtStage } from '../stage.ts';
import { stageSize } from '../stage-size.ts';
import { videoSeeks, watchVideo } from '../video-sync.ts';
import { Camera } from './camera.ts';
import { chip, show, spotlight } from './chip.ts';
import type { ChipOptions, ShowOptions, SpotlightOptions } from './chip.ts';
import { CURSORS, Cursor, cursorElement } from './cursor.ts';
import { el, h } from './dom.ts';
import { camrect, center, phraseCamRect, phraseRect, srect } from './geometry.ts';
import type { StageRect } from './geometry.ts';
import { Marks } from './marks.ts';
import * as math from './math.ts';
import { cutPaper, polyLerp, polyStr } from './paper.ts';
import { rng, vnoise } from './random.ts';
import { TextFx } from './text-fx.ts';
import { esc, streamed, typist } from './typing.ts';
import type { Typist } from './typing.ts';

export const KIT_VERSION = 2;

export interface VideoOptions {
  loop?: boolean;
  /** Film seconds at which the clip's first frame shows. */
  start?: number;
  class?: string;
  style?: string;
}

/** Every key press a typist made, in film seconds: the score's ticks follow them. */
const typingTimes: number[] = [];

/**
 * The cut's whole world. A film made of scenes adds `scene`, `scenes`, `score` and `narration` (scenes/install.ts);
 * each scene sees a copy of it on its own clock and in its own box.
 */
export interface Kit {
  version: number;
  readonly W: number;
  readonly H: number;
  readonly stage: HTMLElement;
  readonly fx: CanvasRenderingContext2D;
  readonly fxCanvas: HTMLCanvasElement;
  el: typeof el;
  h: typeof h;
  esc: typeof esc;
  css(text: string): HTMLStyleElement;
  module(name: string): string | null;
  json(name: string): unknown;
  exec(name: string): void;
  modules(): string[];
  assets: AssetStore;
  cursors: typeof CURSORS;
  fonts: Record<StackName, string>;
  typing: { times: number[] };
  clamp01: typeof math.clamp01;
  clamp: typeof math.clamp;
  seg: typeof math.seg;
  lerp: typeof math.lerp;
  eo: typeof math.eo;
  ei: typeof math.ei;
  eio: typeof math.eio;
  eoq: typeof math.eoq;
  eox: typeof math.eox;
  eob: typeof math.eob;
  spring: typeof math.spring;
  step: typeof math.step;
  pulse: typeof math.pulse;
  smoothstep: typeof math.smoothstep;
  breathe: typeof math.breathe;
  rng: typeof rng;
  vnoise: typeof vnoise;
  typist(text: string, start: number, cps: number, seed?: number): Typist;
  streamed: typeof streamed;
  srect: typeof srect;
  center: typeof center;
  camrect: typeof camrect;
  phraseRect: typeof phraseRect;
  phraseCamRect: typeof phraseCamRect;
  Camera: typeof Camera;
  Cursor: typeof Cursor;
  Marks: typeof Marks;
  TextFx: typeof TextFx;
  cutPaper: typeof cutPaper;
  polyLerp: typeof polyLerp;
  polyStr: typeof polyStr;
  video(source: string, options?: VideoOptions): HTMLVideoElement;
  seek(video: HTMLVideoElement, second: number): void;
  cursor(glyph?: string): Cursor;
  svgLayer(): SVGSVGElement;
  chip(text: string, options?: ChipOptions): HTMLElement;
  show(node: HTMLElement, t: number, tIn: number, tOut?: number | null, options?: ShowOptions): number;
  spotlight(rect: StageRect | null, amount: number, options?: SpotlightOptions): void;
  raster(html: string | Node, options?: PlateOptions): Promise<HTMLCanvasElement>;
  plateStats(): { count: number; bytes: number };
}

export const typingClock = (): number[] => typingTimes;

/** Inserted just under the fx canvas, which stays on top of everything the film adds. */
function beneathFx(node: Node): void {
  const { stage, fxCanvas } = builtStage();
  stage.insertBefore(node, fxCanvas.parentNode === stage ? fxCanvas : null);
}

export function makeKit(): Kit {
  const kit: Kit = {
    version: KIT_VERSION,
    get W() {
      return stageSize.width;
    },
    get H() {
      return stageSize.height;
    },
    get stage() {
      return builtStage().stage;
    },
    get fx() {
      return builtStage().fx;
    },
    get fxCanvas() {
      return builtStage().fxCanvas;
    },
    el,
    h,
    esc,
    css(text) {
      const style = el('style', { text: String(text) });
      beneathFx(style);
      return style as HTMLStyleElement;
    },
    module: (name) => findModule(String(name))?.text ?? null,
    json(name) {
      const text = kit.module(name);
      if (text === null) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        console.error('kit.json(' + name + '): ' + (error instanceof Error ? error.message : String(error)));
        return null;
      }
    },
    exec(name) {
      const module = findModule(String(name));
      if (!module) {
        console.error('kit.exec: no module ' + name);
        return;
      }
      injectScript(module.text, 'module ' + name);
    },
    modules: moduleNames,
    assets: assetStore,
    cursors: CURSORS,
    fonts: fontFamilies,
    typing: { times: typingTimes },
    ...math,
    rng,
    vnoise,
    typist: (text, start, cps, seed) => typist(text, start, cps, seed, typingTimes),
    streamed,
    srect,
    center,
    camrect,
    phraseRect,
    phraseCamRect,
    Camera,
    Cursor,
    Marks,
    TextFx,
    cutPaper,
    polyLerp,
    polyStr,
    // A muted clip the stage keeps at film time t − start (looped if asked), playing with the transport; kit.seek shows an exact second instead.
    video(source, options = {}) {
      const video = el('video', {
        muted: true,
        playsInline: true,
        preload: 'auto',
        loop: !!options.loop,
        attrs: { 'data-start': String(options.start || 0) },
        class: options.class,
        style: options.style,
      });
      if (!(video instanceof HTMLVideoElement)) throw new Error('kit.video: no video element');
      let src = String(source || '');
      const asset = assetUrl(src);
      if (asset !== null) src = asset;
      else if (!/[:/]/.test(src)) console.error('kit.video: no asset ' + src);
      watchVideo(video);
      video.src = src;
      return video;
    },
    seek(video, second) {
      if (video instanceof HTMLVideoElement && isFinite(second)) videoSeeks.set(video, Number(second));
    },
    cursor(glyph) {
      const node = cursorElement(glyph);
      beneathFx(node);
      return new Cursor(node);
    },
    svgLayer() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', String(stageSize.width));
      svg.setAttribute('height', String(stageSize.height));
      svg.setAttribute('viewBox', `0 0 ${stageSize.width} ${stageSize.height}`);
      svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
      beneathFx(svg);
      return svg;
    },
    chip(text, options) {
      const node = chip(text, options);
      beneathFx(node);
      return node;
    },
    show,
    spotlight: (rect, amount, options) => spotlight(builtStage().fx, rect, amount, options),
    raster,
    plateStats,
  };
  return kit;
}
