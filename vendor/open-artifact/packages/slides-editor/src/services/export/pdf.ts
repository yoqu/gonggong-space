/**
 * PDF export: one page per slide, drawn as a JPEG with an invisible text
 * layer (so the words can be found, selected and copied), the slide's web
 * links as link annotations and one outline bookmark per slide. Speaker
 * notes, when asked for, follow each slide on pages of their own.
 */

import { SLIDE_HEIGHT, SLIDE_WIDTH, slideTitle } from '@open-artifact/slides-core';
import { buildPdf, type PdfPage, type PdfTextRun } from '@open-artifact/wasm-export';
import { linkAreas, mountSlide, slidePicture, textLines } from '../capture.ts';
import { canvasBlob } from '@open-artifact/export-kit';
import { BROWSER_LIMIT } from './files.ts';
import { breathe, noteStills, type ExportJob, type ExportSlide } from './job.ts';
import type { PdfQuality } from '../exports.ts';
import { paginate, wrapLines } from './notes.ts';

/** Pixels per slide px and JPEG quality of each setting. */
export const PDF_QUALITY: Record<PdfQuality, { scale: number; jpeg: number }> = {
  good: { scale: 1, jpeg: 0.8 },
  better: { scale: 1.5, jpeg: 0.85 },
  best: { scale: 2, jpeg: 0.9 },
};

/** Most pages in one file. */
const MAX_PAGES = 2000;
/** Most picture bytes in one file (leaves room under the download limit). */
const MAX_BYTES = Math.floor(BROWSER_LIMIT * 0.9);

/* Notes page layout, in slide px. */
// The deck format uses two canvas pixels per typographic point, as does the PPTX writer.
const PT_PER_PX = 0.5;
const MARGIN = 96;
const THUMB_W = 640;
const GUTTER = 64;
const NOTE_SIZE = 30;
const NOTE_LINE = 48;
const HEAD_SIZE = 36;
const NOTES_FONT = '"Helvetica Neue", Helvetica, Arial, "Noto Sans", sans-serif';
/** Most notes pages per slide. */
const MAX_NOTE_PAGES = 4;
const BOTTOM = SLIDE_HEIGHT - MARGIN;

/** The page size of every page, pt: 960×540 for 16:9, 720×540 for 4:3 (read at export time). */
const pageWidth = (): number => SLIDE_WIDTH * PT_PER_PX;
const PAGE_H = SLIDE_HEIGHT * PT_PER_PX;

/** Options of a PDF export. */
export interface PdfOptions {
  quality: PdfQuality;
  notes: boolean;
}

/** A canvas as a JPEG. */
async function jpegOf(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await canvasBlob(canvas, 'image/jpeg', quality);
  if (!blob) throw new Error('The browser would not draw the notes page.');
  return blob;
}

/** The size of a page's picture, bytes. */
const pictureBytes = (page: PdfPage): number => (page.jpeg instanceof Blob ? page.jpeg.size : page.jpeg.length);

/** Draws the notes pages of a slide. */
async function notesPages(entry: ExportSlide, thumb: Blob, scale: number, jpeg: number, job: ExportJob): Promise<PdfPage[]> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(SLIDE_WIDTH * scale);
  canvas.height = Math.round(SLIDE_HEIGHT * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const font = (size: number, weight = 400): string => `${weight} ${size}px ${NOTES_FONT}`;
  ctx.font = font(NOTE_SIZE);
  const width = SLIDE_WIDTH - 2 * MARGIN;
  const lines = wrapLines(entry.slide.notes.trim(), width, (text) => ctx.measureText(text).width);
  const thumbHeight = THUMB_W * SLIDE_HEIGHT / SLIDE_WIDTH;
  const firstTop = MARGIN + thumbHeight + 56;
  const firstLines = Math.floor((BOTTOM - firstTop) / NOTE_LINE);
  const perPage = Math.floor((BOTTOM - MARGIN) / NOTE_LINE);
  const { pages, cut } = paginate(lines, firstLines, perPage, MAX_NOTE_PAGES);
  if (cut) job.notes.add('notesCut', entry.number);
  let picture: ImageBitmap | null = null;
  try {
    picture = await createImageBitmap(thumb);
  } catch {
    picture = null;
  }
  const out: PdfPage[] = [];
  for (const [index, pageLines] of pages.entries()) {
    const text: PdfTextRun[] = [];
    const write = (value: string, x: number, baseline: number, size: number, weight = 400): void => {
      ctx.font = font(size, weight);
      ctx.fillText(value, x, baseline);
      if (value.trim()) {
        text.push({ text: value, x: x * PT_PER_PX, baseline: baseline * PT_PER_PX, size: size * PT_PER_PX, width: ctx.measureText(value).width * PT_PER_PX });
      }
    };
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
    ctx.textBaseline = 'alphabetic';
    let top = MARGIN;
    if (index === 0) {
      if (picture) ctx.drawImage(picture, MARGIN, MARGIN, THUMB_W, thumbHeight);
      ctx.strokeStyle = '#d4d4d4';
      ctx.lineWidth = 2;
      ctx.strokeRect(MARGIN - 1, MARGIN - 1, THUMB_W + 2, thumbHeight + 2);
      const column = MARGIN + THUMB_W + GUTTER;
      ctx.fillStyle = '#111111';
      write(`Slide ${entry.number}`, column, MARGIN + HEAD_SIZE, HEAD_SIZE, 600);
      const title = slideTitle(entry.slide, 160);
      if (title) {
        ctx.font = font(NOTE_SIZE);
        ctx.fillStyle = '#666666';
        const titleLines = wrapLines(title, SLIDE_WIDTH - MARGIN - column, (t) => ctx.measureText(t).width).slice(0, 5);
        titleLines.forEach((line, i) => write(line, column, MARGIN + HEAD_SIZE + 24 + (i + 1) * NOTE_LINE, NOTE_SIZE));
      }
      top = firstTop;
    }
    ctx.fillStyle = '#222222';
    pageLines.forEach((line, i) => write(line, MARGIN, top + i * NOTE_LINE + NOTE_SIZE * 1.2, NOTE_SIZE));
    out.push({
      jpeg: await jpegOf(canvas, jpeg),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      width: pageWidth(),
      height: PAGE_H,
      text,
    });
  }
  if (picture && 'close' in picture) picture.close();
  return out;
}

/** Writes the deck as a PDF. */
export async function exportPdf(job: ExportJob, options: PdfOptions): Promise<Blob> {
  const { scale, jpeg } = PDF_QUALITY[options.quality];
  const pages: PdfPage[] = [];
  let bytes = 0;
  for (const [index, entry] of job.slides.entries()) {
    if (pages.length >= MAX_PAGES || bytes >= MAX_BYTES) {
      for (const rest of job.slides.slice(index)) job.notes.add('pageLimit', rest.number);
      break;
    }
    job.begin(entry.number);
    noteStills(job, entry);
    const mounted = await mountSlide(entry.slide, job.capture);
    try {
      const picture = await slidePicture(mounted, job.capture, { scale, type: 'image/jpeg', quality: jpeg, background: '#ffffff' });
      bytes += picture.blob.size;
      const text: PdfTextRun[] = textLines(mounted.root).map((line) => ({
        text: line.text,
        x: line.x * PT_PER_PX,
        baseline: line.baseline * PT_PER_PX,
        size: line.size * PT_PER_PX,
        width: line.width * PT_PER_PX,
      }));
      const links = linkAreas(mounted.root).map((area) => ({
        uri: area.href,
        x: area.x * PT_PER_PX,
        y: area.y * PT_PER_PX,
        width: area.w * PT_PER_PX,
        height: area.h * PT_PER_PX,
      }));
      pages.push({
        jpeg: picture.blob,
        pixelWidth: picture.width,
        pixelHeight: picture.height,
        width: pageWidth(),
        height: PAGE_H,
        text,
        links,
        bookmark: `${entry.number}. ${slideTitle(entry.slide) ?? `Slide ${entry.number}`}`,
      });
      if (options.notes && entry.slide.notes.trim()) {
        for (const page of await notesPages(entry, picture.blob, scale, jpeg, job)) {
          bytes += pictureBytes(page);
          pages.push(page);
        }
      }
    } finally {
      mounted.dispose();
    }
    job.progress(index + 1);
    await breathe();
  }
  if (pages.length === 0) throw new Error('There are no slides to export.');
  // Assembled in the export Worker: the pictures travel there as Blobs.
  const pdf = await buildPdf(pages, { title: job.title });
  return new Blob([pdf as BlobPart], { type: 'application/pdf' });
}
