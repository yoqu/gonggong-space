import { fontFaceCss, stackCss } from '../fonts.ts';
import { el, h } from '../kit/dom.ts';
import { stageSize } from '../stage-size.ts';
import { noMargin } from '../stage.ts';
import { drawSnapshot, whyNoDecode } from './draw.ts';
import type { HoldFirstDraw } from './hold-first-draw.ts';
import { PLAIN_INK, decodeFirst, forcedColorsActive, svgForRaster } from './serialize.ts';
import { xmlOf } from './xml.ts';

const PLATES_WARN_BYTES = 256 * 1024 * 1024;

let hold: HoldFirstDraw | null = null;
let holdMs: number | undefined;
let plateCount = 0;
let plateBytes = 0;

/** The hold is made before the film clock replaces performance.now; the wait comes with the load. */
export function setPlateHold(made: HoldFirstDraw, waitMs: number | undefined): void {
  hold = made;
  holdMs = waitMs;
}

export const plateStats = (): { count: number; bytes: number } => ({ count: plateCount, bytes: plateBytes });

function toCanvas(surface: HTMLCanvasElement | ImageBitmap, width: number, height: number): HTMLCanvasElement {
  if (surface instanceof HTMLCanvasElement) return surface;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(surface, 0, 0);
  surface.close();
  return canvas;
}

/**
 * XHTML for a foreignObject, drawn to a canvas at `scale`. A plate has none of the film's CSS and so no root color of
 * its own: under forced colors its text is plain black, as it is with no theme.
 */
export function rasterXml(xml: string, width: number, height: number, scale: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const { svg, pw, ph } = svgForRaster(xml, width, height, scale, forcedColorsActive() ? PLAIN_INK : undefined);
    const image = new Image();
    const draw = (): void => {
      try {
        drawSnapshot(image, pw, ph)
          .then((surface) => toCanvas(surface, pw, ph))
          .then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    };
    image.onload = () => (hold ? hold(svg, holdMs, draw) : draw());
    image.onerror = () => reject(new Error('snapshot decode failed (foreignObject)' + whyNoDecode(svg)));
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

export interface PlateOptions {
  width?: number;
  height?: number;
  scale?: number;
  css?: string;
}

/** `kit.raster(html, options)`: a DOM plate drawn once to a canvas, for a cut that draws on canvas (call it in init). */
export function raster(html: string | Node, options: PlateOptions = {}): Promise<HTMLCanvasElement> {
  const width = options.width || stageSize.width;
  const height = options.height || stageSize.height;
  const scale = options.scale || 1;
  const holder = el('div', { style: `width:${width}px;height:${height}px;position:relative;overflow:hidden` });
  holder.appendChild(el('style', { text: noMargin('') + fontFaceCss() + stackCss() + (options.css ?? '') }));
  let body: Node | null = typeof html === 'string' ? h('<div>' + html + '</div>') : html;
  // A stray </div> in a stored film's string: the plate stays what it was, the wrapper alone.
  if (typeof html === 'string' && body instanceof Element && body.hasAttribute('data-kit-holder')) body = body.firstElementChild;
  if (body) holder.appendChild(body);
  decodeFirst(holder);
  // xmlOf changes what it is given, and html may be the film's own node: a copy, in a document where no custom element's constructor runs and no picture loads.
  const wrap = document.createElement('div');
  wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrap.style.cssText = `width:${width}px;height:${height}px;overflow:hidden;position:relative`;
  wrap.appendChild(holder);
  const copy = document.implementation.createHTMLDocument('').importNode(wrap, true);
  return rasterXml(xmlOf(copy), width, height, scale).then((canvas) => {
    plateCount++;
    plateBytes += canvas.width * canvas.height * 4;
    if (plateBytes > PLATES_WARN_BYTES) console.warn('kit.raster: plates now hold ' + Math.round(plateBytes / 1048576) + ' MB');
    return canvas;
  });
}
