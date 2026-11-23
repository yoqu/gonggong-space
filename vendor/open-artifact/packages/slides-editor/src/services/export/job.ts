/**
 * What every exporter receives: the slides to write (already filtered),
 * the capture context, the notes collector and progress reporting.
 */

import { videoThumbnailUrl, type ImageNode, type Slide, type SlideNode } from '@open-artifact/slides-core';
import type { CaptureContext } from '../capture.ts';
import type { ExportNotes } from './notes.ts';

/** A slide to export, with its number in the deck (1-based, counting every slide). */
export interface ExportSlide {
  slide: Slide;
  number: number;
}

/** One export run. */
export interface ExportJob {
  /** The deck title as shown. */
  title: string;
  slides: ExportSlide[];
  capture: CaptureContext;
  notes: ExportNotes;
  /** Marks the slide being worked on: notes raised by capture callbacks attach to it. */
  begin(number: number): void;
  /** Reports how many slides are finished. */
  progress(done: number): void;
}

/** Calls `visit` for every node of a slide, depth first in source order. */
export function forEachNode(slide: Slide, visit: (node: SlideNode) => void): void {
  const walk = (nodes: readonly SlideNode[]): void => {
    for (const node of nodes) {
      visit(node);
      if (node.kind === 'box') walk(node.children);
    }
  };
  walk(slide.children);
}

/** True when any pinned child of the slide has a build. */
export function hasBuilds(slide: Slide): boolean {
  return slide.children.some((child) => child.buildIn || child.buildOut);
}

/** The video frames of a slide. */
export function videoFrames(slide: Slide): ImageNode[] {
  const out: ImageNode[] = [];
  forEachNode(slide, (node) => {
    if (node.kind === 'image' && node.video) out.push(node);
  });
  return out;
}

/** Pictures of a clip use its poster. */
export function noteStills(job: ExportJob, entry: ExportSlide): void {
  for (const frame of videoFrames(entry.slide)) {
    const poster = frame.src || (frame.video?.link ? videoThumbnailUrl(frame.video.link) : null);
    job.notes.add(poster ? 'video' : 'videoMissing', entry.number);
  }
}

/** Gives the page a moment to paint and handle input between slides. */
export function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
