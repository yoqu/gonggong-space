import { dropSlightDisplacement, sayWholeStyle, sayWholeStyles } from './styles.ts';
import { xmlOf } from './xml.ts';

/** A stand-in with no picture: an <img> without a source draws with a broken-image border. */
export const CLEAR_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGBgAAAABQABeqhXUAAAAABJRU5ErkJggg==';
const BIG_PICTURE_CHARS = 65536;

/** The #fx canvas's last PNG, kept until something touches the canvas. */
export interface FxPicture {
  canvas: HTMLCanvasElement;
  png(): string;
}

/** WebKit can paint a picture inside an SVG image blank unless it is told to decode before painting. */
export function decodeFirst(root: ParentNode): void {
  for (const image of root.querySelectorAll('img')) image.setAttribute('decoding', 'sync');
}

function copyAt(source: CanvasImageSource, w: number, h: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** What a person did to a layer by hand goes by marks on its element: the picture standing in for it takes them over. */
function keepMarks(from: Element, to: Element): void {
  for (const name of ['data-film-over', 'data-film-laid']) {
    const value = from.getAttribute(name);
    if (value !== null) to.setAttribute(name, value);
  }
}

export interface SerializeOptions {
  width: number;
  height: number;
  /** Under 1, for a caller that only inspects the picture: media are read from small copies and the fonts left out. */
  mediaScale: number;
  fx: FxPicture | null;
  /** Over 0: the scale of a small preview, which leaves slight displacement out. */
  smoothAt: number;
  warn: (video: HTMLVideoElement, key: string, message: string) => void;
}

/**
 * The node as XHTML text for an SVG foreignObject. Canvas, clip and big picture pixels are spliced into the text
 * after serializing: an <img src> set in this long-lived document would start a load it keeps.
 */
export function serializeForRaster(node: HTMLElement, options: SerializeOptions): string {
  const clone = node.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return '';
  sayWholeStyles(node, clone);
  if (options.smoothAt > 0) dropSlightDisplacement(clone, options.smoothAt);
  const urls: string[] = [];
  const mark = 'data-raster-canvas-' + Math.random().toString(36).slice(2);
  const standIn = (image: HTMLImageElement, url: string): void => {
    image.setAttribute(mark, String(urls.length));
    urls.push(url);
  };
  if (options.mediaScale < 1) shrinkPictures(node, clone, options.mediaScale, standIn);
  // Read #fx afresh while a clip is on the stage: in Chromium a clip copied just after 'seeked' can still show the frame before.
  const fx = options.fx && node.querySelector('video') ? null : options.fx;
  replaceCanvases(node, clone, options.mediaScale, fx, standIn);
  replaceVideos(node, clone, options, standIn);
  keepInputs(node, clone);
  decodeFirst(clone);
  if (clone.id === 'stage') {
    clone.style.transform = 'none';
    clone.style.left = '0';
    clone.style.top = '0';
  }
  const wrap = document.createElement('div');
  wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrap.style.cssText = `width:${options.width}px;height:${options.height}px;overflow:hidden;position:relative;margin:0;padding:0`;
  wrap.appendChild(clone);
  let out = xmlOf(wrap);
  urls.forEach((url, k) => {
    out = out.replace(' ' + mark + '="' + k + '"', ' src="' + (/^data:image\//.test(url) ? url : CLEAR_PIXEL) + '"');
  });
  return out;
}

function shrinkPictures(node: HTMLElement, clone: HTMLElement, scale: number, standIn: (image: HTMLImageElement, url: string) => void): void {
  const fonts = clone.querySelector('#film-fonts');
  if (fonts) fonts.textContent = '';
  const sources = node.querySelectorAll('img');
  const copies = clone.querySelectorAll('img');
  for (let i = 0; i < copies.length && i < sources.length; i++) {
    const source = sources[i];
    const copy = copies[i];
    if (!source || !copy) continue;
    const from = source.currentSrc || source.src;
    if (!source.complete || !source.naturalWidth || from.length < BIG_PICTURE_CHARS) continue;
    const box = getComputedStyle(source);
    // Left whole: an SVG, whose natural size may be a default, and the two fits that draw a picture at its natural size.
    if (/^data:image\/svg/i.test(from) || box.objectFit === 'none' || box.objectFit === 'scale-down') continue;
    let url: string;
    try {
      url = copyAt(source, source.naturalWidth, source.naturalHeight, scale).toDataURL('image/png');
    } catch {
      continue;
    }
    copy.style.setProperty('width', box.width, 'important');
    copy.style.setProperty('height', box.height, 'important');
    copy.removeAttribute('src');
    copy.removeAttribute('srcset');
    standIn(copy, url);
    // The writes above re-serialize the copy's style, which can empty more values.
    sayWholeStyle(source, copy);
  }
}

// Told by identity, not by place among the canvases: a scene may have taken #fx into its box.
function replaceCanvases(node: HTMLElement, clone: HTMLElement, scale: number, fx: FxPicture | null, standIn: (image: HTMLImageElement, url: string) => void): void {
  const sources = node.querySelectorAll('canvas');
  const copies = clone.querySelectorAll('canvas');
  for (let i = 0; i < copies.length && i < sources.length; i++) {
    const source = sources[i];
    const copy = copies[i];
    if (!source || !copy) continue;
    const image = document.createElement('img');
    let url = '';
    try {
      url = scale < 1 ? copyAt(source, source.width, source.height, scale).toDataURL('image/png') : fx && fx.canvas === source ? fx.png() : source.toDataURL('image/png');
    } catch {
      image.alt = '';
    }
    standIn(image, url);
    image.setAttribute('style', copy.getAttribute('style') ?? '');
    image.className = copy.className;
    image.width = source.width;
    image.height = source.height;
    keepMarks(copy, image);
    if (!copy.style.width) image.style.width = (source.clientWidth || source.width) + 'px';
    if (!copy.style.height) image.style.height = (source.clientHeight || source.height) + 'px';
    sayWholeStyle(source, image);
    copy.parentNode?.replaceChild(image, copy);
  }
}

// A clip draws as its current frame; the clone's own load is cancelled.
function replaceVideos(node: HTMLElement, clone: HTMLElement, options: SerializeOptions, standIn: (image: HTMLImageElement, url: string) => void): void {
  const sources = node.querySelectorAll('video');
  const copies = clone.querySelectorAll('video');
  for (let i = 0; i < copies.length && i < sources.length; i++) {
    const source = sources[i];
    const copy = copies[i];
    if (!source || !copy) continue;
    const image = document.createElement('img');
    const shown = getComputedStyle(source);
    let url = '';
    copy.removeAttribute('src');
    copy.textContent = '';
    try {
      copy.load();
    } catch {
      // Nothing to cancel.
    }
    if (source.readyState >= 2 && source.videoWidth > 0) {
      try {
        // WebP keeps alpha at a fraction of PNG's bytes: the raster document keeps every data: URL until recycled.
        url = copyAt(source, source.videoWidth, source.videoHeight, Math.min(1, options.mediaScale)).toDataURL('image/webp', 0.92);
      } catch (error) {
        options.warn(source, 'taint', 'cannot be exported (' + (error instanceof Error ? error.name : String(error)) + '); it shows empty in frames');
      }
    } else if ((source.currentSrc || source.src) && !source.error) options.warn(source, 'empty', 'had no decoded frame when a frame was exported; it shows empty there');
    if (!url) image.alt = '';
    standIn(image, url);
    image.setAttribute('style', copy.getAttribute('style') ?? '');
    image.className = copy.className;
    if (copy.id) image.id = copy.id;
    keepMarks(copy, image);
    image.style.objectFit = shown.objectFit;
    image.style.objectPosition = shown.objectPosition;
    if (!copy.style.width) image.style.width = shown.width;
    if (!copy.style.height) image.style.height = shown.height;
    sayWholeStyle(source, image);
    copy.parentNode?.replaceChild(image, copy);
  }
}

function keepInputs(node: HTMLElement, clone: HTMLElement): void {
  const query = 'input, textarea, select';
  const sources = node.querySelectorAll(query);
  const copies = clone.querySelectorAll(query);
  for (let i = 0; i < copies.length && i < sources.length; i++) {
    const source = sources[i];
    const copy = copies[i];
    if (!source || !copy) continue;
    if (source instanceof HTMLInputElement && (source.type === 'checkbox' || source.type === 'radio')) {
      if (source.checked) copy.setAttribute('checked', '');
      else copy.removeAttribute('checked');
    } else if (source instanceof HTMLTextAreaElement) copy.textContent = source.value;
    else if (source instanceof HTMLSelectElement) {
      copy.querySelectorAll('option').forEach((option, k) => {
        if (k === source.selectedIndex) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      });
    } else if (source instanceof HTMLInputElement) copy.setAttribute('value', source.value);
  }
}

/** A snapshot's text color under forced colors when nothing gives it one: a page's own, with no theme. */
export const PLAIN_INK = '#000';

/**
 * The SVG keeps its content's own size with no viewBox, and the draw scales it to pw × ph: WebKit ignores an
 * SVG-level scale for positioned HTML in a foreignObject. data-raster-size draws nothing: it makes the text, and so
 * the URL the browser caches by, differ per output size.
 *
 * A snapshot is a document of its own, which the stage's opt-out of forced colors does not reach: the foreignObject
 * opts out, frame and plate alike, or Chromium repaints the picture in the theme's colors. Its default text color is
 * the theme's too, so under forced colors the caller gives `ink` for the root, as an attribute any rule in the snapshot
 * overrides. Not light-dark(), as the stage has: Firefox takes a picture's scheme from the theme.
 */
export function svgForRaster(xml: string, width: number, height: number, scale: number, ink?: string): { svg: string; pw: number; ph: number } {
  const pw = Math.max(1, Math.round(width * scale));
  const ph = Math.max(1, Math.round(height * scale));
  return {
    pw,
    ph,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" data-raster-size="${pw}x${ph}"${ink === undefined ? '' : ` color="${ink}"`}>` +
      `<foreignObject x="0" y="0" width="${width}" height="${height}" style="forced-color-adjust:none">` +
      xml +
      '</foreignObject></svg>',
  };
}

let forcedColors: MediaQueryList | null = null;
/** Taken before the film runs: a film's own matchMedia can replace the global. */
export function watchForcedColors(): void {
  try {
    forcedColors = matchMedia('(forced-colors: active)');
  } catch {
    forcedColors = null;
  }
}

/**
 * Under forced colors (a Windows contrast theme) a frame keeps the film's own colors: the document opts out while
 * `read` runs, or getComputedStyle would give the theme's colors. `read` must stay synchronous.
 */
export function inOwnColors<T>(read: () => T): T {
  if (!forcedColors || !forcedColors.matches) return read();
  const root = document.documentElement;
  const bare = !root.hasAttribute('style');
  const style = root.style;
  const had = style.getPropertyValue('forced-color-adjust');
  const priority = style.getPropertyPriority('forced-color-adjust');
  style.setProperty('forced-color-adjust', 'none', 'important');
  try {
    return read();
  } finally {
    if (had) style.setProperty('forced-color-adjust', had, priority);
    else style.removeProperty('forced-color-adjust');
    if (bare) {
      // A browser may write a style change into the attribute only when it is read; removed before that, it comes back as style="".
      root.getAttribute('style');
      root.removeAttribute('style');
    }
  }
}

export const forcedColorsActive = (): boolean => !!forcedColors && forcedColors.matches;
