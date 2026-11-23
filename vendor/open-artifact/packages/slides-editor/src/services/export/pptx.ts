/**
 * PowerPoint export.
 *
 * Each slide is rendered offscreen and read back element by element (every
 * drawn element carries `data-open-artifact-path` and `data-open-artifact-kind`), so positions,
 * sizes and text formatting are what the browser laid out, after text
 * fitting. Most things become native, editable objects:
 *
 * - text, lists and text boxes → text boxes with formatted runs, bullets and links;
 * - box, frame and rectangle backgrounds → shapes (solid or linear-gradient fill, outline, shadow);
 * - polygon shapes and lines → custom shapes; connectors → lines with arrowheads;
 * - tables → native tables; pictures → cropped pictures; speaker notes → notes.
 *
 * What PowerPoint cannot draw natively becomes a picture of just that
 * element: inline SVG, icons, embedded pages, and picture or patterned
 * backgrounds. Anything that cannot carry over is recorded as an export note.
 */

import { nodeAt, parsePathKey, SLIDE_HEIGHT, SLIDE_WIDTH, type ConnectorNode, type HeadKind, type ImageNode, type ShapeNode, type SlideNode } from '@open-artifact/slides-core';
import { connectorGeometry, connectorStroke, parseStroke, SHAPE_POLYGONS, type Point } from '../../render/geometry.ts';
import { mountSlide, slidePicture, type MountedSlide } from '../capture.ts';
import {
  cornerRadii,
  cornerRadius,
  intersect,
  objectContentRect,
  officeShadow,
  parseAngle,
  parseBoxShadow,
  parseColor,
  parseLinearGradient,
  pictureOutline,
  pptxFont,
  px,
  splitTop,
  withOpacity,
  type CssColor,
  type FontChoice,
  type Rect,
} from './css.ts';
import { setEastAsianFonts, collectFontUses, embedDeckFonts, fontNoticeText, networkFetchers, noteFontEmbedding, type EmbeddedFont } from './font-embedding.ts';
import { breathe, hasBuilds, type ExportJob, type ExportSlide } from './job.ts';
import {
  centerSingleLine,
  collapseGaps,
  edgeSpaceAsInset,
  writePptx,
  type Arrowhead,
  type Box,
  type Fill,
  type Geometry,
  type Line,
  type Paragraph,
  type PptxMedia,
  type PptxSlide,
  type Shadow,
  type SlideElement,
  type TableCell,
  type TextBody,
  type TextRun,
} from './ooxml.ts';


/** PowerPoint numbering of CSS list markers (nested ordered lists). */
const NUMBER_SCHEMES: Record<string, string> = {
  'lower-alpha': 'alphaLcPeriod',
  'lower-latin': 'alphaLcPeriod',
  'upper-alpha': 'alphaUcPeriod',
  'upper-latin': 'alphaUcPeriod',
  'lower-roman': 'romanLcPeriod',
  'upper-roman': 'romanUcPeriod',
};

/**
 * Current fonts include embeddable faces. The older embed request is an alias.
 * Basic fonts use Arial, Georgia or Courier New.
 */
export type PptxFonts = FontChoice | 'embed';

/** Options of a PPTX export. */
export interface PptxOptions {
  fonts: PptxFonts;
}

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
/** Device pixels per slide px of element pictures. */
const RASTER_SCALE = 2;
/** Room drawn around an element picture for shadows and filters, px. */
const EFFECT_PAD = 48;
/** How much wider text boxes are than their element, as a share of the width (office text measures wider). */
const TEXT_SLACK = 0.03;
const WHITE: CssColor = { hex: 'FFFFFF', alpha: 1 };
const BLACK: CssColor = { hex: '000000', alpha: 1 };

/* -------------------------------------------------------------------------- */
/* Colors                                                                      */
/* -------------------------------------------------------------------------- */

const hex2 = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();

const probed = new Map<string, CssColor | null>();
let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS color as sRGB: parsed when the spelling is a known one, else
 * painted onto a one-pixel canvas and read back (wide-gamut and `oklch()`
 * colors, `color-mix()`).
 */
function resolveColor(value: string | null | undefined): CssColor | null {
  if (!value || value === 'none') return null;
  const parsed = parseColor(value);
  if (parsed) return parsed;
  if (probed.has(value)) return probed.get(value)!;
  let result: CssColor | null = null;
  try {
    if (probe === undefined) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      probe = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#00000000';
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = probe.getImageData(0, 0, 1, 1).data;
      result = { hex: `${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: a / 255 };
    }
  } catch {
    result = null;
  }
  probed.set(value, result);
  return result;
}

/** A color laid over white (slide backgrounds cannot be translucent). */
function overWhite(color: CssColor): CssColor {
  if (color.alpha >= 1) return color;
  const mix = (i: number): string => hex2(parseInt(color.hex.slice(i, i + 2), 16) * color.alpha + 255 * (1 - color.alpha));
  return { hex: `${mix(0)}${mix(2)}${mix(4)}`, alpha: 1 };
}

/** A CSS line style as a dash. */
function dashOf(style: string | undefined): Line['dash'] {
  if (style === 'dashed') return 'dash';
  if (style === 'dotted') return 'dot';
  return 'solid';
}

/** An arrowhead kind as a DrawingML line end. */
function headOf(kind: HeadKind): Arrowhead | undefined {
  return kind === 'filled' ? 'triangle' : kind === 'open' ? 'arrow' : undefined;
}

function alignOf(value: string): Paragraph['align'] {
  if (value === 'center') return 'ctr';
  if (value === 'right' || value === 'end') return 'r';
  if (value === 'justify') return 'just';
  return 'l';
}

/** Collapses white space the way normal CSS text does, across a paragraph's runs. */
function collapseRuns(runs: TextRun[], preserve: boolean): TextRun[] {
  if (preserve) return runs.filter((run) => run.lineBreak || run.text);
  const out: TextRun[] = [];
  let lineStart = true;
  for (const run of runs) {
    if (run.lineBreak) {
      const last = out[out.length - 1];
      if (last && !last.lineBreak) last.text = last.text.replace(/ +$/, '');
      out.push(run);
      lineStart = true;
      continue;
    }
    let text = run.text.replace(/[ \t\n\r\f]+/g, ' ');
    const last = out[out.length - 1];
    if (lineStart || (last && !last.lineBreak && last.text.endsWith(' '))) text = text.replace(/^ +/, '');
    if (!text) continue;
    out.push({ ...run, text });
    lineStart = false;
  }
  const last = out[out.length - 1];
  if (last && !last.lineBreak) last.text = last.text.replace(/ +$/, '');
  // A final line break draws no line of its own in HTML.
  if (out[out.length - 1]?.lineBreak) out.pop();
  return out.filter((run) => run.lineBreak || run.text);
}

/** The number of lines an element's text takes. */
function lineCount(el: Element): number {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const tops: number[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (!tops.some((top) => Math.abs(top - rect.top) < rect.height * 0.5)) tops.push(rect.top);
    }
  }
  return tops.length;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

/** The picture files of the package, shared by every slide. */
class MediaStore {
  readonly items: PptxMedia[] = [];
  private readonly byUrl = new Map<string, string>();

  add(data: Uint8Array, type: PptxMedia['type'], url?: string): string {
    if (url) {
      const known = this.byUrl.get(url);
      if (known) return known;
    }
    const key = `image${this.items.length + 1}`;
    this.items.push({ key, data, type });
    if (url) this.byUrl.set(url, key);
    return key;
  }

  known(url: string): string | undefined {
    return this.byUrl.get(url);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading one slide                                                           */
/* -------------------------------------------------------------------------- */

/** Where an element sits: its placed box and a map from its own px to slide px. */
interface Frame {
  box: Box;
  /** Unscaled size (the element's own px). */
  w: number;
  h: number;
  sx: number;
  sy: number;
  toSlide(x: number, y: number): Point;
}

/** Reads one mounted slide into PPTX elements. */
class SlideReader {
  readonly elements: SlideElement[] = [];
  private readonly root: HTMLElement;
  private readonly origin: DOMRect;
  private readonly styles = new Map<Element, CSSStyleDeclaration>();
  private readonly counts = new Map<string, number>();

  private readonly mounted: MountedSlide;
  private readonly job: ExportJob;
  private readonly entry: ExportSlide;
  private readonly media: MediaStore;
  private readonly fonts: FontChoice;

  constructor(mounted: MountedSlide, job: ExportJob, entry: ExportSlide, media: MediaStore, fonts: FontChoice) {
    this.mounted = mounted;
    this.job = job;
    this.entry = entry;
    this.media = media;
    this.fonts = fonts;
    this.root = mounted.root;
    this.origin = mounted.root.getBoundingClientRect();
  }

  private style(el: Element): CSSStyleDeclaration {
    let style = this.styles.get(el);
    if (!style) {
      style = getComputedStyle(el);
      this.styles.set(el, style);
    }
    return style;
  }

  private name(label: string): string {
    const n = (this.counts.get(label) ?? 0) + 1;
    this.counts.set(label, n);
    return `${label} ${n}`;
  }

  /** Product of the opacities of the element and its ancestors. */
  private opacity(el: Element): number {
    let value = 1;
    for (let at: Element | null = el; at && at !== this.root.parentElement; at = at.parentElement) {
      const opacity = parseFloat(this.style(at).opacity);
      if (Number.isFinite(opacity)) value *= opacity;
    }
    return value;
  }

  /** The element's placed box, from its layout size and the transforms above it. */
  private frame(el: Element): Frame {
    const rect = el.getBoundingClientRect();
    let rot = 0;
    let sx = 1;
    let sy = 1;
    for (let at: Element | null = el; at && at !== this.root; at = at.parentElement) {
      const style = this.style(at);
      if (style.transform && style.transform !== 'none') {
        try {
          const m = new DOMMatrixReadOnly(style.transform);
          rot += (Math.atan2(m.b, m.a) * 180) / Math.PI;
          sx *= Math.hypot(m.a, m.b);
          sy *= Math.hypot(m.c, m.d);
        } catch {
          // An unreadable transform: treat as none.
        }
      }
      if (style.rotate && style.rotate !== 'none') rot += parseAngle(style.rotate.trim().split(/\s+/).pop() ?? '') ?? 0;
      if (style.scale && style.scale !== 'none') {
        const [a = 1, b = a] = style.scale.trim().split(/\s+/).map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          sx *= a;
          sy *= b;
        }
      }
    }
    rot = ((rot % 360) + 360) % 360;
    if (Math.abs(rot) < 0.01 || Math.abs(rot - 360) < 0.01) rot = 0;
    let w = el instanceof HTMLElement ? el.offsetWidth : (el as SVGSVGElement).clientWidth;
    let h = el instanceof HTMLElement ? el.offsetHeight : (el as SVGSVGElement).clientHeight;
    if (!w && !h) {
      // No layout size of its own (an inline SVG, say): fall back to what is drawn.
      w = rect.width / (sx || 1);
      h = rect.height / (sy || 1);
      rot = 0;
    }
    const cx = rect.left - this.origin.left + rect.width / 2;
    const cy = rect.top - this.origin.top + rect.height / 2;
    const bw = w * sx;
    const bh = h * sy;
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      box: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, rot: rot || undefined },
      w,
      h,
      sx,
      sy,
      toSlide(x, y) {
        const dx = (x - w / 2) * sx;
        const dy = (y - h / 2) * sy;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
      },
    };
  }

  /** Reads every drawn element, in paint (document) order. */
  async read(): Promise<void> {
    const slide = this.entry.slide;
    for (const el of Array.from(this.root.querySelectorAll('[data-open-artifact-kind]'))) {
      const kind = el.getAttribute('data-open-artifact-kind') as SlideNode['kind'];
      const node = nodeAt(slide, parsePathKey(el.getAttribute('data-open-artifact-path') ?? ''));
      if (el.getClientRects().length === 0 || this.style(el).visibility !== 'visible') continue;
      const alpha = this.opacity(el);
      if (alpha <= 0.001) continue;
      const frame = this.frame(el);
      if (frame.box.w < 0.5 && frame.box.h < 0.5 && kind !== 'rule' && kind !== 'connector') continue;
      switch (kind) {
        case 'text':
        case 'list':
        case 'textbox':
          await this.panel(el as HTMLElement, frame, alpha, this.name('Shape'));
          this.text(el as HTMLElement, kind, frame, alpha);
          break;
        case 'box':
          await this.panel(el as HTMLElement, frame, alpha, this.name(node?.kind === 'box' && node.group ? 'Group' : 'Shape'));
          break;
        case 'table':
          await this.table(el as HTMLElement, frame, alpha);
          break;
        case 'image':
          await this.image(el as HTMLElement, frame, alpha, node?.kind === 'image' ? node : undefined);
          break;
        case 'shape':
          if (el instanceof HTMLElement) await this.panel(el, frame, alpha, this.name('Shape'));
          else if (node?.kind === 'shape') await this.shape(el as SVGSVGElement, frame, alpha, node);
          break;
        case 'connector':
          if (node?.kind === 'connector') this.connector(el as SVGSVGElement, frame, alpha, node);
          break;
        case 'rule':
          this.rule(el as HTMLElement, frame, alpha);
          break;
        case 'embed':
          this.job.notes.add('embed', this.entry.number);
          await this.raster(el, this.name('Embedded page'), { fonts: false });
          break;
        case 'svg':
          await this.raster(el, this.name('Graphic'), {});
          break;
        case 'icon':
          await this.raster(el, this.name('Icon'), { fonts: false });
          break;
      }
    }
  }

  /** A picture of just this element (or of its own background and border, `bare`). */
  private async raster(el: Element, name: string, options: { bare?: boolean; fonts?: boolean; description?: string }): Promise<void> {
    const rect = el.getBoundingClientRect();
    const style = this.style(el);
    const pad = (style.filter && style.filter !== 'none') || (style.boxShadow && style.boxShadow !== 'none') ? EFFECT_PAD : 2;
    const left = Math.floor(rect.left - this.origin.left - pad);
    const top = Math.floor(rect.top - this.origin.top - pad);
    const area = intersect(
      { x: left, y: top, w: Math.ceil(rect.right - this.origin.left + pad) - left, h: Math.ceil(rect.bottom - this.origin.top + pad) - top },
      { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
    );
    if (area.w < 1 || area.h < 1) return;
    const picture = await slidePicture(this.mounted, this.job.capture, {
      scale: RASTER_SCALE,
      type: 'image/png',
      only: el,
      bare: options.bare,
      area,
      fonts: options.fonts,
    });
    const key = this.media.add(new Uint8Array(await picture.blob.arrayBuffer()), 'png');
    this.elements.push({ type: 'picture', name, box: area, media: key, description: options.description });
  }

  /** The four borders of an element. */
  private borders(style: CSSStyleDeclaration, alpha: number): { l?: Line; r?: Line; t?: Line; b?: Line } {
    const side = (name: 'Top' | 'Right' | 'Bottom' | 'Left'): Line | undefined => {
      const width = px(style[`border${name}Width`]);
      const lineStyle = style[`border${name}Style`];
      const color = resolveColor(style[`border${name}Color`]);
      if (width <= 0 || !color || color.alpha <= 0 || lineStyle === 'none' || lineStyle === 'hidden') return undefined;
      return { width, color: withOpacity(color, alpha), dash: dashOf(lineStyle) };
    };
    return { t: side('Top'), r: side('Right'), b: side('Bottom'), l: side('Left') };
  }

  /**
   * An element's own painting: background, border and shadow, as one
   * shape. Picture and patterned backgrounds are drawn as a picture.
   */
  private async panel(el: HTMLElement, frame: Frame, alpha: number, name: string, options: { shadow?: boolean } = {}): Promise<void> {
    const style = this.style(el);
    const image = style.backgroundImage;
    let fill: Fill = { type: 'none' };
    this.noteEffects(style, options.shadow !== false);
    if (image && image !== 'none') {
      const gradient = image.includes('url(') ? null : parseLinearGradient(image);
      if (!gradient) {
        this.job.notes.add('backgroundPicture', this.entry.number);
        await this.raster(el, name, { bare: true, fonts: false });
        return;
      }
      fill = { type: 'gradient', angle: gradient.angle, stops: gradient.stops.map((stop) => ({ pos: stop.pos, color: withOpacity(stop.color, alpha) })) };
    } else {
      const color = resolveColor(style.backgroundColor);
      if (color && color.alpha > 0) fill = { type: 'solid', color: withOpacity(color, alpha) };
    }
    const borders = this.borders(style, alpha);
    const sides = [borders.t, borders.r, borders.b, borders.l];
    const uniform = sides.every((line) => line && sides[0] && line.width === sides[0].width && line.color.hex === sides[0].color.hex && line.color.alpha === sides[0].color.alpha && line.dash === sides[0].dash);
    const shadow = options.shadow === false ? undefined : this.shadow(style.boxShadow, frame, alpha);
    const line = uniform ? borders.t : undefined;
    if (fill.type !== 'none' || line || shadow) {
      // CSS borders lie inside the box; office outlines straddle the edge.
      const inset = line ? line.width / 2 : 0;
      const box: Box = { ...frame.box, x: frame.box.x + inset, y: frame.box.y + inset, w: Math.max(0, frame.box.w - 2 * inset), h: Math.max(0, frame.box.h - 2 * inset) };
      const radiusValue = style.borderTopLeftRadius;
      const radius = cornerRadius(radiusValue, frame.w, frame.h) * frame.sx - inset;
      let geometry: Geometry = { preset: 'rect' };
      if (/%$/.test(radiusValue.trim()) && parseFloat(radiusValue) >= 50) geometry = { preset: 'ellipse' };
      else if (radius > 0.5) geometry = { preset: 'roundRect', radius };
      this.elements.push({ type: 'shape', name, box, geometry, fill, line, shadow });
    }
    if (!uniform) {
      if (sides.some(Boolean) && cornerRadius(style.borderTopLeftRadius, frame.w, frame.h) > 0.5) this.job.notes.add('borderSides', this.entry.number);
      const { w, h } = frame.box;
      const edges: [Line | undefined, Point, Point][] = [
        [borders.t, [0, (borders.t?.width ?? 0) / 2], [w, (borders.t?.width ?? 0) / 2]],
        [borders.r, [w - (borders.r?.width ?? 0) / 2, 0], [w - (borders.r?.width ?? 0) / 2, h]],
        [borders.b, [w, h - (borders.b?.width ?? 0) / 2], [0, h - (borders.b?.width ?? 0) / 2]],
        [borders.l, [(borders.l?.width ?? 0) / 2, h], [(borders.l?.width ?? 0) / 2, 0]],
      ];
      for (const [edge, a, b] of edges) {
        if (!edge) continue;
        this.elements.push({ type: 'shape', name: `${name} border`, box: frame.box, geometry: { path: [a, b], closed: false }, fill: { type: 'none' }, line: edge });
      }
    }
  }

  /** The first outer `box-shadow` of an element as an office shadow. */
  private shadow(value: string | undefined, frame: Frame, alpha: number): Shadow | undefined {
    const css = parseBoxShadow(value);
    const own = css ? officeShadow(css, { w: frame.w, h: frame.h }) : null;
    return css && own ? { ...own, color: withOpacity(css.color, alpha) } : undefined;
  }

  /** Notes what an element's own painting loses as an office shape: inner, layered or growing shadows, double borders, blend modes, filters. */
  private noteEffects(style: CSSStyleDeclaration, shadow: boolean): void {
    const n = this.entry.number;
    if (shadow && style.boxShadow && style.boxShadow !== 'none') {
      const layers = splitTop(style.boxShadow);
      if (layers.some((layer) => /\binset\b/.test(layer))) this.job.notes.add('shadowInset', n);
      if (layers.filter((layer) => !/\binset\b/.test(layer)).length > 1) this.job.notes.add('shadowLayers', n);
      if ((parseBoxShadow(style.boxShadow)?.spread ?? 0) > 0) this.job.notes.add('shadowSpread', n);
    }
    if ([style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle].includes('double')) this.job.notes.add('borderDouble', n);
    if (style.mixBlendMode && style.mixBlendMode !== 'normal') this.job.notes.add('blend', n);
    if (style.filter && style.filter !== 'none' && !/^drop-shadow\(/.test(style.filter.trim())) this.job.notes.add('filter', n);
  }

  /** The color text is drawn in (gradient-clipped text takes its first stop). */
  private textColor(el: Element, alpha: number): CssColor | undefined {
    const style = this.style(el);
    let color = resolveColor(style.getPropertyValue('-webkit-text-fill-color') || style.color);
    if (color && color.alpha === 0) {
      for (let at: Element | null = el; at && at !== this.root; at = at.parentElement) {
        const own = this.style(at);
        if (own.backgroundClip === 'text' || own.getPropertyValue('-webkit-background-clip') === 'text') {
          color = parseLinearGradient(own.backgroundImage)?.stops[0]?.color ?? resolveColor(style.color);
          this.job.notes.add('textGradient', this.entry.number);
          break;
        }
      }
    }
    return color ? withOpacity(color, alpha) : undefined;
  }

  /** The runs of one paragraph element. */
  private runs(block: Element, alpha: number): TextRun[] {
    const runs: TextRun[] = [];
    const visit = (parent: Node): void => {
      for (const child of Array.from(parent.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.nodeValue ?? '';
          const el = child.parentElement;
          if (!text || !el) continue;
          const style = this.style(el);
          let underline = false;
          for (let at: Element | null = el; at && at !== block.parentElement; at = at.parentElement) {
            if (this.style(at).textDecorationLine.includes('underline')) {
              underline = true;
              break;
            }
          }
          const link = el.closest('a');
          const href = link && block.contains(link) ? link.getAttribute('href') ?? undefined : undefined;
          const spacing = style.letterSpacing === 'normal' ? 0 : px(style.letterSpacing);
          runs.push({
            text,
            size: px(style.fontSize, 32),
            font: pptxFont(style.fontFamily, this.fonts),
            bold: (parseInt(style.fontWeight, 10) || 400) >= 600 || undefined,
            italic: style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique') || undefined,
            underline: underline || undefined,
            color: this.textColor(el, alpha),
            href: href && /^(https?:|mailto:)/i.test(href) ? href : undefined,
            spacing: spacing || undefined,
            caps: style.textTransform === 'uppercase' || undefined,
          });
        } else if (child instanceof HTMLBRElement) {
          runs.push({ text: '', size: px(this.style(child.parentElement ?? block).fontSize, 32), lineBreak: true });
        } else if (child instanceof Element) {
          if (this.style(child).display === 'none') continue;
          // A nested list is its own paragraphs (listParagraphs), not part of its item's line.
          if (child instanceof HTMLUListElement || child instanceof HTMLOListElement) continue;
          visit(child);
        }
      }
    };
    visit(block);
    return collapseRuns(runs, /^pre|break-spaces/.test(this.style(block).whiteSpace));
  }

  /** One paragraph from a block (or list item). */
  private paragraph(el: HTMLElement, alpha: number, extra: Partial<Paragraph> = {}): Paragraph {
    const style = this.style(el);
    const lineHeight = style.lineHeight === 'normal' ? undefined : px(style.lineHeight) || undefined;
    return {
      runs: this.runs(el, alpha),
      align: alignOf(style.textAlign),
      lineHeight,
      spaceBefore: px(style.marginTop) || undefined,
      spaceAfter: px(style.marginBottom) || undefined,
      endSize: px(style.fontSize, 32),
      endFont: pptxFont(style.fontFamily, this.fonts),
      ...extra,
    };
  }

  /**
   * The paragraphs of a list, one per item (bullets hang in the list's left
   * padding); a nested list's items follow their parent item, one level in.
   * `ownMargins` adds the list's own margins around them, for a list among
   * other blocks.
   */
  private listParagraphs(list: HTMLElement, alpha: number, level = 0, outer = 0, ownMargins = true): { paragraphs: Paragraph[]; elements: HTMLElement[] } {
    const style = this.style(list);
    const bullet = this.listMarker(list, style);
    const items = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
    const padding = px(style.paddingLeft);
    const marginLeft = outer + padding || undefined;
    const paragraphs: Paragraph[] = [];
    const elements: HTMLElement[] = [];
    // An item's margins sit around all it holds, nested lists included; touching margins collapse to the larger one.
    const widen = (p: Paragraph | undefined, side: 'spaceBefore' | 'spaceAfter', margin: number): void => {
      if (p && margin > (p[side] ?? 0)) p[side] = margin;
    };
    items.forEach((item) => {
      const nested = Array.from(item.children).filter((c): c is HTMLElement => c instanceof HTMLUListElement || c instanceof HTMLOListElement);
      const own = this.runs(item, alpha).some((run) => run.text.trim() || run.lineBreak);
      const first = paragraphs.length;
      if (own || nested.length === 0) {
        const p = this.paragraph(item, alpha, { bullet: this.style(item).listStyleType === 'none' ? undefined : bullet, marginLeft, spaceBefore: undefined, spaceAfter: undefined, ...(level ? { hanging: padding, level } : {}) });
        if (p.bullet) {
          const color = resolveColor(getComputedStyle(item, '::marker').color);
          const text = p.runs.find((run) => run.text.trim())?.color;
          if (color && (!text || color.hex !== text.hex || color.alpha !== text.alpha)) p.bullet = { ...p.bullet, color: withOpacity(color, alpha) };
        }
        paragraphs.push(p);
        elements.push(item);
      }
      for (const sub of nested) {
        const inner = this.listParagraphs(sub, alpha, level + 1, marginLeft ?? 0);
        paragraphs.push(...inner.paragraphs);
        elements.push(...inner.elements);
      }
      const itemStyle = this.style(item);
      widen(paragraphs[first], 'spaceBefore', px(itemStyle.marginTop));
      widen(paragraphs[paragraphs.length - 1], 'spaceAfter', px(itemStyle.marginBottom));
    });
    if (level === 0) {
      // The list itself is a flex item, so its own margins stay apart from its items'.
      collapseGaps(paragraphs);
      const head = paragraphs[0];
      const tail = paragraphs[paragraphs.length - 1];
      if (head && ownMargins) head.spaceBefore = (head.spaceBefore ?? 0) + px(style.marginTop) || undefined;
      if (tail && ownMargins) tail.spaceAfter = (tail.spaceAfter ?? 0) + px(style.marginBottom) || undefined;
    } else {
      widen(paragraphs[0], 'spaceBefore', px(style.marginTop));
      widen(paragraphs[paragraphs.length - 1], 'spaceAfter', px(style.marginBottom));
    }
    return { paragraphs, elements };
  }

  /** The marker a list draws, with notes for what PowerPoint numbering cannot follow. */
  private listMarker(list: HTMLElement, style: CSSStyleDeclaration): Paragraph['bullet'] {
    const type = style.listStyleType;
    if (type === 'none') return undefined;
    if (style.listStylePosition === 'inside') this.job.notes.add('listInside', this.entry.number);
    const chars: Record<string, string> = { disc: '•', circle: '◦', square: '▪' };
    if (chars[type]) return { type: 'char', char: chars[type]! };
    const text = /^"(.*)"$/s.exec(type);
    if (text) return text[1] ? { type: 'char', char: text[1], ownFont: true } : undefined;
    const ordered = list instanceof HTMLOListElement ? list : undefined;
    if (ordered?.reversed) this.job.notes.add('listReversed', this.entry.number);
    const start = ordered?.hasAttribute('start') ? ordered.start : 1;
    if (start < 1) this.job.notes.add('listStart', this.entry.number);
    return { type: 'number', start, scheme: NUMBER_SCHEMES[type] };
  }

  /** Text, lists and text boxes as a text box over their panel. */
  private text(el: HTMLElement, kind: 'text' | 'list' | 'textbox', frame: Frame, alpha: number): void {
    const style = this.style(el);
    const paragraphs: Paragraph[] = [];
    const elements: HTMLElement[] = [];
    let listPadding = 0;
    if (kind === 'text') {
      paragraphs.push({ ...this.paragraph(el, alpha), spaceBefore: undefined, spaceAfter: undefined });
      elements.push(el);
    } else if (kind === 'list') {
      const list = this.listParagraphs(el, alpha, 0, 0, false);
      paragraphs.push(...list.paragraphs);
      elements.push(...list.elements);
      listPadding = px(style.paddingLeft);
    } else {
      const gap = px(style.rowGap);
      const blocks = Array.from(el.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-open-artifact-block'));
      blocks.forEach((block, i) => {
        const added = block instanceof HTMLUListElement || block instanceof HTMLOListElement ? this.listParagraphs(block, alpha) : { paragraphs: [this.paragraph(block, alpha)], elements: [block] };
        const last = added.paragraphs[added.paragraphs.length - 1];
        if (last && gap && i < blocks.length - 1) last.spaceAfter = (last.spaceAfter ?? 0) + gap;
        paragraphs.push(...added.paragraphs);
        elements.push(...added.elements);
      });
    }
    if (!paragraphs.some((p) => p.runs.some((run) => run.text.trim()))) return;
    const inset = {
      l: px(style.paddingLeft) - listPadding + px(style.borderLeftWidth),
      t: px(style.paddingTop) + px(style.borderTopWidth),
      r: px(style.paddingRight) + px(style.borderRightWidth),
      b: px(style.paddingBottom) + px(style.borderBottomWidth),
    };
    const single = elements.every((block) => lineCount(block) <= 1);
    const box: Box = { ...frame.box };
    const extra = Math.max(4, box.w * TEXT_SLACK);
    const align = paragraphs[0]?.align ?? 'l';
    if (align === 'ctr') box.x -= extra / 2;
    else if (align === 'r') box.x -= extra;
    box.w += extra;
    let body: TextBody = { paragraphs, inset, anchor: anchorOf(style), wrap: !single };
    if (kind === 'list') body = edgeSpaceAsInset(body);
    if (single) body = centerSingleLine(body, frame.h);
    this.elements.push({ type: 'shape', name: this.name('Text'), box, geometry: { preset: 'rect' }, fill: { type: 'none' }, text: body, textBox: true });
  }

  /** A table: its wrapper's panel, then the table as a native table. */
  private async table(wrapper: HTMLElement, frame: Frame, alpha: number): Promise<void> {
    await this.panel(wrapper, frame, alpha, this.name('Shape'));
    const table = wrapper.querySelector('table');
    if (!table || table.rows.length === 0) return;
    const own = this.frame(table);
    if (own.box.rot) this.job.notes.add('rotatedTable', this.entry.number);
    const rows = Array.from(table.rows);
    const columns = Array.from(rows[0]!.cells).map((cell) => cell.offsetWidth * own.sx);
    const out = rows.map((row) => {
      const rowStyle = this.style(row);
      const cells: TableCell[] = Array.from(row.cells).map((cell) => {
        const style = this.style(cell);
        const color = resolveColor(style.backgroundColor);
        const rowColor = resolveColor(rowStyle.backgroundColor);
        const background = color && color.alpha > 0 ? color : rowColor && rowColor.alpha > 0 ? rowColor : null;
        const vertical = style.verticalAlign;
        return {
          text: {
            paragraphs: [{ ...this.paragraph(cell, alpha), spaceBefore: undefined, spaceAfter: undefined }],
            inset: { l: px(style.paddingLeft), t: px(style.paddingTop), r: px(style.paddingRight), b: px(style.paddingBottom) },
            anchor: vertical === 'middle' ? 'ctr' : vertical === 'bottom' ? 'b' : 't',
          },
          fill: background ? { type: 'solid', color: withOpacity(background, alpha) } : { type: 'none' },
          borders: this.borders(style, alpha),
        };
      });
      return { height: row.offsetHeight * own.sy, cells };
    });
    const width = columns.reduce((sum, w) => sum + w, 0);
    const height = out.reduce((sum, row) => sum + row.height, 0);
    const [cx, cy] = own.toSlide(own.w / 2, own.h / 2);
    this.elements.push({ type: 'table', name: this.name('Table'), box: { x: cx - width / 2, y: cy - height / 2, w: width, h: height }, columns, rows: out });
  }

  /** A picture frame: its panel, then the picture, cropped to what shows. */
  private async image(el: HTMLElement, frame: Frame, alpha: number, node: ImageNode | undefined): Promise<void> {
    const style = this.style(el);
    const img = Array.from(el.children).find((child): child is HTMLImageElement => child instanceof HTMLImageElement) ?? null;
    const src = img ? img.currentSrc || img.getAttribute('src') || '' : '';
    const known = src ? this.media.known(this.job.capture.assets.url(src)) : undefined;
    const picture = src && !known ? await this.job.capture.assets.picture(src) : null;
    const clip: Rect = { x: el.clientLeft, y: el.clientTop, w: el.clientWidth, h: el.clientHeight };
    const borders = this.borders(style, alpha);
    const plain = !borders.t && !borders.r && !borders.b && !borders.l;
    let placed = false;
    if (img && (picture || known)) {
      const imgBox: Rect = { x: el.clientLeft + img.offsetLeft, y: el.clientTop + img.offsetTop, w: img.offsetWidth, h: img.offsetHeight };
      const own = this.style(img);
      const natural = { w: img.naturalWidth || picture?.width || imgBox.w, h: img.naturalHeight || picture?.height || imgBox.h };
      const content = objectContentRect(own.objectFit, own.objectPosition, imgBox, natural);
      const visible = intersect(content, intersect(imgBox, clip));
      const whole = Math.abs(visible.x - clip.x) < 1 && Math.abs(visible.y - clip.y) < 1 && Math.abs(visible.w - clip.w) < 1 && Math.abs(visible.h - clip.h) < 1;
      // The frame's shadow goes on the picture when the picture fills it.
      await this.panel(el, frame, alpha, this.name('Shape'), { shadow: !(whole && plain) });
      if (visible.w >= 0.5 && visible.h >= 0.5 && content.w > 0 && content.h > 0) {
        const key = known ?? this.media.add(picture!.data, picture!.type, this.job.capture.assets.url(src));
        const crop = {
          l: (visible.x - content.x) / content.w,
          t: (visible.y - content.y) / content.h,
          r: (content.x + content.w - visible.x - visible.w) / content.w,
          b: (content.y + content.h - visible.y - visible.h) / content.h,
        };
        const cropped = crop.l > 0.0005 || crop.t > 0.0005 || crop.r > 0.0005 || crop.b > 0.0005;
        const [cx, cy] = frame.toSlide(visible.x + visible.w / 2, visible.y + visible.h / 2);
        const w = visible.w * frame.sx;
        const h = visible.h * frame.sy;
        const radiusValue = style.borderTopLeftRadius;
        const radius = whole ? cornerRadius(radiusValue, frame.w, frame.h) * frame.sx : 0;
        const oval = whole && /%$/.test(radiusValue.trim()) && parseFloat(radiusValue) >= 50;
        const outline = whole ? undefined : this.roundedCut(el, style, visible, clip);
        this.elements.push({
          type: 'picture',
          name: this.name(node?.video ? 'Video' : 'Picture'),
          box: { x: cx - w / 2, y: cy - h / 2, w, h, rot: frame.box.rot },
          media: key,
          crop: cropped ? crop : undefined,
          radius: !oval && radius > 0.5 ? radius : undefined,
          oval: oval || undefined,
          outline: outline?.map(([x, y]) => [x * frame.sx, y * frame.sy] as const),
          shadow: whole && plain ? this.shadow(style.boxShadow, frame, alpha) : undefined,
          alpha: alpha < 1 ? alpha : undefined,
          description: node?.alt || undefined,
        });
      }
      placed = true;
      if (node?.video) this.job.notes.add('video', this.entry.number);
    } else {
      await this.panel(el, frame, alpha, this.name('Shape'));
    }
    if (placed) return;
    if (node?.video) {
      this.job.notes.add('videoMissing', this.entry.number);
      this.videoPlaceholder(frame, alpha);
    } else if (src) {
      this.job.notes.add('picture', this.entry.number);
    }
  }

  /**
   * The outline of a picture that leaves a gap inside its rounded frame, cut
   * where it reaches into the frame's curves (inside the borders).
   */
  private roundedCut(el: HTMLElement, style: CSSStyleDeclaration, picture: Rect, clip: Rect): Array<[number, number]> | undefined {
    const values = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius] as const;
    const outer = cornerRadii(values, el.offsetWidth, el.offsetHeight);
    if (!outer.some((r) => r.x > 0.5 && r.y > 0.5)) return undefined;
    const [l, t, r, b] = [style.borderLeftWidth, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth].map(px) as [number, number, number, number];
    const sides: Array<[number, number]> = [[l, t], [r, t], [r, b], [l, b]];
    const inner = outer.map((radius, i) => ({ x: Math.max(0, radius.x - sides[i]![0]), y: Math.max(0, radius.y - sides[i]![1]) }));
    return pictureOutline(picture, clip, inner);
  }

  /** A dark frame with a play mark, for a video without a poster picture. */
  private videoPlaceholder(frame: Frame, alpha: number): void {
    this.elements.push({ type: 'shape', name: this.name('Video'), box: frame.box, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: '111111', alpha: 0.9 * alpha } } });
    const size = Math.min(frame.box.w, frame.box.h) * 0.25;
    if (size < 4) return;
    const [cx, cy] = frame.toSlide(frame.w / 2, frame.h / 2);
    this.elements.push({
      type: 'shape',
      name: this.name('Play'),
      box: { x: cx - size / 2, y: cy - size / 2, w: size, h: size, rot: frame.box.rot },
      geometry: { path: [[size * 0.15, 0], [size, size / 2], [size * 0.15, size]], closed: true },
      fill: { type: 'solid', color: withOpacity(WHITE, 0.9 * alpha) },
    });
  }

  /** Polygon and line shapes as custom shapes. */
  private async shape(svg: SVGSVGElement, frame: Frame, alpha: number, node: ShapeNode): Promise<void> {
    if (node.style.filter) {
      // Filters other than shadows have no office equivalent.
      await this.raster(svg, this.name('Shape'), { fonts: false });
      return;
    }
    const { w, h } = frame.box;
    const stroke = parseStroke(node.style.border);
    if (node.shape === 'line') {
      const line = svg.querySelector('line');
      const style = line ? this.style(line) : null;
      const color = resolveColor(style?.stroke) ?? BLACK;
      this.elements.push({
        type: 'shape',
        name: this.name('Line'),
        box: frame.box,
        geometry: { path: [[0, h / 2], [w, h / 2]], closed: false },
        fill: { type: 'none' },
        line: { width: stroke?.width ?? 2, color: withOpacity(color, alpha), dash: dashOf(stroke?.line), round: true },
      });
      return;
    }
    const polygon = svg.querySelector('polygon');
    const style = polygon ? this.style(polygon) : null;
    const fillColor = resolveColor(style?.fill);
    const strokeColor = resolveColor(style?.stroke);
    const points = (SHAPE_POLYGONS[node.shape] ?? '')
      .split(' ')
      .filter(Boolean)
      .map((pair): Point => {
        const [x = 0, y = 0] = pair.split(',').map(Number);
        return [(x / 100) * w, (y / 100) * h];
      });
    this.elements.push({
      type: 'shape',
      name: this.name('Shape'),
      box: frame.box,
      geometry: { path: points, closed: true },
      fill: fillColor && fillColor.alpha > 0 ? { type: 'solid', color: withOpacity(fillColor, alpha) } : { type: 'none' },
      line: stroke && strokeColor ? { width: stroke.width, color: withOpacity(strokeColor, alpha), dash: dashOf(stroke.line) } : undefined,
      shadow: this.shadow(node.style['box-shadow'], frame, alpha),
    });
  }

  /** A connector as an open path with arrowheads. */
  private connector(svg: SVGSVGElement, frame: Frame, alpha: number, node: ConnectorNode): void {
    const geometry = connectorGeometry(node, frame.w, frame.h);
    const points = geometry.points.map(([x, y]) => frame.toSlide(x, y));
    if (points.length < 2) return;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const paths = svg.querySelectorAll('path');
    const shaft = paths[1] ?? paths[0];
    const color = resolveColor(shaft ? this.style(shaft).stroke : null) ?? resolveColor(this.style(svg).color) ?? BLACK;
    this.elements.push({
      type: 'shape',
      name: this.name('Connector'),
      box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
      geometry: { path: points.map(([px, py]): Point => [px - x, py - y]), closed: false },
      fill: { type: 'none' },
      line: {
        width: connectorStroke(node) * frame.sx,
        color: withOpacity(color, alpha),
        dash: dashOf(node.style['border-style']),
        head: headOf(node.headStart),
        tail: headOf(node.headEnd),
        round: true,
      },
    });
  }

  /** A rule as a line along its top border. */
  private rule(el: HTMLElement, frame: Frame, alpha: number): void {
    const style = this.style(el);
    const width = px(style.borderTopWidth);
    const color = resolveColor(style.borderTopColor);
    if (width <= 0 || !color || style.borderTopStyle === 'none') return;
    const { w } = frame.box;
    const box: Box = { ...frame.box, h: Math.max(frame.box.h, width) };
    this.elements.push({
      type: 'shape',
      name: this.name('Line'),
      box,
      geometry: { path: [[0, width / 2], [w, width / 2]], closed: false },
      fill: { type: 'none' },
      line: { width, color: withOpacity(color, alpha), dash: dashOf(style.borderTopStyle) },
    });
  }

  /** The slide's background: a color, a linear gradient, or a picture of it. */
  async background(): Promise<PptxSlide['background']> {
    const style = this.style(this.root);
    const image = style.backgroundImage;
    if (image && image !== 'none') {
      const gradient = image.includes('url(') ? null : parseLinearGradient(image);
      if (gradient && gradient.stops.every((stop) => stop.color.alpha >= 1)) {
        return { type: 'fill', fill: { type: 'gradient', angle: gradient.angle, stops: gradient.stops } };
      }
      this.job.notes.add('backgroundPicture', this.entry.number);
      const picture = await slidePicture(this.mounted, this.job.capture, {
        scale: 1,
        type: 'image/jpeg',
        quality: 0.92,
        background: '#ffffff',
        only: this.root,
        bare: true,
        fonts: false,
      });
      return { type: 'picture', media: this.media.add(new Uint8Array(await picture.blob.arrayBuffer()), 'jpeg') };
    }
    const color = resolveColor(style.backgroundColor);
    return { type: 'fill', fill: { type: 'solid', color: overWhite(color ?? WHITE) } };
  }
}

/** Vertical placement of text from the element's flex alignment. */
function anchorOf(style: CSSStyleDeclaration): TextBody['anchor'] {
  if (!style.display.includes('flex')) return 't';
  const value = style.flexDirection.startsWith('row') ? style.alignItems : style.justifyContent;
  if (value === 'center') return 'ctr';
  if (/end$/.test(value)) return 'b';
  return 't';
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

/** Writes the deck as a PowerPoint file. */
export async function exportPptx(job: ExportJob, options: PptxOptions): Promise<Blob> {
  const media = new MediaStore();
  const slides: PptxSlide[] = [];
  let transition: PptxSlide['transition'];
  const choice: FontChoice = options.fonts === 'basic' ? 'basic' : 'current';
  for (const [index, entry] of job.slides.entries()) {
    job.begin(entry.number);
    if (hasBuilds(entry.slide)) job.notes.add('builds', entry.number);
    const mounted = await mountSlide(entry.slide, job.capture);
    try {
      const reader = new SlideReader(mounted, job, entry, media, choice);
      const background = await reader.background();
      await reader.read();
      slides.push({ background, elements: reader.elements, notes: entry.slide.notes.trim() || undefined, transition });
    } finally {
      mounted.dispose();
    }
    // A slide's transition plays as it is left: in PowerPoint, on the next slide.
    const own = entry.slide.transition;
    if (own === 'magic') job.notes.add('magic', entry.number);
    transition = own === 'magic' ? 'fade' : own;
    job.progress(index + 1);
    await breathe();
  }
  if (slides.length === 0) throw new Error('There are no slides to export.');
  let fonts: EmbeddedFont[] | undefined;
  let description: string | undefined;
  if (options.fonts !== 'basic') {
    const embedding = await embedDeckFonts(collectFontUses(slides), Object.values(job.capture.faces), {
      ...networkFetchers,
      readFile: async (src) => {
        const blob = await job.capture.assets.blob(src);
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      },
    });
    noteFontEmbedding(job.notes, embedding);
    fonts = embedding.fonts;
    description = fontNoticeText(embedding);
  }
  setEastAsianFonts(slides, fonts ?? []);
  const bytes = await writePptx({ title: job.title, slides, media: media.items, created: new Date(), width: SLIDE_WIDTH, height: SLIDE_HEIGHT, fonts, description });
  return new Blob([bytes as BlobPart], { type: PPTX_TYPE });
}
