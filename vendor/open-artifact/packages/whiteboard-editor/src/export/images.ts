/**
 * Loads what a board picture draws from outside the board document:
 * pictures (`/_blob/<id>` uploads from the host's root, `https` images and
 * inline data URLs, a video's poster being its picture), agent drawings
 * with the board's pen, lucide icons of icon stickers, the still Noto art
 * of emoji stickers, and the board font.
 *
 * Remote pictures are fetched into object URLs so they never taint the
 * canvas; if fetching fails they load directly with CORS. Drawings that
 * would taint the canvas (a browser that refuses to read SVG pixels) are
 * left out. Loading runs six at a time under one time budget; whatever is
 * still loading when it runs out is left out of the picture.
 */

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { iconStickerOf, svgToBase64DataUrl, type BoardElement } from '@open-artifact/whiteboard-core';
import { emojiArtKey, notoEmojiArt, stickerEmoji } from '../lib/noto-emoji.ts';
import { stickerIconComponent } from '../lib/sticker-icons.ts';
import { iconStickerColor } from '../ui/StickerGlyph.tsx';
import { drawnImageSrc, type DrawnPen } from './drawn-svg.ts';

/** How long pictures may take to load before the export goes on without them, ms. */
export const RASTER_IMAGE_LOAD_TIMEOUT_MS = 45_000;
/** How many pictures load at once. */
export const IMAGE_LOAD_WORKERS = 6;
/** How long the export waits for the board font, ms. */
export const FONT_LOAD_TIMEOUT_MS = 1500;
/** Pixel size icon sticker art is rendered at. */
const ICON_RENDER_PX = 96;

/** How many pictures were drawn, ran out of time, or failed to load. */
export interface ImageLoadTally {
  drawn: number;
  timed_out: number;
  failed: number;
}

/** Loaded images by source, and what became of the rest. */
export interface LoadedImages {
  loaded: Map<string, HTMLImageElement>;
  tally: ImageLoadTally;
}

/** Everything a board picture draws besides the document itself. */
export interface PictureAssets {
  /** Loaded pictures and drawings, by the source in {@link PictureAssets.imageSources}. */
  images: ReadonlyMap<string, HTMLImageElement>;
  /** The source each image element draws (drawings restyled with the pen), by element id. */
  imageSources: ReadonlyMap<string, string>;
  /** Sticker art: rendered icons by lucide icon name, Noto emoji by {@link emojiArtKey}. */
  icons: ReadonlyMap<string, HTMLImageElement>;
  tally: ImageLoadTally;
  /** Frees the object URLs the loading made. */
  release(): void;
}

/** True for `data:` URLs (never fetched, never taint). */
function isDataUrl(src: string): boolean {
  return /^data:/i.test(src);
}

/** A picture source as an absolute URL (`/_blob/<id>` resolves to the page's origin); data URLs stay as they are. */
export function resolveImageUrl(src: string, base: string = document.baseURI): string {
  if (isDataUrl(src)) return src;
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

/** Loads an image element; `null` when it does not load. */
export function loadHtmlImageElement(src: string, crossOrigin?: 'anonymous'): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** True when a canvas can read back what the image draws (it would not taint the export). */
export function canReadImagePixels(img: CanvasImageSource): boolean {
  try {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0, 1, 1);
    ctx?.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads one picture without tainting the canvas: data URLs directly,
 * anything else fetched into an object URL (kept in `objectUrls` to free
 * later), falling back to a CORS image load.
 */
async function loadReadableImage(src: string, objectUrls: string[]): Promise<HTMLImageElement | null> {
  if (isDataUrl(src)) return loadHtmlImageElement(src);
  const url = resolveImageUrl(src);
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (response.ok) {
      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrls.push(objectUrl);
      const img = await loadHtmlImageElement(objectUrl);
      if (img) return img;
    }
  } catch {
    // Fall through to a direct load.
  }
  return loadHtmlImageElement(url, 'anonymous');
}

/**
 * Loads pictures six at a time until `timeoutMs` runs out. Each loaded
 * image must be readable (pixels a canvas can read back).
 */
export async function loadRasterImages(srcs: Iterable<string>, timeoutMs = RASTER_IMAGE_LOAD_TIMEOUT_MS, objectUrls: string[] = []): Promise<LoadedImages> {
  const loaded = new Map<string, HTMLImageElement>();
  const queue = [...new Set(srcs)];
  const total = queue.length;
  let failed = 0;
  const worker = async (): Promise<void> => {
    for (let src = queue.shift(); src !== undefined; src = queue.shift()) {
      const img = await loadReadableImage(src, objectUrls);
      if (img && canReadImagePixels(img)) loaded.set(src, img);
      else failed += 1;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(Array.from({ length: IMAGE_LOAD_WORKERS }, worker)),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  queue.length = 0;
  const drawn = new Map(loaded);
  return { loaded: drawn, tally: { drawn: drawn.size, timed_out: total - drawn.size - failed, failed } };
}

/** SVG markup of icon art by icon name (the art never changes). */
const iconMarkup = new Map<string, string>();

/**
 * The lucide art of an icon as SVG markup, rendered into a detached element
 * with the page's own React: no lazily loaded renderer, which a page that
 * outlives its build (a rebuild renames the chunks) could no longer load.
 */
function stickerIconMarkup(name: string): string | undefined {
  const known = iconMarkup.get(name);
  if (known !== undefined) return known;
  const Icon = stickerIconComponent(name);
  if (!Icon || typeof document === 'undefined') return undefined;
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(Icon, { size: ICON_RENDER_PX, strokeWidth: 2.5, color: iconStickerColor(name) })));
    const svg = host.innerHTML;
    if (!svg.startsWith('<svg')) return undefined;
    const markup = svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    iconMarkup.set(name, markup);
    return markup;
  } finally {
    root.unmount();
  }
}

/** Still Noto emoji art loaded so far, by emoji (`null`: it did not load). */
const emojiArt = new Map<string, Promise<HTMLImageElement | null>>();

/** The still Noto art of an emoji, loaded with CORS so it can be painted. */
function loadEmojiArt(glyph: string): Promise<HTMLImageElement | null> {
  let loading = emojiArt.get(glyph);
  if (!loading) {
    const art = notoEmojiArt(glyph);
    loading = art ? loadHtmlImageElement(art.svg, 'anonymous').then((img) => (img && canReadImagePixels(img) ? img : null)) : Promise.resolve(null);
    emojiArt.set(glyph, loading);
  }
  return loading;
}

/**
 * Loads the art of every icon and emoji sticker on the board: lucide art
 * rendered into images by icon name, Noto emoji art by {@link emojiArtKey}.
 * Art that fails is left out (an icon sticker draws a plain disc in its
 * marker color, an emoji its system font glyph).
 */
export async function loadStickerIcons(elements: readonly BoardElement[]): Promise<Map<string, HTMLImageElement>> {
  const names = new Set<string>();
  const emoji = new Set<string>();
  for (const element of elements) {
    if (element.type !== 'sticker') continue;
    const icon = iconStickerOf(element.art);
    if (icon && stickerIconComponent(icon.icon)) names.add(icon.icon);
    const glyph = stickerEmoji(element);
    if (glyph !== undefined) emoji.add(glyph);
  }
  const icons = new Map<string, HTMLImageElement>();
  await Promise.all([
    ...[...names].map(async (name) => {
      try {
        const svg = stickerIconMarkup(name);
        const img = svg === undefined ? null : await loadHtmlImageElement(svgToBase64DataUrl(svg));
        if (img && canReadImagePixels(img)) icons.set(name, img);
      } catch {
        // This icon draws its disc.
      }
    }),
    ...[...emoji].map(async (glyph) => {
      const img = await loadEmojiArt(glyph);
      if (img) icons.set(emojiArtKey(glyph), img);
    }),
  ]);
  return icons;
}

/** Waits for the page's fonts to be ready, at most `timeoutMs`. */
export async function loadBoardFontsWithTimeout(timeoutMs = FONT_LOAD_TIMEOUT_MS): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Loads everything a board picture draws besides the document: each image
 * element's source (drawings given `pen`), icon sticker art and the font.
 */
export async function loadPictureAssets(
  elements: readonly BoardElement[],
  pen: DrawnPen,
  timeoutMs = RASTER_IMAGE_LOAD_TIMEOUT_MS,
  looks: ReadonlyMap<string, string> = new Map(),
): Promise<PictureAssets> {
  const imageSources = new Map<string, string>();
  for (const element of elements) if (element.type === 'image') imageSources.set(element.id, looks.get(element.id) ?? drawnImageSrc(element, pen));
  const objectUrls: string[] = [];
  const [{ loaded, tally }, icons] = await Promise.all([loadRasterImages(imageSources.values(), timeoutMs, objectUrls), loadStickerIcons(elements), loadBoardFontsWithTimeout()]);
  return {
    images: loaded,
    imageSources,
    icons,
    tally,
    release() {
      for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
    },
  };
}
