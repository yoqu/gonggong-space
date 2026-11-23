/**
 * Comments on the deck: the Slides adapter of the shared comments controller
 * (`@open-artifact/editor-kit`, comments.ts). The host stores the threads;
 * this file says what a slide anchor is and where it points. A thread is
 * anchored to:
 * - a whole slide (`{slide}`),
 * - an element of a slide (`{slide, el}`, `el` being its view-context id),
 * - a point on an element or the slide (`{slide, el?, x, y}` in slide px),
 * - an area drawn on the slide (`{slide, x, y, w, h}`),
 * - or the whole artifact (`{}`).
 *
 * Comment mode (C, or the Shell's Comment button) turns clicks on the stage
 * into new threads; the list shows every thread. Unresolved counts appear on
 * slide thumbnails.
 */

import { contextId, nodeAt, nodeLabel, resolveContextId, type NodePath, type Slide } from '@open-artifact/slides-core';
import type { CommentThread, JsonRecord } from '@open-artifact/runtime';
import { createComments } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { useAgent } from './agent.ts';
import { maybeSession } from './session.ts';

/** Where a thread sits. */
export interface SlideAnchor {
  slide?: string;
  el?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** True when this viewer is a commenter or more. */
const commenter = (): boolean => {
  const s = maybeSession();
  return Boolean(s?.shell && s.viewer.role !== 'viewer');
};

/** The deck's comments. */
export const slidesComments = createComments<SlideAnchor>({
  parse: parseAnchor,
  serialize: (anchor) => JSON.stringify(anchor),
  label: (anchor) => anchorLabel(anchor),
  location: (anchor) => locationOf(anchor),
  reveal: (anchor) => revealAnchor(anchor),
  canComment: commenter,
  // Anyone who may comment may hand a thread to the agent.
  canSendToAgent: commenter,
  agentName: () => useAgent.getState().status.name,
  agentWakesIdle: () => useAgent.getState().status.wakesIdle,
  onModeChange(on) {
    if (on) useView.getState().endTextEdit();
  },
  noun: 'deck',
  maxThreads: 200,
  notify: (message) => toast.add(message),
});

/** The comments store. */
export const useComments = slidesComments.store;

/** True when this viewer may write comments (commenters and up). */
export const canComment = slidesComments.canComment;

/** Ask the frame to enter comment mode at the selected slide or element. */
export function requestAnchoredComment(anchor: SlideAnchor): void {
  if (canComment()) maybeSession()?.shell?.requestCommentMode(true, JSON.stringify(anchor));
}

/** Loads the threads and keeps them current. */
export async function startComments(): Promise<void> {
  const host = maybeSession();
  if (host?.shell) await slidesComments.start(host.comments);
}

/** Reads a stored anchor; anything unreadable is the whole deck. */
export function parseAnchor(text: string): SlideAnchor {
  try {
    const value = JSON.parse(text) as SlideAnchor;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** Reads a thread's anchor. */
export const anchorOf = slidesComments.anchorOf;

/** Unresolved thread counts by slide id. */
export function openCounts(threads: readonly CommentThread[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (thread.status !== 'open') continue;
    const slide = anchorOf(thread).slide;
    if (slide) counts.set(slide, (counts.get(slide) ?? 0) + 1);
  }
  return counts;
}

/** The element path an anchor names on its slide, if it still resolves. */
export function anchorPath(slide: Slide, anchor: SlideAnchor): NodePath | null {
  if (!anchor.el) return null;
  return resolveContextId(slide, anchor.el)?.path ?? null;
}

/** A short label of an anchor: `Slide 3 › Text "Q3 revenue"`. */
export function anchorLabel(anchor: SlideAnchor): string {
  if (!anchor.slide) return 'Whole deck';
  const deck = useDeck.getState();
  const n = deckOrder(deck).indexOf(anchor.slide) + 1;
  const slide = deck.slides[anchor.slide]?.slide;
  const head = n > 0 ? `Slide ${n}` : 'Deleted slide';
  if (!slide) return head;
  const path = anchorPath(slide, anchor);
  const node = path ? nodeAt(slide, path) : undefined;
  if (node) return `${head} › ${nodeLabel(node, 40)}`;
  if (anchor.w !== undefined) return `${head} › Area`;
  return head;
}

/** The anchor of an element (and an optional point on it). */
export function elementAnchor(slide: Slide, path: NodePath | null, point?: { x: number; y: number }, area?: { w: number; h: number }): SlideAnchor {
  const anchor: SlideAnchor = { slide: slide.id };
  const el = path ? contextId(slide, path) : null;
  if (el) anchor.el = el;
  if (point) {
    anchor.x = Math.round(point.x);
    anchor.y = Math.round(point.y);
  }
  if (area) {
    anchor.w = Math.round(area.w);
    anchor.h = Math.round(area.h);
  }
  return anchor;
}

/** Location details the agent reads alongside the label. */
function locationOf(anchor: SlideAnchor): JsonRecord {
  const deck = useDeck.getState();
  const location: JsonRecord = {};
  if (anchor.slide) {
    location.slideId = anchor.slide;
    location.slideIndex = deckOrder(deck).indexOf(anchor.slide) + 1;
  }
  if (anchor.el) location.element = anchor.el;
  if (anchor.x !== undefined && anchor.y !== undefined) location.point = { x: anchor.x, y: anchor.y };
  if (anchor.w !== undefined && anchor.h !== undefined) location.size = { w: anchor.w, h: anchor.h };
  return location;
}

/** Brings an anchor's slide on stage (the card opens after it). */
function revealAnchor(anchor: SlideAnchor): void {
  const view = useView.getState();
  if (anchor.slide && useDeck.getState().slides[anchor.slide]) {
    if (view.mode !== 'edit') view.setMode('edit');
    view.showSlide(anchor.slide);
  }
}
