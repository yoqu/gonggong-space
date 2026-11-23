import { isPlainObject, utf8Bytes } from './json.ts';
import { MAX_FILM_SECONDS } from './limits.ts';
import { isPageOnlyPath } from './names.ts';
import type { PlaySeconds } from './units.ts';

export type VideoContextScalar = string | number | boolean | null;
export type VideoContextValue = VideoContextScalar | string[] | Record<string, number> | { text: string };
/** What a video page tells the agent of the viewer's screen. */
export type VideoViewContext = Record<string, VideoContextValue>;

export const MAX_VIDEO_VIEW_CONTEXT_BYTES = 32_768;
export const MAX_VIEW_CONTEXT_KEYS = 32;
export const MAX_VIEW_CONTEXT_ITEMS = 20;
export const MAX_VIEW_CONTEXT_STRING_CHARS = 200;
export const MAX_VIEW_CONTEXT_LABEL_CHARS = 60;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/~-]{0,127}$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_COORDINATE = 1e9;

export type VideoViewMode = 'player' | 'tweaks' | 'export';

export interface VideoViewOptions {
  mode: VideoViewMode;
  /** Changes by hand not yet saved. */
  dirty: boolean;
  /** Ids of what is picked on the picture (layer ids). */
  selected: readonly string[];
  /** The page-only records holding changes by hand (`modules/recut.json`…). */
  handEditRecords: readonly string[];
  /** Where the playhead stands, as played. */
  at?: PlaySeconds;
  /** The scene at the playhead. */
  scene?: string;
}

/** The context a video page publishes. */
export function buildVideoViewContext(options: VideoViewOptions): VideoViewContext {
  return {
    mode: options.mode,
    dirty: options.dirty,
    selected: options.selected.filter((id) => SAFE_ID_PATTERN.test(id)).slice(0, MAX_VIEW_CONTEXT_ITEMS),
    handEditRecords: options.handEditRecords.filter(isPageOnlyPath).slice(0, MAX_VIEW_CONTEXT_ITEMS),
    ...(options.at !== undefined && Number.isFinite(options.at) ? { at: Math.round(Math.min(MAX_FILM_SECONDS, Math.max(0, options.at)) * 100) / 100 } : {}),
    ...(options.scene !== undefined && SAFE_ID_PATTERN.test(options.scene) ? { scene: options.scene } : {}),
  };
}

function sanitizeValue(value: unknown): VideoContextValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return Array.from(value).length <= MAX_VIEW_CONTEXT_STRING_CHARS ? value : undefined;
  if (Array.isArray(value)) {
    const ids = value.slice(0, MAX_VIEW_CONTEXT_ITEMS).filter((item): item is string => typeof item === 'string' && SAFE_ID_PATTERN.test(item));
    return ids.length === Math.min(value.length, MAX_VIEW_CONTEXT_ITEMS) ? ids : undefined;
  }
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length === 1 && typeof value.text === 'string')
    return Array.from(value.text).length <= MAX_VIEW_CONTEXT_LABEL_CHARS ? { text: value.text } : undefined;
  const rect: Record<string, number> = {};
  for (const key of ['x', 'y', 'w', 'h']) {
    const item = value[key];
    if (typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= MAX_COORDINATE) rect[key] = item;
  }
  return Object.keys(rect).length === keys.length && keys.length > 0 ? rect : undefined;
}

/**
 * A view context received from a video page, made safe: known shapes only (scalars, lists of ids, boxes, short
 * labels), at most 32 keys; `null` for anything but a plain object of at most 32 KiB of JSON.
 */
export function validateVideoViewContext(value: unknown): VideoViewContext | null {
  if (!isPlainObject(value)) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (json === undefined || utf8Bytes(json) > MAX_VIDEO_VIEW_CONTEXT_BYTES) return null;
  const context: VideoViewContext = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_VIEW_CONTEXT_KEYS)) {
    if (!KEY_PATTERN.test(key)) continue;
    if (key === 'edits') {
      if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) context.edits = item;
      continue;
    }
    if (key === 'handEditRecords') {
      if (Array.isArray(item)) context.handEditRecords = item.filter((path): path is string => typeof path === 'string' && isPageOnlyPath(path));
      continue;
    }
    const safe = sanitizeValue(item);
    if (safe !== undefined) context[key] = safe;
  }
  return context;
}
