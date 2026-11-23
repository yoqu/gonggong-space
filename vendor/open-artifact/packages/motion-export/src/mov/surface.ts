import { ExportCheckError } from '../errors.ts';
import type { ExportSurface } from '../gif/surface.ts';
import type { ExportDimensions } from '../types.ts';
import { words } from '../words.ts';

/** Where a MOV's frames are drawn on nothing, so what the film leaves clear stays transparent. */
export function createAlphaSurface(size: ExportDimensions): ExportSurface {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new ExportCheckError(words.noCanvas, 'no_canvas');
  context.imageSmoothingQuality = 'high';
  return {
    paint: (image) => {
      context.clearRect(0, 0, size.width, size.height);
      if (image !== null) context.drawImage(image, 0, 0, size.width, size.height);
    },
    pixels: () => context.getImageData(0, 0, size.width, size.height).data,
  };
}
