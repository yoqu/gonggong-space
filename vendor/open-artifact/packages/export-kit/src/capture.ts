/**
 * Capturing rendered DOM as pictures, two ways:
 *
 * - through an SVG `<foreignObject>`: a copy of the markup with every
 *   picture inlined as a `data:` URL ({@link inlinedCopy}) is wrapped in an
 *   SVG document ({@link foreignObjectSvg}), loaded as an image
 *   ({@link loadSvgImage}) and drawn onto a canvas. It keeps everything the
 *   browser can draw, but some browsers refuse to read the canvas back;
 * - with dom-to-svg ({@link elementSvg}), which rebuilds the element as
 *   plain SVG shapes: a vector drawing that pastes into design tools, and
 *   the fallback when the first way fails.
 *
 * What is captured (a slide, an artboard's element) and how the result is
 * drawn stays with each editor.
 */

import { elementToSVG, inlineResources } from 'dom-to-svg';
import { withCaptureSafeDom } from './capture-safe.ts';
import { cssUrls } from './fonts.ts';

/** A transparent 1×1 GIF: stands in for pictures a capture leaves out. */
export const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** How large a capture may be. */
export interface CaptureLimits {
  /** Largest side, px. */
  maxSide: number;
  /** Most pixels in one capture. */
  maxPixels: number;
}

/** The largest scale an area of `width` × `height` can be drawn at within `limits`. */
export function maxCaptureScale(width: number, height: number, limits: CaptureLimits): number {
  return Math.min(limits.maxSide / Math.max(width, height, 1), Math.sqrt(limits.maxPixels / Math.max(width * height, 1)));
}

/** Resolves once every picture in the element loaded (or failed, or took longer than `timeout` ms) and decoded. */
export async function picturesReady(root: ParentNode, timeout: number): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          const done = (): void => resolve();
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
          setTimeout(done, timeout);
        });
      }
      await image.decode().catch(() => undefined);
    }),
  );
}

/**
 * Hides everything under `root` but `target` (live elements or a copy), so a
 * capture draws only the target where it sits. `bare` also hides what the
 * target holds (its background and border only). Returns an undo.
 */
export function hideOutside(root: HTMLElement, target: Element | undefined, bare: boolean): () => void {
  const touched: [Element & ElementCSSInlineStyle, string, string, string][] = [];
  const set = (el: Element, property: string, value: string): void => {
    const styled = el as Element & ElementCSSInlineStyle;
    if (!styled.style) return;
    touched.push([styled, property, styled.style.getPropertyValue(property), styled.style.getPropertyPriority(property)]);
    styled.style.setProperty(property, value, 'important');
  };
  if (target) {
    if (target !== root) {
      set(root, 'visibility', 'hidden');
      set(target, 'visibility', 'visible');
    }
    if (bare) {
      for (const child of Array.from(target.children)) set(child, 'visibility', 'hidden');
      set(target, '-webkit-text-fill-color', 'transparent');
      set(target, 'text-shadow', 'none');
    }
  }
  return () => {
    for (const [el, property, value, priority] of touched.reverse()) {
      if (value) el.style.setProperty(property, value, priority);
      else el.style.removeProperty(property);
    }
  };
}

/** How {@link inlinedCopy} reads and replaces pictures. */
export interface InlineOptions {
  /** A picture's address as a `data:` URL, or null when it cannot be read. */
  dataUrl: (src: string) => Promise<string | null>;
  /**
   * What becomes of a picture that cannot be read. `leave`: an `<img>`
   * loses its `src`; an SVG `<image>` and a style's `url(…)` keep their
   * address. `blank`: each becomes {@link BLANK_GIF}.
   */
  unreadable: 'leave' | 'blank';
  /** Called with each `<img>` source and style `url(…)` that could not be read. */
  onMissing?: (src: string) => void;
  /** Inlines only pictures in this element; `<img>`s outside it are blanked (their size kept) so the copy stays small, and it alone is shown. */
  only?: Element;
  /** With `only`: hides what the element holds (see {@link hideOutside}). */
  bare?: boolean;
}

/** Replaces `url(…)` references in an element's inline style with `data:` URLs. */
export async function inlineStyleUrls(el: Element, options: Pick<InlineOptions, 'dataUrl' | 'unreadable' | 'onMissing'>): Promise<void> {
  const style = el.getAttribute('style');
  if (!style || !style.includes('url(')) return;
  let next = style;
  for (const { match, url: raw } of cssUrls(style)) {
    const url = raw.replace(/&quot;/g, '');
    if (url.startsWith('data:')) continue;
    const data = await options.dataUrl(url);
    if (data) next = next.replace(match, `url("${data}")`);
    else if (options.unreadable === 'blank') next = next.replace(match, `url("${BLANK_GIF}")`);
    else options.onMissing?.(url);
  }
  el.setAttribute('style', next);
}

/** A copy of the element's markup with every picture inlined, ready to be drawn in isolation. */
export async function inlinedCopy(root: HTMLElement, options: InlineOptions): Promise<HTMLElement> {
  const copy = root.cloneNode(true) as HTMLElement;
  const live = [root, ...Array.from(root.querySelectorAll('*'))];
  const copies = [copy, ...Array.from(copy.querySelectorAll('*'))];
  const target = options.only;
  const inside = (el: Element): boolean => !target || target === el || target.contains(el);
  await Promise.all(
    live.map(async (el, i) => {
      const twin = copies[i]!;
      if (el instanceof HTMLImageElement) {
        twin.removeAttribute('srcset');
        twin.removeAttribute('loading');
        const src = el.currentSrc || el.src;
        if (inside(el)) {
          const data = src ? await options.dataUrl(src) : null;
          if (data) twin.setAttribute('src', data);
          else if (options.unreadable === 'blank') twin.setAttribute('src', BLANK_GIF);
          else {
            twin.removeAttribute('src');
            if (src) options.onMissing?.(src);
          }
        } else {
          twin.setAttribute('src', BLANK_GIF);
          (twin as HTMLElement).style.width = `${el.offsetWidth}px`;
          (twin as HTMLElement).style.height = `${el.offsetHeight}px`;
        }
      } else if (el instanceof SVGImageElement) {
        const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
        if (href && !href.startsWith('data:')) {
          const data = await options.dataUrl(href);
          if (data) twin.setAttribute('href', data);
          else if (options.unreadable === 'blank') twin.setAttribute('href', BLANK_GIF);
          twin.removeAttribute('xlink:href');
        }
      }
      if (inside(el)) await inlineStyleUrls(twin, options);
    }),
  );
  if (target) {
    const index = live.indexOf(target);
    if (index >= 0) hideOutside(copy, copies[index], Boolean(options.bare));
  }
  return copy;
}

/** Escapes text (such as CSS) for an XML text node. */
export function xmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** The size of a {@link foreignObjectSvg} drawing. */
export interface ForeignObjectSize {
  /** The markup's layout size, CSS px (also the view box). */
  width: number;
  height: number;
  /** The SVG's own size (default: the layout size). */
  outerWidth?: number;
  outerHeight?: number;
}

/** An SVG document drawing serialized XHTML `markup`, styled by `css`, through a `<foreignObject>`. */
export function foreignObjectSvg(markup: string, css: string, size: ForeignObjectSize): string {
  const { width, height } = size;
  return (
    `<svg xmlns="${SVG_NS}" width="${size.outerWidth ?? width}" height="${size.outerHeight ?? height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="${XHTML_NS}" style="width:${width}px;height:${height}px;margin:0;overflow:hidden"><style>${xmlText(css)}</style>${markup}</div>` +
    '</foreignObject></svg>'
  );
}

/** Loads an SVG document as an image (from a `data:` URL), decoded; rejects with `error` when it will not load. */
export async function loadSvgImage(svg: string, options: { error: string; decoding?: HTMLImageElement['decoding'] }): Promise<HTMLImageElement> {
  const image = new Image();
  if (options.decoding) image.decoding = options.decoding;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(options.error));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  await image.decode().catch(() => undefined);
  return image;
}

/** An area to capture, CSS px in the element's window. */
export interface CaptureArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Puts every `<image>` link under `root` in the XLink namespace.
 *
 * dom-to-svg writes an image's address with `setAttribute('xlink:href', …)`,
 * which in its XML document makes an attribute in no namespace. Its
 * `inlineResources` reads `href.baseVal`, which only sees a namespaced
 * `xlink:href` (or a plain `href`), so every picture failed with "No URL
 * passed", kept its web address, and came out blank once the address was
 * dropped. Once namespaced, inlining's own `setAttribute('xlink:href', data)`
 * updates that same attribute.
 */
export function linkImages(root: Element): void {
  for (const image of Array.from(root.getElementsByTagNameNS(SVG_NS, 'image'))) {
    const plain = image.getAttributeNodeNS(null, 'xlink:href');
    if (!plain) continue;
    image.removeAttributeNode(plain);
    image.setAttributeNS(XLINK_NS, 'xlink:href', plain.value);
  }
}

/** An `<img>`'s content box and how its picture fills it, as dom-to-svg places its `<image>`. */
interface ImageFit {
  x: number;
  y: number;
  width: number;
  height: number;
  preserveAspectRatio: string;
}

/** `object-position` as an SVG alignment (`xMidYMid`); positions other than 0%, 50% and 100% are taken as the middle. */
export function objectAlign(position: string): string {
  const [x = '50%', y = '50%'] = position.trim().split(/\s+/);
  const KEYWORDS: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
  const axis = (value: string): string => {
    const at = KEYWORDS[value] ?? (value.endsWith('%') || Number.parseFloat(value) === 0 ? Number.parseFloat(value) : Number.NaN);
    return at === 0 ? 'Min' : at === 100 ? 'Max' : 'Mid';
  };
  return `x${axis(x)}Y${axis(y)}`;
}

/** `object-fit` (and `object-position`) as an SVG `preserveAspectRatio`; null where SVG has no match (`none`). */
export function objectFitAspect(fit: string, position: string): string | null {
  switch (fit) {
    case 'fill':
      return 'none';
    case 'cover':
      return `${objectAlign(position)} slice`;
    case 'contain':
    case 'scale-down':
      return `${objectAlign(position)} meet`;
    default:
      return null;
  }
}

/** How each `<img>` under `element` fills its box, measured where dom-to-svg measures it. */
function imageFits(element: Element): ImageFit[] {
  const view = element.ownerDocument.defaultView!;
  const fits: ImageFit[] = [];
  const images = element.localName === 'img' ? [element] : Array.from(element.querySelectorAll('img'));
  for (const image of images) {
    const style = view.getComputedStyle(image);
    const preserveAspectRatio = objectFitAspect(style.objectFit, style.objectPosition);
    if (!preserveAspectRatio) continue;
    const rect = image.getBoundingClientRect();
    const left = Number.parseFloat(style.paddingLeft) || 0;
    const top = Number.parseFloat(style.paddingTop) || 0;
    fits.push({
      x: rect.x + left,
      y: rect.y + top,
      width: rect.width - left - (Number.parseFloat(style.paddingRight) || 0),
      height: rect.height - top - (Number.parseFloat(style.paddingBottom) || 0),
      preserveAspectRatio,
    });
  }
  return fits;
}

/**
 * Gives each `<image>` dom-to-svg made for an `<img>` the picture's
 * `object-fit`: it leaves SVG's default (`xMidYMid meet`), which letterboxes
 * a cropped (`cover`) or stretched (`fill`, HTML's default) picture. Images
 * are matched by position and size; background images already carry their
 * own `preserveAspectRatio` and are left alone.
 */
function fitImages(root: Element, fits: readonly ImageFit[]): void {
  if (!fits.length) return;
  const near = (a: string | null, b: number): boolean => a !== null && Math.abs(Number(a) - b) < 0.5;
  for (const image of Array.from(root.getElementsByTagNameNS(SVG_NS, 'image'))) {
    if (image.hasAttribute('preserveAspectRatio')) continue;
    const fit = fits.find((f) => near(image.getAttribute('x'), f.x) && near(image.getAttribute('y'), f.y) && near(image.getAttribute('width'), f.width) && near(image.getAttribute('height'), f.height));
    if (fit) image.setAttribute('preserveAspectRatio', fit.preserveAspectRatio);
  }
}

/**
 * The element rebuilt as plain SVG by dom-to-svg (links dropped), its
 * resources inlined. `area` defaults to the element's own box.
 *
 * `fontCss` replaces the `@font-face` rules dom-to-svg copies itself. It
 * only copies those of linked stylesheets it may read (none from an inline
 * `<style>`, none from another origin), and without its font a text is
 * drawn in a fallback at the place measured for the real one. Pass the
 * document's {@link embeddedFontCss} for a drawing that is rasterized.
 */
export async function elementSvg(element: Element, area?: CaptureArea, options: { fontCss?: string } = {}): Promise<XMLDocument> {
  const box = area ?? element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView!;
  const fits = imageFits(element);
  const doc = withCaptureSafeDom(element, () => elementToSVG(element, { captureArea: new view.DOMRect(box.x, box.y, box.width, box.height), keepLinks: false }));
  linkImages(doc.documentElement);
  fitImages(doc.documentElement, fits);
  // dom-to-svg's own rules sit in the first <style>; emptied, there is nothing for it to download a second time.
  const fontStyle = options.fontCss === undefined ? null : Array.from(doc.documentElement.children).find((child) => child.localName === 'style');
  if (fontStyle) fontStyle.textContent = '';
  await inlineResources(doc.documentElement);
  if (fontStyle) fontStyle.textContent = options.fontCss!;
  else if (options.fontCss) {
    const style = doc.createElementNS(SVG_NS, 'style');
    style.textContent = options.fontCss;
    doc.documentElement.prepend(style);
  }
  return doc;
}
