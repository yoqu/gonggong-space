/**
 * Pictures in the browser: reading blobs as `data:` URLs, encoding canvases,
 * decoding picture files, and drawing them smaller. Exports inline pictures
 * into self-contained files and uploads shrink pictures to the stored limits;
 * each caller keeps its own limits and qualities and passes them in.
 *
 * Everything here needs a DOM (FileReader, canvas, `createImageBitmap`).
 */

/** Reads a blob as a `data:` URL. `failure` makes the error a failed read rejects with (default: the reader's error, else "The file could not be read."). */
export function blobToDataUrl(blob: Blob, failure: (error: DOMException | null) => Error = (error) => error ?? new Error('The file could not be read.')): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(failure(reader.error));
    reader.readAsDataURL(blob);
  });
}

/** A canvas as a blob (null when empty, or when the browser refuses to read it back). */
export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Encodes a canvas as WebP where the browser writes it, else as the type
 * `fallback` names (asked only then). Null when neither could be written.
 */
export async function encodePreferringWebp(canvas: HTMLCanvasElement, quality: number, fallback: () => string): Promise<Blob | null> {
  const webp = await canvasBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return webp;
  return canvasBlob(canvas, fallback(), quality);
}

/** Decodes a picture file (SVG through an image element, drawn at 1024 × 1024 when it has no size); null when it cannot be decoded. */
export async function decodePicture(blob: Blob): Promise<ImageBitmap | HTMLImageElement | null> {
  if (blob.type !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to an image element.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('undecodable'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      // SVG without a size: draw it at a reasonable default.
      image.width = 1024;
      image.height = 1024;
    }
    return image;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The scale that brings a picture's long edge down to `maxEdge` (1 when it already fits). */
export function edgeScale(width: number, height: number, maxEdge: number): number {
  return Math.min(1, maxEdge / Math.max(width, height, 1));
}

/** How {@link drawScaled} draws. */
export interface DrawScaledOptions {
  /** The canvas's `imageSmoothingQuality` (left at the browser's default when omitted). */
  smoothing?: ImageSmoothingQuality;
  /** Smallest canvas side, px (default 1). */
  minSide?: number;
}

/**
 * Draws a picture of `width` × `height` px onto a new canvas at `scale`
 * (each side rounded, at least `minSide`). Null when the browser gives no
 * 2D context.
 */
export function drawScaled(source: CanvasImageSource, width: number, height: number, scale: number, options: DrawScaledOptions = {}): HTMLCanvasElement | null {
  const minSide = options.minSide ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(minSide, Math.round(width * scale));
  canvas.height = Math.max(minSide, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (options.smoothing) context.imageSmoothingQuality = options.smoothing;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Below this many bytes, a picture that already fits is left as it is by {@link shrinkPicture}. */
export const SHRINK_MIN_BYTES = 512 * 1024;

/**
 * A raster picture redrawn so its long edge is at most `maxEdge` px and
 * re-encoded (WebP where the browser writes it, else JPEG, or PNG for a PNG
 * that may be transparent) at `quality`. Null when the file should stay as
 * it is: not a still raster picture (SVG, GIF), already small enough (fits
 * and under `minBytes`), undecodable, or when the smaller copy is not
 * smaller in bytes.
 */
export async function shrinkPicture(blob: Blob, maxEdge: number, quality: number, minBytes = SHRINK_MIN_BYTES): Promise<Blob | null> {
  if (!/^image\/(png|jpeg|jpg|webp|avif|bmp)$/.test(blob.type)) return null;
  const bitmap = await decodePicture(blob);
  if (!bitmap) return null;
  try {
    const { width, height } = bitmap;
    const scale = edgeScale(width, height, maxEdge);
    if (scale >= 1 && blob.size < minBytes) return null;
    const canvas = drawScaled(bitmap, width, height, scale, { smoothing: 'high' });
    if (!canvas) return null;
    const out = await encodePreferringWebp(canvas, quality, () => (blob.type === 'image/png' ? 'image/png' : 'image/jpeg'));
    return out && out.size < blob.size ? out : null;
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
}
