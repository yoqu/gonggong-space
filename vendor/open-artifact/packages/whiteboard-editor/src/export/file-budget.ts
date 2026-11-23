/**
 * Size rules of the board file download: how large its preview and
 * embedded pictures may be, and how a file that would pass the host's
 * download cap sheds embedded pictures (largest first), then its preview.
 *
 * Everything here is pure, so the budget logic is testable without a
 * canvas.
 */

import { MAX_RASTER_DATA_URL_CHARS } from '@open-artifact/whiteboard-core';

/** Hosts cap a single download at 16 MB; the file keeps 64 KB of headroom. */
export const BOARD_FILE_BYTE_BUDGET = 16 * 1024 * 1024 - 64 * 1024;
/** Longest edges tried for the preview, largest first. */
export const BOARD_FILE_PREVIEW_SIZES: readonly number[] = [2048, 1536, 1024, 768, 512];
/** Most characters of the preview's data URL. */
export const BOARD_FILE_PREVIEW_MAX_CHARS = 4_194_304;
/** Longest edge of an embedded picture, pixels. */
export const BOARD_FILE_IMAGE_MAX_PX = 2048;
/** Shortest long edge an embedded picture shrinks to before it is left out. */
export const BOARD_FILE_IMAGE_MIN_PX = 96;
/** JPEG quality of embedded pictures. */
export const BOARD_FILE_JPEG_QUALITY = 0.85;
/** How much each retry shrinks a picture that is still too large. */
export const BOARD_FILE_IMAGE_SHRINK = 0.7;
/** Most characters of one embedded picture (what a board accepts as an inline picture). */
export const BOARD_FILE_IMAGE_MAX_CHARS = MAX_RASTER_DATA_URL_CHARS;

/** A size in pixels. */
export interface PixelSize {
  w: number;
  h: number;
}

/** UTF-8 byte length of a text. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The pixel size of a picture scaled so its long edge is `longEdge` (at least 1 × 1). */
export function embedPixelSize(natural: PixelSize, longEdge: number): PixelSize {
  const scale = longEdge / Math.max(natural.w, natural.h, 1);
  return { w: Math.max(1, Math.round(natural.w * scale)), h: Math.max(1, Math.round(natural.h * scale)) };
}

/**
 * The long edges to try when embedding a picture: its own (at most
 * {@link BOARD_FILE_IMAGE_MAX_PX}), shrinking by {@link BOARD_FILE_IMAGE_SHRINK}
 * while at least {@link BOARD_FILE_IMAGE_MIN_PX}.
 */
export function embedLongEdges(natural: PixelSize): number[] {
  const first = Math.min(Math.max(natural.w, natural.h), BOARD_FILE_IMAGE_MAX_PX);
  if (first < BOARD_FILE_IMAGE_MIN_PX) return first > 0 ? [first] : [];
  const edges: number[] = [];
  for (let edge = first; edge >= BOARD_FILE_IMAGE_MIN_PX; edge = Math.floor(edge * BOARD_FILE_IMAGE_SHRINK)) edges.push(edge);
  return edges;
}

/** A board file text and what it kept. */
export interface FittedBoardFile {
  text: string;
  /** Ids of the pictures still embedded. */
  embedded: ReadonlySet<string>;
  /** The preview is still included. */
  preview: boolean;
}

/**
 * Assembles a board file within `budget` bytes: all embedded pictures and
 * the preview when they fit, else dropping pictures largest first, then the
 * preview. The last attempt is returned even if it is still too large.
 */
export function fitBoardFileToBudget(
  assemble: (embeds: ReadonlyMap<string, string>, preview: boolean) => string,
  embeds: ReadonlyMap<string, string>,
  budget: number = BOARD_FILE_BYTE_BUDGET,
): FittedBoardFile {
  const kept = new Map(embeds);
  const largestFirst = [...embeds].sort(([, a], [, b]) => b.length - a.length).map(([id]) => id);
  let text = assemble(kept, true);
  let size = utf8Length(text);
  while (size > budget && largestFirst.length > 0) {
    // Drop just enough of the largest pictures to cover the excess, then measure again.
    for (let excess = size - budget; excess > 0 && largestFirst.length > 0; ) {
      const id = largestFirst.shift()!;
      excess -= kept.get(id)?.length ?? 0;
      kept.delete(id);
    }
    text = assemble(kept, true);
    size = utf8Length(text);
  }
  if (size <= budget) return { text, embedded: new Set(kept.keys()), preview: true };
  return { text: assemble(kept, false), embedded: new Set(kept.keys()), preview: false };
}
