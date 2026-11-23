/**
 * The pointer gesture framework. A press on the board asks the active tool
 * for a {@link Gesture}; the surface then routes that pointer's moves and
 * release to it until it ends. Tools stay small and testable: they get board
 * and screen coordinates and the element under the pointer, never raw DOM.
 */

import type { ElementId } from '@open-artifact/whiteboard-core';
import { screenToBoard, type Point } from '../lib/camera.ts';
import { useCamera } from '../state/camera.ts';
import type { ToolName } from '../lib/tools.ts';

/** One pointer sample. */
export interface PointerSample {
  /** The DOM event (for modifiers, pointer type, button). */
  event: PointerEvent;
  /** Viewport-relative position, CSS pixels. */
  screen: Point;
  /** Board position. */
  board: Point;
  /** Element id under the pointer (closest `[data-wb-id]`), if any. */
  target: ElementId | null;
  /** The DOM element under the pointer. */
  node: Element | null;
}

/** A gesture in progress. */
export interface Gesture {
  /** Cursor while the gesture runs. */
  cursor?: string;
  move?(sample: PointerSample): void;
  up?(sample: PointerSample): void;
  /** Escape, a second finger, or the pointer was lost. Undo any preview. */
  cancel?(): void;
}

/** A tool's press handler: returns the gesture to run, or `null` to ignore the press. */
export type ToolPress = (sample: PointerSample) => Gesture | null;

const tools = new Map<ToolName, ToolPress>();
let gestureSerial = 0;

/** A unique undo key for a gesture, including any pauses before it ends. */
export function gestureKey(gesture: string, id: string): string {
  return `${gesture}:${id}:#${++gestureSerial}`;
}

/** Distinguishes gesture keys from reusable keys for typing and keyboard edits. */
export function isGestureKey(key: string): boolean {
  return /:#\d+$/.test(key);
}

/** Registers a tool's press handler. */
export function registerTool(name: ToolName, press: ToolPress): void {
  tools.set(name, press);
}

/** The press handler of a tool. */
export function toolPress(name: ToolName): ToolPress | undefined {
  return tools.get(name);
}

/** The element id at a DOM node (closest `[data-wb-id]`). */
export function elementIdAt(node: Element | null): ElementId | null {
  const host = node?.closest<HTMLElement>('[data-wb-id]');
  return host?.dataset.wbId ?? null;
}

/** Builds a sample from a DOM pointer event over the surface element. */
export function sampleOf(event: PointerEvent, surface: HTMLElement): PointerSample {
  const bounds = surface.getBoundingClientRect();
  const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const node = event.target instanceof Element ? event.target : null;
  return { event, screen, board: screenToBoard(useCamera.getState().camera, screen), target: elementIdAt(node), node };
}

/** Distance in screen pixels a press must travel before it counts as a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** On touch, the same threshold is larger. */
export const TOUCH_DRAG_THRESHOLD_PX = 8;

/** The drag threshold for a pointer type. */
export function dragThreshold(event: PointerEvent): number {
  return event.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
}

/** True once `to` is past the drag threshold from `from` (screen pixels). */
export function pastThreshold(from: Point, to: Point, event: PointerEvent): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= dragThreshold(event);
}
