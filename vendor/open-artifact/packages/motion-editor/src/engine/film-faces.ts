/**
 * The typefaces the stage declares for a film: a person's picks (`refaced.json`), the Google Fonts families the film
 * or a person asks for (stored in `fetched-fonts.json`, else fetched), and the film's own built-in names.
 */

import {
  CUT_SOURCE_NAME,
  FETCHED_FONTS_MODULE,
  FONT_SLOTS,
  buildFilmFaces,
  builtinFontsCoverText,
  isBuiltinFontRequest,
  prepareFilmFonts,
  readFilmFontSlots,
  usableFontFaces,
  type FilmFaces,
  type FontByteResult,
  type FontFetcher,
  type FontModule,
  type FontStoreUpdate,
  type PreparedFilmFonts,
  type RenderFontFace,
} from '@open-artifact/motion-core';
import type { StageFace, StageFaces } from '@open-artifact/motion-stage';

/** What the engine needs to put typefaces on a film; the page supplies it (`host/fonts.ts`). */
export interface FilmFontsIo {
  /** A built-in font file as a `data:font/woff2` URI, or `null` when it cannot be had. */
  builtin(file: string): Promise<string | null>;
  /** Fetches Google Fonts families, or `undefined` where the page cannot reach them. */
  fetcher(): FontFetcher | undefined;
  /** A stored font upload's bytes. */
  stored(ref: string): Promise<FontByteResult>;
  /** Called with what `fetched-fonts.json` should become; the page stores it when it may. */
  store?(update: FontStoreUpdate, modules: readonly FontModule[]): void;
}

export interface FilmFacesResult {
  faces: StageFaces | null;
  prepared: PreparedFilmFonts | null;
  warnings: string[];
  infos: string[];
}

/** True when the film asks for a family that is not built in, or has fetched families stored. */
export function asksForFetchedFonts(modules: readonly FontModule[]): boolean {
  if (modules.some((module) => module.name === FETCHED_FONTS_MODULE)) return true;
  const { other } = readFilmFontSlots(modules, 'asked');
  return FONT_SLOTS.some((slot) => other[slot] !== undefined && !isBuiltinFontRequest(other[slot]));
}

export function toStageFace(face: RenderFontFace): StageFace {
  return {
    family: face.family,
    url: face.url,
    weight: face.weight,
    style: face.style,
    ...(face.range !== undefined ? { range: face.range } : {}),
    ...(face.sample !== undefined ? { sample: face.sample } : {}),
    ...(face.box !== undefined ? { box: [face.box[0], face.box[1]] } : {}),
  };
}

/**
 * The faces from {@link buildFilmFaces}, without a person's built-in picks when the built-in typefaces lack a letter
 * the film shows. `urlOf` gives each built-in file's URI.
 */
export function chooseFilmFaces(
  script: string,
  modules: readonly FontModule[],
  prepared: PreparedFilmFonts | null,
  urlOf: (file: string) => string,
): { faces: FilmFaces | null; lacks: boolean } {
  const requested = prepared?.faces ?? {};
  const faces = buildFilmFaces(modules, urlOf, requested);
  if (faces === null || faces.shipped === null) return { faces, lacks: false };
  if (builtinFontsCoverText([{ name: CUT_SOURCE_NAME, kind: 'js', text: script }, ...modules])) return { faces, lacks: false };
  return { faces: buildFilmFaces(modules, urlOf, requested, false), lacks: true };
}

/** Prepares fetched families, loads the built-in files the faces use, and gives the stage its faces. */
export async function filmStageFaces(script: string, modules: readonly FontModule[], io: FilmFontsIo): Promise<FilmFacesResult> {
  const warnings: string[] = [];
  let prepared: PreparedFilmFonts | null = null;
  if (asksForFetchedFonts(modules)) {
    const record = modules.find((module) => module.name === FETCHED_FONTS_MODULE)?.text ?? null;
    try {
      prepared = await prepareFilmFonts(modules, [{ name: CUT_SOURCE_NAME, kind: 'js', text: script }, ...modules], io.fetcher(), {
        record,
        bytes: (ref) => io.stored(ref),
      });
    } catch {
      warnings.push('The film’s Google Fonts families could not be prepared, so it shows in its stand-in typefaces.');
    }
  }
  if (prepared !== null) warnings.push(...prepared.notes);
  if (prepared?.store != null) io.store?.(prepared.store, modules);
  const files = new Set<string>();
  try {
    chooseFilmFaces(script, modules, prepared, (file) => (files.add(file), ''));
  } catch {
    return { faces: null, prepared, warnings: [...warnings, 'The typefaces could not be put on, so the film is in the system’s fonts.'], infos: prepared?.asides ?? [] };
  }
  const uris = new Map<string, string>();
  await Promise.all(
    [...files].map(async (file) => {
      const uri = await io.builtin(file);
      if (uri !== null) uris.set(file, uri);
    }),
  );
  const missing = [...files].filter((file) => !uris.has(file));
  if (missing.length > 0) warnings.push(`The built-in font files ${missing.join(', ')} could not be loaded, so the text they set is in the system’s fonts.`);
  const { faces, lacks } = chooseFilmFaces(script, modules, prepared, (file) => uris.get(file) ?? '');
  if (lacks) warnings.push('The built-in typefaces lack a letter the film shows, so none of those is in use. They have Western European letters only.');
  if (faces === null) return { faces: null, prepared, warnings, infos: prepared?.asides ?? [] };
  return { faces: { slots: faces.slots, fonts: usableFontFaces(faces.fonts).map(toStageFace) }, prepared, warnings, infos: prepared?.asides ?? [] };
}
