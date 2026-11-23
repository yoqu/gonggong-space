/**
 * Offscreen slide capture for exports.
 *
 * A slide is rendered with the regular {@link SlideView} in `export` mode
 * into a hidden 1920×1080 host on this page, then everything it shows is
 * waited for (pictures decoded, web fonts loaded, text refitted). From there
 * exports read it three ways:
 *
 * - as a picture: the slide's markup (pictures and fonts inlined as `data:`
 *   URLs) is drawn through an SVG `<foreignObject>` onto a canvas, which
 *   keeps everything the browser can draw; if the browser refuses (a tainted
 *   canvas, an image that will not load), dom-to-svg rebuilds the slide as
 *   plain SVG instead;
 * - as text: the lines of words with their positions (for the PDF text
 *   layer) and the areas of links;
 * - as live DOM, for exports that measure elements (PPTX) or copy markup
 *   (HTML).
 */

import { createElement, createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  canvasBlob,
  elementSvg,
  foreignObjectSvg,
  groupLines,
  hideOutside,
  inlinedCopy as inlinedMarkup,
  loadSvgImage,
  maxCaptureScale,
  measureLinks,
  measureWords,
  picturesReady,
  SVG_NS,
  type CaptureLimits,
  type LinkArea,
  type TextLine,
} from '@open-artifact/export-kit';
import { nodeAt, parsePathKey, SLIDE_HEIGHT, SLIDE_WIDTH, type DeckFace, type Slide } from '@open-artifact/slides-core';
import { embedStillsReady } from '../render/embed-still.ts';
import { SlideView } from '../render/SlideView.tsx';
import { installSlideStyles, slideStylesheet } from '../render/css.ts';
import { fitElement } from '../render/fit.ts';
import { fontsReady, syncDeckFonts } from '../render/fonts.ts';
import type { AssetCache } from './export/assets.ts';

export type { LinkArea, TextLine };

/** How large a capture may be: 12000 px a side, 100 megapixels. */
const CAPTURE_LIMITS: CaptureLimits = { maxSide: 12000, maxPixels: 100_000_000 };
/** How long a picture may take to load, ms. */
const IMAGE_TIMEOUT = 15_000;
/** How long web fonts may take to load, ms. */
const FONT_TIMEOUT = 8_000;

/**
 * The page reset the editor runs under (Tailwind's preflight, as far as it
 * reaches slide elements), in the lowest cascade layer like there. Drawn
 * pictures and HTML exports include it so slides lay out exactly as they do
 * in the editor.
 */
export const PAGE_RESET =
  '@layer base{*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}' +
  'hr{height:0;color:inherit;border-top-width:1px}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}' +
  'a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}table{text-indent:0;border-color:inherit;border-collapse:collapse}' +
  'ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}}';

/** What a capture needs from the export. */
export interface CaptureContext {
  resolveSrc: (src: string) => string;
  assets: AssetCache;
  faces: Readonly<Record<string, DeckFace>>;
  /** Self-contained `@font-face` rules drawn into pictures. */
  fontCss: string;
  /** Called when a picture had to be drawn with the fallback renderer. */
  onMissingEmbed?: () => void;
  onFallback?: () => void;
  /** Called for each picture that could not be read. */
  onMissingPicture?: (src: string) => void;
  /** Called with the font families still loading when a slide had to be drawn without them. */
  onLateFonts?: (families: string[]) => void;
}

/** A slide rendered offscreen. */
export interface MountedSlide {
  slide: Slide;
  /** The `.open-artifact-slide` element (1920×1080, at the page's far left). */
  root: HTMLDivElement;
  /** Unmounts and removes the host. */
  dispose(): void;
}

/** A rectangle in slide px. */
export interface SlideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Refits every fitted text element now (export hosts may not get resize callbacks). */
function refit(root: HTMLElement, slide: Slide): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-open-artifact-kind="text"],[data-open-artifact-kind="list"],[data-open-artifact-kind="textbox"],[data-open-artifact-kind="table"]'))) {
    const node = nodeAt(slide, parsePathKey(el.getAttribute('data-open-artifact-path') ?? ''));
    if (!node || node.fit === 'none') continue;
    fitElement(el);
  }
}

/** Renders a slide offscreen and waits until it is fully drawn. */
export async function mountSlide(slide: Slide, context: Pick<CaptureContext, 'resolveSrc' | 'faces' | 'onMissingEmbed' | 'onLateFonts'>, captureEmbeds = true): Promise<MountedSlide> {
  installSlideStyles();
  syncDeckFonts(context.faces, context.resolveSrc);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-open-artifact-export-host', '');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${SLIDE_WIDTH}px`,
    height: `${SLIDE_HEIGHT}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(host);
  const ref = createRef<HTMLDivElement>();
  const reactRoot = createRoot(host);
  flushSync(() => {
    reactRoot.render(createElement(SlideView, { slide, options: { mode: 'export', captureEmbeds, resolveSrc: context.resolveSrc }, rootRef: ref }));
  });
  const dispose = (): void => {
    reactRoot.unmount();
    host.remove();
  };
  const root = ref.current;
  if (!root) {
    dispose();
    throw new Error('The slide could not be drawn.');
  }
  if (captureEmbeds) {
    if ((await embedStillsReady(root)).includes(false)) context.onMissingEmbed?.();
  }
  await picturesReady(root, IMAGE_TIMEOUT);
  const late = await fontsReady(document, FONT_TIMEOUT);
  if (late.length) context.onLateFonts?.(late);
  // Fonts and pictures change sizes: settle, refit, settle.
  await wait(20);
  refit(root, slide);
  await wait(0);
  return { slide, root, dispose };
}

/* -------------------------------------------------------------------------- */
/* Pictures                                                                    */
/* -------------------------------------------------------------------------- */

/** How a picture of a slide is drawn. */
export interface PictureOptions {
  /** Device pixels per slide px. */
  scale: number;
  type?: 'image/png' | 'image/jpeg';
  /** JPEG quality 0–1. */
  quality?: number;
  /** Painted under the slide (JPEG has no transparency). */
  background?: string;
  /** Area of the slide to draw, slide px (default: all of it). */
  area?: SlideRect;
  /** Draws only this element and what it holds; the rest is invisible. */
  only?: Element;
  /** With `only`: hides what the element holds (its background and border only). */
  bare?: boolean;
  /** Draw web fonts (default true; off for pictures without text). */
  fonts?: boolean;
}

/** A drawn picture. */
export interface Picture {
  blob: Blob;
  /** Pixel size. */
  width: number;
  height: number;
}

/**
 * A copy of the slide's markup with every picture inlined, ready to be
 * drawn in isolation. With `only`, pictures outside the target are blanked
 * (their size kept) so the copy stays small. A picture that cannot be read
 * is reported and left out.
 */
export function inlinedCopy(root: HTMLElement, context: CaptureContext, options: { only?: Element; bare?: boolean } = {}): Promise<HTMLElement> {
  return inlinedMarkup(root, {
    dataUrl: (src) => context.assets.dataUrl(src),
    unreadable: 'leave',
    onMissing: (src) => context.onMissingPicture?.(src),
    only: options.only,
    bare: options.bare,
  });
}

/** The slide as an SVG document drawing its markup through `<foreignObject>`. */
async function slideSvg(mounted: MountedSlide, context: CaptureContext, options: PictureOptions): Promise<string> {
  const copy = await inlinedCopy(mounted.root, context, options);
  const markup = new XMLSerializer().serializeToString(copy);
  const css = `${options.fonts === false ? '' : context.fontCss}\n${PAGE_RESET}\n${slideStylesheet()}`;
  return foreignObjectSvg(markup, css, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
}

/** The slide rebuilt as plain SVG by dom-to-svg (the fallback renderer). */
async function plainSvg(mounted: MountedSlide, context: CaptureContext, options: PictureOptions): Promise<string> {
  const root = mounted.root;
  const undo = hideOutside(root, options.only, Boolean(options.bare));
  try {
    const doc = await elementSvg(root);
    const svg = doc.documentElement;
    if (options.fonts !== false && context.fontCss) {
      const style = doc.createElementNS(SVG_NS, 'style');
      style.textContent = context.fontCss;
      svg.insertBefore(style, svg.firstChild);
    }
    svg.setAttribute('width', String(SLIDE_WIDTH));
    svg.setAttribute('height', String(SLIDE_HEIGHT));
    for (const script of Array.from(svg.querySelectorAll('script'))) script.remove();
    return new XMLSerializer().serializeToString(doc);
  } finally {
    undo();
  }
}

/** Loads an SVG document as an image. */
const loadSvg = (svg: string): Promise<HTMLImageElement> => loadSvgImage(svg, { error: 'The slide could not be drawn.', decoding: 'sync' });

/** Draws a loaded slide image onto a canvas; null when the browser refuses to read it back. */
async function draw(image: HTMLImageElement, area: SlideRect, scale: number, options: PictureOptions): Promise<Picture | null> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.w * scale));
  canvas.height = Math.max(1, Math.round(area.h * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, -area.x * scale, -area.y * scale, SLIDE_WIDTH * scale, SLIDE_HEIGHT * scale);
  const blob = await canvasBlob(canvas, options.type ?? 'image/png', options.quality);
  return blob ? { blob, width: canvas.width, height: canvas.height } : null;
}

/** Draws a slide (or a part of it) as a PNG or JPEG. */
export async function slidePicture(mounted: MountedSlide, context: CaptureContext, options: PictureOptions): Promise<Picture> {
  const area = options.area ?? { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT };
  const scale = Math.max(0.05, Math.min(options.scale, maxCaptureScale(area.w, area.h, CAPTURE_LIMITS)));
  try {
    const picture = await draw(await loadSvg(await slideSvg(mounted, context, options)), area, scale, options);
    if (picture) return picture;
  } catch {
    // Fall back below.
  }
  context.onFallback?.();
  const picture = await draw(await loadSvg(await plainSvg(mounted, context, options)), area, scale, options);
  if (!picture) throw new Error('The browser would not draw this slide.');
  return picture;
}

/* -------------------------------------------------------------------------- */
/* Text and links                                                              */
/* -------------------------------------------------------------------------- */

/** The lines of text drawn on a slide (slide px), for a searchable text layer. Words outside the slide are left out. */
export function textLines(root: HTMLElement): TextLine[] {
  const words = measureWords(root, { origin: 'root', drawnWithin: root, brokenWord: 'domrect' });
  return groupLines(words.filter((word) => !(word.right < 0 || word.left > SLIDE_WIDTH || word.bottom < 0 || word.top > SLIDE_HEIGHT)));
}

/** The clickable areas of web links on a slide, slide px. */
export function linkAreas(root: HTMLElement): LinkArea[] {
  return measureLinks(root, { origin: 'root', drawnWithin: root, drawnOnly: false });
}
