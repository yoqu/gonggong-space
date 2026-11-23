/**
 * Dragging stickers out of the picker onto the board.
 *
 * A press on a sticker cell (marked {@link STICKER_DRAG_ATTRIBUTE}) that
 * moves 6 px (on a touch screen, where the grid scrolls up and down: 12 px
 * mostly sideways) takes the sticker off the panel: it flies under the
 * pointer, peeling off its sheet (`ui/sticker-peel.ts`). Let go
 * over the board, it is placed there (on the item under it, if any) and
 * the peel lays down on it; let go over the panel, the board's chrome or
 * outside the window, it flies home. The click that follows a flight does
 * not also pick the sticker.
 */

import { DEFAULT_STICKER_SIZE } from '@open-artifact/whiteboard-core';
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { screenToBoard, type Point } from '../lib/camera.ts';
import { canEditBoard } from '../services/actions.ts';
import { READ_ONLY_MESSAGE, refuse } from '../services/announce.ts';
import { useCamera } from '../state/camera.ts';
import { useTool, type StickerChoice } from '../state/tool.ts';
import { placeSticker, whenStickerRendered } from '../tools/sticker.ts';
import { startStickerFlight, type StickerFlight, type StickerPeel } from './sticker-peel.ts';

/** Attribute on a picker cell that can be dragged out; with {@link STICKER_ART_ATTRIBUTE} or {@link STICKER_GLYPH_ATTRIBUTE}. */
export const STICKER_DRAG_ATTRIBUTE = 'data-sticker-drag';
/** The dragged sticker's catalog key. */
export const STICKER_ART_ATTRIBUTE = 'data-sticker-art';
/** The dragged sticker's bare emoji. */
export const STICKER_GLYPH_ATTRIBUTE = 'data-sticker-glyph';
/** How far a press moves before it drags, px. */
const DRAG_START_PX = 6;
/** On a touch screen: how far sideways a press moves before it drags (and how much more sideways than up or down), px. */
const TOUCH_DRAG_START_PX = 12;
const TOUCH_DRAG_RATIO = 1.5;
/** A drop this close to the panel counts as over it (back home), px. */
const PANEL_MARGIN_PX = 8;
/** The art's share of a sticker's box on the board (see `StickerView`). */
const BOARD_ART_SHARE = 0.78;

/** A drag in progress. */
interface Drag {
  choice: StickerChoice;
  cell: HTMLElement;
  pointer: number;
  x: number;
  y: number;
  /** A touch press, whose pointer the cell captured on its own (the grid scrolls). */
  pans: boolean;
  carried?: StickerFlight;
}

/** The pointer handlers {@link useStickerDrag} puts on the cells' container. */
export interface StickerDragHandlers {
  onPointerDown(event: ReactPointerEvent): void;
  onPointerMove(event: ReactPointerEvent): void;
  onPointerUp(event: ReactPointerEvent): void;
  onPointerCancel(event: ReactPointerEvent): void;
  onLostPointerCapture(event: ReactPointerEvent): void;
}

/** What {@link useStickerDrag} gives the picker. */
export interface StickerDrag {
  /** Handlers for the element holding the cells. */
  handlers: StickerDragHandlers;
  /** Whether a flight just ended (the click it makes picks nothing). */
  justDropped(): boolean;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The sticker a cell carries, if it can be dragged. */
function cellChoice(cell: Element): StickerChoice | undefined {
  if (!cell.hasAttribute(STICKER_DRAG_ATTRIBUTE)) return undefined;
  const art = cell.getAttribute(STICKER_ART_ATTRIBUTE) ?? '';
  const glyph = cell.getAttribute(STICKER_GLYPH_ATTRIBUTE) ?? '';
  const choice: StickerChoice = { ...(art !== '' ? { art } : {}), ...(glyph !== '' ? { glyph } : {}) };
  return choice.art !== undefined || choice.glyph !== undefined ? choice : undefined;
}

/** The board surface, when (`x`, `y`) is over it and not over the board's chrome. */
function boardSurfaceAt(x: number, y: number): HTMLElement | undefined {
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return undefined;
  const surface = document.querySelector<HTMLElement>('.wb-surface');
  if (surface === null) return undefined;
  const rect = surface.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return undefined;
  const chrome = document.elementsFromPoint(x, y).some((node) => node.closest('[data-wb-chrome]') !== null && node.closest('.wb-el') === null);
  return chrome ? undefined : surface;
}

/**
 * Places a sticker dropped at client point `client` over `surface`, puts
 * the Sticker tool down (closing the picker), and lays the flight's `peel`
 * down on it. Returns whether the peel was handed on (else the caller ends it).
 */
export function dropStickerOnBoard(choice: StickerChoice, client: Point, surface: HTMLElement, peel: StickerPeel | undefined): boolean {
  if (!canEditBoard()) {
    refuse(READ_ONLY_MESSAGE);
    return false;
  }
  if (useTool.getState().tool === 'sticker') useTool.getState().pick({ tool: 'select' });
  const rect = surface.getBoundingClientRect();
  const at = screenToBoard(useCamera.getState().camera, { x: client.x - rect.left, y: client.y - rect.top });
  const id = placeSticker(choice, at, { pop: peel === undefined });
  if (id === undefined || peel === undefined) return false;
  whenStickerRendered(
    id,
    (node) => void peel.layDown(node),
    () => peel.end(),
  );
  return true;
}

/** Pointer dragging of the cells inside `panel` (see the module comment). */
export function useStickerDrag(panel: RefObject<HTMLElement | null>): StickerDrag {
  const dragRef = useRef<Drag | undefined>(undefined);
  const justDroppedRef = useRef(false);
  const drag = useMemo(() => {
    const letGo = (): void => {
      dragRef.current?.carried?.back();
      dragRef.current = undefined;
    };
    const onEnd = (event: ReactPointerEvent): void => {
      const current = dragRef.current;
      if (current === undefined || current.pointer !== event.pointerId) return;
      // The touch target's own capture passing to the cell is not an end.
      if (event.type === 'lostpointercapture' && event.target !== current.cell) return;
      if (event.type !== 'pointerup') {
        letGo();
        return;
      }
      dragRef.current = undefined;
      const flight = current.carried;
      if (flight === undefined) return;
      justDroppedRef.current = true;
      setTimeout(() => {
        justDroppedRef.current = false;
      });
      const { clientX: x, clientY: y } = event;
      const box = panel.current?.getBoundingClientRect();
      const overPanel =
        box !== undefined && x > box.left - PANEL_MARGIN_PX && x < box.right + PANEL_MARGIN_PX && y > box.top - PANEL_MARGIN_PX && y < box.bottom + PANEL_MARGIN_PX;
      const surface = overPanel ? undefined : boardSurfaceAt(x, y);
      if (surface === undefined || !canEditBoard()) {
        if (surface !== undefined) refuse(READ_ONLY_MESSAGE);
        flight.back();
        return;
      }
      const peel = flight.drop();
      let handed = false;
      try {
        handed = dropStickerOnBoard(current.choice, { x, y }, surface, peel);
      } finally {
        if (!handed) peel?.end();
      }
    };
    const handlers: StickerDragHandlers = {
      onPointerDown(event) {
        letGo();
        if (!(event.target instanceof Element) || event.button !== 0 || event.ctrlKey) return;
        const cell = event.target.closest<HTMLElement>(`[${STICKER_DRAG_ATTRIBUTE}]`);
        const choice = cell === null ? undefined : cellChoice(cell);
        if (cell === null || choice === undefined) return;
        const pans = event.target.hasPointerCapture(event.pointerId);
        dragRef.current = { choice, cell, pointer: event.pointerId, x: event.clientX, y: event.clientY, pans };
        cell.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        const current = dragRef.current;
        if (current === undefined || current.pointer !== event.pointerId) return;
        if (event.buttons === 0 || !current.cell.isConnected) {
          letGo();
          return;
        }
        if (current.carried === undefined) {
          const dx = Math.abs(event.clientX - current.x);
          const dy = Math.abs(event.clientY - current.y);
          if (current.pans ? dx < TOUCH_DRAG_START_PX || dx < dy * TOUCH_DRAG_RATIO : Math.hypot(dx, dy) < DRAG_START_PX) return;
          const source = current.cell.firstElementChild instanceof HTMLElement ? current.cell.firstElementChild : current.cell;
          const artPx = source.offsetWidth || source.getBoundingClientRect().width;
          const size = DEFAULT_STICKER_SIZE * BOARD_ART_SHARE * useCamera.getState().camera.zoom;
          current.carried = startStickerFlight(source, artPx, size, prefersReducedMotion(), true);
        }
        current.carried.move(event.clientX, event.clientY);
      },
      onPointerUp: onEnd,
      onPointerCancel: onEnd,
      onLostPointerCapture: onEnd,
    };
    return { handlers, letGo };
  }, [panel]);
  // A picker closed mid-drag sends the sticker home.
  useEffect(() => drag.letGo, [drag]);
  return useMemo(() => ({ handlers: drag.handlers, justDropped: () => justDroppedRef.current }), [drag]);
}
