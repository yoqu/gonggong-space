/**
 * The corner grip of an area drawn to ask or comment about, in screen
 * units: a small dot marks the area's origin (its top-left corner), and the
 * grip on the corner across from it resizes the area from that origin.
 * Shown on the area the open Ask panel is about and on the area of a
 * comment being written.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Box } from '@open-artifact/whiteboard-core';
import { boardToScreen, screenToBoard, type Point } from '../lib/camera.ts';
import { useAsk } from '../state/ask.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { AREA_PICK_MIN_PX } from './area-pick.ts';
import { areaCornerPoint, areaFromCorners, oppositeCorner, type AreaCorner } from './ask-marks.ts';
import { areaCommentDraft, isCommentDraft, useComments } from './comments.ts';
import { useMyColor } from './hooks.ts';

/** The corner the dot marks; the grip sits across from it. */
const ORIGIN: AreaCorner = 'top-left';

/** One area's dot and grip. */
function Grip({ box, label, color, resize }: { box: Box; label: string; color?: string; resize: (rect: Box) => void }) {
  const camera = useCamera((state) => state.camera);
  const drag = useRef<{ pointerId: number; origin: Point; overlay: Element } | null>(null);
  const origin = boardToScreen(camera, areaCornerPoint(box, ORIGIN));
  const corner = boardToScreen(camera, areaCornerPoint(box, oppositeCorner(ORIGIN)));
  const paint = color ? { ['--wb-area-color' as string]: color } : {};

  const boardPoint = (event: ReactPointerEvent, overlay: Element): Point => {
    const rect = overlay.getBoundingClientRect();
    return screenToBoard(useCamera.getState().camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const overlay = event.currentTarget.closest('.wb-collab-overlay');
    if (event.button !== 0 || overlay === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, origin: areaCornerPoint(box, ORIGIN), overlay };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    const min = AREA_PICK_MIN_PX / useCamera.getState().camera.zoom;
    resize(areaFromCorners(current.origin, boardPoint(event, current.overlay), min));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  return (
    <>
      <div className="wb-area-origin" aria-hidden="true" style={{ transform: `translate(${origin.x}px, ${origin.y}px)`, ...paint }} />
      <div
        className="wb-area-grip"
        data-wb-chrome=""
        aria-hidden="true"
        title={label}
        style={{ transform: `translate(${corner.x}px, ${corner.y}px)`, ...paint }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      />
    </>
  );
}

/** The grips of the area the Ask panel is about and of the area of a comment being written. */
export function AreaGrips() {
  const askOpen = useAsk((state) => state.open);
  const scope = useAsk((state) => state.scope);
  const draft = useComments((state) => state.draft);
  const myColor = useMyColor();
  const askArea = askOpen && scope.kind === 'area' ? scope.rect : undefined;
  const commentArea = draft && isCommentDraft(draft) && 'w' in draft.at ? draft.at : undefined;
  return (
    <>
      {askArea ? <Grip box={askArea} label="Drag to resize the area" color={myColor} resize={(rect) => useAsk.getState().show({ kind: 'area', rect })} /> : null}
      {commentArea ? (
        <Grip
          box={commentArea}
          label="Drag to resize the area"
          resize={(rect) => {
            const elements = useBoard.getState().board.content.elements;
            const zoom = useCamera.getState().camera.zoom;
            useComments.getState().setDraft(areaCommentDraft(rect, areaCornerPoint(rect, 'top-right'), elements, currentMeasures(), zoom));
          }}
        />
      ) : null}
    </>
  );
}
