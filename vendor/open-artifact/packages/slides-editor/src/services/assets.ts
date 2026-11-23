/**
 * Pictures and clips: uploading (pictures are downscaled to a 2560px long
 * edge first; clips over 20 MB are re-encoded in the page), and placing up
 * to six files on the current slide at once.
 */

import { LIMITS, newImage, parseVideoUrl, pinNode, round2, setImageSource, setVideo, SLIDE_HEIGHT, SLIDE_WIDTH, type ImageNode, type NodePath, type Rect, type SlideNode } from '@open-artifact/slides-core';
import { drawScaled } from '@open-artifact/export-kit';
import { toast } from '@open-artifact/ui';
import { changeCurrent, centeredRect, currentSlide, insertPinned } from './commands.ts';
import { resolveSrc, session } from './session.ts';
import { nodeAt, updateNodeAt, videoThumbnailUrl } from '@open-artifact/slides-core';

/** Picture types the deck accepts. */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/;
/** Clip types the deck accepts. */
const VIDEO_TYPES = /^video\/(mp4|quicktime|webm)$/;

/** An uploaded file and its natural size. */
export interface Uploaded {
  src: string;
  width: number;
  height: number;
  /** For a clip: the uploaded poster frame. */
  poster?: string;
}

/** True for a file the deck can place. */
export function isPlaceable(file: File): boolean {
  return IMAGE_TYPES.test(file.type) || VIDEO_TYPES.test(file.type) || /\.(png|jpe?g|gif|webp|svg|mp4|mov|webm)$/i.test(file.name);
}

/** True for a clip. */
export function isVideoFile(file: File): boolean {
  return VIDEO_TYPES.test(file.type) || /\.(mp4|mov|webm)$/i.test(file.name);
}

/** Loads a picture to read its size (and draw it). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The picture could not be read.'));
    image.src = url;
  });
}

/** Downscales a raster picture whose long edge exceeds the limit. Keeps the type where it can. */
async function downscale(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const width = image.naturalWidth || 1;
    const height = image.naturalHeight || 1;
    const edge = Math.max(width, height);
    // SVG and GIF stay as they are (vector / animation).
    if (edge <= LIMITS.imageEdge || /svg|gif/.test(file.type)) return { blob: file, width, height };
    const canvas = drawScaled(image, width, height, LIMITS.imageEdge / edge, { minSide: 0 });
    if (!canvas) throw new Error('The picture could not be drawn.');
    const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    return { blob: blob ?? file, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads a picture. */
export async function uploadImage(file: File): Promise<Uploaded> {
  const assets = session().assets;
  if (!assets) throw new Error('Uploads are not available here.');
  const { blob, width, height } = await downscale(file);
  const record = await assets.upload(blob, { name: file.name });
  return { src: record.url, width, height };
}

/** Reads a clip's size and a poster frame (as a JPEG). */
async function probeVideo(blob: Blob): Promise<{ width: number; height: number; duration: number; poster: Blob | null }> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('The clip could not be read.'));
    });
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    let poster: Blob | null = null;
    try {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 1500);
      });
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, LIMITS.imageEdge / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    } catch {
      poster = null;
    }
    return { width, height, duration: video.duration || 0, poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Re-encodes a clip to fit under the upload limit by playing it into a
 * MediaRecorder at a bitrate chosen from its length. Runs in real time.
 */
async function shrinkVideo(file: File, duration: number, onProgress: (fraction: number) => void): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot compress clips. Compress it to under 20 MB first.');
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('The clip could not be read.'));
    });
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!capture) throw new Error('This browser cannot compress clips. Compress it to under 20 MB first.');
    const stream = capture.call(video);
    const seconds = Math.max(1, duration || video.duration || 60);
    // 90% of the limit, leaving room for the container.
    const bitrate = Math.max(250_000, Math.floor((LIMITS.videoBytes * 8 * 0.9) / seconds));
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 96_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    video.ontimeupdate = () => onProgress(Math.min(1, video.currentTime / seconds));
    video.onended = () => recorder.stop();
    recorder.start(1000);
    await video.play();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    if (blob.size > LIMITS.videoBytes) throw new Error('The clip is still over 20 MB after compressing. Trim it first.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads a clip (compressing it first when it is over the limit) and its poster frame. */
export async function uploadVideo(file: File): Promise<Uploaded> {
  const assets = session().assets;
  if (!assets) throw new Error('Uploads are not available here.');
  const probe = await probeVideo(file);
  let data: Blob = file;
  if (file.size > LIMITS.videoBytes) {
    const id = toast.add({ title: 'Compressing…', description: 'Keep this tab open until the clip is placed.', timeout: 0 });
    try {
      data = await shrinkVideo(file, probe.duration, (fraction) =>
        toast.update(id, { title: `Compressing… ${Math.round(fraction * 100)}%`, description: 'Keep this tab open until the clip is placed.' }),
      );
    } finally {
      toast.close(id);
    }
  }
  const record = await assets.upload(data, { name: file.name });
  const poster = probe.poster ? (await assets.upload(probe.poster, { name: `${file.name}.jpg` })).url : undefined;
  return { src: record.url, width: probe.width, height: probe.height, ...(poster ? { poster } : {}) };
}

/** Fits (w, h) inside (maxW, maxH), keeping the aspect. */
function fitSize(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { w: round2(w * scale), h: round2(h * scale) };
}

/** A pinned picture / clip node for an upload, centered at `at` (slide px). */
function nodeFor(upload: Uploaded, video: boolean, at: { x: number; y: number }, n: number): ImageNode {
  const size = fitSize(upload.width, upload.height, 1200, 760);
  const rect: Rect = {
    x: round2(Math.max(0, Math.min(SLIDE_WIDTH - size.w, at.x - size.w / 2 + n * 32))),
    y: round2(Math.max(0, Math.min(SLIDE_HEIGHT - size.h, at.y - size.h / 2 + n * 32))),
    ...size,
  };
  if (!video) return newImage(rect, upload.src);
  let node = newImage(rect, upload.poster);
  node = setVideo(node, { src: upload.src, ...(upload.poster ? { still: 'clip' } : {}) });
  return node;
}

/**
 * Places files on the current slide (at most six at once), centered at `at`
 * (slide px; default the slide center). Unsupported files are reported.
 */
export async function placeFiles(files: readonly File[], at: { x: number; y: number } = { x: SLIDE_WIDTH / 2, y: SLIDE_HEIGHT / 2 }): Promise<void> {
  if (!currentSlide()) return;
  const placeable = files.filter(isPlaceable);
  if (placeable.length < files.length) toast.add({ title: 'Some files were skipped', description: 'Pictures (PNG, JPEG, GIF, WebP, SVG) and clips (MP4, MOV, WebM) can be placed.' });
  if (placeable.length > LIMITS.insertImages) toast.add({ title: `Placing the first ${LIMITS.insertImages} files` });
  const chosen = placeable.slice(0, LIMITS.insertImages);
  if (chosen.length === 0) return;
  const pending = toast.add({ title: chosen.length === 1 ? 'Uploading…' : `Uploading ${chosen.length} files…`, timeout: 0 });
  const nodes: SlideNode[] = [];
  try {
    for (const [i, file] of chosen.entries()) {
      try {
        const video = isVideoFile(file);
        const upload = video ? await uploadVideo(file) : await uploadImage(file);
        nodes.push(nodeFor(upload, video, at, i));
      } catch (error) {
        toast.add({ title: `${file.name} could not be added`, description: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    toast.close(pending);
  }
  insertPinned(nodes.length === 1 ? 'Add picture' : `Add ${nodes.length} pictures`, nodes);
}

/** Replaces the picture of the image at `path` (keeps its frame). */
export async function replaceImage(path: NodePath, file: File): Promise<void> {
  try {
    const video = isVideoFile(file);
    const upload = video ? await uploadVideo(file) : await uploadImage(file);
    changeCurrent(video ? 'Replace clip' : 'Replace picture', (slide) =>
      updateNodeAt(slide, path, (node) => {
        if (node.kind !== 'image') return node;
        if (!video) return setImageSource(setVideo(node, null), upload.src, node.alt);
        return setVideo(setImageSource(node, upload.poster, node.alt), { src: upload.src, link: undefined, ...(upload.poster ? { still: 'clip' } : {}) });
      }),
    );
  } catch (error) {
    toast.add({ title: `${file.name} could not be added`, description: error instanceof Error ? error.message : String(error) });
  }
}

/** Sets a custom poster frame for the clip at `path`. */
export async function replacePoster(path: NodePath, file: File): Promise<void> {
  try {
    const upload = await uploadImage(file);
    changeCurrent('Set clip cover', (slide) =>
      updateNodeAt(slide, path, (node) => (node.kind === 'image' ? setVideo(setImageSource(node, upload.src, node.alt), { still: 'custom' }) : node)),
    );
  } catch (error) {
    toast.add({ title: 'The cover could not be set', description: error instanceof Error ? error.message : String(error) });
  }
}

/** Uploads `blob` as the clip cover of the image at `path`. */
async function setPosterBlob(path: NodePath, blob: Blob, still: string, label: string): Promise<void> {
  const upload = await uploadImage(new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' }));
  changeCurrent(label, (slide) => updateNodeAt(slide, path, (node) => (node.kind === 'image' ? setVideo(setImageSource(node, upload.src, node.alt), { still }) : node)));
}

/**
 * Uses a frame of the uploaded clip at `path` as its cover: the frame at
 * `seconds` (clamped to the clip's length).
 */
export async function posterFromClip(path: NodePath, seconds = 0.5): Promise<void> {
  const slide = currentSlide();
  const node = slide ? nodeAt(slide, path) : undefined;
  const src = node?.kind === 'image' ? node.video?.src : undefined;
  if (!src) return;
  try {
    const response = await fetch(resolveSrc(src));
    if (!response.ok) throw new Error(`The clip could not be read (${response.status}).`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('The clip could not be read.'));
      });
      video.currentTime = Math.max(0, Math.min(seconds, (video.duration || 1) - 0.05));
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 1500);
      });
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, LIMITS.imageEdge / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!poster) throw new Error('The frame could not be captured.');
      await setPosterBlob(path, poster, 'clip', 'Use clip frame as cover');
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    toast.add({ title: 'The cover could not be set', description: error instanceof Error ? error.message : String(error) });
  }
}

/** Uses the hosting site's thumbnail as the cover of the linked clip at `path`. */
export async function posterFromSite(path: NodePath): Promise<void> {
  const slide = currentSlide();
  const node = slide ? nodeAt(slide, path) : undefined;
  const link = node?.kind === 'image' ? node.video?.link : undefined;
  const url = link ? videoThumbnailUrl(link) : null;
  if (!url) {
    toast.add({ title: "This site doesn't offer a thumbnail", description: 'Choose a picture for the cover instead.' });
    return;
  }
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`The thumbnail could not be loaded (${response.status}).`);
    await setPosterBlob(path, await response.blob(), 'site', "Use site's thumbnail as cover");
  } catch (error) {
    toast.add({ title: 'The thumbnail could not be loaded', description: error instanceof Error ? error.message : 'Choose a picture for the cover instead.' });
  }
}

/**
 * Adds a hosted clip from its link (YouTube, Vimeo, Loom, Google Drive).
 * Returns false when the link is not one of those.
 */
export function insertVideoLink(url: string, path?: NodePath): boolean {
  const link = parseVideoUrl(url.trim());
  if (!link) return false;
  if (path) {
    const slide = currentSlide();
    const node = slide ? nodeAt(slide, path) : undefined;
    if (node?.kind === 'image') {
      changeCurrent('Set video link', (s) => updateNodeAt(s, path, (n) => (n.kind === 'image' ? setVideo(n, { link, src: undefined }) : n)));
      return true;
    }
  }
  const node = setVideo(pinNode({ kind: 'image', style: { 'object-fit': 'cover' } }, centeredRect(1120, 630)) as ImageNode, { link });
  insertPinned('Add video', [node]);
  return true;
}

/** Opens the file picker. */
export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Accept string of the picture / clip picker. */
export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/quicktime,video/webm,.mov';
