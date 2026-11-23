/**
 * Hover: which element the pointer is over while nothing is pressed, for
 * the hover outline and the hovered item's side dots (Select tool only).
 * Hit tests run at most once a frame.
 *
 * The hovered item stays hovered while the pointer crosses the gap to its
 * side dots and while it is over one of them, so the dots can be reached.
 *
 * Apart from that, the untitled section the pointer is over (inside it on
 * empty board, or on its title band) asks for a title: “Add a title”.
 */

import { create } from 'zustand';
import { elementBounds, hitSlop, isElementLocked, type Box, type ElementId } from '@open-artifact/whiteboard-core';
import { canEditBoard } from '../services/actions.ts';
import { screenToBoard } from '../lib/camera.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { effectiveTool, useTool } from '../state/tool.ts';
import { useInteraction } from '../selection/store.ts';
import { containerAtPoint, hitContext, pressTargetAt } from './hit.ts';
import { HOVER_KEEP_SLOP_PX, SIDE_DOT_OFFSET_PX } from './place.ts';

/** True when `x, y` is within `band` of the box's edge (inside or out). */
export function isNearBoxEdge(box: Box, x: number, y: number, band: number): boolean {
  const edgeDistance = Math.min(x - box.x, box.x + box.w - x, y - box.y, box.y + box.h - y);
  return edgeDistance <= band && edgeDistance >= -band;
}

/** The unlocked section the pointer is over (on empty board inside it, its frame or its title band), if any: it glows, and an untitled one asks for a title. */
export const useSectionHover = create<{ id: ElementId | null }>()(() => ({ id: null }));

function setSectionHover(id: ElementId | null): void {
  if (useSectionHover.getState().id !== id) useSectionHover.setState({ id });
}

/** Starts tracking hover over the surface; returns a function that stops. */
export function installHover(surface: HTMLElement): () => void {
  let frame = 0;
  let last: { x: number; y: number; type: string } | null = null;
  const update = (): void => {
    frame = 0;
    const at = last;
    const selection = useSelection.getState();
    if (!at || effectiveTool() !== 'select' || useTool.getState().commentMode || useInteraction.getState().transform !== null) {
      selection.setHover(null);
      setSectionHover(null);
      return;
    }
    const camera = useCamera.getState().camera;
    const board = screenToBoard(camera, at);
    const context = hitContext();
    const target = pressTargetAt(context, board, at.type, false);
    const hit = target?.id ?? null;
    if (target === undefined && canEditBoard()) {
      const sections = context.elements.filter((element) => element.type === 'container' && !isElementLocked(element));
      setSectionHover(containerAtPoint(sections, board, hitSlop(at.type, context.zoom), context.measures, context.zoom)?.id ?? null);
    } else setSectionHover(target?.type === 'container' && !isElementLocked(target) && canEditBoard() ? target.id : null);
    // Keep the hovered item near its edge (on the way to its side dots).
    const kept = selection.hover !== null && hit !== selection.hover ? useBoard.getState().byId.get(selection.hover) : undefined;
    const keptBox = kept ? elementBounds(kept, currentMeasures()) : undefined;
    const band = ((hit !== null ? HOVER_KEEP_SLOP_PX : SIDE_DOT_OFFSET_PX) + 0.5) / camera.zoom;
    selection.setHover(keptBox && isNearBoxEdge(keptBox, board.x, board.y, band) ? selection.hover : hit);
  };
  const onMove = (event: PointerEvent): void => {
    if (event.buttons !== 0 || event.pointerType === 'touch') return;
    // Over a side dot: the item it belongs to stays hovered.
    if (event.target instanceof Element && event.target.closest('.wb-side-dot')) return;
    const bounds = surface.getBoundingClientRect();
    last = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, type: event.pointerType };
    if (event.target instanceof Element && event.target.closest('[data-wb-chrome]')) last = null;
    if (frame === 0) frame = requestAnimationFrame(update);
  };
  const onLeave = (): void => {
    last = null;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    useSelection.getState().setHover(null);
    setSectionHover(null);
  };
  surface.addEventListener('pointermove', onMove, { passive: true });
  surface.addEventListener('pointerleave', onLeave);
  return () => {
    onLeave();
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerleave', onLeave);
  };
}
