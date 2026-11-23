/**
 * PNG export: one slide as a 1920×1080 picture, re-compressed losslessly in
 * the export Worker.
 */

import { optimizePng } from '@open-artifact/wasm-export';
import { mountSlide, slidePicture } from '../capture.ts';
import { noteStills, type ExportJob } from './job.ts';

/** Draws the job's (single) slide as a PNG. */
export async function exportPng(job: ExportJob): Promise<Blob> {
  const entry = job.slides[0];
  if (!entry) throw new Error('There is no slide to export.');
  job.begin(entry.number);
  noteStills(job, entry);
  const mounted = await mountSlide(entry.slide, job.capture);
  try {
    const picture = await slidePicture(mounted, job.capture, { scale: 1, type: 'image/png' });
    const bytes = await optimizePng(picture.blob);
    job.progress(1);
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  } finally {
    mounted.dispose();
  }
}
