/**
 * The Whiteboard element schema: every element type, its fields, the named
 * enums (colors, sizes, shapes, arrow ends) and the limits the page and the
 * agent tools both enforce.
 *
 * Elements are flat JSON. Each one is stored as its own document
 * (`elements/<id>`, without the `id` field) so two people, or a person and
 * the agent, can change different elements, or different fields of one
 * element, at the same time without losing each other's work.
 *
 * Colors, sizes and shapes are names, never CSS: the renderer maps them to
 * theme colors, so a board reads the same in light and dark themes.
 */

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

/** Most elements one board holds. */
export const MAX_BOARD_ELEMENTS = 800;
/** Most characters of an element's text. */
export const MAX_TEXT_CHARS = 4000;
/** Most characters of an arrow label. */
export const MAX_LABEL_CHARS = 200;
/** Most points (x, y pairs) of one stroke. */
export const MAX_STROKE_POINTS = 4000;
/** Longest inline raster image (`data:image/png;base64,…`), in characters. */
export const MAX_RASTER_DATA_URL_CHARS = 102_400;
/** Coordinates are clamped to ±this. */
export const COORDINATE_LIMIT = 1e6;
/** Smallest width or height of an element. */
export const MIN_ELEMENT_SIZE = 8;
/** Largest width or height of an element. */
export const MAX_ELEMENT_SIZE = 8000;
/** Default sticker width and height. */
export const DEFAULT_STICKER_SIZE = 48;
/** Largest tilt of a note, degrees either way. */
export const MAX_NOTE_TILT = 2;
/** Gap between an image and its selection frame. */
export const IMAGE_FRAME_PADDING = 6;
/** A new note is tilted by a random amount in ±this, degrees. */
export const NEW_NOTE_TILT_RANGE = 1;
/** Most groups one element belongs to (groups nest up to this deep). */
export const MAX_ELEMENT_GROUPS = 8;
/** Most bend values of an arrow's manual route. */
export const MAX_ARROW_BENDS = 12;
/** Largest manual elbow offset (`jog`) of an arrow. */
export const MAX_ARROW_JOG = 2000;
/** Most characters of an embed's HTML; longer markup is cut. */
export const MAX_HTML_CHARS = 16_384;
/** Most characters of an embed's saved state (JSON text). */
export const MAX_HTML_STATE_CHARS = 16_384;
/** Longest shared timer, ms (6 hours). */
export const MAX_TIMER_MS = 21_600_000;
/** Default shared timer, ms (5 minutes). */
export const DEFAULT_TIMER_MS = 300_000;
/** Most custom ink colors a board keeps. */
export const MAX_BOARD_INKS = 64;
/** Most agent claims with an area or ids kept at once. */
export const MAX_CLAIMS_WITH_AREA = 4;
/** Most element ids one claim lists. */
export const MAX_CLAIM_IDS = 50;
/** Most claims without area or ids kept at once. */
export const MAX_BARE_CLAIMS = 32;
/** Most characters of a note's author name. */
export const MAX_AUTHOR_CHARS = 80;
/** Most characters of an author id. */
export const MAX_AUTHOR_ID_CHARS = 128;
/** Longest link-card address. */
export const MAX_LINK_HREF_CHARS = 512;
/** Longest link-card title. */
export const MAX_LINK_TITLE_CHARS = 120;
/** Longest image link (`href`). */
export const MAX_IMAGE_HREF_CHARS = 2048;
/** Longest text placeholder. */
export const MAX_PLACEHOLDER_CHARS = 200;

/** Element ids: 1–40 characters of the db path alphabet, not only dots. */
export const ELEMENT_ID_PATTERN = /^(?!\.{1,40}$)[A-Za-z0-9_.~:@+-]{1,40}$/;
/** `#rrggbb`, any case. */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
/** An author's word-tracking stamp: 8 lower-case hex digits. */
export const WORDS_PATTERN = /^[0-9a-f]{8}$/;

/* -------------------------------------------------------------------------- */
/* Named enums                                                                */
/* -------------------------------------------------------------------------- */

/** Fill colors of notes, shapes, sections and table headers. */
export const NOTE_COLORS = ['yellow', 'peach', 'pink', 'green', 'blue', 'purple', 'white'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** Named pen (ink) colors. */
export const INK_COLOR_NAMES = ['ink', 'terracotta', 'blue', 'green', 'purple'] as const;
export type InkColorName = (typeof INK_COLOR_NAMES)[number];

/** A `#rrggbb` color (stored lower-case). */
export type HexColor = `#${string}`;
/** A fill: a named fill color or any hex color. */
export type FillColor = NoteColor | HexColor;
/** A pen color: a named ink or any hex color. */
export type InkColor = InkColorName | HexColor;

/** Text sizes, smallest first. */
export const TEXT_SIZES = ['small', 'body', 'large', 'title', 'huge'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** How each text size is set. */
export interface TextSizeStyle {
  label: string;
  /** Font size in board units. */
  px: number;
  /** Regular weight. */
  weight: number;
  /** Bold weight. */
  bold: number;
}

export const TEXT_SIZE_STYLES: Readonly<Record<TextSize, TextSizeStyle>> = {
  small: { label: 'Small', px: 14, weight: 400, bold: 700 },
  body: { label: 'Body', px: 16, weight: 400, bold: 700 },
  large: { label: 'Large', px: 28, weight: 500, bold: 700 },
  title: { label: 'Title', px: 48, weight: 500, bold: 600 },
  huge: { label: 'Huge', px: 96, weight: 500, bold: 600 },
};

/** Line height of every text, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.35;

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNMENTS)[number];

/** Outlines of a shape. */
export const SHAPE_KINDS = [
  'rect',
  'rounded',
  'ellipse',
  'diamond',
  'pill',
  'hexagon',
  'parallelogram',
  'database',
  'queue',
  'document',
  'cloud',
  'person',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_KIND_LABELS: Readonly<Record<ShapeKind, string>> = {
  rect: 'Rectangle',
  rounded: 'Square',
  ellipse: 'Circle',
  diamond: 'Diamond',
  pill: 'Pill',
  hexagon: 'Hexagon',
  parallelogram: 'Parallelogram',
  database: 'Database',
  queue: 'Queue',
  document: 'Document',
  cloud: 'Cloud',
  person: 'Person',
};

/** Sides of a box an arrow may attach to. */
export const ARROW_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type ArrowSide = (typeof ARROW_SIDES)[number];

/** Legacy arrow-head modes (`head`): which ends get an arrowhead. */
export const ARROW_HEAD_MODES = ['end', 'both', 'none'] as const;
export type ArrowHeadMode = (typeof ARROW_HEAD_MODES)[number];

/** What one end of an arrow looks like (`heads`). */
export const ARROW_HEAD_KINDS = ['none', 'arrow', 'circle'] as const;
export type ArrowHeadKind = (typeof ARROW_HEAD_KINDS)[number];

/** The heads each legacy mode stands for: `[start, end]`. */
export const ARROW_HEADS_BY_MODE: Readonly<Record<ArrowHeadMode, readonly [ArrowHeadKind, ArrowHeadKind]>> = {
  end: ['none', 'arrow'],
  both: ['arrow', 'arrow'],
  none: ['none', 'none'],
};

/** Section layouts the page keeps tidy. */
export const SECTION_LAYOUTS = ['rows', 'columns'] as const;
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];

/** Kinds of artifact a link card can point at; picks the card's icon. */
export const LINK_KINDS = ['whiteboard', 'design', 'design-system', 'slides', 'doc', 'dashboard', 'motion', 'web'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_LABELS: Readonly<Record<LinkKind, string>> = {
  whiteboard: 'Whiteboard',
  design: 'Design',
  'design-system': 'Design system',
  slides: 'Slide deck',
  doc: 'Doc',
  dashboard: 'Dashboard',
  motion: 'Motion',
  web: 'Web page',
};

/** Looks an SVG drawing can be drawn in (`style`). */
export const DRAWING_STYLES = ['watercolor', 'comic', 'draft', 'paper', 'blueprint', 'marker', 'plain'] as const;
export type DrawingStyle = (typeof DRAWING_STYLES)[number];
/** A `style` value the format keeps: a lowercase slug, so a look added later survives older peers. */
export const DRAWING_STYLE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** Default size of a link card. */
export const LINK_CARD_SIZE = { w: 320, h: 56 } as const;

/** Element types that may be rotated (`turn`). */
export const ROTATABLE_ELEMENT_TYPES = ['note', 'text', 'shape', 'image', 'stroke', 'sticker', 'link'] as const;

/** The special sticker art that draws the placer's avatar (a vote). */
export const FACE_STICKER_ART = 'face';

/* -------------------------------------------------------------------------- */
/* Elements                                                                   */
/* -------------------------------------------------------------------------- */

export type ElementId = string;

/** Who wrote an element: absent for people, `agent` for the agent. */
export type ElementAuthor = 'agent';

/** Fields every element may carry. */
export interface ElementBase {
  id: ElementId;
  /** Rotation in whole degrees, in (-180, 180]; only on rotatable types, never 0. */
  turn?: number;
  /** Locked elements cannot be moved, deleted, restyled or grouped. */
  locked?: true;
  /** Group ids, innermost first; at most {@link MAX_ELEMENT_GROUPS}. */
  groups?: string[];
}

/** Authorship stamps: the agent marks what it wrote. */
export interface Authorship {
  /** `agent` when the agent wrote the element. */
  by?: ElementAuthor;
  /** 8 hex digits identifying the agent's wording, so edits by people show. */
  words?: string;
}

/** Text styling shared by notes, shapes and tables. */
export interface TextStyle {
  size?: TextSize;
  /** Text color; by default the renderer picks a readable one for the fill. */
  ink?: InkColor;
  textAlign?: TextAlign;
}

/** A position and size. */
export interface BoxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A sticky note (people's notes; the agent uses yellow rounded shapes). */
export interface NoteElement extends ElementBase, Authorship, BoxGeometry, TextStyle {
  type: 'note';
  color: FillColor;
  /** Limited Markdown (see `text/markup.ts`). */
  text: string;
  /** Tilt in degrees, ±{@link MAX_NOTE_TILT}. */
  tilt: number;
  /** Display name of the person who wrote it. */
  author?: string;
  /** Id of the person who wrote it. */
  authorId?: string;
}

/** A box with an outline and text. */
export interface ShapeElement extends ElementBase, Authorship, BoxGeometry, TextStyle {
  type: 'shape';
  kind: ShapeKind;
  color: FillColor;
  /** Outline color; none by default. */
  stroke?: InkColor;
  /** No fill (needs a stroke). */
  hollow?: true;
  /** The stroke keeps its exact color in both themes. */
  solid?: true;
  text: string;
}

/** A titled section that holds other elements. */
export interface ContainerElement extends ElementBase, Authorship, BoxGeometry {
  type: 'container';
  color: FillColor;
  /** The title, drawn above the box. */
  text: string;
  /** Optional layout the page keeps when items are added. */
  lay?: SectionLayout;
}

/** Text without a box. */
export interface TextElement extends ElementBase, Authorship {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: TextSize;
  color: InkColor;
  /** Wrap width; the text does not wrap without it. */
  wrap?: number;
  textAlign?: TextAlign;
  /** Shown while the text is empty; one plain line. */
  placeholder?: string;
}

/** A freehand stroke. */
export interface StrokeElement extends ElementBase {
  type: 'stroke';
  x: number;
  y: number;
  /** Flat `[x0, y0, x1, y1, …]`, relative to `x, y`. */
  points: number[];
  color: InkColor;
  /** Pen width, 1–40. */
  width: number;
}

/** One end of an arrow: an element id or a free point. */
export type ArrowEnd = ElementId | readonly [number, number];

/**
 * A manual route: the first axis (`h` or `v`) then alternating offsets.
 * The first ceil(n/2) values are relative to the start box center, the rest
 * to the end box center.
 */
export type ArrowBends = readonly ['h' | 'v', ...number[]];

/** An arrow between two elements or points. */
export interface ArrowElement extends ElementBase, Authorship {
  type: 'arrow';
  from: ArrowEnd;
  to: ArrowEnd;
  fromSide?: ArrowSide;
  toSide?: ArrowSide;
  /** Offset of the middle segment of an elbow route. */
  jog?: number;
  bends?: ArrowBends;
  head: ArrowHeadMode;
  /** Exact end styles `[start, end]`; wins over `head`. */
  heads?: readonly [ArrowHeadKind, ArrowHeadKind];
  dash: boolean;
  color: InkColor;
  label?: string;
}

/** How an image is cropped inside its frame (cover fit, then zoom and pan). */
export interface ImageCrop {
  /** 1–50. */
  zoom: number;
  /** Pan, 0–1 (0.5 is centered). */
  x: number;
  y: number;
}

/** An image, an agent drawing (SVG) or an uploaded video's poster. */
export interface ImageElement extends ElementBase, BoxGeometry {
  type: 'image';
  /** `/_blob/<id>`, a small inline raster, or a base64 SVG drawing. */
  src: string;
  crop?: ImageCrop;
  /** `/_blob/<id>` of an uploaded video; the image is its poster. */
  video?: string;
  /** A web link the image opens. */
  href?: string;
  /** How an SVG drawing is drawn; only SVG drawings carry it. */
  style?: string;
  by?: ElementAuthor;
}

/**
 * Where a sticker sits on its host:
 * `[hostId, hostX, hostY, stickerX, stickerY, offX?, offY?]`. When the host
 * moved and the sticker did not, the sticker follows.
 */
export type StickerOn =
  | readonly [ElementId, number, number, number, number]
  | readonly [ElementId, number, number, number, number, number, number];

/** A sticker: an emoji or icon from the catalog, or the placer's face (a vote). */
export interface StickerElement extends ElementBase, BoxGeometry {
  type: 'sticker';
  /** The emoji shown when the art is unknown, and read by screen readers. */
  glyph: string;
  /** A catalog key, or {@link FACE_STICKER_ART}. */
  art?: string;
  /** Who placed it (a face sticker shows this person). */
  authorId?: string;
  on?: StickerOn;
}

/** A small live web page in a sealed sandbox. */
export interface HtmlElement extends ElementBase, BoxGeometry {
  type: 'html';
  html: string;
  /** Shared state the embed saved (`boardEmbed.save`), JSON text. */
  state?: string;
  by?: ElementAuthor;
}

/** Shared countdown fields. */
export interface TimerFields {
  durationMs: number;
  /** When it ends (epoch ms) while running; `null` when paused or stopped. */
  endsAt: number | null;
  /** Time left while paused. */
  remainingMs: number;
}

/** A timer placed on the board. */
export interface TimerElement extends ElementBase, TimerFields {
  type: 'timer';
  x: number;
  y: number;
}

/** A card linking to another artifact or a web page. */
export interface LinkElement extends ElementBase {
  type: 'link';
  x: number;
  y: number;
  /** `open-artifact://artifact/<id>` or an `http(s)` URL. */
  href: string;
  title?: string;
  kind?: LinkKind;
}

/** One column of a table. */
export interface TableColumn {
  /** Sort key. */
  at?: number;
  /** Width, 48–800. */
  w?: number;
}

/** One row of a table: its sort key and its cells by column id. */
export type TableRow = { at?: number } & { [columnId: string]: string | number | undefined };

/** Cell backgrounds of a table: `{ [rowId]: { [columnId]: color } }`. */
export type TableFills = Record<string, Record<string, FillColor>>;

/** Heat maps of a table: a color per column and per row, tinting its numbers by value. */
export interface TableHeat {
  cols?: Record<string, FillColor>;
  rows?: Record<string, FillColor>;
}

/** A table. Rows and columns are keyed so concurrent edits merge. */
export interface TableElement extends ElementBase, Authorship, TextStyle {
  type: 'table';
  x: number;
  y: number;
  cols: Record<string, TableColumn>;
  rows: Record<string, TableRow>;
  /** The first row is a bold header. */
  head: boolean;
  /** Header fill. */
  color: FillColor;
  fills?: TableFills;
  heat?: TableHeat;
}

/** Every element. */
export type BoardElement =
  | NoteElement
  | ShapeElement
  | ContainerElement
  | TextElement
  | StrokeElement
  | ArrowElement
  | ImageElement
  | StickerElement
  | HtmlElement
  | TimerElement
  | LinkElement
  | TableElement;

export type ElementType = BoardElement['type'];

export const ELEMENT_TYPES = [
  'note',
  'shape',
  'container',
  'text',
  'stroke',
  'arrow',
  'image',
  'sticker',
  'html',
  'timer',
  'link',
  'table',
] as const satisfies readonly ElementType[];

/** The element of a given type. */
export type ElementOf<T extends ElementType> = Extract<BoardElement, { type: T }>;

/** An element as stored: no `id` (the document path carries it). */
export type StoredElement = DistributiveOmit<BoardElement, 'id'>;

/** `Omit` over each member of a union. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Elements that are boxes: they have a frame, can hold stickers and anchor arrows. */
export type BoxElement = NoteElement | ShapeElement | ImageElement | TextElement | ContainerElement | StickerElement | HtmlElement | TimerElement | LinkElement | TableElement;

/* -------------------------------------------------------------------------- */
/* Board-level records                                                        */
/* -------------------------------------------------------------------------- */

/** A custom ink color added by someone, shared by the board. */
export interface BoardInk {
  /** `#rrggbb`, lower-case. */
  color: HexColor;
  /** When it was added (epoch ms); oldest are dropped first. */
  at: number;
}

/**
 * The agent's claim on part of the board: an area, the ids it will change,
 * or both. Everyone sees it until the agent deletes it (or it expires).
 */
export interface ClaimedArea {
  /** The claim key from the asker's view context. */
  key: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  ids?: ElementId[];
}

/** The board's content, in drawing order (back to front). */
export interface BoardContent {
  elements: BoardElement[];
  timer?: TimerFields;
  inks?: BoardInk[];
  claimed?: ClaimedArea[];
}

/** A whole board as the editor holds it. */
export interface Board {
  title: string;
  content: BoardContent;
}

/* -------------------------------------------------------------------------- */
/* Small predicates                                                           */
/* -------------------------------------------------------------------------- */

const BOX_TYPES: ReadonlySet<ElementType> = new Set(['note', 'shape', 'image', 'text', 'container', 'sticker', 'html', 'timer', 'link', 'table']);
const ROTATABLE: ReadonlySet<ElementType> = new Set(ROTATABLE_ELEMENT_TYPES);

/** True for elements with a frame (everything but strokes and arrows). */
export function isBoxElement(element: BoardElement): element is BoxElement {
  return BOX_TYPES.has(element.type);
}

/** Boxes that draw a frame: not embeds or stickers. */
export function isFramedBoxElement(element: BoardElement): element is BoxElement {
  return isBoxElement(element) && element.type !== 'html' && element.type !== 'sticker';
}

/** True when the element type can be rotated. */
export function isRotatableElement(element: Pick<BoardElement, 'type'>): boolean {
  return ROTATABLE.has(element.type);
}

/** The element's rotation in degrees (0 for types that do not rotate). */
export function elementTurn(element: BoardElement | undefined): number {
  return element !== undefined && isRotatableElement(element) ? (element.turn ?? 0) : 0;
}

/** True when the element is locked. */
export function isElementLocked(element: BoardElement | undefined): boolean {
  return element?.locked === true;
}

/** The arrow's end styles `[start, end]`. */
export function arrowHeads(arrow: Pick<ArrowElement, 'head' | 'heads'>): readonly [ArrowHeadKind, ArrowHeadKind] {
  return arrow.heads ?? ARROW_HEADS_BY_MODE[arrow.head];
}

/** The `head` / `heads` fields for given end styles. */
export function arrowHeadFields(heads: readonly [ArrowHeadKind, ArrowHeadKind]): Pick<ArrowElement, 'head' | 'heads'> {
  return { head: heads[0] === 'arrow' ? 'both' : heads[1] === 'arrow' ? 'end' : 'none', heads };
}

/** The arrow's ends in reading direction (an arrow drawn backwards reads from its head). */
export function arrowDirectedEnds(arrow: ArrowElement): { from: ArrowEnd; to: ArrowEnd } {
  const [start, end] = arrowHeads(arrow);
  return start === 'arrow' && end !== 'arrow' ? { from: arrow.to, to: arrow.from } : { from: arrow.from, to: arrow.to };
}

/** The element ids an arrow attaches to. */
export function arrowEndIds(arrow: Pick<ArrowElement, 'from' | 'to'>): ElementId[] {
  return [arrow.from, arrow.to].filter((end): end is ElementId => typeof end === 'string');
}

/** True when both ends name the same element, or free points within {@link MIN_ELEMENT_SIZE}. */
export function sameArrowEnd(a: ArrowEnd, b: ArrowEnd): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_ELEMENT_SIZE;
}

/** Moves a free arrow end; an attached end stays. */
export function offsetArrowEnd(end: ArrowEnd, dx: number, dy: number): ArrowEnd {
  return typeof end === 'string' ? end : [end[0] + dx, end[1] + dy];
}

/** Wraps degrees into (-180, 180], rounded to whole degrees. */
export function normalizeTurnDegrees(degrees: unknown): number {
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return 0;
  const wrapped = ((Math.round(degrees) % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** The element with a new rotation (omitted when 0), keeping `locked` and `groups` last. */
export function withElementTurn<T extends BoardElement>(element: T, degrees: number): T {
  const { turn: _turn, locked, groups, ...rest } = element;
  const turn = normalizeTurnDegrees(degrees);
  return {
    ...rest,
    ...(turn !== 0 ? { turn } : {}),
    ...(locked !== undefined ? { locked } : {}),
    ...(groups !== undefined ? { groups } : {}),
  } as T;
}

/** True when an embed's HTML reached the cap (so its tail, and maybe its script, was cut). */
export function isHtmlAtCharLimit(element: HtmlElement): boolean {
  return element.html.length >= MAX_HTML_CHARS && [...element.html].length >= MAX_HTML_CHARS;
}

/** The plain text an element shows, for search, outlines and screen readers. */
export function elementPlainText(element: BoardElement, tableHeader?: (table: TableElement) => string[]): string {
  switch (element.type) {
    case 'note':
    case 'shape':
    case 'container':
    case 'text':
      return element.text;
    case 'arrow':
      return element.label ?? '';
    case 'sticker':
      return element.glyph;
    case 'link':
      return element.title ?? '';
    case 'table':
      return (tableHeader?.(element) ?? []).filter((cell) => cell !== '').join(', ');
    case 'image':
    case 'stroke':
    case 'html':
    case 'timer':
      return '';
  }
}

/** A fill color for a new note by its author: stable per person, never white. */
export function noteColorForAuthor(authorId: string): NoteColor {
  let hash = 0;
  for (let index = 0; index < authorId.length; index++) hash = (hash * 31 + authorId.charCodeAt(index)) >>> 0;
  const colors = NOTE_COLORS.filter((color) => color !== 'white');
  return colors[hash % colors.length] ?? 'yellow';
}

let elementIdCounter = 0;

/** A fresh element id for things people make: base36 time, a counter and randomness. */
export function createElementId(): ElementId {
  elementIdCounter = (elementIdCounter + 1) % 1296;
  const random = Math.floor(Math.random() * 46656)
    .toString(36)
    .padStart(3, '0');
  return `${Date.now().toString(36)}-${elementIdCounter.toString(36).padStart(2, '0')}${random}`;
}

/** Ids of the elements, minus the locked ones. */
export function withoutLockedIds(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): ReadonlySet<ElementId> {
  const locked = new Set(elements.flatMap((element) => (ids.has(element.id) && isElementLocked(element) ? [element.id] : [])));
  return locked.size === 0 ? ids : new Set([...ids].filter((id) => !locked.has(id)));
}

/** {@link withoutLockedIds}, unless that leaves nothing (then every id). */
export function withoutLockedIdsUnlessAll(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): ReadonlySet<ElementId> {
  const unlocked = withoutLockedIds(elements, ids);
  return unlocked.size > 0 ? unlocked : ids;
}

/** Drops the agent's authorship stamps (a copy is the copier's). */
export function omitAuthorshipFields<T extends BoardElement>(element: T): T {
  const { by: _by, words: _words, ...rest } = element as T & Authorship;
  return rest as T;
}

/** The fields a copy keeps: no authorship, no lock (and a locked element's groups go too). */
export function copyableElementFields<T extends BoardElement>(element: T): T {
  const { locked, ...rest } = omitAuthorshipFields(element) as T & { locked?: true };
  if (locked === true) delete (rest as { groups?: string[] }).groups;
  return rest as T;
}
