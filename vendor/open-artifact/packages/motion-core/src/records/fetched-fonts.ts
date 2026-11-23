import {
  ALLOWED_FONT_LICENCES,
  GOOGLE_FONT_FILE_URL_PATTERN,
  GOOGLE_FONT_LIMITS,
  MAX_FONT_NOTICE_CHARS,
  formatUnicodeRanges,
  parseFontRequest,
  parseUnicodeRanges,
  type FontLicence,
  type FontRequest,
} from '../fonts/google.ts';
import { isPlainObject } from '../json.ts';
import { FILM_SCHEMA_VERSION } from '../limits.ts';
import { BLOB_REFERENCE_PATTERN } from '../names.ts';
import { readVersionOneRecord, recordAbout, type SerializeRecordOptions } from './common.ts';

/** One font file fetched from Google Fonts and stored with the film as an upload. */
export interface StoredFontFace {
  url: string;
  /** Its weight range, `"400 700"`. */
  weight: string;
  /** Its unicode-range, `''` for all. */
  range: string;
  /** One character it shows, to test it with. */
  sample: string;
  /** The weights of a variable file, `"100 900"`. */
  axis?: string;
  /** The upload: `_blob/<id>`. */
  ref: string;
}

export interface StoredFontFamily extends FontRequest {
  /** A hash of the text the film showed when the files were picked. */
  shown: string;
  faces: StoredFontFace[];
  licence?: FontLicence;
  notice?: string;
}

export interface FetchedFontsRecord {
  about?: string;
  families: StoredFontFamily[];
}

export const EMPTY_FETCHED_FONTS_RECORD: FetchedFontsRecord = { families: [] };
export const MAX_STORED_FONT_FAMILIES = 4;

export const FETCHED_FONTS_ABOUT =
  'The film’s page writes this file; leave it as it is. It lists the font files that the page fetched from Google Fonts for the families named under "fonts" in modules/scenes.json, and stored with the film so that every viewer gets them. To change a typeface, change "fonts" there: the page updates this file by itself.';

const VISIBLE_CHARACTER_PATTERN = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Z}]$/u;

export function parseStoredFontFace(value: unknown): StoredFontFace | null {
  if (!isPlainObject(value)) return null;
  const { url, weight, range, sample, ref, axis } = value;
  if (typeof weight !== 'string' || !/^[1-9][0-9]{0,3} [1-9][0-9]{0,3}$/.test(weight)) return null;
  const [low, high] = weight.split(' ').map(Number) as [number, number];
  const ranges = typeof range !== 'string' ? null : range === '' ? [] : parseUnicodeRanges(range);
  if (
    typeof url !== 'string' ||
    !GOOGLE_FONT_FILE_URL_PATTERN.test(url) ||
    low > high ||
    high > 1000 ||
    ranges === null ||
    typeof sample !== 'string' ||
    !VISIBLE_CHARACTER_PATTERN.test(sample) ||
    typeof ref !== 'string' ||
    !BLOB_REFERENCE_PATTERN.test(ref)
  )
    return null;
  return {
    url,
    weight,
    range: formatUnicodeRanges(ranges),
    sample,
    ...(typeof axis === 'string' && /^[1-9]00 [1-9]00$/.test(axis) ? { axis } : {}),
    ref,
  };
}

/** The families `fetched-fonts.json` stores: at most four, twelve files in all, each family once. */
export function parseFetchedFontsRecord(input: unknown, parseRequest: (value: unknown) => FontRequest | null = parseFontRequest): FetchedFontsRecord {
  const record = readVersionOneRecord(input, 'families');
  if (record === null) return { families: [] };
  let filesLeft: number = GOOGLE_FONT_LIMITS.files;
  const seen = new Set<string>();
  const families: StoredFontFamily[] = [];
  for (const item of (record.families as unknown[]).slice(0, MAX_STORED_FONT_FAMILIES)) {
    if (!isPlainObject(item)) continue;
    const request = parseRequest(item);
    if (request === null || request.family !== item.family || seen.has(request.family)) continue;
    if (typeof item.shown !== 'string' || !/^[0-9a-f]{8}$/.test(item.shown) || !Array.isArray(item.faces)) continue;
    const faces = item.faces.slice(0, filesLeft + 1).map(parseStoredFontFace);
    if (faces.length === 0 || faces.length > filesLeft || !faces.every((face): face is StoredFontFace => face !== null)) continue;
    filesLeft -= faces.length;
    seen.add(request.family);
    const licence = ALLOWED_FONT_LICENCES.find((allowed) => allowed === item.licence);
    const notice = licence !== undefined && typeof item.notice === 'string' && item.notice !== '' && item.notice.length <= MAX_FONT_NOTICE_CHARS ? item.notice : undefined;
    families.push({ ...request, shown: item.shown, ...(licence !== undefined && notice !== undefined ? { licence, notice } : {}), faces });
  }
  const about = recordAbout(record);
  return { ...(about !== undefined ? { about } : {}), families };
}

/** `fetched-fonts.json`'s text. The page keeps the module even with no family, so this never gives `null`. */
export function serializeFetchedFontsRecord(record: FetchedFontsRecord, options: SerializeRecordOptions = {}): string {
  return JSON.stringify({ v: FILM_SCHEMA_VERSION, ...(options.about === false ? {} : { about: FETCHED_FONTS_ABOUT }), families: record.families });
}
