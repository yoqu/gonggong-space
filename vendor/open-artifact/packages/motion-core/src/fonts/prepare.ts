import { MAX_STORED_FONT_FAMILIES, parseFetchedFontsRecord, type StoredFontFamily } from '../records/fetched-fonts.ts';
import { REFACED_MODULE } from '../names.ts';
import { FONT_SLOTS, isBuiltinFontRequest, resolveBuiltinFont, type FontSlot } from './builtin.ts';
import { mergeFontRequests, parseCatalogFontRequest } from './catalog.ts';
import { collectShownCodePoints, coversLatinCharacters, hashShownFontText, type SelectedFontFace } from './coverage.ts';
import type { FontFetchResult, FontFetcher, PreparedFontFace } from './fetcher.ts';
import { filmShownText, readFilmFontSlots, readRefacedSlotValues, type FontModule } from './film-fonts.ts';
import { GOOGLE_FONT_LIMITS, type FontRequest } from './google.ts';
import { DEFAULT_FONT_WAITS, type FontWaits } from './request-cache.ts';
import { confirmedFontAxis, isUsableWoff2, woff2DataUri } from './woff2.ts';
import { FONT_NOTE_WORDS, FONT_WORDS } from './words.ts';

/** An upload's bytes, `null` when it cannot be read, `'late'` when it did not come in time. */
export type FontByteResult = ArrayBuffer | null | 'late';

/** `fetched-fonts.json` as stored, and its uploads. */
export interface StoredFontReader {
  record: string | null;
  bytes(ref: string): Promise<FontByteResult>;
}

/** A face to store: one already stored (by its upload) or one fetched now (by its bytes). */
export type FontStoreFace = SelectedFontFace & ({ ref: string; bytes?: never } | { bytes: Uint8Array; ref?: never });

export interface FontStoreFamily extends FontRequest {
  shown: string;
  faces: FontStoreFace[];
  licence?: string;
  notice?: string;
}

/**
 * What `fetched-fonts.json` should become, written over `from` (the text it was read as). `idle`: the film did not
 * ask for these, so they are written once it has loaded. `wrong`: families whose stored files differ from the fetched.
 */
export interface FontStoreUpdate {
  from: string | null;
  idle?: true;
  families: FontStoreFamily[];
  wrong: string[];
}

/** A family the film shows without: `listed` when the catalog has it, `coming` when it may yet come, `or` its stand-in. */
export interface MissingFont {
  name: string;
  listed: boolean;
  coming?: true;
  slots: FontSlot[];
  or: string | null;
}

export interface PreparedFilmFonts {
  /** The slots that ask for a Google Fonts family. */
  slots: FontSlot[];
  faces: Partial<Record<FontSlot, PreparedFontFace[]>>;
  /** For the agent: why a family is not in use. */
  notes: string[];
  /** Like notes, of families that were not asked for this load. */
  asides: string[];
  absent: MissingFont[];
  /** Each slot that asks, and the family. */
  asked: Map<FontSlot, string>;
  /** The asked slots whose family is in use. */
  of: Map<FontSlot, string>;
  /** The families that were late, resolving to those that came after all; `null` when none was late. */
  late: Promise<Set<string>> | null;
  store: FontStoreUpdate | null;
}

const EMPTY_PREPARED: PreparedFilmFonts = {
  slots: [],
  faces: {},
  notes: [],
  asides: [],
  absent: [],
  asked: new Map(),
  of: new Map(),
  late: null,
  store: null,
};

interface SlotRequest {
  slot: FontSlot;
  request: FontRequest;
}

interface StoredBudget {
  stored: StoredFontFamily;
  faces: PreparedFontFace[];
}

const facesBytes = (faces: ReadonlyArray<{ bytes: Uint8Array }>): number => faces.reduce((sum, face) => sum + face.bytes.length, 0);
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => left.length === right.length && left.every((byte, index) => byte === right[index]);

function withinMs<T>(read: Promise<T>, ms: number): Promise<T | 'late'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('late'), ms);
    read.then(
      (value) => (clearTimeout(timer), resolve(value)),
      () => (clearTimeout(timer), resolve('late')),
    );
  });
}

/** A family name simple enough to show a person, from a slot's value. */
function shownFamilyName(value: unknown): string | null {
  const name = typeof value === 'object' && value !== null ? (value as { family?: unknown }).family : value;
  return typeof name === 'string' && name.length <= 32 && /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/.test(name) ? name : null;
}

/**
 * The fonts a film is drawn with: each slot's Google Fonts family from the files stored with the film when they are
 * whole and still fit its text, else fetched; what to store; and notes on every family that is not in use.
 * `sources` are the modules whose text is shown.
 */
export async function prepareFilmFonts(
  modules: readonly FontModule[],
  sources: readonly FontModule[],
  fetcher: FontFetcher | undefined,
  storedReader: StoredFontReader,
  { fileMs, lateMs }: Pick<FontWaits, 'fileMs' | 'lateMs'> = DEFAULT_FONT_WAITS,
): Promise<PreparedFilmFonts> {
  try {
    const { other, faces: standIns } = readFilmFontSlots(modules, 'asked');
    const asking = FONT_SLOTS.filter((slot) => other[slot] !== undefined && !isBuiltinFontRequest(other[slot]));
    const asked: SlotRequest[] = asking.flatMap((slot) => {
      const request = parseCatalogFontRequest(other[slot]);
      return request === null ? [] : [{ slot, request }];
    });
    const picks = readRefacedSlotValues(modules.find((module) => module.name === REFACED_MODULE)?.text);
    const pickedFamily = (slot: FontSlot): boolean => picks[slot] !== undefined && resolveBuiltinFont(picks[slot]) === undefined;
    const sourceOf = (slot: FontSlot): string => (pickedFamily(slot) ? FONT_NOTE_WORDS.pickedSource(slot) : FONT_NOTE_WORDS.filmSource(slot));
    const fallbackOf = (slot: FontSlot): string =>
      standIns[slot] !== undefined ? FONT_NOTE_WORDS.fallsBackToStandIn : slot === 'display' ? FONT_NOTE_WORDS.fallsBackToSans : FONT_NOTE_WORDS.fallsBackToSystem;
    const unlisted = asking.filter((slot) => !asked.some((entry) => entry.slot === slot));
    const unlistedNotes = unlisted
      .filter((slot) => standIns[slot] !== undefined)
      .map((slot) => sourceOf(slot) + FONT_NOTE_WORDS.notListed(pickedFamily(slot)) + fallbackOf(slot));
    const unlistedAbsent =
      fetcher === undefined
        ? []
        : unlisted.flatMap((slot) => {
            const name = shownFamilyName(other[slot]);
            return name === null ? [] : [{ name, listed: false, slot }];
          });
    const lateWaits = new Map<string, Array<Promise<boolean>>>();
    const absentOf = (entries: ReadonlyArray<{ name: string; listed: boolean; slot: FontSlot }>): MissingFont[] =>
      [...new Set(entries.map((entry) => entry.name))].map((name) => {
        const ofName = entries.filter((entry) => entry.name === name);
        const slots = ofName.map((entry) => entry.slot);
        const standInNames = new Set(slots.map((slot) => standIns[slot]?.name ?? null));
        return {
          name,
          listed: ofName[0]!.listed,
          ...(lateWaits.has(name) ? { coming: true as const } : {}),
          slots,
          or: standInNames.size === 1 ? [...standInNames][0]! : null,
        };
      });
    if (asked.length === 0) return { ...EMPTY_PREPARED, notes: unlistedNotes, absent: absentOf(unlistedAbsent), asked: new Map(), of: new Map() };

    const wanted = mergeFontRequests(asked.map((entry) => entry.request)).slice(0, MAX_STORED_FONT_FAMILIES);
    let shownPoints: number[] | undefined;
    const points = (): number[] => (shownPoints ??= collectShownCodePoints(filmShownText(sources)));
    const storedFamilies = parseFetchedFontsRecord(storedReader.record, parseCatalogFontRequest).families;
    const lateStored = new Set<string>();
    const budgets: Array<StoredBudget | null> = await Promise.all(
      wanted.map(async (request) => {
        const match = storedFamilies.find((family) => family.family === request.family);
        const reads = match === undefined ? [] : match.faces.map((face) => storedReader.bytes(face.ref));
        const results = await Promise.all(reads.map((read) => withinMs(read, fileMs)));
        if (results.includes('late')) lateStored.add(request.family);
        if (results.includes('late') && lateMs > fileMs)
          lateWaits.set(request.family, [
            Promise.all(reads).then(
              (all) => all.every((bytes) => bytes !== null && bytes !== 'late'),
              () => false,
            ),
          ]);
        const files = results.map((result) => (result === null || result === 'late' ? null : new Uint8Array(result)));
        if (match === undefined || !files.every((bytes): bytes is Uint8Array<ArrayBuffer> => bytes !== null && isUsableWoff2(bytes))) return null;
        const axes = match.faces.map((face, index) => confirmedFontAxis(face.axis, files[index]!));
        return {
          stored: match,
          faces: match.faces.map(({ ref: _ref, axis: _axis, ...face }, index) => ({
            ...face,
            ...(axes.every((axis) => axis !== undefined) ? { axis: axes[index]! } : {}),
            bytes: files[index]!,
            data: woff2DataUri(files[index]!),
          })),
        };
      }),
    );
    const storedFresh =
      wanted.every((request, index) => {
        const budget = budgets[index];
        return budget != null && budget.stored.weights.join() === request.weights.join() && budget.stored.shown === hashShownFontText(points());
      }) && budgets.reduce((sum, budget) => sum + facesBytes(budget?.faces ?? []), 0) <= GOOGLE_FONT_LIMITS.filmBytes;
    const existing = new Map<string, [number, number]>(
      wanted.flatMap((request, index) => {
        const budget = budgets[index];
        return budget != null && (storedFresh || coversLatinCharacters(budget.faces, points()))
          ? [[request.family, [budget.faces.length, facesBytes(budget.faces)]] as [string, [number, number]]]
          : [];
      }),
    );
    const toFetch = storedFresh ? [] : wanted;
    const fetchedList: FontFetchResult[] =
      toFetch.length === 0 || fetcher === undefined ? [] : await Promise.resolve().then(() => fetcher(toFetch, points, existing)).catch(() => []);
    const fetched = new Map(fetchedList.map((result) => [result.family, result] as const));
    for (const result of fetched.values())
      if (result.faces !== null) lateWaits.delete(result.family);
      else if (result.coming !== undefined) lateWaits.set(result.family, [...(lateWaits.get(result.family) ?? []), result.coming]);

    let [filesLeft, bytesLeft] = [...fetched.values()].reduce(
      ([files, bytes], result) => [files - (result.faces?.length ?? 0), bytes - facesBytes(result.faces ?? [])],
      [GOOGLE_FONT_LIMITS.files as number, GOOGLE_FONT_LIMITS.filmBytes as number],
    );
    const finalFailure = (result: FontFetchResult | undefined): boolean => result !== undefined && result.faces === null && result.final === true;
    const chosen = new Map<string, PreparedFontFace[] | null>(
      wanted.map((request, index) => {
        const [result, budget] = [fetched.get(request.family), budgets[index]];
        if (result?.faces != null) return [request.family, result.faces];
        if (
          budget == null ||
          finalFailure(result) ||
          (!storedFresh && !coversLatinCharacters(budget.faces, points())) ||
          budget.faces.length > filesLeft ||
          facesBytes(budget.faces) > bytesLeft
        )
          return [request.family, null];
        [filesLeft, bytesLeft] = [filesLeft - budget.faces.length, bytesLeft - facesBytes(budget.faces)];
        return [request.family, budget.faces];
      }),
    );

    const storedFiles = budgets.flatMap((budget) => budget?.faces.map((face, index) => ({ bytes: face.bytes, ref: budget.stored.faces[index]!.ref })) ?? []);
    const fetchedNow = (family: string): PreparedFontFace[] | null => (lateStored.has(family) ? null : (fetched.get(family)?.faces ?? null));
    let storeFilesLeft = GOOGLE_FONT_LIMITS.files - wanted.reduce((sum, request) => sum + (fetchedNow(request.family)?.length ?? 0), 0);
    const storeFamilies: FontStoreFamily[] = wanted.flatMap((request, index): FontStoreFamily[] => {
      const [result, storedFamily] = [fetched.get(request.family), storedFamilies.find((family) => family.family === request.family)];
      if (result?.faces != null && fetchedNow(request.family) !== null)
        return [
          {
            ...request,
            shown: hashShownFontText(points()),
            faces: result.faces.map(({ url, weight, range, sample, axis, bytes }): FontStoreFace => {
              const stored = storedFiles.find((file) => sameBytes(file.bytes, bytes));
              const face = { url, weight, range, sample, ...(axis !== undefined ? { axis } : {}) };
              return stored === undefined ? { ...face, bytes } : { ...face, ref: stored.ref };
            }),
          },
        ];
      if (
        storedFamily === undefined ||
        finalFailure(result) ||
        storedFamily.faces.length > storeFilesLeft ||
        (budgets[index] != null && chosen.get(request.family) == null)
      )
        return [];
      storeFilesLeft -= storedFamily.faces.length;
      return [storedFamily];
    });
    const filmOther = readFilmFontSlots(modules, 'film').other;
    const kept = storedFamilies
      .filter(
        (family) =>
          !wanted.some((request) => request.family === family.family) &&
          FONT_SLOTS.some((slot) => !isBuiltinFontRequest(filmOther[slot]) && parseCatalogFontRequest(filmOther[slot])?.family === family.family),
      )
      .slice(0, Math.max(0, MAX_STORED_FONT_FAMILIES - storeFamilies.length))
      .filter((family) => {
        if (family.faces.length > storeFilesLeft) return false;
        storeFilesLeft -= family.faces.length;
        return true;
      });
    storeFamilies.push(...kept);

    const missing = asked.filter(({ request }) => chosen.get(request.family) == null);
    const unasked = (family: string): boolean => {
      const result = fetched.get(family);
      return result !== undefined && result.faces === null && result.unasked === true;
    };
    const isStored = (family: string): boolean => storedFamilies.some((stored) => stored.family === family);
    const isAside = ({ slot, request }: SlotRequest): boolean => unasked(request.family) && standIns[slot] !== undefined && !isStored(request.family);
    const whyNot = (family: string): string => {
      const result = fetched.get(family);
      if (result !== undefined && result.faces === null && result.final === true) return result.why;
      if (isStored(family)) return FONT_WORDS.storedUnusable;
      if (result !== undefined && result.faces === null) return result.why;
      return fetcher === undefined ? FONT_WORDS.fetchDisabled : FONT_WORDS.playerFailure;
    };
    const noteOf = ({ slot, request }: SlotRequest): string =>
      sourceOf(slot) +
      FONT_NOTE_WORDS.notInUse(request.family) +
      whyNot(request.family) +
      '.' +
      fallbackOf(slot) +
      (unasked(request.family) && standIns[slot] === undefined ? FONT_NOTE_WORDS.nameStandIn(request.family) : '');
    const askedFamilies = new Map(asked.map(({ slot, request }) => [slot, request.family] as const));
    const storeChanged = [...fetched.values()].some((result) => result.faces !== null || (finalFailure(result) && isStored(result.family)));
    return {
      slots: asked.map((entry) => entry.slot),
      faces: Object.fromEntries(
        asked.flatMap(({ slot, request }) => {
          const faces = chosen.get(request.family);
          return faces == null ? [] : [[slot, faces] as const];
        }),
      ),
      notes: [...unlistedNotes, ...missing.filter((entry) => !isAside(entry)).map(noteOf)],
      asides: missing.filter(isAside).map(noteOf),
      absent: absentOf([
        ...unlistedAbsent,
        ...missing
          .filter(({ request }) => fetcher !== undefined && !unasked(request.family))
          .map(({ slot, request }) => ({ name: request.family, listed: true, slot })),
      ]),
      asked: askedFamilies,
      of: new Map([...askedFamilies].filter(([, family]) => chosen.get(family) != null)),
      late:
        lateWaits.size === 0
          ? null
          : Promise.all([...lateWaits].map(async ([family, waits]) => ((await Promise.all(waits)).some(Boolean) ? [family] : []))).then(
              (families) => new Set(families.flat()),
            ),
      store: storeChanged
        ? {
            from: storedReader.record,
            families: storeFamilies,
            wrong: wanted.flatMap((request, index) => {
              const [result, budget] = [fetched.get(request.family), budgets[index]];
              return result?.faces != null && budget != null && !budget.faces.every((face) => result.faces!.some((other) => sameBytes(face.bytes, other.bytes)))
                ? [request.family]
                : [];
            }),
          }
        : fetcher !== undefined && storedFresh && storedFamilies.length > 0
          ? { from: storedReader.record, idle: true, families: storedFamilies, wrong: [] }
          : null,
    };
  } catch {
    return { ...EMPTY_PREPARED, asked: new Map(), of: new Map() };
  }
}
