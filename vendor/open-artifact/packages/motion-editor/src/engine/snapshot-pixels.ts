/**
 * A snapshot's pixels, read through the raster frame the export uses: an opaque-origin frame draws the SVG, so the
 * pictures in it cannot taint what the page reads back. One frame serves the page; it is made on first use.
 */

import { createRasterHost, type RasterHost } from '@open-artifact/motion-export';

let host: Promise<RasterHost> | null = null;
let reader: HTMLCanvasElement | null = null;

function rasterHost(): Promise<RasterHost> {
  host ??= import('virtual:motion-raster-frame').then((frame) => createRasterHost({ script: frame.default }));
  host.catch(() => {
    host = null;
  });
  return host;
}

/** The snapshot's RGBA pixels at `pw` × `ph`; `null` when it cannot be drawn or read back. */
export async function snapshotPixels(svg: string, pw: number, ph: number): Promise<Uint8ClampedArray | null> {
  const width = Math.max(1, Math.round(pw));
  const height = Math.max(1, Math.round(ph));
  let bitmap: ImageBitmap;
  try {
    bitmap = await (await rasterHost()).raster(svg, width, height);
  } catch {
    return null;
  }
  try {
    const canvas = (reader ??= document.createElement('canvas'));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/** Lets the raster frame go (the page is closing); the next read makes a new one. */
export function disposeSnapshotPixels(): void {
  const going = host;
  host = null;
  reader = null;
  void going?.then((made) => made.dispose(), () => undefined);
}
