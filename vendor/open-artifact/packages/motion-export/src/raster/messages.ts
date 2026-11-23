/** Page → raster frame: draw this snapshot at `pw` × `ph`. */
export interface RasterRequest {
  rid: number;
  svg: string;
  pw: number;
  ph: number;
  waitMs?: number;
}

/** Raster frame → page. */
export type RasterReply = { rasterReady: true } | { rid: number; bitmap: ImageBitmap } | { rid: number; error: string };

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isRasterRequest(value: unknown): value is RasterRequest {
  return (
    isFields(value) &&
    isNumber(value['rid']) &&
    typeof value['svg'] === 'string' &&
    isNumber(value['pw']) &&
    isNumber(value['ph']) &&
    (value['waitMs'] === undefined || isNumber(value['waitMs']))
  );
}

/** A reply as the page reads it: whether the frame is ready, or the request it answers and how. */
export type ReadReply =
  | { kind: 'ready' }
  | { kind: 'bitmap'; rid: number; bitmap: ImageBitmap }
  | { kind: 'error'; rid: number; message: string }
  | { kind: 'other' };

const MAX_ERROR_CHARS = 300;

export function readRasterReply(value: unknown): ReadReply {
  if (!isFields(value)) return { kind: 'other' };
  if (value['rasterReady'] === true) return { kind: 'ready' };
  const rid = Number(value['rid']);
  if (!Number.isFinite(rid)) return { kind: 'other' };
  const bitmap = value['bitmap'];
  if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) return { kind: 'bitmap', rid, bitmap };
  const error = value['error'];
  return { kind: 'error', rid, message: typeof error === 'string' ? error.slice(0, MAX_ERROR_CHARS) : 'raster failed' };
}
