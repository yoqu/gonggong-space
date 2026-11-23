/**
 * Fitting boxes to their text: laying text out into words (with CJK and
 * Southeast Asian line breaking), growing notes and shapes until their text
 * fits, the smallest size a box may be resized to, and widening a text
 * element's wrap when a font makes its longest word slightly too wide.
 *
 * Widths come from `measure.ts`, so results follow whichever measurer is
 * installed.
 */

import { normalizeElementOrKeep, persistedElementByDerived } from '../derived.ts';
import { MIN_ELEMENT_SIZE, TEXT_LINE_HEIGHT, TEXT_SIZE_STYLES, type BoardContent, type BoardElement, type BoxGeometry, type NoteElement, type ShapeElement, type ShapeKind, type TextAlign, type TextElement, type TextSize } from '../schema.ts';
import { shapeTextInsets } from '../shape-paths.ts';
import { hasBlankText, lineSpanStyles, lineSpanText, textLinesWithHang, type HungTextLine, type TextLine, type TextRunStyle } from './markup.ts';
import { DEFAULT_TEXT_STYLE, measureRunsWidth, measureTextBlock, textWidthWithListMarker } from './measure.ts';

// ---------------------------------------------------------------------------
// Line breaking
// ---------------------------------------------------------------------------

/** `\p{sc=…}` classes for some scripts. */
function scriptPropertyClasses(...scripts: string[]): string {
  return scripts.map((script) => '\\p{sc=' + script + '}').join('');
}

const CJK_SCRIPT_CLASSES = scriptPropertyClasses('Han', 'Hiragana', 'Katakana', 'Hangul');
const SOUTHEAST_ASIAN_SCRIPT_CLASSES = scriptPropertyClasses('Thai', 'Lao', 'Khmer', 'Myanmar');

/**
 * Break opportunities around CJK: each CJK character (with its opening
 * punctuation before and closing punctuation after) is its own piece; runs
 * of anything else stay whole.
 */
export const CJK_BREAK_PATTERN = new RegExp('[\\p{Ps}\\p{Pi}]*[' + CJK_SCRIPT_CLASSES + ']\\p{M}*[\\p{Pe}\\p{Pf}\\p{Po}]*|[^' + CJK_SCRIPT_CLASSES + ']+', 'gu');

/** Scripts written without spaces that need a dictionary to break. */
export const SOUTHEAST_ASIAN_SCRIPT_PATTERN = new RegExp('[' + SOUTHEAST_ASIAN_SCRIPT_CLASSES + ']', 'u');

const WORD_SEGMENTER = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : undefined;

/** Splits a space-free word where lines may break inside it. */
export function splitBreakableWords(word: string): string[] {
  return WORD_SEGMENTER !== undefined && SOUTHEAST_ASIAN_SCRIPT_PATTERN.test(word) ? Array.from(WORD_SEGMENTER.segment(word), (segment) => segment.segment) : (word.match(CJK_BREAK_PATTERN) ?? []);
}

/** A piece of a line that does not break: its styled runs, and for the first piece of a word the italic style of the space before it. */
export interface WordPiece {
  runs: TextRunStyle[];
  spaced?: TextRunStyle['italic'];
}

/** Splits a line at whitespace (and further with `split`) into styled pieces. */
export function splitWordPieces(line: Pick<TextLine, 'spans'>, split: (word: string) => string[] = (word) => [word]): WordPiece[] {
  const plain = lineSpanText(line);
  const italicByChar = lineSpanStyles(line).flatMap((run) => Array<TextRunStyle['italic']>(run.text.length).fill(run.italic));
  let cursor = 0;
  return plain.split(/\s+/).flatMap((word) =>
    split(word).map((piece, pieceIndex): WordPiece => {
      const start = plain.indexOf(piece, cursor);
      cursor = start + piece.length;
      const runs: TextRunStyle[] = [];
      for (let runStart = start, runEnd = runStart; runStart < cursor; runStart = runEnd) {
        while (runEnd < cursor && italicByChar[runEnd] === italicByChar[runStart]) runEnd++;
        runs.push({ text: plain.slice(runStart, runEnd), italic: italicByChar[runStart] ?? false });
      }
      return { runs: runs.length > 0 ? runs : [{ text: '', italic: false }], ...(pieceIndex === 0 ? { spaced: italicByChar[start - 1] ?? false } : {}) };
    }),
  );
}

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

/** The px and weight of a text size (the default style when it has none). */
function textStyleOf(size: TextSize | undefined): { px: number; weight: number } {
  return size === undefined ? DEFAULT_TEXT_STYLE : TEXT_SIZE_STYLES[size];
}

/** The lines of a text with their spans and hanging indents at a size. */
export function layoutTextLines(text: string, size?: TextSize): HungTextLine[] {
  const { px, weight } = textStyleOf(size);
  return textLinesWithHang(text, px, (sample) => textWidthWithListMarker(sample, px, weight));
}

/** The natural (unwrapped) size of rich text. */
export function measureRichTextBlock(text: string, size?: TextSize): { w: number; h: number } {
  const lines = layoutTextLines(text, size);
  return {
    w: Math.max(...lines.map((line) => Math.ceil(line.hang) + measureRunsWidth(lineSpanStyles(line), size))),
    h: measureTextBlock(lines.map(lineSpanText).join('\n'), size).h,
  };
}

/** Text whose layout can be measured. */
export interface MeasurableText {
  text: string;
  size?: TextSize;
}

/** The width of the widest word (with its line's hang), the narrowest a wrap can go. */
export function longestWordWidth(element: MeasurableText): number {
  return Math.ceil(Math.max(...layoutTextLines(element.text, element.size).flatMap((line) => splitWordPieces(line).map((piece) => line.hang + measureRunsWidth(piece.runs, element.size)))));
}

/** How far list text hangs beyond its first level of indentation (0 without lists). */
export function textHangIndent(element: MeasurableText): number {
  const hangs = layoutTextLines(element.text, element.size).flatMap((line) => (line.hang > 0 ? [line.hang] : []));
  return hangs.length === 0 ? 0 : Math.max(0, Math.min(...hangs) - 1.5 * textStyleOf(element.size).px);
}

/**
 * A text element resized to `width` within `box`: unwrapped when it fits,
 * otherwise wrapped (never narrower than its longest word). Left-aligned
 * text keeps its right edge (it was resized from the left).
 */
export function fitTextToWidth(element: TextElement, box: Pick<BoxGeometry, 'x' | 'w'>, align: TextAlign, width: number): TextElement {
  const naturalWidth = measureRichTextBlock(element.text, element.size).w;
  const { wrap: _wrap, ...rest } = element;
  const nextWrap = width >= naturalWidth ? undefined : Math.max(longestWordWidth(element), width);
  return normalizeElementOrKeep<TextElement>({ ...rest, ...(nextWrap !== undefined ? { wrap: nextWrap } : {}), x: align === 'left' ? box.x + box.w - (nextWrap ?? naturalWidth) : box.x });
}

// ---------------------------------------------------------------------------
// Box fitting
// ---------------------------------------------------------------------------

/** The largest box auto-fitting grows to. */
export const MAX_AUTO_FIT_BOX = { w: 640, h: 4000 } as const;

/** Horizontal padding around note text. */
export const NOTE_TEXT_PADDING = 32;

/** Room left beside the widest word when fitting loosely. */
export const FIT_WORD_SLACK = 16;

/**
 * How tightly to fit: `word` is the slack beside the widest word (undefined
 * to keep the width), `line` the slack per line, `tall` the extra height,
 * and `exact` skips rounding up.
 */
export interface FitMode {
  word: number | undefined;
  line: number;
  tall: number;
  exact: boolean;
}

/** Fit with room to spare. */
export const FIT_LOOSE: FitMode = { word: FIT_WORD_SLACK, line: 4, tall: 12, exact: false };

/** Fit with room to spare, keeping the width. */
export const FIT_LOOSE_NO_WORD: FitMode = { ...FIT_LOOSE, word: undefined };

/** Fit exactly, keeping the width. */
export const FIT_EXACT: FitMode = { word: undefined, line: 0, tall: 0, exact: true };

/** Whether an element is a shape or a note. */
export function isShapeOrNote(element: BoardElement | undefined): element is ShapeElement | NoteElement {
  return element?.type === 'shape' || element?.type === 'note';
}

/** A box whose text can be fitted. */
export interface FittableText extends MeasurableText {
  /** The shape's kind (insets follow it); a plain rectangle when absent. */
  kind?: ShapeKind;
}

/** A measured piece of a laid-out line. */
interface MeasuredPiece {
  runs: TextRunStyle[];
  ww: number;
  gap: number;
}

/** A laid-out line: its hang and measured pieces. */
interface MeasuredLine {
  hang: number;
  pieces: MeasuredPiece[];
}

/**
 * The size a box needs for its text, starting from `w`×`h` and only
 * growing: wider for its widest word (per `fit.word`), taller for its
 * wrapped lines. Repeats until the size settles, since insets depend on it.
 */
export function fitBoxToText(element: FittableText, w: number, h: number, fit: FitMode): { w: number; h: number } {
  if (hasBlankText(element)) return { w, h };
  const { px } = textStyleOf(element.size);
  const measure = (runs: readonly TextRunStyle[]): number => measureRunsWidth(runs, element.size, fit.exact);
  const spaceCache = new Map<TextRunStyle['italic'], number>();
  const spaceWidth = (italic: TextRunStyle['italic']): number => {
    if (!spaceCache.has(italic)) spaceCache.set(italic, measure([{ text: 'a a', italic }]) - measure([{ text: 'aa', italic }]));
    return spaceCache.get(italic) ?? 0;
  };
  const lines: MeasuredLine[] = layoutTextLines(element.text, element.size).map((line) => ({
    hang: line.hang,
    pieces: splitWordPieces(line, splitBreakableWords).map(({ runs, spaced }) => ({ runs, ww: measure(runs), gap: spaced === undefined ? 0 : spaceWidth(spaced) })),
  }));
  for (let pass = 0; pass < 8; pass++) {
    const next = fitBoxToTextOnce(element.kind ?? 'rect', w, h, fit, px, lines, measure);
    if (next.w === w && next.h === h) break;
    [w, h] = [next.w, next.h];
  }
  return { w, h };
}

/** One pass of {@link fitBoxToText} at the current size. */
function fitBoxToTextOnce(kind: ShapeKind, w: number, h: number, fit: FitMode, px: number, lines: readonly MeasuredLine[], measure: (runs: readonly TextRunStyle[]) => number): { w: number; h: number } {
  const insets = shapeTextInsets(kind, w, h);
  const [innerX, innerY] = [1 - insets.left - insets.right, 1 - insets.top - insets.bottom];
  const round = fit.exact ? (value: number): number => value : Math.ceil;
  const width =
    fit.word === undefined ? w : Math.max(w, Math.min(MAX_AUTO_FIT_BOX.w, round((Math.max(...lines.flatMap((line) => line.pieces.map((piece) => line.hang + piece.ww))) + fit.word) / innerX)));
  let lineCount = 0;
  for (const line of lines) {
    const room = width * innerX - fit.line - line.hang;
    let cursor = 0;
    lineCount += 1;
    for (const { runs, ww: pieceWidth, gap } of line.pieces) {
      if (cursor > 0 && cursor + gap + pieceWidth > room) {
        lineCount += 1;
        cursor = 0;
      }
      // A piece wider than the line breaks between graphemes.
      const steps = pieceWidth > room ? runs.flatMap((run) => (run.text.match(/\P{M}\p{M}*|\p{M}+/gu) ?? []).map((grapheme) => measure([{ ...run, text: grapheme }]))) : [(cursor > 0 ? gap : 0) + pieceWidth];
      for (const step of steps) {
        if (cursor > 0 && cursor + step > room) {
          lineCount += 1;
          cursor = 0;
        }
        cursor += step;
      }
    }
  }
  return { w: width, h: Math.max(h, Math.min(MAX_AUTO_FIT_BOX.h, round((lineCount * px * TEXT_LINE_HEIGHT + fit.tall) / innerY))) };
}

/**
 * How a note or shape grows to fit its text (undefined when it already
 * fits). Notes only widen, up to their widest word; shapes grow around
 * their center.
 */
export function fittedBoxPatch(element: NoteElement | ShapeElement): Partial<BoxGeometry> | undefined {
  if (element.type === 'note') {
    const size = element.size;
    if (size === undefined) return undefined;
    const widest = Math.max(0, ...layoutTextLines(element.text, size).flatMap((line) => splitWordPieces(line, splitBreakableWords).map((piece) => line.hang + measureRunsWidth(piece.runs, size))));
    const width = Math.min(MAX_AUTO_FIT_BOX.w, Math.ceil(widest + FIT_WORD_SLACK + NOTE_TEXT_PADDING));
    return width > element.w ? { w: width } : undefined;
  }
  const { w, h } = element.size === undefined ? element : fitBoxToText(element, element.w, element.h, FIT_LOOSE);
  return w === element.w && h === element.h ? undefined : { x: element.x - (w - element.w) / 2, y: element.y - (h - element.h) / 2, w, h };
}

/** The size a shape needs when its text overflows (undefined when it fits exactly). */
export function overflowFitSize(element: FittableText & { w: number; h: number }): { w: number; h: number } | undefined {
  return fitBoxToText(element, element.w, element.h, FIT_EXACT).h === element.h ? undefined : fitBoxToText(element, element.w, element.h, FIT_LOOSE);
}

/** How a note or shape grows after its text changed (shapes only when their text overflows). */
export function autoFitPatch(element: NoteElement | ShapeElement): Partial<BoxGeometry> | undefined {
  return element.type === 'shape' && overflowFitSize(element) === undefined ? undefined : fittedBoxPatch(element);
}

/**
 * The smallest size a note or shape may be resized to without hiding text,
 * within `box` and at least `minW`×`minH`. Text that already overflows may
 * keep overflowing by as much.
 */
export function minResizeSizeForText(element: NoteElement | ShapeElement, box: { w: number; h: number }, minW: number, minH: number): { w: number; h: number } {
  if (element.type === 'note') return { w: Math.max(minW, Math.min(box.w, fittedBoxPatch({ ...element, w: 0 })?.w ?? 0)), h: minH };
  const w = Math.max(minW, Math.min(box.w, fitBoxToText(element, MIN_ELEMENT_SIZE, MIN_ELEMENT_SIZE, FIT_LOOSE).w));
  const overflow = Math.max(0, fitBoxToText(element, box.w, MIN_ELEMENT_SIZE, FIT_LOOSE_NO_WORD).h - box.h);
  return { w, h: fitBoxToText(element, w, Math.max(minH, fitBoxToText(element, w, MIN_ELEMENT_SIZE, FIT_LOOSE_NO_WORD).h - overflow), FIT_EXACT).h };
}

// ---------------------------------------------------------------------------
// Fitting a whole board to the loaded fonts
// ---------------------------------------------------------------------------

const textWrapFitCache = new WeakMap<TextElement, TextElement>();

/**
 * A text element whose wrap is widened to its longest word when the word
 * is only slightly too wide (within 5% plus its hang), as happens when the
 * page's font is wider than the one the wrap was chosen with.
 */
export function widenTextWrapToFit(text: TextElement): TextElement {
  let fitted = textWrapFitCache.get(text);
  if (fitted === undefined) {
    const width = text.wrap === undefined ? 0 : longestWordWidth(text);
    fitted = text.wrap !== undefined && width > text.wrap && width <= text.wrap * 1.05 + 1 + textHangIndent(text) ? normalizeElementOrKeep<TextElement>({ ...text, wrap: width }) : text;
    textWrapFitCache.set(text, fitted);
  }
  return fitted;
}

/**
 * A memoized fitter of board content to the loaded fonts: text wraps are
 * widened ({@link widenTextWrapToFit}) and shapes whose text overflows grow
 * ({@link overflowFitSize}). A shape whose text and box did not change
 * since the previous call is not refitted, so a person can still shrink
 * it; derived elements are left alone. Returns the same content when
 * nothing changed.
 *
 * The page calls it only once its fonts have loaded (and resets metrics
 * then); before that, raw content should be shown as is.
 */
export function createFontFitContent(): (raw: BoardContent) => BoardContent {
  const fitCache = new WeakMap<ShapeElement, ShapeElement>();
  let unchangedById = new Map<string, ShapeElement>();
  let lastRaw: BoardContent | undefined;
  let lastFitted: BoardContent | undefined;
  return (raw) => {
    if (raw === lastRaw && lastFitted !== undefined) return lastFitted;
    const previousById = unchangedById;
    unchangedById = new Map();
    const elements = raw.elements.map((element): BoardElement => {
      if (element.type === 'text') return widenTextWrapToFit(element);
      if (element.type !== 'shape' || persistedElementByDerived.has(element)) return element;
      const prior = previousById.get(element.id);
      const sameLayout =
        prior !== undefined &&
        prior.text === element.text &&
        prior.size === element.size &&
        prior.textAlign === element.textAlign &&
        prior.kind === element.kind &&
        prior.w === element.w &&
        prior.h === element.h;
      let fitted = fitCache.get(element);
      if (fitted === undefined) {
        const grow = sameLayout ? undefined : overflowFitSize(element);
        fitted = grow === undefined ? element : normalizeElementOrKeep<ShapeElement>({ ...element, ...grow });
      }
      if (fitted === element) unchangedById.set(element.id, element);
      else fitCache.set(element, fitted);
      return fitted;
    });
    lastRaw = raw;
    lastFitted = elements.some((element, index) => element !== raw.elements[index]) ? { ...raw, elements } : raw;
    return lastFitted;
  };
}
