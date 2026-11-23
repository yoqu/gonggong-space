/**
 * Thumbnail snapshots: one slide drawn as a small WebP (or JPEG) image, for
 * the thumbnails that are not live (services/live.ts).
 *
 * The slide is rendered with the regular {@link SlideView} in `thumb` mode
 * into a hidden host on this page (a few hosts are reused, one slide at a
 * time each), waited for (pictures, fonts, text fitting), then its markup is
 * copied with pictures and the deck's fonts inlined as `data:` URLs and drawn
 * through an SVG `<foreignObject>` onto a canvas at thumbnail size. Pictures
 * are inlined downscaled, since a thumbnail never needs more.
 *
 * This is the export capture (services/capture.ts) cut down for speed: no
 * fallback renderer (a slide whose picture fails stays live-or-placeholder),
 * a small output, and caches that outlive one capture.
 */

import { createElement, createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import {
  blobToDataUrl,
  blockUnicodeRange,
  canvasBlob,
  cssUrls,
  drawScaled,
  edgeScale,
  fontFaceBlocks,
  foreignObjectSvg,
  inlinedCopy,
  loadSvgImage,
  parseUnicodeRange,
  picturesReady,
  rangeCovers,
} from '@open-artifact/export-kit';
import { isFontHref, nodeAt, parsePathKey, SLIDE_HEIGHT, SLIDE_WIDTH, type DeckFace, type Slide } from '@open-artifact/slides-core';
import { SlideView, type RenderOptions } from '../render/SlideView.tsx';
import { installSlideStyles, slideStylesheet } from '../render/css.ts';
import { embedStillsReady } from '../render/embed-still.ts';
import { fitElement } from '../render/fit.ts';
import { fontFaceRule, fontsReady, syncDeckFonts } from '../render/fonts.ts';
import { PAGE_RESET } from './capture.ts';
import { snapshotSize } from './live-plan.ts';

/** How long a picture may take to load, ms. */
const IMAGE_TIMEOUT = 5_000;
/** How long web fonts may take to load, ms. */
const FONT_TIMEOUT = 4_000;
/** Longest side of a picture inlined into a snapshot, px. */
const MAX_PICTURE_SIDE = 1024;
/** Pictures (and font files) kept inlined between captures. */
const CACHE_ENTRIES = 160;
/** Inlined font data per snapshot, bytes of `data:` URL. */
const MAX_FONT_BYTES = 3_000_000;

/** What a snapshot needs from the deck. */
export interface SnapshotContext {
  resolveSrc: (src: string) => string;
  faces: Readonly<Record<string, DeckFace>>;
  /** Image pixels per slide px. */
  scale: number;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Caches                                                                      */
/* -------------------------------------------------------------------------- */

/** A small map that forgets its oldest entries. */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly size: number) {}
  get(key: string, make: () => V): V {
    let value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
      return value;
    }
    value = make();
    this.map.set(key, value);
    while (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
    return value;
  }
}

const pictures = new Lru<Promise<string | null>>(CACHE_ENTRIES);
const files = new Lru<Promise<string | null>>(CACHE_ENTRIES);
const sheets = new Lru<Promise<string[]>>(16);

const absolute = (url: string): string => {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
};

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

/** A file as a `data:` URL, as it is (fonts). */
function fileData(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  const href = absolute(url);
  return files.get(href, async () => {
    const blob = await fetchBlob(href);
    return blob ? blobToDataUrl(blob).catch(() => null) : null;
  });
}

/** A picture as a `data:` URL, redrawn smaller when it is larger than a thumbnail can show. */
function pictureData(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  const href = absolute(url);
  return pictures.get(href, async () => {
    const blob = await fetchBlob(href);
    if (!blob) return null;
    if (/svg|gif/.test(blob.type) || typeof createImageBitmap !== 'function') return blobToDataUrl(blob).catch(() => null);
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = edgeScale(bitmap.width, bitmap.height, MAX_PICTURE_SIDE);
      if (scale === 1 && blob.size < 400_000) {
        bitmap.close();
        return await blobToDataUrl(blob);
      }
      const canvas = drawScaled(bitmap, bitmap.width, bitmap.height, scale);
      if (!canvas) throw new Error('No canvas.');
      bitmap.close();
      // WebP keeps transparency; JPEG where the browser cannot write WebP would lose it, so PNG then.
      const type = snapshotType() === 'image/webp' ? 'image/webp' : 'image/png';
      const small = await canvasBlob(canvas, type, 0.85);
      return await blobToDataUrl(small ?? blob);
    } catch {
      return blobToDataUrl(blob).catch(() => null);
    }
  });
}

let encodeType: 'image/webp' | 'image/jpeg' | null = null;

/** The image type snapshots are written as: WebP where the browser writes it, else JPEG. */
export function snapshotType(): 'image/webp' | 'image/jpeg' {
  if (!encodeType) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    encodeType = canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  }
  return encodeType;
}

/* -------------------------------------------------------------------------- */
/* Fonts                                                                       */
/* -------------------------------------------------------------------------- */

/** The `@font-face` blocks of a Google Fonts stylesheet. */
function sheetBlocks(href: string): Promise<string[]> {
  return sheets.get(href, async () => {
    try {
      const response = await fetch(href);
      if (!response.ok) return [];
      return fontFaceBlocks(await response.text());
    } catch {
      return [];
    }
  });
}

/** A block with its `url(…)` sources inlined (null when one cannot be read). */
async function inlineBlock(block: string, budget: { bytes: number }): Promise<string | null> {
  let out = block;
  for (const { match, url } of cssUrls(block)) {
    const data = await fileData(url);
    if (!data || data.length > budget.bytes) return null;
    budget.bytes -= data.length;
    out = out.replace(match, `url("${data}")`);
  }
  return out;
}

/** Self-contained `@font-face` rules for the deck's faces, limited to the blocks `text` needs. */
async function fontCss(faces: Readonly<Record<string, DeckFace>>, resolveSrc: (src: string) => string, text: string): Promise<string> {
  const points = new Set<number>();
  for (const char of text) points.add(char.codePointAt(0)!);
  const rules: string[] = [];
  const budget = { bytes: MAX_FONT_BYTES };
  for (const face of Object.values(faces)) {
    if (face.href && isFontHref(face.href)) {
      for (const block of await sheetBlocks(face.href)) {
        if (!rangeCovers(parseUnicodeRange(blockUnicodeRange(block)), points)) continue;
        const inlined = await inlineBlock(block, budget);
        if (inlined) rules.push(inlined);
      }
    } else if (face.src) {
      const data = await fileData(resolveSrc(face.src));
      if (data && data.length <= budget.bytes) {
        budget.bytes -= data.length;
        rules.push(fontFaceRule(face, data));
      }
    }
  }
  return rules.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

interface Host {
  el: HTMLDivElement;
  root: Root;
}

const idle: Host[] = [];

function takeHost(): Host {
  const reused = idle.pop();
  if (reused) return reused;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-open-artifact-snapshot-host', '');
  Object.assign(el.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${SLIDE_WIDTH}px`,
    height: `${SLIDE_HEIGHT}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    contain: 'strict',
    zIndex: '-1',
  });
  document.body.appendChild(el);
  return { el, root: createRoot(el) };
}

function giveHost(host: Host): void {
  flushSync(() => host.root.render(null));
  idle.push(host);
}

function refit(root: HTMLElement, slide: Slide): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-open-artifact-kind="text"],[data-open-artifact-kind="list"],[data-open-artifact-kind="textbox"],[data-open-artifact-kind="table"]'))) {
    const node = nodeAt(slide, parsePathKey(el.getAttribute('data-open-artifact-path') ?? ''));
    if (!node || node.fit === 'none') continue;
    fitElement(el);
  }
}

const optionsCache = new WeakMap<(src: string) => string, RenderOptions>();
const thumbOptions = (resolveSrc: (src: string) => string): RenderOptions => {
  let options = optionsCache.get(resolveSrc);
  if (!options) {
    options = { mode: 'thumb', resolveSrc };
    optionsCache.set(resolveSrc, options);
  }
  return options;
};

/** Draws one slide as a small image. Rejects when the browser will not draw it. */
export async function snapshotSlide(slide: Slide, context: SnapshotContext): Promise<Blob> {
  installSlideStyles();
  syncDeckFonts(context.faces, context.resolveSrc);
  const host = takeHost();
  host.el.style.width = `${SLIDE_WIDTH}px`;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    giveHost(host);
  };
  try {
    const ref = createRef<HTMLDivElement>();
    flushSync(() => host.root.render(createElement(SlideView, { slide, options: thumbOptions(context.resolveSrc), rootRef: ref })));
    const root = ref.current;
    if (!root) throw new Error('The slide could not be drawn.');
    await embedStillsReady(root);
    await picturesReady(root, IMAGE_TIMEOUT);
    await fontsReady(document, FONT_TIMEOUT);
    await wait(0);
    refit(root, slide);
    const [copy, fonts] = await Promise.all([inlinedCopy(root, { dataUrl: pictureData, unreadable: 'blank' }), fontCss(context.faces, context.resolveSrc, root.textContent ?? '')]);
    const markup = new XMLSerializer().serializeToString(copy);
    // The live tree is no longer needed: free the host for the next slide before the slow part.
    release();
    const { w, h } = snapshotSize(SLIDE_WIDTH, SLIDE_HEIGHT, context.scale);
    const css = `${fonts}\n${PAGE_RESET}\n${slideStylesheet()}`;
    const svg = foreignObjectSvg(markup, css, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, outerWidth: w, outerHeight: h });
    const image = await loadSvgImage(svg, { error: 'The slide could not be drawn.' });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('No canvas.');
    // JPEG has no transparency: white under the slide, as thumbnails show it.
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(image, 0, 0, w, h);
    const blob = await canvasBlob(canvas, snapshotType(), 0.82);
    if (!blob) throw new Error('The browser would not draw this slide.');
    return blob;
  } finally {
    release();
  }
}
