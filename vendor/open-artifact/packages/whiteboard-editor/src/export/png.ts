/**
 * The board as one PNG picture: frames the board, loads its pictures, icon
 * art and font, paints it in the given color scheme and encodes it. The
 * browser's PNG is then re-compressed losslessly in the export Worker
 * (boards are mostly flat colors, which pack into small palettes).
 */

import { optimizePng } from '@open-artifact/wasm-export';
import type { BoardElement, ColorScheme, ElementMeasures } from '@open-artifact/whiteboard-core';
import { drawnImagePen } from './drawn-svg.ts';
import { EXPORT_MAX_PX, exportFrameFor } from './frame.ts';
import { loadPictureAssets, RASTER_IMAGE_LOAD_TIMEOUT_MS, type ImageLoadTally } from './images.ts';
import { canvasToPngBlob, drawBoardCanvas } from './paint.ts';

/** What a board picture is made from. */
export interface BoardPngInput {
  elements: readonly BoardElement[];
  title: string;
  measures?: ElementMeasures;
  scheme: ColorScheme;
  /** Draw note authors and face sticker colors and initials. */
  showAuthors: boolean;
  /** The display name of a person id (face sticker initials). */
  faceName(personId: string): string | undefined;
  /** Longest edge of the picture, pixels. */
  maxPx?: number;
  /** How long pictures may take to load, ms. */
  timeoutMs?: number;
  /** Painted looks of drawings (object URLs by element id); the others draw as written. */
  looks?: ReadonlyMap<string, string>;
}

/** A board picture and what became of its pictures. */
export interface BoardPng {
  blob: Blob;
  tally: ImageLoadTally;
}

/** Paints and encodes the board picture. Rejects for an empty board or when encoding fails. */
export async function exportBoardPng(input: BoardPngInput): Promise<BoardPng> {
  const frame = exportFrameFor(input.elements, input.measures, input.maxPx ?? EXPORT_MAX_PX);
  if (!frame) throw new Error('The board is empty.');
  const assets = await loadPictureAssets(input.elements, drawnImagePen(input.scheme), input.timeoutMs ?? RASTER_IMAGE_LOAD_TIMEOUT_MS, input.looks);
  try {
    const canvas = drawBoardCanvas({
      elements: input.elements,
      title: input.title,
      ...(input.measures ? { measures: input.measures } : {}),
      frame,
      scheme: input.scheme,
      images: assets.images,
      imageSources: assets.imageSources,
      icons: assets.icons,
      showAuthors: input.showAuthors,
      faceName: input.faceName,
    });
    let encoded: Blob;
    try {
      encoded = await canvasToPngBlob(canvas);
    } finally {
      canvas.width = 0;
    }
    const bytes = await optimizePng(encoded);
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), tally: assets.tally };
  } finally {
    assets.release();
  }
}
