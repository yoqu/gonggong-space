/**
 * "PowerPoint, pictures": each slide becomes one full-bleed picture with the
 * slide's text as its alternative text, plus the speaker notes and the
 * slide's transition. Looks exactly like the deck in any app, but nothing
 * on it is editable.
 */

import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@open-artifact/slides-core';
import { mountSlide, slidePicture, textLines } from '../capture.ts';
import { breathe, hasBuilds, noteStills, type ExportJob } from './job.ts';
import { writePptx, type PptxMedia, type PptxSlide } from './ooxml.ts';

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
/** Device pixels per slide px of a slide picture. */
const PICTURE_SCALE = 1;
/** JPEG quality of slide pictures. */
const PICTURE_QUALITY = 0.9;
/** Longest alternative text of a slide picture, in characters. */
export const PICTURE_ALT_MAX = 1000;

/** A slide's text as one line of alternative text, cut to {@link PICTURE_ALT_MAX}. */
export function pictureAltText(lines: readonly string[], max = PICTURE_ALT_MAX): string {
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  if ([...text].length <= max) return text;
  return `${[...text].slice(0, max - 1).join('').trimEnd()}…`;
}

/** Writes the deck as a PowerPoint file of slide pictures. */
export async function exportPicturePptx(job: ExportJob): Promise<Blob> {
  const media: PptxMedia[] = [];
  const slides: PptxSlide[] = [];
  let transition: PptxSlide['transition'];
  for (const [index, entry] of job.slides.entries()) {
    job.begin(entry.number);
    noteStills(job, entry);
    if (hasBuilds(entry.slide)) job.notes.add('builds', entry.number);
    const mounted = await mountSlide(entry.slide, job.capture);
    try {
      const picture = await slidePicture(mounted, job.capture, { scale: PICTURE_SCALE, type: 'image/jpeg', quality: PICTURE_QUALITY, background: '#ffffff' });
      const key = `image${media.length + 1}`;
      media.push({ key, data: new Uint8Array(await picture.blob.arrayBuffer()), type: 'jpeg' });
      const name = `Slide ${entry.number}`;
      slides.push({
        elements: [
          {
            type: 'picture',
            name,
            box: { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
            media: key,
            description: pictureAltText(textLines(mounted.root).map((line) => line.text)) || name,
          },
        ],
        notes: entry.slide.notes.trim() || undefined,
        transition,
      });
    } finally {
      mounted.dispose();
    }
    const own = entry.slide.transition;
    if (own === 'magic') job.notes.add('magic', entry.number);
    transition = own === 'magic' ? 'fade' : own;
    job.progress(index + 1);
    await breathe();
  }
  if (slides.length === 0) throw new Error('There are no slides to export.');
  const bytes = await writePptx({ title: job.title, slides, media, created: new Date(), width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  return new Blob([bytes as BlobPart], { type: PPTX_TYPE });
}
