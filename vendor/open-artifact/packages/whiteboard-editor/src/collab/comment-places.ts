/**
 * Where comments sit, without side effects (unit-tested): the place of a
 * thread's anchor on the board now, and the draft of a new comment at a
 * clicked point or a dragged area (its anchor, label, and what the agent
 * reads about it).
 */

import {
  anchorDrawnRect,
  areaAnchorFor,
  areaCommentLabel,
  boardPointTarget,
  commentAreaCover,
  commentBoxCornerPoint,
  createAnchorIdLookup,
  decodeCommentAnchor,
  describeAnchorForAgent,
  elementBounds,
  elementPlainText,
  encodeCommentAnchor,
  nearestCommentBoxCorner,
  normalizeCommentLabelText,
  type BoardElement,
  type Box,
  type CommentAnchor,
  type ElementMeasures,
} from '@open-artifact/whiteboard-core';
import type { JsonRecord } from '@open-artifact/runtime';
import type { Point } from '../lib/camera.ts';

/**
 * A comment anchor as the comments controller holds it: the encoded core
 * anchor, and for a comment being written, what its draft worked out about
 * it (a {@link CommentDraft}). Stored threads' anchors carry the encoded
 * anchor alone: the host keeps their label and location.
 */
export interface BoardAnchor {
  /** The encoded anchor. */
  anchor: string;
  label?: string;
  detail?: string;
  location?: JsonRecord;
  at?: Point | Box;
}

/** A comment being written: where it goes, before its first message. */
export interface CommentDraft extends BoardAnchor {
  /** The encoded anchor. */
  anchor: string;
  /** Short human label (`Note "Q3 goals"`). */
  label: string;
  /** What the agent reads about the anchor. */
  detail: string;
  /** Structured location for the agent. */
  location: JsonRecord;
  /** Where the pin sits (board units); a box for an area. */
  at: Point | Box;
}

/** True for the anchor of a comment being written (one made by {@link pointCommentDraft} or {@link areaCommentDraft}). */
export function isCommentDraft(anchor: BoardAnchor): anchor is CommentDraft {
  return anchor.label !== undefined && anchor.detail !== undefined && anchor.location !== undefined && anchor.at !== undefined;
}

/** Where a thread's pin sits now. */
export interface ThreadPlace {
  /** The pin, board units. */
  point: Point;
  /** The area, for an area comment. */
  rect?: Box;
  /** The element it is on, for a comment on an element. */
  id?: string;
}

/**
 * Where an anchor sits on the board now; `undefined` when what it was on is
 * gone (or the anchor is unreadable, or it is about the whole board).
 */
export function anchorPlace(anchor: string, elements: readonly BoardElement[], measures?: ElementMeasures, zoom?: number): ThreadPlace | undefined {
  if (anchor === '') return undefined;
  const decoded = decodeCommentAnchor(anchor, createAnchorIdLookup(elements.map((element) => element.id)));
  if (decoded === null) return undefined;
  switch (decoded.kind) {
    case 'board':
      return { point: { x: decoded.x, y: decoded.y } };
    case 'item': {
      const element = elements.find((other) => other.id === decoded.id);
      const box = element ? elementBounds(element, measures) : undefined;
      return box ? { point: { x: box.x + decoded.fx * box.w, y: box.y + decoded.fy * box.h }, id: decoded.id } : undefined;
    }
    case 'area':
    case 'item-area': {
      const rect = anchorDrawnRect(anchor, elements, measures, zoom);
      return rect ? { point: commentBoxCornerPoint(rect, decoded.corner), rect, ...(decoded.kind === 'item-area' ? { id: decoded.id } : {}) } : undefined;
    }
  }
}

/** A short human label of an element: `Note "Q3 goals"`. */
export function elementCommentLabel(element: BoardElement): string {
  const kind = element.type === 'container' ? 'Section' : element.type === 'html' ? 'Embed' : element.type === 'stroke' ? 'Drawing' : element.type.charAt(0).toUpperCase() + element.type.slice(1);
  const text = normalizeCommentLabelText(elementPlainText(element), 32);
  return text ? `${kind} "${text}"` : kind;
}

/** The draft for a comment at a board point (on the element under it, if any). */
export function pointCommentDraft(point: Point, elements: readonly BoardElement[], measures?: ElementMeasures, zoom?: number): CommentDraft {
  const hitId = boardPointTarget(point.x, point.y, elements, measures).selected[0];
  const element = hitId === undefined ? undefined : elements.find((other) => other.id === hitId);
  const box = element ? elementBounds(element, measures) : undefined;
  const anchor: CommentAnchor =
    element && box && box.w > 0 && box.h > 0
      ? { kind: 'item', id: element.id, fx: Math.min(1, Math.max(0, (point.x - box.x) / box.w)), fy: Math.min(1, Math.max(0, (point.y - box.y) / box.h)) }
      : { kind: 'board', x: Math.round(point.x), y: Math.round(point.y) };
  const encoded = encodeCommentAnchor(anchor);
  return {
    anchor: encoded,
    label: element ? elementCommentLabel(element) : 'Board',
    detail: describeAnchorForAgent(encoded, elements, measures, zoom),
    location: { x: Math.round(point.x), y: Math.round(point.y), ...(element ? { ids: [element.id] } : {}) },
    at: point,
  };
}

/** The draft for a comment on a dragged area. */
export function areaCommentDraft(rect: Box, release: Point, elements: readonly BoardElement[], measures?: ElementMeasures, zoom?: number): CommentDraft {
  const cover = commentAreaCover(rect, elements, measures, zoom);
  const corner = nearestCommentBoxCorner(rect, release);
  const encoded = encodeCommentAnchor(areaAnchorFor(rect, corner, cover));
  return {
    anchor: encoded,
    label: areaCommentLabel(cover, 'Area'),
    detail: describeAnchorForAgent(encoded, elements, measures, zoom),
    location: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
      ids: cover.items.slice(0, 50).map((element) => element.id),
    },
    at: rect,
  };
}
