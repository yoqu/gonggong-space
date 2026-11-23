/**
 * Adding pictures and videos to the board, from the toolbar's file picker,
 * a drop or a paste.
 *
 * Pictures are uploaded to the artifact's asset store (`/_blob/<id>`),
 * shrunk first when over the stored limits. Without uploads, or when an
 * upload fails, a picture goes in as a small inline image instead. Videos
 * need uploads: the video is stored and its first frame becomes the
 * picture shown until it plays.
 *
 * New items land at the given board point (a drop) or the middle of the
 * view, side by side, and end up selected. Each file is sized first, so
 * while it uploads a placeholder shows where it will land, here and on
 * other pages (`collab/uploads.ts`).
 *
 * Other files (text files) are attached to the Ask panel instead, which
 * opens for them (`collab/attached-files.ts`); a mixed drop does both.
 */

import { toast } from '@open-artifact/ui';
import { MAX_ELEMENT_SIZE, createElementId, wouldExceedElementLimit, type ImageElement } from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import {
  fileMimeType,
  inlineImageDataUrl,
  isBoardMediaFile,
  isImageFile,
  isVideoFile,
  imagePixelSize,
  mediaRefusalMessage,
  prepareImageUpload,
  probeVideo,
  withMimeType,
  type MediaRefusal,
  type PixelSize,
  type VideoProbe,
} from '../lib/media.ts';
import { offerFilesToAsk } from '../collab/AskPanel.tsx';
import { unsupportedDropMessage } from '../collab/attached-files.ts';
import { endUpload, showUpload } from '../collab/uploads.ts';
import { changeElements, useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useSelection } from '../state/selection.ts';
import { revealElements, viewCenter } from './navigation.ts';
import { maybeSession } from './session.ts';

/** Longest edge of a new picture, in screen pixels at the current zoom. */
const NEW_MEDIA_SCREEN_EDGE = 400;
/** Smallest edge of a new picture, in board units. */
const MIN_MEDIA_EDGE = 16;
/** Space between pictures added together. */
const MEDIA_GAP = 24;

/** A picture or video sized and placed, about to upload. */
interface PlacedMedia {
  file: File;
  /** The video's probe (videos only). */
  probe?: VideoProbe;
  /** Where it lands. */
  element: Pick<ImageElement, 'id' | 'x' | 'y' | 'w' | 'h'>;
  /** The picture itself while it uploads (an object URL). */
  preview: string;
}

/** A picture or video uploaded: what its element shows. */
interface UploadedMedia {
  src: string;
  video?: string;
}

/** Uploads a blob; `undefined` when uploads are unavailable or fail. */
async function upload(blob: Blob, name: string): Promise<string | undefined> {
  const assets = maybeSession()?.assets;
  if (!assets) return undefined;
  try {
    const record = await assets.upload(blob, { name });
    return record.url;
  } catch {
    return undefined;
  }
}

/** The pixel size of a picture, or with a video its probe (videos need uploads). */
async function sizeMedia(file: File): Promise<{ size: PixelSize; probe?: VideoProbe } | MediaRefusal> {
  if (isVideoFile(file) && !isImageFile(file)) {
    if (!maybeSession()?.assets) return 'unavailable';
    const probe = await probeVideo(file);
    return typeof probe === 'string' ? probe : { size: probe.size, probe };
  }
  const size = await imagePixelSize(file);
  return size === undefined ? 'decode_failed' : { size };
}

/** Uploads one picture: to the asset store when possible, else inline. */
async function uploadPicture(file: File): Promise<UploadedMedia | MediaRefusal> {
  const gifTooLarge = fileMimeType(file) === 'image/gif' && file.size > 2 * 1024 * 1024;
  if (!gifTooLarge && maybeSession()?.assets) {
    try {
      const prepared = await prepareImageUpload(file);
      const url = await upload(prepared, file.name);
      if (url !== undefined) return { src: url };
    } catch {
      // Fall back to an inline picture below.
    }
  }
  try {
    return { src: await inlineImageDataUrl(file) };
  } catch {
    return 'too_large';
  }
}

/** Uploads one video and its first frame (both need uploads). */
async function uploadVideo(file: File, probe: VideoProbe): Promise<UploadedMedia | MediaRefusal> {
  const video = await upload(withMimeType(file, probe.type), file.name);
  if (video === undefined) return 'upload_failed';
  const poster = (await upload(probe.poster, `${file.name}.poster`)) ?? (await inlineImageDataUrl(probe.poster).catch(() => undefined));
  if (poster === undefined) return 'upload_failed';
  return { src: poster, video };
}

/** The size a new picture is drawn at: its own size, but at most a comfortable share of the view. */
function displaySize(size: PixelSize): PixelSize {
  const zoom = useCamera.getState().camera.zoom;
  const longest = Math.max(size.w, size.h);
  const scale = Math.min(1, NEW_MEDIA_SCREEN_EDGE / zoom / longest, MAX_ELEMENT_SIZE / longest);
  return { w: Math.max(MIN_MEDIA_EDGE, Math.round(size.w * scale)), h: Math.max(MIN_MEDIA_EDGE, Math.round(size.h * scale)) };
}

/** Lays pictures of `sizes` out side by side, centered on a point. */
function placeMedia(sizes: readonly PixelSize[], center: Point): Array<Pick<ImageElement, 'id' | 'x' | 'y' | 'w' | 'h'>> {
  const drawn = sizes.map(displaySize);
  const totalW = drawn.reduce((sum, size) => sum + size.w, 0) + MEDIA_GAP * (drawn.length - 1);
  let x = center.x - totalW / 2;
  return drawn.map((size) => {
    const box = { id: createElementId(), x: Math.round(x), y: Math.round(center.y - size.h / 2), w: size.w, h: size.h };
    x += size.w + MEDIA_GAP;
    return box;
  });
}

/** Message for files the board does not take (when they cannot be attached to a request either). */
export function unsupportedFilesMessage(): string {
  return unsupportedDropMessage(false);
}

/**
 * Adds pictures and videos to the board. Other files are offered to the Ask
 * panel as attachments (or, when this viewer cannot ask, refused with a
 * notice).
 */
export async function insertFiles(files: readonly File[], at?: Point): Promise<void> {
  if (!maybeSession()?.canEdit) return;
  const media = files.filter(isBoardMediaFile);
  if (media.length < files.length) offerFilesToAsk(files.filter((file) => !isBoardMediaFile(file)));
  if (media.length === 0) return;
  const room = !wouldExceedElementLimit(useBoard.getState().board.content, media.length);
  if (!room) {
    toast.add({ title: 'The board is full.', description: 'Remove something to make room.' });
    return;
  }
  const center = at ?? viewCenter();
  const sized = await Promise.all(media.map(sizeMedia));
  const refused: Array<readonly [MediaRefusal, File]> = [];
  const sizedFiles: Array<{ file: File; size: PixelSize; probe?: VideoProbe }> = [];
  sized.forEach((result, index) => {
    if (typeof result === 'string') refused.push([result, media[index]!]);
    else sizedFiles.push({ file: media[index]!, ...result });
  });
  const boxes = placeMedia(
    sizedFiles.map((item) => item.size),
    center,
  );
  const placed: PlacedMedia[] = sizedFiles.map((item, index) => {
    const element = boxes[index]!;
    const preview = URL.createObjectURL(item.probe?.poster ?? item.file);
    showUpload(element, preview);
    return { file: item.file, ...(item.probe ? { probe: item.probe } : {}), element, preview };
  });
  const uploaded = await Promise.all(placed.map((item) => (item.probe ? uploadVideo(item.file, item.probe) : uploadPicture(item.file))));
  const elements: ImageElement[] = [];
  uploaded.forEach((result, index) => {
    const item = placed[index]!;
    if (typeof result === 'string') refused.push([result, item.file]);
    else elements.push({ ...item.element, type: 'image', src: result.src, ...(result.video !== undefined ? { video: result.video } : {}) });
  });
  if (refused.length > 0) {
    const [reason, file] = refused[0]!;
    toast.add({ title: mediaRefusalMessage(reason, isVideoFile(file)), ...(refused.length > 1 ? { description: `${refused.length} files were not added.` } : {}) });
  }
  const added =
    elements.length > 0 &&
    changeElements((current) => [...current, ...elements], { label: elements.length === 1 ? (elements[0]!.video ? 'Add video' : 'Add picture') : 'Add pictures' });
  const stored = new Set(added ? elements.map((element) => element.id) : []);
  for (const item of placed) {
    endUpload(item.element.id, stored.has(item.element.id) ? item.element.id : undefined);
    URL.revokeObjectURL(item.preview);
  }
  if (!added) return;
  useSelection.getState().select(elements.map((element) => element.id));
  revealElements(elements);
}
