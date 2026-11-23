import { FILM_NAME_PATTERN } from '@open-artifact/motion-core';
import type { AssetMime, FontLicence, ModuleKind } from '@open-artifact/motion-core';

const MODULE_EXTENSIONS: Readonly<Record<ModuleKind, RegExp>> = {
  js: /\.js$/i,
  css: /\.css$/i,
  html: /\.html?$/i,
  json: /\.json$/i,
  text: /\.(?:txt|md|svg)$/i,
};

const ASSET_EXTENSIONS: Readonly<Record<AssetMime, RegExp>> = {
  'image/png': /\.png$/i,
  'image/jpeg': /\.jpe?g$/i,
  'image/gif': /\.gif$/i,
  'image/webp': /\.webp$/i,
  'image/svg+xml': /\.svg$/i,
  'font/woff2': /\.woff2$/i,
  'font/woff': /\.woff$/i,
  'font/ttf': /\.ttf$/i,
  'font/otf': /\.otf$/i,
  'video/mp4': /\.mp4$/i,
  'video/webm': /\.webm$/i,
  'application/pdf': /\.pdf$/i,
  'audio/mpeg': /\.mp3$/i,
  'audio/wav': /\.wav$/i,
};

/** Names some computers cannot save a file under. */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
/** Names that could be taken for the folder's own index.html or README.txt. */
const FOLDER_OWN = /^(?:index|readme)\./i;

/** Keeps track of the names taken in one folder of the ZIP, compared without case. */
export class FolderNames {
  #seen = new Set<string>();

  /** Takes the name when it can be a file of its own here; false when it cannot. */
  accept(name: string, extension: RegExp): boolean {
    const key = name.toLowerCase();
    const ok = FILM_NAME_PATTERN.test(name) && !WINDOWS_RESERVED.test(name) && !FOLDER_OWN.test(name) && extension.test(name) && !this.#seen.has(key);
    if (ok) this.#seen.add(key);
    return ok;
  }

  module(name: string, kind: ModuleKind): boolean {
    return this.accept(name, MODULE_EXTENSIONS[kind]);
  }

  asset(name: string, mime: AssetMime): boolean {
    return this.accept(name, ASSET_EXTENSIONS[mime]);
  }
}

/** The folder everything sits in: the title's file stem, kept clear of names a computer refuses. */
export const sourceRootFolder = (stem: string): string => (WINDOWS_RESERVED.test(stem) ? '_' + stem : stem) + '/';

/** A font family as a folder name. */
export const fontFolder = (family: string): string => 'fonts/' + (family.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font') + '/';

export function licenceFileName(licence: FontLicence): string {
  switch (licence) {
    case 'OFL-1.1':
    case 'OFL-1.0':
      return 'OFL.txt';
    case 'Apache-2.0':
      return 'LICENSE.txt';
    case 'UFL-1.0':
      return 'UFL.txt';
    default: {
      const never: never = licence;
      return never;
    }
  }
}
