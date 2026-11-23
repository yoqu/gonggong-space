/**
 * The in-memory slide model.
 *
 * A slide file is one `<section>` written in a closed HTML/CSS subset. The
 * compiler turns it into the typed tree below and the serializer writes the
 * tree back as the same subset, so the editor edits data, never a DOM. The
 * tree mirrors the markup one element to one node: a node's position in its
 * parent's `children` is its position in the file, which is what keeps paint
 * order (source order) and view-context paths (child indices) trivially in
 * sync with what the agent reads.
 *
 * Styles are kept as normalized declaration strings keyed by property name
 * (`StyleMap`). Values have already been checked against the subset grammar
 * and snapped to its canonical spelling, so the renderer can hand them to the
 * browser as-is and the serializer only has to order them.
 */

import type { CssProperty } from './css/properties.ts';
import type { IconName } from './icons.ts';

/** Normalized inline style: property → canonical value. */
export type StyleMap = Partial<Record<CssProperty, string>>;

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

/** Entrance / exit effects of a build. */
export const BUILD_EFFECTS = ['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop'] as const;
export type BuildEffect = (typeof BUILD_EFFECTS)[number];

/** One `data-build-in` / `data-build-out` value. */
export interface BuildSpec {
  effect: BuildEffect;
  /** Step number 1–50; builds without one run in source order after numbered ones. */
  order?: number;
  /** Runs right after the previous step instead of waiting for a click. */
  auto?: boolean;
}

/** How a slide leaves the stage while presenting. */
export const TRANSITIONS = ['fade', 'push', 'magic'] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** `data-fit`: how a squeezed box treats its text. */
export const FIT_MODES = ['shrink', 'none', 'grow'] as const;
export type FitMode = (typeof FIT_MODES)[number];

/* -------------------------------------------------------------------------- */
/* Rich text                                                                   */
/* -------------------------------------------------------------------------- */

/** Inline formatting of a run. Only the subset's inline tags exist. */
export interface Marks {
  /** `<b>` */
  b?: true;
  /** `<span style="font-weight:400">`: regular weight inside bold text. Never with `b`. */
  regular?: true;
  /** `<i>` */
  i?: true;
  /** `<u>` */
  u?: true;
  /** `<span style="color:…">`, a normalized color. */
  color?: string;
  /** `<a href>`, always http(s). */
  href?: string;
}

/**
 * A run of text with one set of marks. A line break (`<br>`) is a `\n` in the
 * text. Adjacent runs never have equal marks (the compiler and every edit
 * re-normalize), so equality of `Run[]` is equality of the rich text.
 */
export interface Run {
  text: string;
  marks?: Marks;
}

/* -------------------------------------------------------------------------- */
/* Nodes                                                                       */
/* -------------------------------------------------------------------------- */

/** Fields every element node has. */
export interface NodeBase {
  /** The element's own `id` attribute, when written. */
  id?: string;
  /** Normalized inline style. */
  style: StyleMap;
  /** `data-build-in` (pinned children of the section only). */
  buildIn?: BuildSpec;
  /** `data-build-out` (pinned children of the section only). */
  buildOut?: BuildSpec;
  /** `data-fit`, when not the default `shrink`. */
  fit?: Exclude<FitMode, 'shrink'>;
  /**
   * In a slide read from a source deck: the element of the source file this
   * node was read from (its place in document order, see `source.ts`), so an
   * edit can be written back into that element. Never written to a file.
   */
  origin?: number;
}

/** Block text tags. */
export const TEXT_TAGS = ['h1', 'h2', 'h3', 'p'] as const;
export type TextTag = (typeof TEXT_TAGS)[number];

/** `<h1>`…`<h3>` and `<p>`: one block of rich text. */
export interface TextNode extends NodeBase {
  kind: 'text';
  tag: TextTag;
  runs: Run[];
}

/** One `<li>`. Items are plain: no style of their own beyond the list's {@link ItemMargin}. */
export interface ListItem {
  runs: Run[];
  /** How far in a nested item sits: 1–8 (absent: the list's own level). */
  level?: number;
}

/** The `margin` every `<li>` of a list gives itself alike, in px (0 or more, not both 0). */
export interface ItemMargin {
  top: number;
  bottom: number;
}

/** `<ul>` / `<ol>` of plain items; an item may sit nested up to eight levels in. */
export interface ListNode extends NodeBase {
  kind: 'list';
  tag: 'ul' | 'ol';
  items: ListItem[];
  /** `<ol start>`: the number of the first item. */
  start?: number;
  /** `<ol reversed>`: the items count down. */
  reversed?: true;
  /** The markers of the lists nested at a level (1–8): `list-style-type` and `list-style-position` only. */
  levels?: Record<number, StyleMap>;
  /** The space above and below each item, nested ones too (`<li style="margin:…">` on every item). */
  itemMargin?: ItemMargin;
}

/** A block inside a text box: an unstyled paragraph, heading or list. */
export type TextBlock = TextNode | ListNode;

/** `<div data-text>`: several unstyled blocks forming one text box. */
export interface TextBoxNode extends NodeBase {
  kind: 'textbox';
  /** `data-text="N"`: list indent in px. */
  indent?: number;
  blocks: TextBlock[];
}

/** `<div>`: a flex column (default), flex row, grid, or a `position:relative` host. */
export interface BoxNode extends NodeBase {
  kind: 'box';
  /** `data-group`: selected and moved as one. */
  group?: boolean;
  children: SlideNode[];
}

/** `data-crop="ZOOM X% Y%"`. */
export interface Crop {
  /** 1–50: the picture is scaled by this inside its box. */
  zoom: number;
  /** object-position x in percent (0–100). */
  x: number;
  /** object-position y in percent (0–100). */
  y: number;
}

/** Hosted video providers a clip link may point at. */
export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'loom', 'drive'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/** A link to a clip hosted elsewhere (`data-video-<provider>="<id>"`). */
export interface VideoLink {
  provider: VideoProvider;
  /** The provider's video id (with `/key` where the provider has one). */
  id: string;
  /** Whole seconds to start at (`data-video-at`). */
  start?: number;
}

/** A clip played in place of a picture. */
export interface VideoSpec {
  /** An uploaded clip (`data-video="/_blob/<id>"`). */
  src?: string;
  /** Or a hosted clip. */
  link?: VideoLink;
  /** `data-video-sound="on"`. */
  sound?: boolean;
  /** `data-video-loop="off"` turns looping off. */
  loop?: boolean;
  /** `data-video-start="click"`: waits for a click while presenting. */
  startOnClick?: boolean;
  /** `data-video-delay`: seconds a self-starting clip waits (≤ 60). */
  delay?: number;
  /** `data-video-still`: where the poster came from (`clip`, or a stamp). */
  still?: string;
}

/** `<img>` (and `<video>`, read as an `<img>` with a clip). */
export interface ImageNode extends NodeBase {
  kind: 'image';
  /** `/_blob/<id>`, a design-system file, or absent for an empty frame. */
  src?: string;
  alt?: string;
  crop?: Crop;
  video?: VideoSpec;
}

/** One `<th>` / `<td>`: plain text. */
export interface TableCell {
  tag: 'th' | 'td';
  runs: Run[];
  style: StyleMap;
}

/** One `<tr>`. */
export interface TableRow {
  style: StyleMap;
  cells: TableCell[];
}

/** `<table>`: rows of cells, no merges; a first row of `<th>` is the header. */
export interface TableNode extends NodeBase {
  kind: 'table';
  rows: TableRow[];
}

/** Inline `<svg>`: one opaque graphic, kept as validated markup. */
export interface SvgNode extends NodeBase {
  kind: 'svg';
  /**
   * The whole `<svg …>…</svg>` element as written, minus its `id`, `style`
   * and `data-*` attributes (those live on the node and are written back by
   * the serializer).
   */
  markup: string;
}

/** `<x-shape kind>` kinds. */
export const SHAPE_KINDS = [
  'rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** `<x-shape>`: a filled glyph that fills its box. */
export interface ShapeNode extends NodeBase {
  kind: 'shape';
  shape: ShapeKind;
}

/** `<x-icon name>`. */
export interface IconNode extends NodeBase {
  kind: 'icon';
  name: IconName;
}

/** Arrowheads at one end of a connector. */
export const HEAD_KINDS = ['none', 'open', 'filled'] as const;
export type HeadKind = (typeof HEAD_KINDS)[number];

/** How a connector runs between its ends. */
export const ROUTES = ['straight', 'hv', 'vh', 'elbow'] as const;
export type Route = (typeof ROUTES)[number];

/** Corners a flow connector starts from. */
export const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;
export type Corner = (typeof CORNERS)[number];

/** A connector coordinate: px in the host's box, or percent of it. */
export interface Coord {
  value: number;
  unit: 'px' | '%';
}

/** `<x-connector>`: a pinned line between two points, or a flow diagonal. */
export interface ConnectorNode extends NodeBase {
  kind: 'connector';
  /** Canvas coordinates; absent for a flow connector. */
  points?: { x1: Coord; y1: Coord; x2: Coord; y2: Coord };
  /** Flow connector: the corner the line starts from. */
  from?: Corner;
  headStart: HeadKind;
  headEnd: HeadKind;
  route: Route;
}

/** `<x-embed>`: a small sandboxed page. */
export interface EmbedNode extends NodeBase {
  kind: 'embed';
  /** The page's HTML, as written between the tags. */
  html: string;
}

/** `<hr>`: a line. */
export interface RuleNode extends NodeBase {
  kind: 'rule';
}

/** Every element a slide can hold. */
export type SlideNode =
  | TextNode
  | ListNode
  | TextBoxNode
  | BoxNode
  | ImageNode
  | TableNode
  | SvgNode
  | ShapeNode
  | IconNode
  | ConnectorNode
  | EmbedNode
  | RuleNode;

export type NodeKind = SlideNode['kind'];

/* -------------------------------------------------------------------------- */
/* Slide                                                                       */
/* -------------------------------------------------------------------------- */

/** One `<section>`: a slide. */
export interface Slide {
  /** The section's `id`, equal to the file name. */
  id: string;
  /** `data-section`: an outline section starts here (its description). */
  section?: string;
  /** `data-transition`. */
  transition?: Transition;
  /** `hidden`: skipped when presenting and exporting. */
  hidden: boolean;
  /** The section's own style: background, text defaults and the flow root's layout. */
  style: StyleMap;
  /** Children in source order (flow and pinned interleaved). */
  children: SlideNode[];
  /** `<aside>` speaker notes, plain text. */
  notes: string;
  /**
   * `data-flat`: in a source deck, a slide saved with inline styles that no
   * longer follows `project/deck.css` (a slide a person added, or an edit
   * that could not be written into the slide's own markup).
   */
  flat?: boolean;
  /**
   * In a slide read from a source deck: the motion it plays when presenting
   * (animations, transitions and fragments of `project/deck.css`). Read
   * only; never written to a file.
   */
  motion?: SlideMotion;
}

/**
 * Motion of a source slide, by element origin (see {@link NodeBase.origin};
 * 0 is the section). Values are as the sheet wrote them, variables
 * substituted.
 */
export interface SlideMotion {
  /** `animation*` and `transition*` declarations. */
  elements: Record<number, Record<string, string>>;
  /** `@starting-style` declarations: where a transition starts from as the slide appears. */
  starting: Record<number, Record<string, string>>;
  /** In-flow `class="fragment"` elements, in document order, with their `data-fragment-index`. */
  fragments: Array<{ origin: number; index?: number }>;
}

/* -------------------------------------------------------------------------- */
/* Small predicates                                                            */
/* -------------------------------------------------------------------------- */

/** True for a `position:absolute` element (or a pinned connector / embed). */
export function isPinned(node: SlideNode): boolean {
  if (node.kind === 'connector') return node.points !== undefined;
  return node.style.position === 'absolute';
}

/** True for a `position:relative` box: the host of pinned children. */
export function isHost(node: SlideNode): node is BoxNode {
  return node.kind === 'box' && node.style.position === 'relative';
}

/** True for a node that holds text the editor edits in place. */
export function isTextual(node: SlideNode): node is TextNode | ListNode | TextBoxNode {
  return node.kind === 'text' || node.kind === 'list' || node.kind === 'textbox';
}

/** True when a box paints something (otherwise it is an invisible layout box). */
export function boxPaints(style: StyleMap): boolean {
  return Boolean(
    (style.background && style.background !== 'transparent') ||
      style.border ||
      style['border-top'] ||
      style['border-right'] ||
      style['border-bottom'] ||
      style['border-left'] ||
      style['box-shadow'] ||
      style['backdrop-filter'],
  );
}

/** True for an empty, unpainted flexible box: a spacer. */
export function isSpacer(node: SlideNode): boolean {
  return (
    node.kind === 'box' &&
    node.children.length === 0 &&
    !boxPaints(node.style) &&
    (node.style.flex !== undefined || node.style['flex-grow'] !== undefined)
  );
}

/** The plain text of runs. */
export function runsText(runs: readonly Run[]): string {
  let text = '';
  for (const run of runs) text += run.text;
  return text;
}

/** The plain text of any node (blocks and items joined by line breaks). */
export function nodeText(node: SlideNode): string {
  switch (node.kind) {
    case 'text':
      return runsText(node.runs);
    case 'list':
      return node.items.map((item) => runsText(item.runs)).join('\n');
    case 'textbox':
      return node.blocks.map((block) => nodeText(block)).join('\n');
    case 'box':
      return node.children.map(nodeText).filter(Boolean).join('\n');
    case 'table':
      return node.rows.map((row) => row.cells.map((cell) => runsText(cell.runs)).join('\t')).join('\n');
    case 'image':
      return node.alt ?? '';
    default:
      return '';
  }
}

/** Creates a fresh empty slide. */
export function emptySlide(id: string): Slide {
  return { id, hidden: false, style: {}, children: [], notes: '' };
}
