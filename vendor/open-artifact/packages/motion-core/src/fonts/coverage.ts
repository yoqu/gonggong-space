import type { GoogleFontFace } from './css2.ts';
import { GOOGLE_FONT_LIMITS, formatUnicodeRanges, parseUnicodeRanges, type FontRequest } from './google.ts';
import { FONT_WORDS } from './words.ts';

/** A face picked for a film: its file, the weights it is declared for, its characters and one it shows. */
export interface SelectedFontFace {
  url: string;
  /** The weight range it is declared for, `"450 549"`. */
  weight: string;
  /** Its unicode-range, `''` for all. */
  range: string;
  sample: string;
  /** The weights one variable file covers, `"100 900"`. */
  axis?: string;
}

/** The letters a Latin family must have when the film shows them. */
export const LATIN_CHARACTER_PATTERN = /[A-Za-zÀ-ÖØ-öø-ɏḀ-ỿ]/;

const SCAN_CHUNK = 16_384;

/**
 * The characters a film shows, as code points, at most one past the limit (so that "too many" can be told): marks
 * past eight on one letter, spaces, controls and variation selectors left out, the rest in NFC.
 */
export function collectShownCodePoints(text: string): number[] {
  const characters = new Set<string>();
  const end = Math.min(text.length, GOOGLE_FONT_LIMITS.shownChars);
  for (let start = 0, stop = 0; start < end && characters.size <= GOOGLE_FONT_LIMITS.points; start = stop) {
    // A chunk ends past any low surrogate or mark that its last character carries.
    for (stop = start + SCAN_CHUNK; stop < start + SCAN_CHUNK + 16 && /^[\udc00-\udfff\p{M}]/u.test(text.slice(stop, stop + 2)); stop++);
    const chunk = text
      .slice(start, stop)
      .replace(/(\p{M}{8})\p{M}+/gu, '$1')
      .normalize('NFC')
      .replace(/[\s\p{Cc}\p{Cf}\p{Cs}\p{Co}⃣︀-️]/gu, '');
    for (const character of chunk) characters.add(character);
  }
  return [...characters].slice(0, GOOGLE_FONT_LIMITS.points + 1).map((character) => character.codePointAt(0)!);
}

export const fontFaceCoversCodePoint = (face: Pick<GoogleFontFace, 'ranges'>, point: number): boolean =>
  face.ranges.length === 0 || face.ranges.some(([from, to]) => point >= from && point <= to);

/** True when the faces hold every Latin letter among the points. */
export function coversLatinCharacters(faces: ReadonlyArray<Pick<SelectedFontFace, 'range'>>, points: readonly number[]): boolean {
  const ranges = faces.map((face) => parseUnicodeRanges(face.range === '' ? 'U+0-10FFFF' : face.range) ?? []).filter((list) => list.length > 0);
  return points.every(
    (point) => !LATIN_CHARACTER_PATTERN.test(String.fromCodePoint(point)) || ranges.some((list) => fontFaceCoversCodePoint({ ranges: list }, point)),
  );
}

const nearest = (values: readonly number[], target: number): number =>
  values.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best));

/**
 * The fewest faces of a stylesheet that show the film at the weights asked (each matched to the nearest the family
 * has), with no more files than `filesLeft`; else why the family cannot be used.
 */
export function selectFontFaces(
  faces: readonly GoogleFontFace[],
  { weights }: Pick<FontRequest, 'weights'>,
  points: readonly number[],
  filesLeft: number,
): SelectedFontFace[] | string {
  const available = [...new Set(faces.map((face) => face.weight))].sort((a, b) => a - b);
  if (available.length === 0) return FONT_WORDS.stylesheetUnusable;
  if (points.length > GOOGLE_FONT_LIMITS.points) return FONT_WORDS.tooManyCharacters(GOOGLE_FONT_LIMITS.points);
  const picked = new Map<string, { face: GoogleFontFace; sample: number }>();
  for (const weight of new Set(weights.map((asked) => nearest(available, asked)))) {
    const ofWeight = faces.filter((face) => face.weight === weight);
    // "A" comes first, so that each weight takes its Latin face even where the film shows no Latin letter.
    for (const [index, point] of [65, ...points].entries()) {
      const face =
        ofWeight.find((candidate) => picked.has(candidate.url) && fontFaceCoversCodePoint(candidate, point)) ??
        ofWeight.find((candidate) => fontFaceCoversCodePoint(candidate, point));
      if (face === undefined && index > 0 && LATIN_CHARACTER_PATTERN.test(String.fromCodePoint(point)))
        return FONT_WORDS.lacksCharacter(String.fromCodePoint(point));
      if (face !== undefined && !picked.has(face.url)) picked.set(face.url, { face, sample: point });
      if (picked.size > filesLeft) return FONT_WORDS.overFileRoom(GOOGLE_FONT_LIMITS.files);
    }
  }
  if (picked.size === 0) return FONT_WORDS.nothingShown;
  const usedWeights = [...new Set([...picked.values()].map(({ face }) => face.weight))];
  const weightsOfFile = (url: string): number[] => [...new Set(faces.filter((face) => face.url === url).map((face) => face.weight))].sort((a, b) => a - b);
  const fileWeights = [...picked.keys()].map(weightsOfFile);
  const variable = usedWeights.length === 1 && fileWeights.every((list) => list.length > 1 && list.join() === fileWeights[0]!.join());
  const boundary = (index: number): number =>
    index <= 0 ? 1 : index >= usedWeights.length ? 1001 : (usedWeights[index - 1]! + usedWeights[index]!) / 2;
  return [...picked.values()].map(({ face, sample }) => {
    const index = usedWeights.indexOf(face.weight);
    const own = weightsOfFile(face.url);
    return {
      url: face.url,
      weight: `${boundary(index)} ${boundary(index + 1) - 1}`,
      range: formatUnicodeRanges(face.ranges),
      sample: String.fromCodePoint(sample),
      ...(variable ? { axis: `${own[0]} ${own[own.length - 1]}` } : {}),
    };
  });
}

/** A short hash of the characters a film shows, stored with its fetched files to tell when the text has changed. */
export function hashShownFontText(points: Iterable<number>): string {
  const text = [...points].sort((a, b) => a - b).join();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
