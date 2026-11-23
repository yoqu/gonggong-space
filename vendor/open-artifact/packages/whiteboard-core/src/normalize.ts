/**
 * Element normalization: the one gate every element passes through, whether
 * it comes from the document store, the clipboard, a board file or the
 * agent. Unknown fields are dropped, numbers are clamped, enums fall back to
 * defaults, and an element that cannot be repaired (no position, a bad id,
 * an image without a valid source) is dropped.
 *
 * The output is canonical: normalizing twice gives the same result, which
 * the sync engine relies on to recognize its own writes coming back.
 */

import {
  ARROW_HEAD_KINDS,
  ARROW_HEAD_MODES,
  ARROW_SIDES,
  COORDINATE_LIMIT,
  DEFAULT_STICKER_SIZE,
  DEFAULT_TIMER_MS,
  DRAWING_STYLE_PATTERN,
  ELEMENT_ID_PATTERN,
  FACE_STICKER_ART,
  HEX_COLOR_PATTERN,
  INK_COLOR_NAMES,
  isBoxElement,
  isRotatableElement,
  MAX_ARROW_BENDS,
  MAX_ARROW_JOG,
  MAX_AUTHOR_ID_CHARS,
  MAX_BARE_CLAIMS,
  MAX_BOARD_ELEMENTS,
  MAX_BOARD_INKS,
  MAX_CLAIM_IDS,
  MAX_CLAIMS_WITH_AREA,
  MAX_ELEMENT_GROUPS,
  MAX_ELEMENT_SIZE,
  MAX_HTML_CHARS,
  MAX_HTML_STATE_CHARS,
  MAX_LABEL_CHARS,
  MAX_NOTE_TILT,
  MAX_PLACEHOLDER_CHARS,
  MAX_STROKE_POINTS,
  MAX_TIMER_MS,
  MIN_ELEMENT_SIZE,
  normalizeTurnDegrees,
  NOTE_COLORS,
  sameArrowEnd,
  SHAPE_KINDS,
  TEXT_ALIGNMENTS,
  TEXT_SIZES,
  WORDS_PATTERN,
  arrowEndIds,
  type ArrowBends,
  type ArrowEnd,
  type ArrowHeadKind,
  type ArrowSide,
  type Authorship,
  type BoardContent,
  type BoardElement,
  type BoardInk,
  type ClaimedArea,
  type ElementAuthor,
  type ElementId,
  type FillColor,
  type HexColor,
  type InkColor,
  type StickerOn,
  type TextAlign,
  type TextStyle,
  type TimerFields,
} from './schema.ts';
import { clampElementText, isSvgImageSource, isUploadedBlobSource, normalizeImageSource } from './image-source.ts';
import { normalizeImageCrop } from './image-crop.ts';
import { normalizeHttpUrl, normalizeLinkFields, sanitizeShortLabel } from './links.ts';
import { isStickerArt, normalizeStickerGlyph, stickerGlyphForArt } from './stickers.ts';
import { normalizeTable } from './table.ts';
import { sliceChars, truncateAuthorName } from './text-limits.ts';

/** Anything read from JSON. */
type Loose = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Field helpers                                                              */
/* -------------------------------------------------------------------------- */

/** `value` clamped to `[min, max]`, or `undefined` when it is not a finite number. */
export function clampFiniteNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** `input` when it is one of `options`, else `fallback`. */
export function parseEnumValue<T extends string>(input: unknown, options: readonly T[], fallback: T): T {
  return typeof input === 'string' && (options as readonly string[]).includes(input) ? (input as T) : fallback;
}

/** A palette name, any `#rrggbb` (lower-cased), or `fallback`. */
export function normalizePaletteColor<T extends string>(color: unknown, palette: readonly T[], fallback: T): T | HexColor {
  if (typeof color === 'string' && (palette as readonly string[]).includes(color)) return color as T;
  if (typeof color === 'string' && HEX_COLOR_PATTERN.test(color)) return color.toLowerCase() as HexColor;
  return fallback;
}

/** A side name, or `undefined`. */
export function normalizeArrowSide(input: unknown): ArrowSide | undefined {
  return typeof input === 'string' && (ARROW_SIDES as readonly string[]).includes(input) ? (input as ArrowSide) : undefined;
}

/** A `[start, end]` pair of head kinds, or `undefined`. */
export function normalizeArrowHeadPair(heads: unknown): readonly [ArrowHeadKind, ArrowHeadKind] | undefined {
  const isHeadKind = (input: unknown): input is ArrowHeadKind => typeof input === 'string' && (ARROW_HEAD_KINDS as readonly string[]).includes(input);
  return Array.isArray(heads) && heads.length === 2 && isHeadKind(heads[0]) && isHeadKind(heads[1]) ? [heads[0], heads[1]] : undefined;
}

/** An element id, or an `[x, y]` point clamped to the board. */
export function normalizeArrowEnd(end: unknown): ArrowEnd | undefined {
  if (typeof end === 'string') return ELEMENT_ID_PATTERN.test(end) ? end : undefined;
  if (!Array.isArray(end) || end.length !== 2) return undefined;
  const x = clampFiniteNumber(end[0], -COORDINATE_LIMIT, COORDINATE_LIMIT);
  const y = clampFiniteNumber(end[1], -COORDINATE_LIMIT, COORDINATE_LIMIT);
  return x === undefined || y === undefined ? undefined : [x, y];
}

/** A manual arrow route: `['h'|'v', …offsets]`, at most {@link MAX_ARROW_BENDS} offsets, all finite. */
export function normalizeArrowBends(bends: unknown): ArrowBends | undefined {
  if (!Array.isArray(bends) || (bends[0] !== 'h' && bends[0] !== 'v') || bends.length > MAX_ARROW_BENDS + 1) return undefined;
  const offsets = bends.slice(1).map((value: unknown) => clampFiniteNumber(value, -2 * COORDINATE_LIMIT, 2 * COORDINATE_LIMIT));
  return offsets.every((value): value is number => value !== undefined) ? [bends[0], ...offsets] : undefined;
}

function pickTextAlign(input: Loose): { textAlign?: TextAlign } {
  const textAlign = TEXT_ALIGNMENTS.find((align) => align === input.textAlign);
  return textAlign !== undefined ? { textAlign } : {};
}

/** The `size`, `ink` and `textAlign` of notes, shapes and tables. */
export function normalizeTextStyleFields(input: Loose): TextStyle {
  const size = TEXT_SIZES.find((value) => value === input.size);
  return {
    ...(size !== undefined ? { size } : {}),
    ...(typeof input.ink === 'string' ? { ink: normalizePaletteColor(input.ink, INK_COLOR_NAMES, 'ink') } : {}),
    ...pickTextAlign(input),
  };
}

/** A text placeholder: one plain line, cleaned like a link title, at most {@link MAX_PLACEHOLDER_CHARS}; `undefined` when empty. */
export function normalizePlaceholder(value: unknown): string | undefined {
  const placeholder = sanitizeShortLabel(value, MAX_PLACEHOLDER_CHARS);
  return placeholder !== '' ? placeholder : undefined;
}

/** The agent's authorship stamps (`by: "agent"`, `words`). */
export function pickAuthorshipFields(input: Loose): Authorship {
  return {
    ...(isAgentAuthor(input.by) ? { by: 'agent' as const } : {}),
    ...(typeof input.words === 'string' && WORDS_PATTERN.test(input.words) ? { words: input.words } : {}),
  };
}

/** True for the agent author marker. */
export function isAgentAuthor(by: unknown): boolean {
  return by === 'agent';
}

function pickBy(input: Loose): { by?: ElementAuthor } {
  return isAgentAuthor(input.by) ? { by: 'agent' } : {};
}

/** Group ids: the first 64 values scanned, valid ids only, deduplicated, at most {@link MAX_ELEMENT_GROUPS}. */
export function normalizeElementGroups(input: Loose): { groups?: string[] } {
  const groups = Array.isArray(input.groups)
    ? [...new Set(input.groups.slice(0, 64).filter((id: unknown): id is string => typeof id === 'string' && ELEMENT_ID_PATTERN.test(id)))].slice(0, MAX_ELEMENT_GROUPS)
    : [];
  return groups.length > 0 ? { groups } : {};
}

/**
 * Timer fields: duration 1 s–6 h (default 5 min), remaining 0–6 h (default
 * the duration), and an end time only when finite and not absurdly far out.
 */
export function normalizeTimerFields(timer: Loose, now = Date.now()): TimerFields {
  const durationMs = Math.round(clampFiniteNumber(timer.durationMs, 1000, MAX_TIMER_MS) ?? DEFAULT_TIMER_MS);
  const remainingMs = Math.round(clampFiniteNumber(timer.remainingMs, 0, MAX_TIMER_MS) ?? durationMs);
  const endsAt = typeof timer.endsAt === 'number' && Number.isFinite(timer.endsAt) ? Math.round(timer.endsAt) : null;
  return { durationMs, endsAt: endsAt !== null && endsAt - now <= MAX_TIMER_MS + 600_000 ? endsAt : null, remainingMs };
}

/** Custom inks: valid hex colors with a time, deduplicated (lower case), oldest first, last {@link MAX_BOARD_INKS}. */
export function normalizeBoardInks(inks: unknown): BoardInk[] {
  const seen = new Set<string>();
  const result: BoardInk[] = [];
  for (const entry of Array.isArray(inks) ? inks : []) {
    const { color, at } = (typeof entry === 'object' && entry !== null ? entry : {}) as Loose;
    if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color) || typeof at !== 'number' || !Number.isFinite(at)) continue;
    const lower = color.toLowerCase() as HexColor;
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push({ color: lower, at });
  }
  return result.sort((a, b) => a.at - b.at || (a.color < b.color ? -1 : 1)).slice(-MAX_BOARD_INKS);
}

/**
 * Agent claims: one per key, an area only when its numbers are finite, ids
 * capped; sorted by key, at most {@link MAX_CLAIMS_WITH_AREA} with an area or
 * ids and {@link MAX_BARE_CLAIMS} bare ones.
 */
export function normalizeClaimedAreas(claimed: unknown): ClaimedArea[] {
  const byKey = new Map<string, ClaimedArea>();
  for (const entry of Array.isArray(claimed) ? claimed : []) {
    const fields = (typeof entry === 'object' && entry !== null ? entry : {}) as Loose;
    const key = fields.key;
    if (typeof key !== 'string' || byKey.has(key)) continue;
    const geometry = (['x', 'y', 'w', 'h'] as const).flatMap((field): [string, unknown][] => (fields[field] === undefined ? [] : [[field, fields[field]]]));
    const hasArea =
      typeof fields.x === 'number' && typeof fields.y === 'number' && geometry.every(([, value]) => typeof value === 'number' && Number.isFinite(value));
    const ids = (Array.isArray(fields.ids) ? fields.ids : [])
      .filter((id: unknown): id is string => typeof id === 'string' && ELEMENT_ID_PATTERN.test(id))
      .slice(0, MAX_CLAIM_IDS);
    byKey.set(
      key,
      ELEMENT_ID_PATTERN.test(key) ? { key, ...(hasArea ? (Object.fromEntries(geometry) as Partial<ClaimedArea>) : {}), ...(ids.length > 0 ? { ids } : {}) } : { key },
    );
  }
  let [withArea, bare] = [0, 0];
  return [...byKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .flatMap((claim) => ((Object.keys(claim).length > 1 ? ++withArea <= MAX_CLAIMS_WITH_AREA : ++bare <= MAX_BARE_CLAIMS) ? [claim] : []));
}

/** A stable id for an element that came without one (FNV-1a of its JSON). */
export function derivedElementId(element: unknown, attempt: number): ElementId {
  let hash = 2166136261;
  for (const char of `${JSON.stringify(element)}#${attempt}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `e-${hash.toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Elements                                                                   */
/* -------------------------------------------------------------------------- */

const size = (value: unknown, fallback: number): number => clampFiniteNumber(value, MIN_ELEMENT_SIZE, MAX_ELEMENT_SIZE) ?? fallback;
const coordinate = (value: unknown): number | undefined => clampFiniteNumber(value, -COORDINATE_LIMIT, COORDINATE_LIMIT);
const elementText = (value: unknown): string => clampElementText(sliceChars(value, Number.POSITIVE_INFINITY));
const fill = (value: unknown, fallback: (typeof NOTE_COLORS)[number]): FillColor => normalizePaletteColor(value, NOTE_COLORS, fallback);
const ink = (value: unknown): InkColor => normalizePaletteColor(value, INK_COLOR_NAMES, 'ink');

/** The sticker's host position, when valid. */
function normalizeStickerOn(on: unknown): { on?: StickerOn } {
  const parts: readonly unknown[] = Array.isArray(on) && (on.length === 5 || on.length === 7) ? on : [];
  const [hostId, hostX, hostY, stickerX, stickerY, offX, offY] = parts;
  const exact = (value: unknown): value is number => coordinate(value) === value;
  if (!(typeof hostId === 'string' && ELEMENT_ID_PATTERN.test(hostId) && exact(hostX) && exact(hostY) && exact(stickerX) && exact(stickerY))) return {};
  if (offX === undefined) return { on: [hostId, hostX, hostY, stickerX, stickerY] };
  return exact(offX) && exact(offY) ? { on: [hostId, hostX, hostY, stickerX, stickerY, offX, offY] } : {};
}

/** Normalizes the type-specific fields; `undefined` when the element cannot be kept. */
function normalizeElementFields(raw: unknown, takenIds: ReadonlySet<ElementId>): BoardElement | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const input = raw as Loose;
  if (typeof input.id === 'string' && !ELEMENT_ID_PATTERN.test(input.id)) return undefined;
  let id = typeof input.id === 'string' ? input.id : derivedElementId(raw, 0);
  for (let attempt = 1; takenIds.has(id); attempt++) id = derivedElementId(raw, attempt);

  if (input.type === 'arrow') {
    const from = normalizeArrowEnd(input.from);
    const to = normalizeArrowEnd(input.to);
    if (from === undefined || to === undefined || sameArrowEnd(from, to)) return undefined;
    const fromSide = normalizeArrowSide(input.fromSide);
    const toSide = normalizeArrowSide(input.toSide);
    const jog = clampFiniteNumber(input.jog, -MAX_ARROW_JOG, MAX_ARROW_JOG);
    const bends = normalizeArrowBends(input.bends);
    const heads = normalizeArrowHeadPair(input.heads);
    const label = sliceChars(input.label, MAX_LABEL_CHARS).trim();
    return {
      type: 'arrow',
      id,
      from,
      to,
      ...(fromSide !== undefined ? { fromSide } : {}),
      ...(toSide !== undefined ? { toSide } : {}),
      ...(jog !== undefined ? { jog } : {}),
      ...(bends !== undefined ? { bends } : {}),
      head: parseEnumValue(input.head, ARROW_HEAD_MODES, 'end'),
      ...(heads !== undefined ? { heads } : {}),
      dash: input.dash === true,
      color: ink(input.color),
      ...(label !== '' ? { label } : {}),
      ...pickAuthorshipFields(input),
    };
  }

  const x = coordinate(input.x);
  const y = coordinate(input.y);
  if (x === undefined || y === undefined) return undefined;

  switch (input.type) {
    case 'note': {
      const author = typeof input.author === 'string' ? truncateAuthorName(input.author) : '';
      const authorId = sliceChars(input.authorId, MAX_AUTHOR_ID_CHARS);
      return {
        type: 'note',
        id,
        x,
        y,
        w: size(input.w, 180),
        h: size(input.h, 180),
        color: fill(input.color, 'yellow'),
        ...normalizeTextStyleFields(input),
        text: elementText(input.text),
        tilt: clampFiniteNumber(input.tilt, -MAX_NOTE_TILT, MAX_NOTE_TILT) ?? 0,
        ...(author !== '' ? { author } : {}),
        ...(authorId !== '' ? { authorId } : {}),
        ...pickAuthorshipFields(input),
      };
    }
    case 'stroke': {
      if (!Array.isArray(input.points) || input.points.length < 2) return undefined;
      const points: number[] = [];
      const count = Math.min(input.points.length, MAX_STROKE_POINTS * 2) & -2;
      for (let index = 0; index < count; index++) {
        const value = coordinate(input.points[index]);
        if (value === undefined) return undefined;
        points.push(value);
      }
      if (points.length < 2) return undefined;
      return { type: 'stroke', id, x, y, points, color: ink(input.color), width: clampFiniteNumber(input.width, 1, 40) ?? 4 };
    }
    case 'shape': {
      const stroke = typeof input.stroke === 'string' ? ink(input.stroke) : undefined;
      const inkNamedAsFill = typeof input.color === 'string' && (INK_COLOR_NAMES as readonly string[]).includes(input.color);
      return {
        type: 'shape',
        id,
        kind: parseEnumValue(input.kind, SHAPE_KINDS, 'rect'),
        x,
        y,
        w: size(input.w, 240),
        h: size(input.h, 160),
        color: fill(input.color, inkNamedAsFill ? 'white' : 'green'),
        ...(stroke !== undefined ? { stroke } : {}),
        ...normalizeTextStyleFields(input),
        ...(input.hollow === true && stroke !== undefined ? { hollow: true as const } : {}),
        text: elementText(input.text),
        ...(input.solid === true ? { solid: true as const } : {}),
        ...pickAuthorshipFields(input),
      };
    }
    case 'container':
      return {
        type: 'container',
        id,
        x,
        y,
        w: size(input.w, 480),
        h: size(input.h, 320),
        color: fill(input.color, 'white'),
        text: elementText(input.text),
        ...(input.lay === 'rows' || input.lay === 'columns' ? { lay: input.lay } : {}),
        ...pickAuthorshipFields(input),
      };
    case 'text': {
      const wrap = clampFiniteNumber(input.wrap, MIN_ELEMENT_SIZE, MAX_ELEMENT_SIZE);
      const placeholder = normalizePlaceholder(input.placeholder);
      const text = elementText(input.text);
      return {
        type: 'text',
        id,
        x,
        y,
        text: placeholder !== undefined && text.trim() === '' ? '' : text,
        size: parseEnumValue(input.size, TEXT_SIZES, 'body'),
        color: ink(input.color),
        ...(wrap !== undefined ? { wrap } : {}),
        ...pickTextAlign(input),
        ...(placeholder !== undefined ? { placeholder } : {}),
        ...pickAuthorshipFields(input),
      };
    }
    case 'image': {
      const src = normalizeImageSource(input.src);
      if (src === undefined) return undefined;
      const crop = normalizeImageCrop(input.crop);
      const video = typeof input.video === 'string' && isUploadedBlobSource(input.video) ? normalizeImageSource(input.video) : undefined;
      const href = video === undefined ? normalizeHttpUrl(input.href) : undefined;
      const style = isSvgImageSource(src) && typeof input.style === 'string' && DRAWING_STYLE_PATTERN.test(input.style) ? input.style : undefined;
      return {
        type: 'image',
        id,
        x,
        y,
        w: size(input.w, 240),
        h: size(input.h, 180),
        src,
        ...(crop !== undefined ? { crop } : {}),
        ...(video !== undefined ? { video } : {}),
        ...(href !== undefined ? { href } : {}),
        ...(style !== undefined ? { style } : {}),
        ...pickBy(input),
      };
    }
    case 'sticker': {
      const art = isStickerArt(input.art) ? input.art : undefined;
      const glyph = normalizeStickerGlyph(input.glyph) ?? (art !== undefined ? (stickerGlyphForArt(art) ?? (art === FACE_STICKER_ART ? '🙂' : undefined)) : undefined);
      if (glyph === undefined) return undefined;
      const authorId = sliceChars(input.authorId, MAX_AUTHOR_ID_CHARS);
      return {
        type: 'sticker',
        id,
        x,
        y,
        w: size(input.w, DEFAULT_STICKER_SIZE),
        h: size(input.h, DEFAULT_STICKER_SIZE),
        glyph,
        ...(art !== undefined ? { art } : {}),
        ...(authorId !== '' ? { authorId } : {}),
        ...normalizeStickerOn(input.on),
      };
    }
    case 'html': {
      const state = typeof input.state === 'string' && input.state !== '' && input.state.length <= MAX_HTML_STATE_CHARS ? input.state : undefined;
      return {
        type: 'html',
        id,
        x,
        y,
        w: size(input.w, 480),
        h: size(input.h, 320),
        html: sliceChars(input.html, MAX_HTML_CHARS),
        ...(state !== undefined ? { state } : {}),
        ...pickBy(input),
      };
    }
    case 'timer':
      return { type: 'timer', id, x, y, ...normalizeTimerFields(input) };
    case 'link': {
      const link = normalizeLinkFields(input);
      return link === undefined ? undefined : { type: 'link', id, x, y, ...link };
    }
    case 'table':
      return {
        type: 'table',
        id,
        x,
        y,
        ...normalizeTable(input, clampElementText),
        head: input.head !== false,
        color: fill(input.color, 'white'),
        ...normalizeTextStyleFields(input),
        ...pickAuthorshipFields(input),
      };
    default:
      return undefined;
  }
}

/**
 * Normalizes one element: its type's fields, then the shared `turn` (only on
 * rotatable types, omitted when 0), `locked` and `groups`, in that order.
 * `takenIds` are ids already used (a missing id is derived to avoid them).
 */
export function normalizeElement(raw: unknown, takenIds: ReadonlySet<ElementId> = new Set()): BoardElement | undefined {
  const element = normalizeElementFields(raw, takenIds);
  if (element === undefined) return undefined;
  const input = raw as Loose;
  const turn = isRotatableElement(element) ? normalizeTurnDegrees(input.turn) : 0;
  const extras = {
    ...(turn !== 0 ? { turn } : {}),
    ...(input.locked === true ? { locked: true as const } : {}),
    ...normalizeElementGroups(input),
  };
  return Object.keys(extras).length === 0 ? element : { ...element, ...extras };
}

/** {@link normalizeElement} with no taken ids. */
export function tryNormalizeElement(raw: unknown): BoardElement | undefined {
  return normalizeElement(raw, new Set());
}

/**
 * Parses board content: up to {@link MAX_BOARD_ELEMENTS} elements (later
 * duplicates get derived ids), arrows whose attached ends are missing or not
 * boxes are dropped, and the timer, inks and claims are normalized.
 */
export function parseBoardContent(raw: unknown): BoardContent {
  const content = (typeof raw === 'object' && raw !== null ? raw : {}) as Loose;
  const elements: BoardElement[] = [];
  const takenIds = new Set<ElementId>();
  if (Array.isArray(content.elements)) {
    for (const rawElement of content.elements) {
      if (elements.length >= MAX_BOARD_ELEMENTS) break;
      const element = normalizeElement(rawElement, takenIds);
      if (element !== undefined) {
        takenIds.add(element.id);
        elements.push(element);
      }
    }
  }
  const boxIds = new Set(elements.filter(isBoxElement).map((element) => element.id));
  return {
    elements: elements.filter((element) => element.type !== 'arrow' || arrowEndIds(element).every((id) => boxIds.has(id))),
    ...(typeof content.timer === 'object' && content.timer !== null ? { timer: normalizeTimerFields(content.timer as Loose) } : {}),
    ...(Array.isArray(content.inks) ? { inks: normalizeBoardInks(content.inks) } : {}),
    ...(Array.isArray(content.claimed) ? { claimed: normalizeClaimedAreas(content.claimed) } : {}),
  };
}
