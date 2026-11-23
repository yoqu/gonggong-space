import { newFilmMeta, type FilmMetaDocument } from './documents.ts';
import { FILM_META_PATH } from './names.ts';

export const DEFAULT_VIDEO_TITLE = 'Untitled motion';

/** The documents of a new motion artifact (path → data): only its meta, so the page shows "No animation yet". */
export function scaffoldFilm(title: string, now: Date = new Date()): Record<string, FilmMetaDocument> {
  return { [FILM_META_PATH]: newFilmMeta(title.trim() === '' ? DEFAULT_VIDEO_TITLE : title, now) };
}

/** The files of a new motion artifact, relative to `db/` (`film/meta.json` → its JSON text). */
export function scaffoldFilmFiles(title: string, now: Date = new Date()): Record<string, string> {
  return Object.fromEntries(Object.entries(scaffoldFilm(title, now)).map(([path, data]) => [`${path}.json`, `${JSON.stringify(data, null, 2)}\n`]));
}
