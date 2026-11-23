/**
 * The board file download: the board's elements as a self-contained JSON
 * file (see whiteboard-core's board file) that people can keep, share,
 * hand to an agent or import into another board.
 *
 * On top of the core file this adds what needs a browser: the outline in
 * layout-aware reading order, a small light-scheme preview picture with
 * authors hidden, and uploaded pictures embedded as inline JPEGs so the
 * file stands on its own. The preview is re-compressed losslessly in the
 * export Worker. A file that would pass the host's download cap
 * drops embedded pictures (largest first), then its preview. The file
 * never carries the board's address.
 */

import {
  buildBoardFile,
  boardFileName,
  boardFileJsonReplacer,
  isRasterDataUrl,
  orderElementsForReading,
  serializeBoardFile,
  type Board,
  type BoardElement,
  type ElementMeasures,
  type ImageElement,
} from '@open-artifact/whiteboard-core';
import { BOARD_FILE_IMAGE_MAX_CHARS, BOARD_FILE_JPEG_QUALITY, BOARD_FILE_PREVIEW_MAX_CHARS, BOARD_FILE_PREVIEW_SIZES, embedLongEdges, embedPixelSize, fitBoardFileToBudget } from './file-budget.ts';
import { optimizePng } from '@open-artifact/wasm-export';
import { exportFrameFor } from './frame.ts';
import { loadPictureAssets, RASTER_IMAGE_LOAD_TIMEOUT_MS, type ImageLoadTally, type PictureAssets } from './images.ts';
import { canvasToPngBlob, drawBoardCanvas } from './paint.ts';

/** What a board file is made from. */
export interface BoardFileInput {
  board: Board;
  measures?: ElementMeasures;
  /** How long pictures may take to load, ms. */
  timeoutMs?: number;
}

/** A board file ready to save. */
export interface BoardFileDownload {
  /** The download name (`<title>.json`). */
  name: string;
  data: Blob;
  /** What became of the board's pictures (embedded, timed out, failed or dropped). */
  tally: ImageLoadTally;
}

/** Lets the page breathe between heavy steps. */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A PNG as a data URL (encoded off the page's thread by the browser). */
function pngDataUrl(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The preview could not be read.'));
    reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  });
}

/** A light-scheme picture of the board with authors hidden, as a PNG data URL within the preview cap. */
async function renderPreview(elements: readonly BoardElement[], title: string, measures: ElementMeasures | undefined, assets: PictureAssets): Promise<string | undefined> {
  for (const size of BOARD_FILE_PREVIEW_SIZES) {
    const frame = exportFrameFor(elements, measures, size);
    if (!frame) return undefined;
    let url: string;
    try {
      const canvas = drawBoardCanvas({
        elements,
        title,
        ...(measures ? { measures } : {}),
        frame,
        scheme: 'light',
        images: assets.images,
        imageSources: assets.imageSources,
        icons: assets.icons,
        showAuthors: false,
        faceName: () => undefined,
      });
      let png: Blob;
      try {
        png = await canvasToPngBlob(canvas);
      } finally {
        canvas.width = 0;
      }
      url = await pngDataUrl(await optimizePng(png));
    } catch {
      return undefined;
    }
    if (url.startsWith('data:image/png') && url.length <= BOARD_FILE_PREVIEW_MAX_CHARS) return url;
    await yieldToPage();
  }
  return undefined;
}

/**
 * An uploaded picture as an inline JPEG on white, uncropped (the element
 * keeps its crop), shrunk until it fits what a board accepts inline.
 */
function embedPicture(img: HTMLImageElement): string | undefined {
  const natural = { w: img.naturalWidth, h: img.naturalHeight };
  if (natural.w === 0 || natural.h === 0) return undefined;
  for (const edge of embedLongEdges(natural)) {
    const size = embedPixelSize(natural, edge);
    const canvas = Object.assign(document.createElement('canvas'), { width: size.w, height: size.h });
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    try {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.drawImage(img, 0, 0, size.w, size.h);
      const url = canvas.toDataURL('image/jpeg', BOARD_FILE_JPEG_QUALITY);
      if (url.length <= BOARD_FILE_IMAGE_MAX_CHARS && isRasterDataUrl(url)) return url;
    } catch {
      return undefined;
    } finally {
      canvas.width = 0;
    }
  }
  return undefined;
}

/** True for a picture the file must embed to stand on its own (an upload or a web image). */
function needsEmbedding(image: ImageElement): boolean {
  return !/^data:/i.test(image.src);
}

/** Builds the board file. */
export async function exportBoardFile(input: BoardFileInput): Promise<BoardFileDownload> {
  const { measures } = input;
  // Scrub text before drawing the preview too. The live board keeps its working sharing links.
  const board: Board = JSON.parse(JSON.stringify(input.board, boardFileJsonReplacer));
  const elements = board.content.elements;
  const assets = await loadPictureAssets(elements, 'ink', input.timeoutMs ?? RASTER_IMAGE_LOAD_TIMEOUT_MS);
  try {
    const preview = await renderPreview(elements, board.title, measures, assets);
    const embeds = new Map<string, string>();
    for (const element of elements) {
      if (element.type !== 'image' || !needsEmbedding(element)) continue;
      const img = assets.images.get(assets.imageSources.get(element.id) ?? element.src);
      const uri = img ? embedPicture(img) : undefined;
      if (uri !== undefined) embeds.set(element.id, uri);
      await yieldToPage();
    }
    const assemble = (kept: ReadonlyMap<string, string>, withPreview: boolean): string =>
      serializeBoardFile(
        buildBoardFile(
          {
            ...board,
            content: {
              ...board.content,
              elements: elements.map((element): BoardElement => {
                if (element.type !== 'image') return element;
                const { src, video, crop, href, type, ...box } = element;
                const picture = needsEmbedding(element) ? kept.get(element.id) : src;
                // A portable copy of a video holds its poster. Local blob URLs belong to the source board.
                if (picture) return { ...box, type, src: picture, ...(crop && { crop }), ...(href && { href }) };
                const label = href ? `[Picture not included](${href})` : 'Picture not included';
                return { ...box, type: 'shape', kind: 'rect', color: 'white', text: label };
              }),
            },
          },
          {
            ...(withPreview && preview !== undefined ? { preview } : {}),
            readingOrder: (items) => orderElementsForReading(items, measures),
          },
        ),
      );
    const fitted = fitBoardFileToBudget(assemble, embeds);
    const pictures = elements.filter((element): element is ImageElement => element.type === 'image' && needsEmbedding(element));
    const dropped = pictures.filter((image) => assets.images.has(assets.imageSources.get(image.id) ?? image.src) && !fitted.embedded.has(image.id)).length;
    return {
      name: boardFileName(board.title),
      data: new Blob([fitted.text], { type: 'application/json' }),
      tally: { ...assets.tally, failed: assets.tally.failed + dropped },
    };
  } finally {
    assets.release();
  }
}
