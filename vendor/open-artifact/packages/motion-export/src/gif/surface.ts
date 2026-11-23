import { ExportCheckError } from '../errors.ts';
import type { ExportDimensions } from '../types.ts';
import { words } from '../words.ts';

/** Where a GIF's frames are drawn on black and read back as RGBA. */
export interface ExportSurface {
  paint(image: CanvasImageSource | null): void;
  pixels(): Uint8ClampedArray<ArrayBuffer>;
}

export type SurfaceMaker = (size: ExportDimensions) => ExportSurface;

export function createOpaqueSurface(size: ExportDimensions): ExportSurface {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (context === null) throw new ExportCheckError(words.noCanvas, 'no_canvas');
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#000';
  return {
    paint: (image) => {
      context.fillRect(0, 0, size.width, size.height);
      if (image !== null) context.drawImage(image, 0, 0, size.width, size.height);
    },
    pixels: () => context.getImageData(0, 0, size.width, size.height).data,
  };
}
