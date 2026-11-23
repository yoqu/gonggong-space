/** The version of `film/meta` and of every record and `scenes.json`. */
export const FILM_SCHEMA_VERSION = 1;

/** A document over this (as the store measures it) is refused. */
export const MAX_DOC_BYTES = 204_800;
/** The `film` and `assets` collections are refused past this. */
export const MAX_COLLECTION_BYTES = 2_097_152;
/** The `modules` collection is refused past this. */
export const MAX_MODULE_COLLECTION_BYTES = 16_777_216;
/** Past this many modules (in name order) the player drops the rest. */
export const MAX_MODULES = 500;
/** Past this many assets the player drops the rest. */
export const MAX_ASSETS = 96;
/** Characters of a film's title. */
export const MAX_TITLE_CHARS = 120;
export const MAX_UPDATED_AT_CHARS = 40;
export const MAX_SCENES = 24;
/** The longest film, in seconds (film time and play time alike: 10 hours). */
export const MAX_FILM_SECONDS = 36_000;
export const MAX_BATCH_WRITES = 50;
export const MAX_BATCH_BYTES = 1_048_576;
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_CHAPTERS = 32;
export const MAX_CHAPTER_LABEL_CHARS = 48;
export const MAX_SCENE_NAME_CHARS = 48;
export const MAX_SCENE_DESCRIPTION_CHARS = 200;
/** Characters of an asset's note. */
export const MAX_ASSET_NOTE_CHARS = 200;
/** Characters of the cut and of a module the player reads; the rest is cut off. */
export const MAX_SCRIPT_CHARS = 262_144;
export const MAX_MODULE_CHARS = 262_144;
/** Characters of an asset's ref (a data: URI can be long). */
export const MAX_ASSET_REF_CHARS = 8_388_608;
/** An asset's width and height are clamped to this many pixels. */
export const MAX_ASSET_SIDE = 16_384;
/** A split module has at most this many parts (`name~1` … `name~99`). */
export const MAX_MODULE_PARTS = 99;
/** How many path segments a document path may have. */
export const MAX_PATH_SEGMENTS = 16;

export const DEFAULT_FILM_WIDTH = 1920;
export const DEFAULT_FILM_HEIGHT = 1080;
export const MIN_FILM_SIDE = 16;
export const MAX_FILM_SIDE = 4096;
export const FILM_FRAME_RATES: readonly number[] = [24, 30, 60];
export const DEFAULT_FRAME_RATE = 60;
export const DEFAULT_BACKGROUND = '#ffffff';
export const MAX_BACKGROUND_CHARS = 64;
