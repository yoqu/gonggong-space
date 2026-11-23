import { isHostToStage } from '../protocol.ts';
import type { StageFilm } from '../protocol.ts';

/** The page's film, written into a standalone page as JSON: bytes go as base64, since JSON has none. */
export interface OfflineAsset {
  name: string;
  mime: string;
  w: number;
  h: number;
  base64?: string;
  url?: string;
}
export interface OfflineFilm extends Omit<StageFilm, 'assets'> {
  assets: OfflineAsset[];
}
export interface OfflineData {
  version: 1;
  film: OfflineFilm;
}

/** Where a standalone page keeps its parts: the film as JSON, and the stage runtime as text. */
export const OFFLINE_DATA_ID = 'film-data';
export const OFFLINE_RUNTIME_ID = 'stage-runtime';

const CHUNK = 0x8000;

export function toBase64(bytes: ArrayBuffer): string {
  const all = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < all.length; i += CHUNK) text += String.fromCharCode(...all.subarray(i, Math.min(i + CHUNK, all.length)));
  return btoa(text);
}

export function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The text for the page's `#film-data` element: JSON that cannot end its <script> early. */
export function offlineDataText(film: StageFilm): string {
  const assets = film.assets.map((asset): OfflineAsset => {
    const { bytes, ...rest } = asset;
    return bytes ? { ...rest, base64: toBase64(bytes) } : rest;
  });
  const data: OfflineData = { version: 1, film: { ...film, assets } };
  return JSON.stringify(data).replace(/<\//g, '<\\/').replace(/<!-{2}/g, '<\\u0021--');
}

const fields = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Its fields as given, with the bytes decoded: the stage's guard checks the rest. */
function assetOf(value: unknown): Record<string, unknown> | null {
  const given = fields(value);
  if (!given) return null;
  const { base64, ...rest } = given;
  if (base64 === undefined) return rest;
  if (typeof base64 !== 'string') return null;
  try {
    return { ...rest, bytes: fromBase64(base64) };
  } catch {
    return null;
  }
}

/** The film a standalone page carries, checked as the stage checks a load; or why it cannot be read. */
export function readOfflineData(text: string): StageFilm | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'the film data is not JSON';
  }
  const data = fields(parsed);
  if (!data || data['version'] !== 1) return 'the film data is not version 1';
  const film = fields(data['film']);
  if (!film || !Array.isArray(film['assets'])) return 'the film data has no film';
  const given: unknown[] = film['assets'];
  const assets = given.map(assetOf);
  if (assets.some((asset) => asset === null)) return 'an asset of the film data cannot be read';
  // Every field but the bytes is checked by the stage's own guard.
  const message: unknown = { type: 'load', film: { ...film, assets } };
  if (!isHostToStage(message) || message.type !== 'load') return 'the film data is not a film the stage can load';
  return message.film;
}
