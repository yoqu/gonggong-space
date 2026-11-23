/**
 * Reading the files a deck shows (uploads, design-system files, fonts) for
 * an export, once each: as blobs, as `data:` URLs, or as pictures an office
 * app accepts (PNG, JPEG, GIF).
 */

import { blobToDataUrl, canvasBlob, decodePicture } from '@open-artifact/export-kit';

/** The size in bytes a `data:` URL decodes to (about). */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  const body = comma < 0 ? url : url.slice(comma + 1);
  return /;base64,/.test(url.slice(0, comma + 1)) ? Math.floor((body.length * 3) / 4) : body.length;
}

/** Statuses that say the server or the way to it had a moment: worth one more try. */
const TRY_AGAIN = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * `fetch` with one more try, past the browser's cache, after a dropped
 * connection or a status in {@link TRY_AGAIN}. A missing file, a second
 * failure or an aborted request is the answer.
 */
export async function fetchRetrying(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  const again = (): Promise<Response> => fetcher(url, { ...init, cache: 'reload' });
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    return again();
  }
  if (!TRY_AGAIN.has(response.status) || init.signal?.aborted) return response;
  return again().catch(() => response);
}

/** A picture ready for a PPTX package. */
export interface OfficePicture {
  data: Uint8Array;
  type: 'png' | 'jpeg' | 'gif';
  width: number;
  height: number;
}

/** Fetches and converts the files an export needs, caching each by address. */
export class AssetCache {
  private readonly blobs = new Map<string, Promise<Blob | null>>();
  private readonly urls = new Map<string, Promise<string | null>>();
  private readonly pictures = new Map<string, Promise<OfficePicture | null>>();

  private readonly resolveSrc: (src: string) => string;

  constructor(resolveSrc: (src: string) => string = (src) => src) {
    this.resolveSrc = resolveSrc;
  }

  /** The absolute address of a reference (`/_blob/…`, `project/ds/…`, a URL). */
  url(src: string): string {
    const resolved = src.startsWith('data:') || src.startsWith('blob:') ? src : this.resolveSrc(src);
    try {
      return new URL(resolved, document.baseURI).href;
    } catch {
      return resolved;
    }
  }

  /** The file behind a reference, or null when it cannot be read (missing, cross-origin). */
  blob(src: string): Promise<Blob | null> {
    const url = this.url(src);
    let pending = this.blobs.get(url);
    if (!pending) {
      pending = fetchRetrying(url, { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null);
      this.blobs.set(url, pending);
    }
    return pending;
  }

  /** The file as a `data:` URL, or null. */
  dataUrl(src: string): Promise<string | null> {
    if (src.startsWith('data:')) return Promise.resolve(src);
    const url = this.url(src);
    let pending = this.urls.get(url);
    if (!pending) {
      pending = this.blob(url).then((blob) => (blob ? blobToDataUrl(blob).catch(() => null) : null));
      this.urls.set(url, pending);
    }
    return pending;
  }

  /**
   * The file as a picture PowerPoint reads: PNG, JPEG and GIF as they are,
   * anything else (WebP, AVIF, SVG) redrawn as PNG.
   */
  picture(src: string): Promise<OfficePicture | null> {
    const url = this.url(src);
    let pending = this.pictures.get(url);
    if (!pending) {
      pending = this.blob(url).then(async (blob) => {
        if (!blob) return null;
        const bitmap = await decodePicture(blob);
        if (!bitmap) return null;
        const { width, height } = bitmap;
        const type = /image\/(png|jpeg|jpg|gif)/.exec(blob.type)?.[1];
        if (type) {
          if ('close' in bitmap) bitmap.close();
          return { data: new Uint8Array(await blob.arrayBuffer()), type: type === 'jpg' ? 'jpeg' : (type as OfficePicture['type']), width, height };
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if ('close' in bitmap) bitmap.close();
        const png = await canvasBlob(canvas, 'image/png');
        return png ? { data: new Uint8Array(await png.arrayBuffer()), type: 'png', width, height } : null;
      });
      this.pictures.set(url, pending);
    }
    return pending;
  }
}
