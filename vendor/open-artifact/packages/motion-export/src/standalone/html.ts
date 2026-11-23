import { CODE_SETTINGS, FETCHED_FONTS_MODULE, RECOLORED_MODULE, REFACED_MODULE, RETYPED_MODULE } from '@open-artifact/motion-core';
import { OFFLINE_DATA_ID, OFFLINE_RUNTIME_ID, offlineDataText } from '@open-artifact/motion-stage';
import type { StageAsset, StageFilm } from '@open-artifact/motion-stage';
import { BYTES_PER_MEBIBYTE, SourceExportError, wholeMegabytes } from '../errors.ts';
import { exportFilename } from '../filename.ts';
import { inScript } from '../raster/document.ts';
import type { ExportedFile } from '../types.ts';
import { words } from '../words.ts';

/** The page reaches nothing outside itself: everything it plays is inside it. */
export const STANDALONE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** Records the page keeps for itself: the editor has already applied them to the film it gives the stage. */
const PAGE_RECORDS: readonly string[] = [RETYPED_MODULE, RECOLORED_MODULE, REFACED_MODULE, FETCHED_FONTS_MODULE];

/** A typeface the page carries, with the licence that must travel with it. */
export interface FontLicenceNotice {
  family: string;
  licence: string;
  text: string;
}

export interface StandaloneInput {
  title: string;
  film: StageFilm;
  /** The narration's takes (audio assets, with their bytes), which the stage itself does not need. */
  takes?: readonly StageAsset[];
  /** The stage runtime (`virtual:motion-stage-runtime`). */
  runtimeScript: string;
  /** The offline player (`buildOfflinePlayer()`). */
  playerScript: string;
  /** Sets `window.filmAudio` (`virtual:motion-standalone-audio`); null for a silent page. */
  audioScript: string | null;
  background?: string;
  licences?: readonly FontLicenceNotice[];
  maxBytes?: number;
}

/** The film a standalone page carries: the stage's film with the narration's takes, without the page's own records. */
export function standaloneFilm(film: StageFilm, takes: readonly StageAsset[] = []): StageFilm {
  const names = new Set(film.assets.map((asset) => asset.name));
  return {
    ...film,
    modules: film.modules.filter((module) => !PAGE_RECORDS.includes(module.name)),
    assets: [...film.assets, ...takes.filter((take) => !names.has(take.name))],
    mode: 'final',
  };
}

export const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text that cannot end the HTML comment it sits in. */
export const escapeHtmlComment = (text: string): string => text.replace(/--+(!?)>/g, '- $1>').replace(/<!-/g, '< !-');

const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|(rgb|hsl)a?\([0-9.,%\s/]{1,40}\))$/;

function pageStyle(background: string | undefined): string {
  const color = background !== undefined && CSS_COLOR.test(background) ? background : '#000';
  return `html,body{margin:0;height:100%;background:${color}}#film{position:fixed;inset:0}`;
}

function licenceComment(licences: readonly FontLicenceNotice[]): string {
  if (licences.length === 0) return '';
  const notices = licences.map((notice) => `${notice.family} (${notice.licence})\n\n${notice.text.trim()}`).join('\n\n----\n\n');
  return '\n<!--\nThe typefaces in this page, each under its own licence:\n\n' + escapeHtmlComment(notices) + '\n-->\n';
}

/** One HTML file that plays the film offline: the film's data, the stage runtime, the sound and the player. */
export function standaloneHtml(input: StandaloneInput): string {
  const film = standaloneFilm(input.film, input.takes);
  const audio = input.audioScript === null ? '' : '<script>' + inScript(input.audioScript) + '</script>';
  return (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${STANDALONE_CONTENT_SECURITY_POLICY}">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(input.title)}</title><style>${pageStyle(input.background)}</style></head><body>` +
    '<div id="film"></div>' +
    `<script type="application/json" id="${OFFLINE_DATA_ID}">${offlineDataText(film)}</script>` +
    `<script type="text/plain" id="${OFFLINE_RUNTIME_ID}">${inScript(input.runtimeScript)}</script>` +
    audio +
    '<script>' +
    inScript(input.playerScript) +
    '</script></body></html>' +
    licenceComment(input.licences ?? [])
  );
}

export const STANDALONE_MAX_BYTES = CODE_SETTINGS.maxMb * BYTES_PER_MEBIBYTE;

/** The standalone page as a file to download; refused when it would pass `maxBytes`. */
export function standaloneFile(input: StandaloneInput): ExportedFile {
  const blob = new Blob([standaloneHtml(input)], { type: 'text/html;charset=utf-8' });
  const maxBytes = input.maxBytes ?? STANDALONE_MAX_BYTES;
  if (blob.size > maxBytes) throw new SourceExportError(words.standaloneTooLarge(wholeMegabytes(maxBytes)), 'too_large');
  return { blob, filename: exportFilename(input.title, 'html'), mime: 'text/html' };
}
