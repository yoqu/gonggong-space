/**
 * Browser helpers for pictures and videos people add to the board: telling
 * which files the board takes, shrinking pictures to fit the stored limits,
 * encoding a small inline picture when uploads are unavailable, and reading
 * a video's size and first frame.
 *
 * Everything here needs a DOM (canvas, `createImageBitmap`, `<video>`).
 */

import { blobToDataUrl, drawScaled, edgeScale, encodePreferringWebp } from '@open-artifact/export-kit';

/** Picture types the board takes. */
export const IMAGE_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
/** Picture types that are re-encoded before upload (browsers draw them, the board stores a raster). */
const TRANSCODED_IMAGE_TYPES: readonly string[] = ['image/avif', 'image/bmp', 'image/svg+xml'];
/** Video types the board plays (QuickTime files are taken when they are really MP4). */
export const VIDEO_MIME_TYPES: readonly string[] = ['video/mp4', 'video/webm'];
const QUICKTIME = 'video/quicktime';

/** Largest GIF uploaded as is (2 MB); larger ones keep only a still frame. */
export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Stored pictures are shrunk under this many bytes (1.5 MB)… */
export const MAX_STORED_IMAGE_BYTES = 1.5 * 1024 * 1024;
/** …and this many pixels on the longest edge. */
export const MAX_STORED_IMAGE_EDGE = 2560;
/** Largest inline picture, in bytes, when uploads are unavailable. */
export const MAX_INLINE_IMAGE_BYTES = 70 * 1024;
/** Largest video (20 MB). */
export const MAX_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024;

/** First longest edge tried for an inline picture. */
const INLINE_START_EDGE = 1280;
/** Each retry shrinks the edge by this ratio. */
const SHRINK_RATIO = 0.7;
/** Smallest edge tried before giving up. */
const MIN_EDGE = 64;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: QUICKTIME,
};

/** A file's type, guessed from its name when the browser left it empty. */
export function fileMimeType(file: Pick<File, 'type' | 'name'>): string {
  const declared = (file.type.split(';')[0] ?? '').trim().toLowerCase();
  if (declared) return declared;
  const extension = /\.(\w+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? '';
}

/** True for a picture the board takes (directly or re-encoded). */
export function isImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  const type = fileMimeType(file);
  return IMAGE_MIME_TYPES.includes(type) || TRANSCODED_IMAGE_TYPES.includes(type);
}

/** True for any video file (whether the board can play it is checked on insert). */
export function isVideoFile(file: Pick<File, 'type' | 'name'>): boolean {
  return fileMimeType(file).startsWith('video/');
}

/** True for a file the board takes as a picture or a video. */
export function isBoardMediaFile(file: Pick<File, 'type' | 'name'>): boolean {
  return isImageFile(file) || isVideoFile(file);
}

/** Why a picture or video was refused, in words people read. */
export type MediaRefusal = 'unsupported_type' | 'too_large' | 'old_quicktime' | 'unplayable' | 'unavailable' | 'upload_failed' | 'decode_failed';

/** The message for a refusal. */
export function mediaRefusalMessage(reason: MediaRefusal, video: boolean): string {
  switch (reason) {
    case 'unsupported_type':
      return video ? 'The board plays MP4 and WebM videos.' : 'The board takes PNG, JPEG, GIF, WebP, SVG, AVIF and BMP pictures.';
    case 'too_large':
      return video ? `Videos can be up to ${MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024} MB.` : 'That picture is too large.';
    case 'old_quicktime':
      return 'That QuickTime video uses an old format. Export it as MP4 and try again.';
    case 'unplayable':
      return 'That video could not be played here.';
    case 'unavailable':
      return video ? 'Uploads aren’t available in this view, so videos can’t be added.' : 'Uploads aren’t available in this view.';
    case 'decode_failed':
      return 'That picture could not be read.';
    case 'upload_failed':
      return video ? 'The video couldn’t be uploaded. Try again in a moment.' : 'The picture couldn’t be uploaded. Try again in a moment.';
  }
}

/* -------------------------------------------------------------------------- */
/* Pictures                                                                   */
/* -------------------------------------------------------------------------- */

/** Pixel size of a picture. */
export interface PixelSize {
  w: number;
  h: number;
}

/** Decodes a picture (SVG through an `<img>`, which also works where `createImageBitmap` refuses SVG). */
async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (fileMimeType(blob as File) !== 'image/svg+xml') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to <img>, which decodes more formats in some browsers.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      // An SVG without a size: draw it at a reasonable default.
      image.width = 800;
      image.height = 600;
    }
    return image;
  } finally {
    // The decoded image stays drawable after the URL is gone.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function sourceSize(source: ImageBitmap | HTMLImageElement): PixelSize {
  return source instanceof HTMLImageElement ? { w: source.naturalWidth || source.width, h: source.naturalHeight || source.height } : { w: source.width, h: source.height };
}

function closeSource(source: ImageBitmap | HTMLImageElement): void {
  if (!(source instanceof HTMLImageElement)) source.close();
}

/** Pixel size of a picture file, or `undefined` when it cannot be decoded. */
export async function imagePixelSize(blob: Blob): Promise<PixelSize | undefined> {
  try {
    const source = await decodeImage(blob);
    const size = sourceSize(source);
    closeSource(source);
    return size.w > 0 && size.h > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

/** Draws a picture at most `maxEdge` pixels on its longest side. */
function drawWithin(source: ImageBitmap | HTMLImageElement | HTMLVideoElement, size: PixelSize, maxEdge: number): HTMLCanvasElement {
  const canvas = drawScaled(source, size.w, size.h, edgeScale(size.w, size.h, maxEdge), { smoothing: 'high' });
  if (!canvas) throw new Error('No 2D canvas.');
  return canvas;
}

/** True when any pixel is not fully opaque (such pictures keep transparency as WebP/PNG). */
function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) if (data[index]! < 255) return true;
  return false;
}

/** Encodes a canvas, WebP first (smallest), then JPEG or PNG as the browser allows. */
async function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const encoded = await encodePreferringWebp(canvas, quality, () => (hasTransparency(canvas) ? 'image/png' : 'image/jpeg'));
  if (!encoded) throw new Error('Could not encode the picture.');
  return encoded;
}

/**
 * Shrinks a picture until it is under `maxBytes` and `maxEdge`: each try
 * draws it smaller (×0.7) until the edge reaches {@link MIN_EDGE}.
 */
export async function downsampleImage(blob: Blob, options: { maxEdge: number; maxBytes: number }): Promise<Blob> {
  const source = await decodeImage(blob);
  try {
    const size = sourceSize(source);
    let edge = Math.min(options.maxEdge, Math.max(size.w, size.h));
    for (;;) {
      const encoded = await encodeCanvas(drawWithin(source, size, edge), 0.86);
      if (encoded.size <= options.maxBytes || edge <= MIN_EDGE) {
        if (encoded.size > options.maxBytes) throw new Error('The picture is too large even when shrunk.');
        return encoded;
      }
      edge = Math.max(MIN_EDGE, Math.floor(edge * SHRINK_RATIO));
    }
  } finally {
    closeSource(source);
  }
}

/** A small inline picture (`data:image/…;base64`) for boards without uploads. */
export async function inlineImageDataUrl(blob: Blob): Promise<string> {
  const small = await downsampleImage(blob, { maxEdge: INLINE_START_EDGE, maxBytes: MAX_INLINE_IMAGE_BYTES });
  return blobToDataUrl(small, () => new Error('Could not read the file.'));
}

/**
 * The picture to upload: GIFs as they are (so they keep moving), SVG, AVIF
 * and BMP re-encoded, and anything over the stored limits shrunk.
 */
export async function prepareImageUpload(file: Blob): Promise<Blob> {
  const type = fileMimeType(file as File);
  if (type === 'image/gif') return file;
  if (TRANSCODED_IMAGE_TYPES.includes(type)) return downsampleImage(file, { maxEdge: MAX_STORED_IMAGE_EDGE, maxBytes: MAX_STORED_IMAGE_BYTES });
  const size = await imagePixelSize(file);
  if (file.size <= MAX_STORED_IMAGE_BYTES && size !== undefined && Math.max(size.w, size.h) <= MAX_STORED_IMAGE_EDGE) return file;
  return downsampleImage(file, { maxEdge: MAX_STORED_IMAGE_EDGE, maxBytes: MAX_STORED_IMAGE_BYTES });
}

/* -------------------------------------------------------------------------- */
/* Videos                                                                     */
/* -------------------------------------------------------------------------- */

/** How long to wait for a video to load its first frame. */
const VIDEO_PROBE_MS = 8000;

/** The video type, or a refusal (old QuickTime files are not MP4 inside). */
async function videoContainerType(file: File): Promise<string | MediaRefusal> {
  const type = fileMimeType(file);
  if (type !== QUICKTIME) return VIDEO_MIME_TYPES.includes(type) ? type : 'unsupported_type';
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return bytes.length === 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp' ? 'video/mp4' : 'old_quicktime';
}

/** A probed video: its size, its type and its first frame as a picture. */
export interface VideoProbe {
  size: PixelSize;
  type: string;
  poster: Blob;
}

/** Loads a video file and grabs its first frame; a refusal when it cannot play here. */
export async function probeVideo(file: File): Promise<VideoProbe | MediaRefusal> {
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) return 'too_large';
  const type = await videoContainerType(file);
  if (!type.includes('/')) return type as MediaRefusal;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), VIDEO_PROBE_MS);
      video.addEventListener('loadeddata', () => {
        clearTimeout(timer);
        resolve(true);
      }, { once: true });
      video.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(false);
      }, { once: true });
      video.src = url;
    });
    if (!ready || video.videoWidth === 0 || video.videoHeight === 0) return 'unplayable';
    const size = { w: video.videoWidth, h: video.videoHeight };
    const poster = await encodeCanvas(drawWithin(video, size, 1280), 0.8);
    return { size, type, poster };
  } catch {
    return 'unplayable';
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** The file with its type filled in (dropped files sometimes have none). */
export function withMimeType(file: File, type = fileMimeType(file)): File {
  return file.type === type ? file : new File([file], file.name, { type });
}
