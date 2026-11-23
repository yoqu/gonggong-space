/**
 * Every fixed number of the Slides format in one place: the canvas, the
 * counting limits the compiler enforces, and the limits the editor and the
 * agent instructions quote. Changing a value here changes what the compiler
 * accepts, so the reference docs must change with it.
 */

/** The two slide sizes a deck can have (deck.json `size`; absent is 16:9). */
export type DeckSize = '16:9' | '4:3';

/** Canvas width of each deck size, in CSS pixels (the height is always 1080). */
export const DECK_SIZE_WIDTHS: Readonly<Record<DeckSize, number>> = { '16:9': 1920, '4:3': 1440 };

/**
 * Slide canvas width in CSS pixels of the deck being worked on: 1920, or
 * 1440 in a 4:3 deck. A live binding: {@link setSlideSize} changes it, and
 * every module that reads it at call time sees the new width.
 *
 * Module state, so it is the editor's alone (one deck per page). Code that runs
 * where many decks are served at once (the type server's project check, on a
 * cloud host every person's decks in one process) takes the width from the
 * deck it is given (`createSourceDeck(css, index.size)`) and never sets this.
 */
export let SLIDE_WIDTH = 1920;
/** Slide canvas height in CSS pixels (the same for both sizes). */
export const SLIDE_HEIGHT = 1080;

/** Reads deck.json's `size`: `"4:3"`, `"16:9"`, or undefined for anything else. */
export function normalizeDeckSize(value: unknown): DeckSize | undefined {
  return value === '4:3' || value === '16:9' ? value : undefined;
}

/**
 * Sets the canvas size every later layout and export of the editor uses (the
 * deck's `size`; undefined is 16:9). The editor calls it when the index
 * loads or changes; nothing on a server calls it (see {@link SLIDE_WIDTH}).
 */
export function setSlideSize(size: DeckSize | undefined): void {
  SLIDE_WIDTH = DECK_SIZE_WIDTHS[size ?? '16:9'];
}
/** The conventional slide margin (padding of a section). */
export const SLIDE_MARGIN = 128;

export const LIMITS = {
  /** Slides in one deck. */
  slides: 500,
  /** Sections (outline rows) in one deck. */
  sections: 100,
  /** Characters of one section description. */
  sectionDescription: 400,
  /** Font faces in one deck. */
  faces: 4,
  /** Design systems installed in one deck. */
  designSystems: 4,
  /** Characters of a Google Fonts css2 link. */
  fontHref: 1024,
  /** Table cells in one deck. */
  deckCells: 40000,
  /** Elements on one slide, as the authoring convention. */
  elements: 200,
  /** Elements on one slide, as the editor's hard limit. */
  elementsHard: 800,
  /** Nested `<div>`s. */
  divDepth: 15,
  /** Positioned children of one host (`<section>` or `position:relative` div). */
  pinnedPerHost: 24,
  /** Table cells on one slide. */
  slideCells: 4000,
  /** Rows of one table. */
  tableRows: 100,
  /** Columns of one table. */
  tableColumns: 24,
  /** Characters of one text element. */
  textChars: 20000,
  /** Inline marks (b, i, u, a, span) of one text element. */
  inlineMarks: 100,
  /** Characters of the speaker notes of one slide. */
  notes: 4000,
  /** Characters of an image's alt text. */
  alt: 500,
  /** Builds (entrance / exit effects) on one slide. */
  builds: 100,
  /** Highest build order number. */
  buildOrder: 50,
  /** Elements in one group. */
  group: 24,
  /** Stops in one gradient. */
  gradientStops: 8,
  /** Layers of one box-shadow / text-shadow. */
  shadows: 8,
  /** Tracks of one grid template. */
  gridTracks: 24,
  /** Bytes of one inline `<svg>`. */
  svgBytes: 52 * 1024,
  /** Bytes of one `<x-embed>`. */
  embedBytes: 16 * 1024,
  /** Embeds on one slide. */
  embedsPerSlide: 8,
  /** Bytes of one slide file; larger files are held read-only. */
  slideFileBytes: 1024 * 1024,
  /** Bytes of one video upload. */
  videoBytes: 20 * 1024 * 1024,
  /** Clips playing at once on one slide. */
  playingVideos: 4,
  /** Seconds a self-starting clip may wait. */
  videoDelay: 60,
  /** Undo steps the editor keeps. */
  undo: 200,
  /** Entries of a view context `selected` list. */
  contextSelected: 20,
  /** Entries of a view context `selection` list. */
  contextSelection: 5,
  /** Bytes of the whole view context record. */
  contextBytes: 3072,
  /** Images placed at once by one insert. */
  insertImages: 6,
  /** Longest edge of an uploaded picture after downscaling. */
  imageEdge: 2560,
  /** Bytes of one file the host saves for a download. */
  downloadBytes: 16 * 1024 * 1024,
} as const;

/** Levels of a nested list (an item's `level` is 0 to this − 1). */
export const LIST_LEVELS = 9;

/**
 * The attribute a source slide's reading carries on each element: the
 * element's place in the source file (see `source.ts`). Only the compiler
 * and the serializer of source slides read or write it.
 */
export const SOURCE_MARK = 'data-open-artifact-src';

/** Font size range in px. */
export const FONT_SIZE_RANGE = { min: 8, max: 400 } as const;
/** Shrink-to-fit floor: a squeezed box never shrinks its text below these. */
export const FIT_FLOOR = { ratio: 0.6, px: 8 } as const;

/** Tag defaults of text elements: size, weight and line height. */
export const TEXT_DEFAULTS = {
  h1: { fontSize: 96, fontWeight: 600, lineHeight: 1.1 },
  h2: { fontSize: 64, fontWeight: 600, lineHeight: 1.15 },
  h3: { fontSize: 44, fontWeight: 600, lineHeight: 1.2 },
  p: { fontSize: 32, fontWeight: 400, lineHeight: 1.4 },
} as const;

/** The font stack text falls back to when no `font-family` is set. */
export const DEFAULT_FONT_STACK = "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/** Grammar of slide ids, section keys and element ids. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Grammar of a design-system folder / namespace. */
export const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Grammar of an uploaded asset reference. */
export const BLOB_PATTERN = /^\/_blob\/[0-9a-f]{32}$/;
/** Grammar of a font family name the deck may declare. */
export const FAMILY_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;
