import { RealMutationObserver, realNow } from './determinism.ts';
import { attachFontStyle, stackCss } from './fonts.ts';
import { el } from './kit/dom.ts';
import { stageSize } from './stage-size.ts';
import type { FxPicture } from './snapshot/serialize.ts';

/*
 * Reading #fx back for a snapshot is slow, so its last PNG is used again until something touches the canvas: its
 * width or height attribute, the loss or return of its context, or a call of any context method but these, which
 * change neither the pixels nor the clip. A method a browser adds later is thus a touch.
 */
const FX_HARMLESS = new Set(
  (
    'constructor beginPath moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ellipse rect roundRect closePath measureText getImageData createImageData createLinearGradient createRadialGradient ' +
    'createConicGradient createPattern getTransform getLineDash setLineDash isPointInPath isPointInStroke getContextAttributes isContextLost save translate scale rotate transform setTransform resetTransform'
  ).split(' '),
);

export interface FxWatch extends FxPicture {
  clear(width: number, height: number): void;
  reset(): void;
  end(): void;
}

function watchFx(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): FxWatch {
  let touches = 0;
  let clearedAt = -1;
  let blankAt = -1;
  let kept: { at: number; url: string } | null = null;
  const proto: object = Object.getPrototypeOf(context);
  const clearRect = context.clearRect;
  const touch = (): void => {
    touches++;
  };
  // On this one context, which every getContext('2d') on #fx returns: a film's own canvases keep the browser's methods.
  for (const name of Object.getOwnPropertyNames(proto)) {
    const method: unknown = Object.getOwnPropertyDescriptor(proto, name)?.value;
    if (typeof method !== 'function' || FX_HARMLESS.has(name)) continue;
    Object.defineProperty(context, name, {
      configurable: true,
      writable: true,
      enumerable: true,
      value(this: unknown, ...args: unknown[]): unknown {
        touches++;
        return Reflect.apply(method, this, args);
      },
    });
  }
  const sized = new RealMutationObserver(touch);
  const sizedNow = (): void => {
    if (sized.takeRecords().length) touches++;
  };
  sized.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  canvas.addEventListener('contextlost', touch);
  canvas.addEventListener('contextrestored', touch);
  // The stage's own wipes are touches only where they may change something: a clip the film left on narrows a clear, and a reset drops it.
  return {
    canvas,
    clear(width, height) {
      sizedNow();
      context.setTransform(1, 0, 0, 1, 0, 0);
      clearRect.call(context, 0, 0, width, height);
      if (touches !== clearedAt) clearedAt = ++touches;
    },
    reset() {
      sizedNow();
      // Giving a canvas its own width again blanks it and its state.
      canvas.width = canvas.width;
      sized.takeRecords();
      if (touches !== blankAt) blankAt = clearedAt = ++touches;
    },
    png() {
      sizedNow();
      if (kept === null || kept.at !== touches) kept = { at: touches, url: canvas.toDataURL('image/png') };
      return kept.url;
    },
    end() {
      sized.disconnect();
    },
  };
}

/** Inside .words a heading or paragraph has no margin unless the film gives it one; alone in the first layer, any rule of the film's wins. */
export const noMargin = (within: string): string => '@layer film-reset{' + within + '.words :is(h1,h2,h3,h4,h5,h6,p){margin:0}}';

const RESET_CSS =
  '#stage{text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;font-kerning:normal}' +
  '#stage,#stage *,#stage *::before,#stage *::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' +
  '#stage ::-webkit-scrollbar{display:none}';

export interface StageParts {
  root: HTMLElement;
  stage: HTMLElement;
  fontStyle: HTMLStyleElement;
  fxCanvas: HTMLCanvasElement;
  fx: CanvasRenderingContext2D;
  fxWatch: FxWatch;
}

let parts: StageParts | null = null;
/** The frame's size at the last fit. */
let fittedTo = { width: -1, height: -1 };

export const stageParts = (): StageParts | null => parts;

export function builtStage(): StageParts {
  if (!parts) throw new Error('the stage is not built');
  return parts;
}

export function buildStage(width: number, height: number, background: string): StageParts {
  parts?.root.remove();
  parts?.fxWatch.end();
  stageSize.width = width;
  stageSize.height = height;
  const root = el('div', { attrs: { id: 'film-root' }, style: 'position:fixed;inset:0;overflow:hidden;background:' + background });
  const stage = el('div', {
    attrs: { id: 'stage' },
    style: `position:absolute;left:0;top:0;width:${width}px;height:${height}px;overflow:hidden;transform-origin:0 0;background:${background}`,
  });
  const fontStyle = document.createElement('style');
  fontStyle.id = 'film-fonts';
  attachFontStyle(fontStyle);
  const reset = el('style', { attrs: { id: 'film-reset' }, text: stackCss() + RESET_CSS + noMargin('#stage ') });
  const fxCanvas = document.createElement('canvas');
  fxCanvas.id = 'fx';
  fxCanvas.width = width;
  fxCanvas.height = height;
  fxCanvas.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;pointer-events:none;z-index:2147483647`;
  const fx = fxCanvas.getContext('2d');
  if (!fx) throw new Error('this browser gives no 2d canvas');
  stage.append(fontStyle, reset, fxCanvas);
  root.appendChild(stage);
  document.body.appendChild(root);
  parts = { root, stage, fontStyle, fxCanvas, fx, fxWatch: watchFx(fxCanvas, fx) };
  fit();
  return parts;
}

/** Scales the stage to the frame, centred. */
export function fit(): void {
  if (!parts) return;
  fittedTo = { width: window.innerWidth, height: window.innerHeight };
  const frameWidth = fittedTo.width || stageSize.width;
  const frameHeight = fittedTo.height || stageSize.height;
  const scale = Math.min(frameWidth / stageSize.width, frameHeight / stageSize.height) || 1;
  stageSize.fit = scale;
  const style = parts.stage.style;
  style.transform = 'scale(' + scale + ')';
  style.left = (frameWidth - stageSize.width * scale) / 2 + 'px';
  style.top = (frameHeight - stageSize.height * scale) / 2 + 'px';
}

/** A new frame has no layout until it has its size: there is nothing to measure on the stage before then. */
export function laidOut(): boolean {
  const stage = parts?.stage;
  return !!stage && stage.getBoundingClientRect().width >= 1;
}

const LAYOUT_POLL_MS = 50;

/** Settles once the stage has a layout, or after `ms` without one. Timers, not animation frames: a hidden frame gets none. */
export function whenLaidOut(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const until = realNow() + ms;
    const look = (): void => {
      if (laidOut() || realNow() >= until) resolve();
      else setTimeout(look, LAYOUT_POLL_MS);
    };
    look();
  });
}

/** A film may have placed the stage itself: at an unchanged frame size it is left alone. */
export function fitIfResized(): void {
  if (fittedTo.width !== window.innerWidth || fittedTo.height !== window.innerHeight) fit();
}
