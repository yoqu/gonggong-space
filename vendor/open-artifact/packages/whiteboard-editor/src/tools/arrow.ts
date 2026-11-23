/**
 * The Arrow tool, and arrow drawing from an item's side dots: press where
 * the arrow starts (on an item it attaches there), drag to where it ends
 * (snapping onto items, their side dots, or a straight line from the start;
 * Shift keeps it on 45° lines, ⌘ turns snapping off) and release.
 *
 * The arrow being drawn is previewed in the overlay; it is written once, on
 * release. A click with the tool and no drag hands the tool back to Select.
 * An arrow left with one end on empty board offers a next item there
 * (`selection/next-offer.ts`).
 */

import {
  alignArrowEndPoint,
  appendElement,
  arrowEndIds,
  createElementId,
  newArrowEnds,
  type ArrowElement,
  type ArrowEndChoice,
  type InkColor,
} from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import { addedMessage, announce } from '../services/announce.ts';
import { editContent } from '../services/actions.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { offerNextItem } from '../selection/next-offer.ts';
import { useInteraction } from '../selection/store.ts';
import type { Gesture, PointerSample } from './gesture.ts';
import { arrowEndAt, arrowEndPoint, hitContext, snapEndToFortyFiveDegrees } from './hit.ts';
import { ensureRoom } from './place.ts';
import { forgetTap, hasModifier } from './select.ts';
import { SNAP_DISTANCE_PX } from './snap.ts';
import { DRAG_THRESHOLD_PX } from './gesture.ts';

/** Options of {@link arrowDrawGesture}. */
export interface ArrowDrawOptions {
  /** Drawn with the Arrow tool (rather than from a side dot). */
  byTool: boolean;
  /** Ink of the new arrow. */
  color: InkColor;
  /** A click without a drag: runs instead of drawing (from a side dot: add a joined item). */
  onClick?: (end: PointerSample) => void;
}

/** True once a drag is long enough to draw an arrow (past the drag slop and the smallest element size). */
function movedPastDrawSlop(start: Point, point: Point, zoom: number): boolean {
  const distance = Math.hypot(point.x - start.x, point.y - start.y);
  return distance * zoom >= DRAG_THRESHOLD_PX && distance >= 8;
}

/** Draws an arrow from `from`, the end where the press started. */
export function arrowDrawGesture(sample: PointerSample, from: ArrowEndChoice, options: ArrowDrawOptions): Gesture {
  const start = sample.board;
  const interaction = useInteraction.getState();
  const origin = (): Point => arrowEndPoint(hitContext(), from) ?? start;
  interaction.setTransform('arrow');
  interaction.setArrowDraft({ from: origin(), to: start, color: options.color });
  let drop: ArrowEndChoice | undefined;
  let moved = false;

  /** The pointer, constrained (Shift) or aligned with the start (unless ⌘). */
  const endPoint = (next: PointerSample): Point => {
    const context = hitContext();
    const point = next.board;
    if (next.event.shiftKey) {
      const snapped = snapEndToFortyFiveDegrees(origin(), point);
      const end = arrowEndAt(context, snapped, next.event.pointerType, from.end).end;
      return typeof from.end === 'string' && end === from.end ? point : snapped;
    }
    const isFree = (at: Point): boolean => typeof arrowEndAt(context, at, next.event.pointerType, from.end).end !== 'string';
    if (hasModifier(next.event) || !isFree(point)) return point;
    const aligned = alignArrowEndPoint(origin(), typeof from.end === 'string' ? from.side : undefined, point.x, point.y, SNAP_DISTANCE_PX / context.zoom);
    return isFree(aligned) ? aligned : point;
  };

  return {
    cursor: 'crosshair',
    move(next) {
      const context = hitContext();
      const point = endPoint(next);
      moved ||= movedPastDrawSlop(start, next.board, context.zoom);
      drop = movedPastDrawSlop(start, point, context.zoom) ? arrowEndAt(context, point, next.event.pointerType, from.end) : undefined;
      const target = drop && typeof drop.end === 'string' ? drop.end : undefined;
      useInteraction.getState().setConnect(target !== undefined ? { id: target, ...(drop?.side !== undefined ? { side: drop.side } : {}) } : null);
      useInteraction.getState().setArrowDraft({ from: origin(), to: (drop && arrowEndPoint(context, drop)) ?? point, color: options.color });
    },
    up(end) {
      useInteraction.getState().reset();
      if (!moved || !drop) {
        if (options.onClick) options.onClick(end);
        else if (options.byTool) useTool.getState().pick({ tool: 'select' });
        return;
      }
      const ends = newArrowEnds({ from, drop, start, byTool: options.byTool });
      if (!ends || !ensureRoom()) return;
      const arrow: ArrowElement = { type: 'arrow', id: createElementId(), ...ends, head: 'end', dash: false, color: options.color };
      const label = arrowEndIds(arrow).length === 2 ? 'Connect' : 'Draw arrow';
      if (!editContent((content) => appendElement(content, arrow), { label })) return;
      useSelection.getState().select([arrow.id]);
      announce(addedMessage('arrow'));
      if (options.byTool) useTool.getState().placed();
      // Drawn from an item into empty board: offer a next item at the free end.
      offerNextItem(arrow);
    },
    cancel() {
      useInteraction.getState().reset();
    },
  };
}

/** The Arrow tool's press. */
export function arrowPress(sample: PointerSample): Gesture | null {
  forgetTap();
  if (!ensureRoom()) return null;
  const from = arrowEndAt(hitContext(), sample.board, sample.event.pointerType);
  return arrowDrawGesture(sample, from, { byTool: true, color: useTool.getState().ink });
}
