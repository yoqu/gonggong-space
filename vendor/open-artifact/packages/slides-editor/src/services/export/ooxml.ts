/**
 * A hand-written PowerPoint (PresentationML) writer.
 *
 * Takes a description of each slide in canvas pixels (1920×1080) and writes
 * the package parts: one blank master and layout, a theme, the slides with
 * their pictures and links, speaker notes (with a notes master) and document
 * properties. Everything is drawn as positioned objects on blank slides:
 * text boxes with formatted runs, preset or custom shapes, connectors as
 * open paths with arrowheads, tables and cropped pictures.
 *
 * The parts are packed (deflated) into the `.pptx` zip by the export
 * Worker (`@open-artifact/wasm-export`).
 */

import { packZip } from '@open-artifact/wasm-export';
import type { CssColor } from './css.ts';
import type { EmbeddedFont } from './font-embedding.ts';

/** EMUs per canvas pixel: 1920 px span the 13.333 in (12,192,000 EMU) of a 16:9 slide. */
export const EMU_PER_PX = 6350;

/** Font size units (1/100 pt) per canvas pixel (1 px = 0.5 pt). */
const SZ_PER_PX = 50;

/* -------------------------------------------------------------------------- */
/* Model                                                                       */
/* -------------------------------------------------------------------------- */

/** A placed box in px; `rot` in degrees clockwise around its center. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
}

export type Fill =
  | { type: 'none' }
  | { type: 'solid'; color: CssColor }
  | { type: 'gradient'; /** CSS angle: 0deg points up, clockwise. */ angle: number; stops: { pos: number; color: CssColor }[] };

/** An arrowhead at one end of a line. */
export type Arrowhead = 'triangle' | 'arrow';

/** An outline or a line. */
export interface Line {
  /** Width in px. */
  width: number;
  color: CssColor;
  dash?: 'solid' | 'dash' | 'dot';
  /** Arrowhead at the path's start. */
  head?: Arrowhead;
  /** Arrowhead at the path's end. */
  tail?: Arrowhead;
  round?: boolean;
}

/** An outer shadow, px. */
export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: CssColor;
  /** Size of the shadow against the shape's, about its centre (1 = the same). */
  scale?: { x: number; y: number };
}

/** A run of text with one format, or a line break. */
export interface TextRun {
  text: string;
  /** Font size in px. */
  size: number;
  font?: string;
  eastAsianFont?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: CssColor;
  href?: string;
  /** Letter spacing in px. */
  spacing?: number;
  /** All capitals. */
  caps?: boolean;
  /** A line break inside the paragraph (text ignored). */
  lineBreak?: boolean;
}

/** One paragraph. */
export interface Paragraph {
  runs: TextRun[];
  align?: 'l' | 'ctr' | 'r' | 'just';
  /** Exact line height in px. */
  lineHeight?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /**
   * The item's marker. A number's scheme is `arabicPeriod` unless set (`alphaLcPeriod`, `romanLcPeriod`…);
   * `ownFont` draws a character in the text's font; `color` paints the marker apart from the text.
   */
  bullet?: ({ type: 'char'; char: string; ownFont?: boolean } | { type: 'number'; start: number; scheme?: string }) & { color?: CssColor };
  /** Left margin of the text in px (bullets hang into it). */
  marginLeft?: number;
  /** How far the bullet hangs left of the text, px (default: all of `marginLeft`; nested items hang one level's padding). */
  hanging?: number;
  /** Nesting level of a list item (0–8). */
  level?: number;
  /** Size of an empty paragraph's line, px. */
  endSize: number;
  endFont?: string;
}

/**
 * Paragraph spacing for paragraphs in one block flow (a list and its nested
 * lists): CSS collapses the margin under one paragraph with the margin over
 * the next, PowerPoint adds them, so the second keeps only what is beyond the
 * first. Changes the paragraphs in place and returns them.
 */
export function collapseGaps<P extends Pick<Paragraph, 'spaceBefore' | 'spaceAfter'>>(paragraphs: P[]): P[] {
  for (let i = 1; i < paragraphs.length; i++) {
    const after = paragraphs[i - 1]!.spaceAfter ?? 0;
    const p = paragraphs[i]!;
    if (after > 0 && p.spaceBefore !== undefined) p.spaceBefore = Math.max(0, p.spaceBefore - after) || undefined;
  }
  return paragraphs;
}

/** The text of a shape or table cell. */
export interface TextBody {
  paragraphs: Paragraph[];
  /** Insets in px. */
  inset: { l: number; t: number; r: number; b: number };
  anchor?: 't' | 'ctr' | 'b';
  /** Wrap within the box (default true). */
  wrap?: boolean;
}

/**
 * The body with the space above its first paragraph and below its last moved
 * into the insets: space that sits inside the box, which PowerPoint would not
 * keep at the edges of a text box.
 */
export function edgeSpaceAsInset(body: TextBody): TextBody {
  const paragraphs = body.paragraphs.map((p) => ({ ...p }));
  const first = paragraphs[0];
  const last = paragraphs[paragraphs.length - 1];
  const t = first?.spaceBefore ?? 0;
  const b = last?.spaceAfter ?? 0;
  if (first) first.spaceBefore = undefined;
  if (last) last.spaceAfter = undefined;
  return { ...body, paragraphs, inset: { ...body.inset, t: body.inset.t + t, b: body.inset.b + b } };
}

/** PowerPoint's single line spacing, as a multiple of the font size. */
export const SINGLE_SPACING = 1.15;

/**
 * A text box of one line taller than single spacing, with that line set at
 * single spacing and the rest of its height split evenly above and below.
 * PowerPoint puts a tall line's extra height above the text where CSS splits
 * it around it; the box must have room for the line and its insets.
 */
export function centerSingleLine(body: TextBody, height: number): TextBody {
  const [only] = body.paragraphs;
  if (!only || body.paragraphs.length !== 1 || !only.lineHeight || only.runs.some((run) => run.lineBreak)) return body;
  const size = Math.max(only.endSize, ...only.runs.map((run) => run.size));
  const single = Math.round(size * SINGLE_SPACING * 100) / 100;
  const extra = only.lineHeight - single;
  if (extra <= 0.5 || body.inset.t + body.inset.b + only.lineHeight > height + 1) return body;
  return {
    ...body,
    paragraphs: [{ ...only, lineHeight: single }],
    inset: { ...body.inset, t: body.inset.t + extra / 2, b: body.inset.b + extra / 2 },
  };
}

export type Geometry =
  | { preset: 'rect' | 'ellipse' }
  | { preset: 'roundRect'; /** Corner radius in px. */ radius: number }
  /** A path through points in px relative to the box. */
  | { path: readonly (readonly [number, number])[]; closed: boolean };

export interface ShapeElement {
  type: 'shape';
  name: string;
  box: Box;
  geometry: Geometry;
  fill: Fill;
  line?: Line;
  shadow?: Shadow;
  text?: TextBody;
  /** Marks a plain text box. */
  textBox?: boolean;
  /** Alternative text. */
  description?: string;
}

export interface PictureElement {
  type: 'picture';
  name: string;
  box: Box;
  /** Key of an entry in {@link PptxDeck.media}. */
  media: string;
  /** Fractions of the picture cut from each side. */
  crop?: { l: number; t: number; r: number; b: number };
  /** Rounded corners, px. */
  radius?: number;
  /** Cut to an ellipse (a 50% corner radius). */
  oval?: boolean;
  /** Cut to this closed outline instead, points in px relative to the box. */
  outline?: readonly (readonly [number, number])[];
  line?: Line;
  shadow?: Shadow;
  /** Opacity 0–1. */
  alpha?: number;
  description?: string;
}

export interface TableCell {
  text: TextBody;
  fill: Fill;
  borders: { l?: Line; r?: Line; t?: Line; b?: Line };
}

export interface TableElement {
  type: 'table';
  name: string;
  box: Box;
  /** Column widths, px. */
  columns: number[];
  rows: { height: number; cells: TableCell[] }[];
}

export type SlideElement = ShapeElement | PictureElement | TableElement;

/** One slide. */
export interface PptxSlide {
  background?: { type: 'fill'; fill: Fill } | { type: 'picture'; media: string };
  elements: SlideElement[];
  /** Speaker notes, plain text. */
  notes?: string;
  /** The transition into this slide. */
  transition?: 'fade' | 'push';
}

/** A picture file. */
export interface PptxMedia {
  key: string;
  data: Uint8Array;
  type: 'png' | 'jpeg' | 'gif';
}

/** The whole presentation. */
export interface PptxDeck {
  title: string;
  slides: PptxSlide[];
  media: PptxMedia[];
  /** Slide size in px (default 1920×1080). */
  width?: number;
  height?: number;
  created?: Date;
  /** Fonts to embed (EOT-wrapped TrueType faces). */
  fonts?: readonly EmbeddedFont[];
  /** The file's description (the embedded fonts' license notices). */
  description?: string;
}

/** The order of faces in `p:embeddedFont` (the schema's). */
const FACE_ORDER = ['regular', 'bold', 'italic', 'boldItalic'];

/** `<p:embeddedFontLst>` for the embedded faces; `relId` gives each face's relationship id. */
export function embeddedFontListXml(fonts: readonly EmbeddedFont[], relId: (font: EmbeddedFont) => string): string {
  if (fonts.length === 0) return '';
  const families: { typeface: string; first: EmbeddedFont; faces: EmbeddedFont[] }[] = [];
  for (const font of fonts) {
    let family = families.find((f) => f.typeface === font.typeface);
    if (!family) {
      family = { typeface: font.typeface, first: font, faces: [] };
      families.push(family);
    }
    if (!family.faces.some((face) => face.style === font.style)) family.faces.push(font);
  }
  let out = '<p:embeddedFontLst>';
  for (const family of families) {
    const { first } = family;
    out += `<p:embeddedFont><p:font typeface="${xml(family.typeface)}"${first.panose ? ` panose="${first.panose}"` : ''}${first.pitchFamily !== undefined ? ` pitchFamily="${first.pitchFamily}"` : ''} charset="${first.charset ?? 0}"/>`;
    for (const face of [...family.faces].sort((a, b) => FACE_ORDER.indexOf(a.style) - FACE_ORDER.indexOf(b.style))) {
      out += `<p:${face.style} r:id="${relId(face)}"/>`;
    }
    out += '</p:embeddedFont>';
  }
  return `${out}</p:embeddedFontLst>`;
}

/* -------------------------------------------------------------------------- */
/* XML helpers                                                                 */
/* -------------------------------------------------------------------------- */

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PML_NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

/** Escapes text for XML, dropping characters XML 1.0 cannot hold. */
export function xml(text: string): string {
  return text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** px → EMU, rounded. */
export const emu = (value: number): number => Math.round(value * EMU_PER_PX);

/** An `a:srgbClr` (with alpha below 1). */
function srgb(color: CssColor): string {
  const alpha = Math.round(Math.min(1, Math.max(0, color.alpha)) * 100000);
  return alpha >= 100000 ? `<a:srgbClr val="${color.hex}"/>` : `<a:srgbClr val="${color.hex}"><a:alpha val="${alpha}"/></a:srgbClr>`;
}

/** The fill element of a fill. */
export function fillXml(fill: Fill): string {
  switch (fill.type) {
    case 'none':
      return '<a:noFill/>';
    case 'solid':
      return `<a:solidFill>${srgb(fill.color)}</a:solidFill>`;
    case 'gradient': {
      const stops = fill.stops.map((stop) => `<a:gs pos="${Math.round(stop.pos * 100000)}">${srgb(stop.color)}</a:gs>`).join('');
      // CSS 0deg points up; DrawingML 0 runs left to right, clockwise.
      const angle = (((fill.angle - 90) % 360) + 360) % 360;
      return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(angle * 60000)}" scaled="0"/></a:gradFill>`;
    }
  }
}

/** An `a:ln` (or a hidden outline). */
export function lineXml(line: Line | undefined, tag = 'a:ln'): string {
  if (!line || line.width <= 0 || line.color.alpha <= 0) return `<${tag}><a:noFill/></${tag}>`;
  const dash = line.dash && line.dash !== 'solid' ? `<a:prstDash val="${line.dash === 'dot' ? 'sysDot' : 'dash'}"/>` : '';
  const join = line.round ? '<a:round/>' : '';
  const end = (name: string, kind: Arrowhead | undefined): string => (kind ? `<a:${name} type="${kind}" w="med" len="med"/>` : '');
  return `<${tag} w="${emu(line.width)}"${line.round ? ' cap="rnd"' : ''}><a:solidFill>${srgb(line.color)}</a:solidFill>${dash}${join}${end('headEnd', line.head)}${end('tailEnd', line.tail)}</${tag}>`;
}

/** An `a:effectLst` with one outer shadow. */
export function shadowXml(shadow: Shadow | undefined): string {
  if (!shadow) return '';
  const distance = Math.hypot(shadow.x, shadow.y);
  const direction = ((((Math.atan2(shadow.y, shadow.x) * 180) / Math.PI) % 360) + 360) % 360;
  const scale = shadow.scale ? ` sx="${Math.round(shadow.scale.x * 100000)}" sy="${Math.round(shadow.scale.y * 100000)}"` : '';
  return `<a:effectLst><a:outerShdw blurRad="${emu(shadow.blur)}" dist="${emu(distance)}" dir="${Math.round(direction * 60000)}"${scale} algn="ctr" rotWithShape="0">${srgb(shadow.color)}</a:outerShdw></a:effectLst>`;
}

/** An `a:xfrm`. */
function xfrm(box: Box, tag = 'a:xfrm'): string {
  const rot = box.rot ? ((Math.round(box.rot * 60000) % 21600000) + 21600000) % 21600000 : 0;
  return `<${tag}${rot ? ` rot="${rot}"` : ''}><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${Math.max(0, emu(box.w))}" cy="${Math.max(0, emu(box.h))}"/></${tag}>`;
}

/** The geometry element of a shape. */
export function geometryXml(geometry: Geometry, box: Box): string {
  if ('path' in geometry) {
    const w = Math.max(1, emu(box.w));
    const h = Math.max(1, emu(box.h));
    const points = geometry.path.map(([x, y]) => `<a:pt x="${emu(x)}" y="${emu(y)}"/>`);
    if (points.length === 0) return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
    const segments = points.map((pt, i) => (i === 0 ? `<a:moveTo>${pt}</a:moveTo>` : `<a:lnTo>${pt}</a:lnTo>`)).join('');
    return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${w}" h="${h}"${geometry.closed ? '' : ' fill="none"'}>${segments}${geometry.closed ? '<a:close/>' : ''}</a:path></a:pathLst></a:custGeom>`;
  }
  if (geometry.preset === 'roundRect') {
    const short = Math.min(box.w, box.h);
    const adj = short > 0 ? Math.min(50000, Math.round((geometry.radius / short) * 100000)) : 0;
    return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
  }
  return `<a:prstGeom prst="${geometry.preset}"><a:avLst/></a:prstGeom>`;
}

/* -------------------------------------------------------------------------- */
/* Relationships of one part                                                   */
/* -------------------------------------------------------------------------- */

class Rels {
  private readonly items: string[] = [];
  private readonly links = new Map<string, string>();

  /** Adds a relationship and returns its id. */
  add(type: string, target: string, external = false): string {
    const id = `rId${this.items.length + 1}`;
    this.items.push(`<Relationship Id="${id}" Type="${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
    return id;
  }

  /** The id of an external hyperlink (one per address). */
  link(href: string): string {
    let id = this.links.get(href);
    if (!id) {
      id = this.add(`${REL}/hyperlink`, href, true);
      this.links.set(href, id);
    }
    return id;
  }

  toString(): string {
    return `${XML_HEAD}<Relationships xmlns="${NS_REL}">${this.items.join('')}</Relationships>`;
  }
}

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

function runPropsXml(run: TextRun, rels: Rels, tag: 'a:rPr' | 'a:endParaRPr' = 'a:rPr'): string {
  const attrs = [`lang="en-US"`, `sz="${Math.max(100, Math.min(400000, Math.round(run.size * SZ_PER_PX)))}"`];
  if (run.bold) attrs.push('b="1"');
  if (run.italic) attrs.push('i="1"');
  if (run.underline) attrs.push('u="sng"');
  if (run.caps) attrs.push('cap="all"');
  if (run.spacing) attrs.push(`spc="${Math.round(run.spacing * SZ_PER_PX)}"`);
  attrs.push('dirty="0"');
  const fill = run.color ? `<a:solidFill>${srgb(run.color)}</a:solidFill>` : '';
  const font = run.font ? `<a:latin typeface="${xml(run.font)}"/><a:ea typeface="${xml(run.eastAsianFont ?? run.font)}"/><a:cs typeface="${xml(run.font)}"/>` : '';
  const link = run.href && tag === 'a:rPr' ? `<a:hlinkClick r:id="${rels.link(run.href)}"/>` : '';
  const children = fill + font + link;
  return children ? `<${tag} ${attrs.join(' ')}>${children}</${tag}>` : `<${tag} ${attrs.join(' ')}/>`;
}

function paragraphXml(paragraph: Paragraph, rels: Rels): string {
  const attrs: string[] = [];
  if (paragraph.align && paragraph.align !== 'l') attrs.push(`algn="${paragraph.align}"`);
  if (paragraph.marginLeft) {
    attrs.push(`marL="${emu(paragraph.marginLeft)}"`);
    if (paragraph.bullet) attrs.push(`indent="${-emu(paragraph.hanging ?? paragraph.marginLeft)}"`);
  }
  if (paragraph.level) attrs.push(`lvl="${Math.min(8, paragraph.level)}"`);
  let props = '';
  if (paragraph.lineHeight) props += `<a:lnSpc><a:spcPts val="${Math.round(paragraph.lineHeight * SZ_PER_PX)}"/></a:lnSpc>`;
  if (paragraph.spaceBefore) props += `<a:spcBef><a:spcPts val="${Math.round(paragraph.spaceBefore * SZ_PER_PX)}"/></a:spcBef>`;
  if (paragraph.spaceAfter) props += `<a:spcAft><a:spcPts val="${Math.round(paragraph.spaceAfter * SZ_PER_PX)}"/></a:spcAft>`;
  const bullet = paragraph.bullet;
  if (bullet?.color) props += `<a:buClr>${srgb(bullet.color)}</a:buClr>`;
  if (bullet?.type === 'char') props += `${bullet.ownFont ? '<a:buFontTx/>' : '<a:buFont typeface="Arial"/>'}<a:buChar char="${xml(bullet.char)}"/>`;
  else if (bullet?.type === 'number') {
    const start = Math.min(32767, Math.max(1, Math.round(bullet.start)));
    props += `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${bullet.scheme ?? 'arabicPeriod'}"${start > 1 ? ` startAt="${start}"` : ''}/>`;
  } else props += '<a:buNone/>';
  const pPr = `<a:pPr${attrs.length ? ` ${attrs.join(' ')}` : ''}>${props}</a:pPr>`;
  const runs = paragraph.runs
    .map((run) => {
      if (run.lineBreak) return `<a:br>${runPropsXml(run, rels)}</a:br>`;
      if (!run.text) return '';
      return `<a:r>${runPropsXml(run, rels)}<a:t>${xml(run.text)}</a:t></a:r>`;
    })
    .join('');
  const end = runPropsXml({ text: '', size: paragraph.endSize, font: paragraph.endFont }, rels, 'a:endParaRPr');
  return `<a:p>${pPr}${runs}${end}</a:p>`;
}

/** A `txBody` (`p:txBody` for shapes, `a:txBody` for table cells). */
export function textBodyXml(body: TextBody, rels: Rels, tag: 'p:txBody' | 'a:txBody' = 'p:txBody'): string {
  const { l, t, r, b } = body.inset;
  const bodyPr = `<a:bodyPr wrap="${body.wrap === false ? 'none' : 'square'}" lIns="${emu(l)}" tIns="${emu(t)}" rIns="${emu(r)}" bIns="${emu(b)}" anchor="${body.anchor ?? 't'}" rtlCol="0"><a:noAutofit/></a:bodyPr>`;
  const paragraphs = body.paragraphs.length ? body.paragraphs : [{ runs: [], endSize: 32 }];
  return `<${tag}>${bodyPr}<a:lstStyle/>${paragraphs.map((p) => paragraphXml(p, rels)).join('')}</${tag}>`;
}

/* -------------------------------------------------------------------------- */
/* Elements                                                                    */
/* -------------------------------------------------------------------------- */

interface SlideWriter {
  rels: Rels;
  /** Media key → relationship id. */
  media(key: string): string;
  nextId(): number;
}

function nvProps(id: number, name: string, description?: string): string {
  return `<p:cNvPr id="${id}" name="${xml(name)}"${description ? ` descr="${xml(description)}"` : ''}/>`;
}

function shapeXml(shape: ShapeElement, writer: SlideWriter): string {
  const id = writer.nextId();
  const text = shape.text ? textBodyXml(shape.text, writer.rels) : '';
  return (
    `<p:sp><p:nvSpPr>${nvProps(id, shape.name, shape.description)}<p:cNvSpPr${shape.textBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(shape.box)}${geometryXml(shape.geometry, shape.box)}${fillXml(shape.fill)}${lineXml(shape.line)}${shadowXml(shape.shadow)}</p:spPr>` +
    `${text}</p:sp>`
  );
}

function pictureXml(picture: PictureElement, writer: SlideWriter): string {
  const id = writer.nextId();
  const rel = writer.media(picture.media);
  const alpha = picture.alpha !== undefined && picture.alpha < 1 ? `<a:alphaModFix amt="${Math.round(Math.max(0, picture.alpha) * 100000)}"/>` : '';
  const crop = picture.crop;
  const src = crop
    ? `<a:srcRect l="${Math.round(crop.l * 100000)}" t="${Math.round(crop.t * 100000)}" r="${Math.round(crop.r * 100000)}" b="${Math.round(crop.b * 100000)}"/>`
    : '';
  const geometry: Geometry = picture.outline ? { path: picture.outline, closed: true } : picture.oval ? { preset: 'ellipse' } : picture.radius && picture.radius > 0 ? { preset: 'roundRect', radius: picture.radius } : { preset: 'rect' };
  return (
    `<p:pic><p:nvPicPr>${nvProps(id, picture.name, picture.description)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rel}">${alpha}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(picture.box)}${geometryXml(geometry, picture.box)}${picture.line ? lineXml(picture.line) : ''}${shadowXml(picture.shadow)}</p:spPr></p:pic>`
  );
}

function tableXml(table: TableElement, writer: SlideWriter): string {
  const id = writer.nextId();
  const grid = table.columns.map((w) => `<a:gridCol w="${Math.max(1, emu(w))}"/>`).join('');
  const rows = table.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          const { l, t, r, b } = cell.text.inset;
          const borders = `${lineXml(cell.borders.l, 'a:lnL')}${lineXml(cell.borders.r, 'a:lnR')}${lineXml(cell.borders.t, 'a:lnT')}${lineXml(cell.borders.b, 'a:lnB')}`;
          const tcPr = `<a:tcPr marL="${emu(l)}" marR="${emu(r)}" marT="${emu(t)}" marB="${emu(b)}" anchor="${cell.text.anchor ?? 't'}">${borders}${fillXml(cell.fill)}</a:tcPr>`;
          return `<a:tc>${textBodyXml({ ...cell.text, inset: { l: 0, t: 0, r: 0, b: 0 } }, writer.rels, 'a:txBody')}${tcPr}</a:tc>`;
        })
        .join('');
      return `<a:tr h="${Math.max(1, emu(row.height))}">${cells}</a:tr>`;
    })
    .join('');
  return (
    `<p:graphicFrame><p:nvGraphicFramePr>${nvProps(id, table.name)}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `${xfrm({ ...table.box, rot: 0 }, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

const EMPTY_GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/* -------------------------------------------------------------------------- */
/* Fixed parts                                                                 */
/* -------------------------------------------------------------------------- */

const CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

/** A complete Office theme with neutral colors and Arial. */
function themeXml(name: string): string {
  const colors: [string, string][] = [
    ['dk1', '000000'],
    ['lt1', 'FFFFFF'],
    ['dk2', '1F2937'],
    ['lt2', 'F3F4F6'],
    ['accent1', '2563EB'],
    ['accent2', 'F59E0B'],
    ['accent3', '10B981'],
    ['accent4', 'EF4444'],
    ['accent5', '8B5CF6'],
    ['accent6', '06B6D4'],
    ['hlink', '2563EB'],
    ['folHlink', '7C3AED'],
  ];
  const scheme = colors
    .map(([key, value]) => (key === 'dk1' ? `<a:dk1><a:sysClr val="windowText" lastClr="${value}"/></a:dk1>` : key === 'lt1' ? `<a:lt1><a:sysClr val="window" lastClr="${value}"/></a:lt1>` : `<a:${key}><a:srgbClr val="${value}"/></a:${key}>`))
    .join('');
  const font = (tag: string) => `<a:${tag}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return (
    `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="${xml(name)}"><a:themeElements>` +
    `<a:clrScheme name="Open Artifact">${scheme}</a:clrScheme>` +
    `<a:fontScheme name="Open Artifact">${font('majorFont')}${font('minorFont')}</a:fontScheme>` +
    `<a:fmtScheme name="Open Artifact"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme>` +
    '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
  );
}

const LEVEL_STYLE = (size: number) =>
  `<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>`;

function masterXml(): string {
  return (
    `${XML_HEAD}<p:sldMaster ${PML_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_GROUP}</p:spTree></p:cSld>` +
    `<p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle>${LEVEL_STYLE(4400)}</p:titleStyle><p:bodyStyle>${LEVEL_STYLE(2800)}</p:bodyStyle><p:otherStyle>${LEVEL_STYLE(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`
  );
}

function layoutXml(): string {
  return `${XML_HEAD}<p:sldLayout ${PML_NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

/** Notes page: 7.5 × 10 in. */
const NOTES_W = 6858000;
const NOTES_H = 9144000;

function notesPlaceholders(body?: string): string {
  const image = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>`;
  const text = body ?? '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>';
  const notes = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${text}</p:sp>`;
  return image + notes;
}

function notesMasterXml(): string {
  return (
    `${XML_HEAD}<p:notesMaster ${PML_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_GROUP}${notesPlaceholders()}</p:spTree></p:cSld>` +
    `<p:clrMap ${CLR_MAP}/><p:notesStyle>${LEVEL_STYLE(1200)}</p:notesStyle></p:notesMaster>`
  );
}

function notesSlideXml(notes: string): string {
  const paragraphs = notes
    .split(/\r?\n/)
    .map((line) => (line ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xml(line)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>'))
    .join('');
  const body = `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody>`;
  return `${XML_HEAD}<p:notes ${PML_NS}><p:cSld><p:spTree>${EMPTY_GROUP}${notesPlaceholders(body)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function transitionXml(kind: PptxSlide['transition']): string {
  if (kind === 'fade') return '<p:transition spd="med"><p:fade/></p:transition>';
  if (kind === 'push') return '<p:transition spd="med"><p:push dir="l"/></p:transition>';
  return '';
}

function backgroundXml(background: PptxSlide['background'], writer: SlideWriter): string {
  if (!background) return '';
  if (background.type === 'picture') {
    return `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${writer.media(background.media)}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
  }
  if (background.fill.type === 'none') return '';
  return `<p:bg><p:bgPr>${fillXml(background.fill)}<a:effectLst/></p:bgPr></p:bg>`;
}

/** W3C date-time without fractions. */
function w3cDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* -------------------------------------------------------------------------- */
/* Package                                                                     */
/* -------------------------------------------------------------------------- */

const CT = 'application/vnd.openxmlformats-officedocument.presentationml';

/** One part of the package: its name and its bytes or text. */
export interface PartEntry {
  name: string;
  data: Uint8Array | string;
}

/** The parts of a presentation (exposed for tests). */
export function pptxEntries(deck: PptxDeck): PartEntry[] {
  const width = deck.width ?? 1920;
  const height = deck.height ?? 1080;
  const created = deck.created ?? new Date();
  const entries: PartEntry[] = [];
  const overrides: string[] = [];
  const override = (part: string, type: string): void => {
    overrides.push(`<Override PartName="/${part}" ContentType="${type}"/>`);
  };

  // Media: one file per key.
  const mediaFiles = new Map<string, string>();
  deck.media.forEach((media, i) => {
    if (mediaFiles.has(media.key)) return;
    const file = `image${i + 1}.${media.type === 'jpeg' ? 'jpeg' : media.type}`;
    mediaFiles.set(media.key, file);
    entries.push({ name: `ppt/media/${file}`, data: media.data });
  });

  // Slides.
  const presRels = new Rels();
  const masterRel = presRels.add(`${REL}/slideMaster`, 'slideMasters/slideMaster1.xml');
  const slideIds: string[] = [];
  let notesCount = 0;
  deck.slides.forEach((slide, i) => {
    const n = i + 1;
    const rels = new Rels();
    rels.add(`${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml');
    const mediaRels = new Map<string, string>();
    let next = 2;
    const writer: SlideWriter = {
      rels,
      media(key) {
        let id = mediaRels.get(key);
        if (!id) {
          const file = mediaFiles.get(key);
          if (!file) throw new Error(`Missing picture ${key}`);
          id = rels.add(`${REL}/image`, `../media/${file}`);
          mediaRels.set(key, id);
        }
        return id;
      },
      nextId: () => next++,
    };
    const background = backgroundXml(slide.background, writer);
    const shapes = slide.elements
      .map((element) => (element.type === 'shape' ? shapeXml(element, writer) : element.type === 'picture' ? pictureXml(element, writer) : tableXml(element, writer)))
      .join('');
    if (slide.notes?.trim()) {
      notesCount++;
      const notesRels = new Rels();
      notesRels.add(`${REL}/notesMaster`, '../notesMasters/notesMaster1.xml');
      notesRels.add(`${REL}/slide`, `../slides/slide${n}.xml`);
      rels.add(`${REL}/notesSlide`, `../notesSlides/notesSlide${n}.xml`);
      entries.push({ name: `ppt/notesSlides/notesSlide${n}.xml`, data: notesSlideXml(slide.notes) });
      entries.push({ name: `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, data: notesRels.toString() });
      override(`ppt/notesSlides/notesSlide${n}.xml`, `${CT}.notesSlide+xml`);
    }
    entries.push({
      name: `ppt/slides/slide${n}.xml`,
      data: `${XML_HEAD}<p:sld ${PML_NS}><p:cSld>${background}<p:spTree>${EMPTY_GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(slide.transition)}</p:sld>`,
    });
    entries.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: rels.toString() });
    override(`ppt/slides/slide${n}.xml`, `${CT}.slide+xml`);
    slideIds.push(`<p:sldId id="${255 + n}" r:id="${presRels.add(`${REL}/slide`, `slides/slide${n}.xml`)}"/>`);
  });
  const notesMasterRel = presRels.add(`${REL}/notesMaster`, 'notesMasters/notesMaster1.xml');
  presRels.add(`${REL}/presProps`, 'presProps.xml');
  presRels.add(`${REL}/viewProps`, 'viewProps.xml');
  presRels.add(`${REL}/theme`, 'theme/theme1.xml');
  presRels.add(`${REL}/tableStyles`, 'tableStyles.xml');

  // Embedded fonts: one `.fntdata` part per face.
  const fonts = deck.fonts ?? [];
  const fontRels = new Map<EmbeddedFont, string>();
  fonts.forEach((font, i) => {
    const part = `fonts/font${i + 1}.fntdata`;
    entries.push({ name: `ppt/${part}`, data: font.data });
    fontRels.set(font, presRels.add(`${REL}/font`, part));
  });
  const fontList = embeddedFontListXml(fonts, (font) => fontRels.get(font)!);

  entries.push({
    name: 'ppt/presentation.xml',
    data:
      `${XML_HEAD}<p:presentation ${PML_NS} saveSubsetFonts="1"${fontList ? ' embedTrueTypeFonts="1"' : ''}>` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRel}"/></p:sldMasterIdLst>` +
      `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterRel}"/></p:notesMasterIdLst>` +
      `<p:sldIdLst>${slideIds.join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${emu(width)}" cy="${emu(height)}"/><p:notesSz cx="${NOTES_W}" cy="${NOTES_H}"/>${fontList}` +
      `<p:defaultTextStyle>${LEVEL_STYLE(1800)}</p:defaultTextStyle></p:presentation>`,
  });
  entries.push({ name: 'ppt/_rels/presentation.xml.rels', data: presRels.toString() });

  const masterRels = new Rels();
  masterRels.add(`${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml');
  masterRels.add(`${REL}/theme`, '../theme/theme1.xml');
  entries.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: masterXml() });
  entries.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRels.toString() });

  const layoutRels = new Rels();
  layoutRels.add(`${REL}/slideMaster`, '../slideMasters/slideMaster1.xml');
  entries.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXml() });
  entries.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRels.toString() });

  const notesMasterRels = new Rels();
  notesMasterRels.add(`${REL}/theme`, '../theme/theme2.xml');
  entries.push({ name: 'ppt/notesMasters/notesMaster1.xml', data: notesMasterXml() });
  entries.push({ name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: notesMasterRels.toString() });

  entries.push({ name: 'ppt/theme/theme1.xml', data: themeXml('Open Artifact') });
  entries.push({ name: 'ppt/theme/theme2.xml', data: themeXml('Open Artifact Notes') });
  entries.push({ name: 'ppt/presProps.xml', data: `${XML_HEAD}<p:presentationPr ${PML_NS}/>` });
  entries.push({
    name: 'ppt/viewProps.xml',
    data: `${XML_HEAD}<p:viewPr ${PML_NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
  });
  entries.push({ name: 'ppt/tableStyles.xml', data: `${XML_HEAD}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` });

  entries.push({
    name: 'docProps/core.xml',
    data:
      `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xml(deck.title)}</dc:title>${deck.description ? `<dc:description>${xml(deck.description)}</dc:description>` : ''}<dc:creator>Open Artifact</dc:creator><cp:lastModifiedBy>Open Artifact</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${w3cDate(created)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${w3cDate(created)}</dcterms:modified></cp:coreProperties>`,
  });
  entries.push({
    name: 'docProps/app.xml',
    data: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Open Artifact</Application><PresentationFormat>${width * 3 === height * 4 ? 'On-screen Show (4:3)' : 'Widescreen'}</PresentationFormat><Slides>${deck.slides.length}</Slides><Notes>${notesCount}</Notes></Properties>`,
  });

  override('ppt/presentation.xml', `${CT}.presentation.main+xml`);
  override('ppt/slideMasters/slideMaster1.xml', `${CT}.slideMaster+xml`);
  override('ppt/slideLayouts/slideLayout1.xml', `${CT}.slideLayout+xml`);
  override('ppt/notesMasters/notesMaster1.xml', `${CT}.notesMaster+xml`);
  override('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml');
  override('ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml');
  override('ppt/presProps.xml', `${CT}.presProps+xml`);
  override('ppt/viewProps.xml', `${CT}.viewProps+xml`);
  override('ppt/tableStyles.xml', `${CT}.tableStyles+xml`);
  override('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml');
  override('docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml');

  const types =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    (fonts.length ? '<Default Extension="fntdata" ContentType="application/x-fontdata"/>' : '') +
    `${overrides.join('')}</Types>`;
  const rootRels = new Rels();
  rootRels.add(`${REL}/officeDocument`, 'ppt/presentation.xml');
  rootRels.add('http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml');
  rootRels.add(`${REL}/extended-properties`, 'docProps/app.xml');

  // [Content_Types].xml and the root relationships come first.
  return [{ name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rootRels.toString() }, ...entries];
}

/** The bytes of a `.pptx`. */
export function writePptx(deck: PptxDeck): Promise<Uint8Array> {
  return packZip(pptxEntries(deck), { date: deck.created ?? new Date() });
}
