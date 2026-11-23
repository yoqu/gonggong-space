import { FETCHED_FONTS_MODULE, RECOLORED_MODULE, REFACED_MODULE, RETYPED_MODULE } from '@open-artifact/motion-core';
import type { AssetMime, FontLicence, ModuleKind } from '@open-artifact/motion-core';
import type { ZipEntry } from '@open-artifact/wasm-export';
import { exportFileStem } from '../filename.ts';
import type { FilmFacts } from '../frame-source.ts';
import { FolderNames, fontFolder, licenceFileName, sourceRootFolder } from './names.ts';
import { sourceReadme } from './readme.ts';

/** Records the page keeps for itself and has already applied to the code. */
const PAGE_RECORDS: readonly string[] = [RETYPED_MODULE, RECOLORED_MODULE, REFACED_MODULE, FETCHED_FONTS_MODULE];

export interface SourceModule {
  name: string;
  kind: ModuleKind;
  text: string;
}

export interface SourceAsset {
  name: string;
  mime: AssetMime;
  bytes: Uint8Array;
}

/** A typeface the video uses, with its files and the licence text that must go with them; null when there is none. */
export interface SourceFont {
  family: string;
  licence: FontLicence;
  licenceText: string | null;
  files: ReadonlyArray<{ name: string; bytes: Uint8Array }>;
}

export interface SourceFolderInput {
  title: string;
  date: Date;
  script: string;
  modules: readonly SourceModule[];
  assets: readonly SourceAsset[];
  fonts: readonly SourceFont[];
  /** The standalone page, or null when there is none. */
  standalone: string | null;
  facts?: Omit<FilmFacts, 'title'>;
  /** The score as a MIDI file, put in as score.mid; null or absent to leave it out. */
  midi?: Uint8Array | null;
}

/** Where the score's MIDI file goes in the folder. */
export const SCORE_MIDI_FILE = 'score.mid';

export interface SourceFolder {
  entries: ZipEntry[];
  /** Files that could not be files of their own. */
  filesLeftOut: string[];
  fontsLeftOut: string[];
}

const pad = (value: number): string => String(value).padStart(2, '0');
const dayOf = (date: Date): string => [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
const fontFileName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'font.woff2';

/**
 * The folder as ZIP entries: README.txt, index.html, cut.js, film.json, score.mid, modules/, assets/ and fonts/ with
 * licences.
 */
export function sourceFolder(input: SourceFolderInput): SourceFolder {
  const root = sourceRootFolder(exportFileStem(input.title));
  const filesLeftOut: string[] = [];
  const moduleNames = new FolderNames();
  const modules = input.modules.filter((module) => {
    if (PAGE_RECORDS.includes(module.name)) return false;
    if (moduleNames.module(module.name, module.kind)) return true;
    filesLeftOut.push('modules/' + module.name);
    return false;
  });
  const assetNames = new FolderNames();
  const assets = input.assets.filter((asset) => {
    if (assetNames.asset(asset.name, asset.mime)) return true;
    filesLeftOut.push('assets/' + asset.name);
    return false;
  });
  const fonts = input.fonts.filter((font) => font.licenceText !== null && font.files.length > 0);
  const fontsLeftOut = input.fonts.filter((font) => !fonts.includes(font)).map((font) => font.family);
  const fontEntries: ZipEntry[] = [];
  const fontFacts = fonts.map((font) => {
    const folder = fontFolder(font.family);
    const names = new Set<string>();
    const files = font.files.map((file, index) => {
      let name = fontFileName(file.name);
      if (names.has(name.toLowerCase())) name = `${index + 1}-${name}`;
      names.add(name.toLowerCase());
      fontEntries.push({ name: root + folder + name, data: file.bytes });
      return folder + name;
    });
    fontEntries.push({ name: root + folder + licenceFileName(font.licence), data: font.licenceText ?? '' });
    return { family: font.family, licence: font.licence, files };
  });
  const film = {
    version: 1,
    title: input.title,
    created: input.date.toISOString(),
    ...(input.facts !== undefined ? { width: input.facts.width, height: input.facts.height, fps: input.facts.fps, duration: input.facts.duration } : {}),
    fonts: fontFacts,
    ...(fontsLeftOut.length > 0 ? { fontsLeftOut } : {}),
    ...(filesLeftOut.length > 0 ? { filesLeftOut } : {}),
  };
  const midi = input.midi ?? null;
  const readme = sourceReadme({
    day: dayOf(input.date),
    standalone: input.standalone !== null,
    parts: ['cut.js', 'film.json', ...(modules.length > 0 ? ['modules/'] : []), ...(assets.length > 0 ? ['assets/'] : [])],
    assets: assets.length > 0,
    fonts: fonts.length > 0,
    midi: midi !== null,
    fontsLeftOut,
    filesLeftOut,
  });
  const entries: ZipEntry[] = [
    { name: root + 'README.txt', data: readme },
    ...(input.standalone !== null ? [{ name: root + 'index.html', data: input.standalone }] : []),
    { name: root + 'cut.js', data: input.script },
    { name: root + 'film.json', data: JSON.stringify(film, null, 2) + '\n' },
    ...(midi !== null ? [{ name: root + SCORE_MIDI_FILE, data: midi }] : []),
    ...modules.map((module): ZipEntry => ({ name: root + 'modules/' + module.name, data: module.text })),
    ...assets.map((asset): ZipEntry => ({ name: root + 'assets/' + asset.name, data: asset.bytes })),
    ...fontEntries,
  ];
  return { entries, filesLeftOut, fontsLeftOut };
}
