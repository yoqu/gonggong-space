import { selectFontFaces, type SelectedFontFace } from './coverage.ts';
import {
  GOOGLE_FONT_PREVIEW_FILE_BYTES,
  GOOGLE_FONT_PREVIEW_SHEET_BYTES,
  googleFontPreviewUrl,
  googleFontStylesheetUrl,
  parseGoogleFontPreviewSheet,
  parseGoogleFontStylesheet,
  type GoogleFontFace,
} from './css2.ts';
import { GOOGLE_FONT_LIMITS, type FontRequest } from './google.ts';
import {
  DEFAULT_FONT_FETCH_IO,
  DEFAULT_FONT_WAITS,
  createFontRequestCache,
  fetchLimitedBytes,
  type FontFetchCause,
  type FontFetchIo,
  type FontWaits,
  type LateWait,
} from './request-cache.ts';
import { confirmedFontAxis, isUsableWoff2, woff2DataUri } from './woff2.ts';
import { FONT_WORDS } from './words.ts';

/** A picked face with its file: the bytes, and the same as a data: URI for the stage. */
export interface PreparedFontFace extends SelectedFontFace {
  bytes: Uint8Array;
  data: string;
}

/**
 * What came of one family: its faces, or why there are none. `final`: asking again would give the same;
 * `coming`: it was late, and resolves true once it came after all.
 */
export type FontFetchResult =
  | { family: string; faces: PreparedFontFace[] }
  | { family: string; faces: null; why: string; final?: true; cause?: FontFetchCause; unasked?: true; coming?: Promise<boolean> };

/**
 * Fetches families for a film: the requests, the film's shown code points (read only if something came), and the
 * files and bytes already given to families stored with the film and not asked again.
 */
export type FontFetcher = (
  requests: readonly FontRequest[],
  readCodePoints: () => readonly number[],
  existing?: ReadonlyMap<string, readonly [number, number]>,
) => Promise<FontFetchResult[]>;

/** A sheet that fails sooner than this is asked again at once for just the weights wanted. */
export const FONT_FETCH_GRACE_MS = 500;

type LateNote = (family: string, cause?: FontFetchCause) => void;

const facesBytes = (faces: ReadonlyArray<{ bytes: Uint8Array }>): number => faces.reduce((sum, face) => sum + face.bytes.length, 0);

/** The fetcher the page uses; each one keeps its own cache of sheets and files. */
export function createGoogleFontFetcher(io: FontFetchIo = DEFAULT_FONT_FETCH_IO, { sheetMs, fileMs, lateMs }: FontWaits = DEFAULT_FONT_WAITS): FontFetcher {
  const sheets = createFontRequestCache<GoogleFontFace[]>(io);
  const files = createFontRequestCache<{ bytes: Uint8Array; data: string }>(io);
  const failedSheets = new Map<string, 'quick' | 'slow'>();
  const weightedOnly = new Set<string>();
  const causes = new Map<string, FontFetchCause>();
  const noteCause =
    (family: string) =>
    (cause: FontFetchCause): void => {
      if (!causes.has(family)) causes.set(family, cause);
    };

  const fetchSheet = async ({ family, weights }: FontRequest, onLate?: LateNote): Promise<GoogleFontFace[] | null> => {
    const startedAt = io.now();
    let wentLate = false;
    const lateAfter = (ms: number, cause?: FontFetchCause): LateWait | undefined =>
      onLate !== undefined && lateMs > sheetMs
        ? {
            ms,
            late: () => {
              wentLate = true;
              onLate(family, cause);
            },
          }
        : undefined;
    const readSheet = async (url: string, onTimeout?: () => void): Promise<GoogleFontFace[] | null> => {
      causes.delete(family);
      const bytes = await fetchLimitedBytes(io, url, Math.max(sheetMs, lateMs), GOOGLE_FONT_LIMITS.sheetChars, (cause) => {
        if (cause === 'timeout') onTimeout?.();
        noteCause(family)(cause);
      });
      const faces = bytes === null ? [] : parseGoogleFontStylesheet(new TextDecoder().decode(bytes), family);
      if (faces.length > 0) return faces;
      noteCause(family)('invalid_content');
      return null;
    };
    const faces = await sheets(
      family,
      async () => {
        let timedOut = false;
        const read = await readSheet(googleFontStylesheetUrl(family), () => (timedOut = true));
        if (read === null && !timedOut) failedSheets.set(family, io.now() - startedAt < FONT_FETCH_GRACE_MS ? 'quick' : 'slow');
        else failedSheets.delete(family);
        return read;
      },
      lateAfter(sheetMs),
    );
    const failed = failedSheets.get(family);
    const quick = failed === 'quick' && !wentLate;
    // A family that does not have every weight fails the whole-range sheet: ask for just the weights wanted.
    if (faces !== null || (lateMs > sheetMs ? failed === undefined && !weightedOnly.has(family) : !quick)) return faces;
    const weighted = await sheets(
      `${family}:${weights.join()}`,
      () => readSheet(googleFontStylesheetUrl(family, weights)),
      quick ? lateAfter(sheetMs) : lateAfter(0, causes.get(family)),
    );
    if (weighted !== null) weightedOnly.add(family);
    return weighted;
  };

  const fetchFile = (family: string, face: SelectedFontFace, onLate?: LateNote): Promise<{ bytes: Uint8Array; data: string } | null> =>
    files(
      face.url,
      async () => {
        const bytes = await fetchLimitedBytes(io, face.url, Math.max(fileMs, lateMs), GOOGLE_FONT_LIMITS.fileBytes, noteCause(family));
        if (bytes !== null && isUsableWoff2(bytes)) return { bytes, data: woff2DataUri(bytes) };
        noteCause(family)('invalid_content');
        return null;
      },
      onLate !== undefined && lateMs > fileMs ? { ms: fileMs, late: () => onLate(family) } : undefined,
    );

  const fetchFamilies = async (
    requests: readonly FontRequest[],
    readCodePoints: () => readonly number[],
    existing: ReadonlyMap<string, readonly [number, number]>,
    onLate?: LateNote,
  ): Promise<FontFetchResult[]> => {
    try {
      const stylesheets = await Promise.all(requests.map((request) => fetchSheet(request, onLate)));
      const [storedFiles, storedBytes] = [...existing]
        .filter(([family]) => !requests.some((request) => request.family === family))
        .reduce(([count, bytes], [, [moreCount, moreBytes]]) => [count + moreCount, bytes + moreBytes], [0, 0]);
      let filesLeft = GOOGLE_FONT_LIMITS.files - storedFiles;
      const points = stylesheets.some((sheet) => sheet !== null) ? readCodePoints() : [];
      const selections = stylesheets.map((sheet, index) => {
        const selected = sheet === null ? FONT_WORDS.unavailable : selectFontFaces(sheet, requests[index]!, points, filesLeft);
        if (typeof selected !== 'string') filesLeft -= selected.length;
        return selected;
      });
      const fetched = await Promise.all(
        selections.map((selected, index) =>
          typeof selected === 'string' ? null : Promise.all(selected.map((face) => fetchFile(requests[index]!.family, face, onLate))),
        ),
      );
      let filmBytes = storedBytes;
      return selections.map((selected, index): FontFetchResult => {
        const family = requests[index]!.family;
        const cause = causes.get(family) ?? 'internal';
        if (typeof selected === 'string')
          return selected === FONT_WORDS.unavailable ? { family, faces: null, why: selected, cause } : { family, faces: null, why: selected, final: true };
        const got = fetched[index];
        if (got == null || got.some((file) => file === null)) return { family, faces: null, why: FONT_WORDS.unavailable, cause };
        const gotFiles = got.filter((file): file is { bytes: Uint8Array; data: string } => file !== null);
        const bytes = facesBytes(gotFiles);
        if (filmBytes + bytes > GOOGLE_FONT_LIMITS.filmBytes)
          return { family, faces: null, why: FONT_WORDS.overFilmBytes(filmBytes > 0, GOOGLE_FONT_LIMITS.filmBytes / 1024), final: true };
        filmBytes += bytes;
        const axes = selected.map((face, fileIndex) => confirmedFontAxis(face.axis, gotFiles[fileIndex]!.bytes));
        return {
          family,
          faces: selected.map(({ axis: _axis, ...face }, fileIndex) => ({
            ...face,
            ...gotFiles[fileIndex]!,
            ...(axes.every((axis) => axis !== undefined) ? { axis: axes[fileIndex]! } : {}),
          })),
        };
      });
    } catch {
      return requests.map(({ family }) => ({ family, faces: null, why: FONT_WORDS.playerFailure, cause: 'internal' }));
    }
  };

  return async (requests, readCodePoints, existing = new Map()) => {
    const lateFamilies = new Set<string>();
    const firstTry = await fetchFamilies(requests, readCodePoints, existing, (family, cause = 'timeout') => {
      noteCause(family)(cause);
      lateFamilies.add(family);
    });
    if (lateFamilies.size === 0) return firstTry;
    // The same requests again, without a deadline: they share the running requests, so this costs nothing more.
    const whole = fetchFamilies(requests, readCodePoints, existing);
    return firstTry.map((result, index) =>
      result.faces === null && lateFamilies.has(result.family)
        ? { ...result, why: FONT_WORDS.late, coming: whole.then((results) => results[index]?.faces != null) }
        : result,
    );
  };
}

/** A family's name drawn in its own face, for the Font panel: files that hold just its letters. */
export interface GoogleFontPreview {
  family: string;
  bytes: Uint8Array;
}

/** Preview files of the families, those that came and are usable. */
export async function fetchGoogleFontPreviews(families: readonly string[], io: FontFetchIo = DEFAULT_FONT_FETCH_IO): Promise<GoogleFontPreview[]> {
  const sheet = await fetchLimitedBytes(io, googleFontPreviewUrl(families), DEFAULT_FONT_WAITS.sheetMs, GOOGLE_FONT_PREVIEW_SHEET_BYTES);
  const urls = sheet === null ? new Map<string, string>() : parseGoogleFontPreviewSheet(new TextDecoder().decode(sheet));
  const files = await Promise.all(
    families.map((family) => {
      const url = urls.get(family);
      return url === undefined ? null : fetchLimitedBytes(io, url, DEFAULT_FONT_WAITS.fileMs, GOOGLE_FONT_PREVIEW_FILE_BYTES);
    }),
  );
  return families.flatMap((family, index) => {
    const bytes = files[index];
    return bytes != null && isUsableWoff2(bytes) ? [{ family, bytes }] : [];
  });
}
