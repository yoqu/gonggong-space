/**
 * The selection overlay, drawn over the board in screen units: the
 * selection's outline (a turned frame for one item; the union plus a
 * hairline per item and an outline per group for several), resize and turn
 * handles, an arrow's end, leg and label handles, side dots, the rubber band,
 * snap guides, the hover outline, the item an arrow end would attach to, the
 * pen stroke and arrow being drawn, and image crop mode.
 *
 * Passive marks live in one SVG in board units (its transform follows the
 * camera); handles are HTML in screen units. Handles opt out of the board's
 * press routing (`data-no-pan`) and drive their own gestures
 * ({@link driveFromHandle}). A handle stays mounted while its gesture runs
 * (unmounting it would drop the pointer capture and cancel the gesture), so
 * handles that should not show during a transform are hidden with CSS via
 * the root's `data-transform`.
 */

import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, RotateCcw, Type } from 'lucide-react';
import {
  ARROW_STROKE,
  ELEMENT_KIND_AFFORDANCES,
  arrowLegHandles,
  blockColorHex,
  elementBounds,
  elementLayoutBox,
  elementTurn,
  expandSelectionToGroups,
  imageCropRect,
  isElementLocked,
  layoutBoxResolver,
  measuredArrowGeometry,
  measuredArrowLabelBox,
  roundedPolygonPathData,
  shapePathData,
  selectionGroupCells,
  shapeFillPaint,
  unionBounds,
  wouldExceedElementLimit,
  type ArrowElement,
  type ArrowGeometry,
  type ArrowLegHandle,
  type ArrowSide,
  type BoardElement,
  type Box,
  type ColorScheme,
  type CropHandle,
  type ElementId,
  type ElementMeasures,
  type ImageElement,
  type InkColor,
  type NextItem,
  type RoutePoint,
} from '@open-artifact/whiteboard-core';
import { elementInkColor, paperTextColor } from '../export/look.ts';
import type { Camera, Point } from '../lib/camera.ts';
import { screenToBoard } from '../lib/camera.ts';
import { useSectionHover } from '../tools/hover.ts';
import { canEditBoard } from '../services/actions.ts';
import { announce, notify } from '../services/announce.ts';
import { onRemoteChange, useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { useColorScheme } from '../state/theme.ts';
import { effectiveTool, useTool } from '../state/tool.ts';
import { useCoarsePointer } from '../ui/hooks.ts';
import { sideDotPoint } from '../tools/hit.ts';
import { SIDE_DOTS_MIN_SIZE, SIDE_DOT_OFFSET_PX } from '../tools/place.ts';
import { sideDotTitle, sideDotsWithRoom } from '../lib/side-dots.ts';
import { gestureKey } from '../tools/gesture.ts';
import { AreaMarquee } from './AreaMarquee.tsx';
import { CROP_IMAGE_CHANGED_ELSEWHERE, cropTargetChanged } from './crop-guard.ts';
import { driveFromHandle, surfaceOf } from './drive.ts';
import { registerInkPath, useInteraction, type ArrowDraft, type GuideLine } from './store.ts';
import {
  arrowEndGesture,
  arrowLegGesture,
  canTurnSelection,
  cropFrameGesture,
  cropPanGesture,
  naturalImageSize,
  resizeGesture,
  resizeHandlesFor,
  selectionFrame,
  hoverSideDot,
  sideDotGesture,
  sideDotItem,
  useSideDotHover,
  turnGesture,
  writeImageCrop,
  zoomImageCropAt,
  type HandleName,
} from './transform.ts';

/* ------------------------------------------------------------------------ */
/* Geometry helpers                                                         */
/* ------------------------------------------------------------------------ */

/** A box in screen pixels, with the turn it is drawn at. */
interface ScreenFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  turn: number;
}

/** A board box as screen pixels. */
function screenFrame(camera: Camera, box: Box, turn = 0): ScreenFrame {
  return { left: (box.x - camera.x) * camera.zoom, top: (box.y - camera.y) * camera.zoom, width: box.w * camera.zoom, height: box.h * camera.zoom, turn };
}

/** A board point as screen pixels. */
function screenPoint(camera: Camera, x: number, y: number): Point {
  return { x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom };
}

/** CSS placing a screen frame (turned about its center). */
function frameStyle(frame: ScreenFrame): CSSProperties {
  return {
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    transform: frame.turn !== 0 ? `rotate(${frame.turn}deg)` : undefined,
  };
}

/** The points of an arrow's line (its route, or its two ends). */
function arrowPoints(line: ArrowGeometry): readonly (readonly [number, number])[] {
  return line.elbow && line.elbow.length >= 2 ? line.elbow : [[line.x1, line.y1], [line.x2, line.y2]];
}

/** The point halfway along a polyline. */
function polylineMidpoint(points: readonly (readonly [number, number])[]): Point {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  let left = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1]!;
    const [bx, by] = points[index]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length >= left && length > 0) return { x: ax + ((bx - ax) * left) / length, y: ay + ((by - ay) * left) / length };
    left -= length;
  }
  const [x, y] = points[0] ?? [0, 0];
  return { x, y };
}

/** SVG `d` of a polyline. */
function polylinePath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

/** SVG `d` of an open arrow head at `tip`, pointing away from `from`. */
function arrowHeadPath(tip: Point, from: Point): string {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / length;
  const uy = (tip.y - from.y) / length;
  const back = { x: tip.x - ux * ARROW_STROKE.head, y: tip.y - uy * ARROW_STROKE.head };
  const wing = ARROW_STROKE.head * ARROW_STROKE.wing;
  return `M ${back.x - uy * wing} ${back.y + ux * wing} L ${tip.x} ${tip.y} L ${back.x + uy * wing} ${back.y - ux * wing}`;
}

/** The SVG transform of a board box turned about its center. */
function turnTransform(box: Box, turn: number): string | undefined {
  return turn !== 0 ? `rotate(${turn} ${box.x + box.w / 2} ${box.y + box.h / 2})` : undefined;
}

/** The outline of an element (or the union of its group when the group is not entered). */
function hoverOutline(elements: readonly BoardElement[], element: BoardElement, selected: readonly ElementId[], measures: ElementMeasures): { box: Box; turn: number } | undefined {
  const group = expandSelectionToGroups(elements, new Set([element.id]), selected);
  if (group.size > 1) {
    const union = unionBounds(elements.flatMap((each) => (group.has(each.id) ? (elementBounds(each, measures) ?? []) : [])));
    return union ? { box: union, turn: 0 } : undefined;
  }
  const box = elementLayoutBox(element, measures);
  return box ? { box, turn: elementTurn(element) } : undefined;
}

/** The ink an element's color paints with (the preview of a pen stroke or an arrow). */
function inkPaint(color: InkColor, scheme: ColorScheme): string {
  return elementInkColor({ color }, scheme);
}

/* ------------------------------------------------------------------------ */
/* Passive marks (board units)                                              */
/* ------------------------------------------------------------------------ */

/** What the board-unit SVG draws. */
interface MarksProps {
  camera: Camera;
  scheme: ColorScheme;
  marquee: Box | null;
  guides: readonly GuideLine[];
  hover: { box: Box; turn: number } | undefined;
  section: { box: Box; turn: number } | undefined;
  connect: { box: Box; turn: number; dot?: Point } | undefined;
  hairlines: readonly { id: ElementId; box: Box; turn: number }[];
  groups: readonly Box[];
  arrowLines: readonly { id: ElementId; d: string }[];
  draft: ArrowDraft | null;
  ink: { color: InkColor; width: number } | null;
  offer: DotOffer | undefined;
}

/** What a click on the hovered side dot would add: the faint item. */
interface DotOffer {
  next: NextItem;
}

/** The passive marks: guides, rubber band, outlines, the pen stroke and the arrow being drawn. */
function Marks({ camera, scheme, marquee, guides, hover, section, connect, hairlines, groups, arrowLines, draft, ink, offer }: MarksProps): ReactNode {
  const zoom = camera.zoom;
  return (
    <svg className="wb-sel-marks" aria-hidden="true">
      <g transform={`scale(${zoom}) translate(${-camera.x} ${-camera.y})`}>
        {arrowLines.map((line) => (
          <path key={line.id} className="wb-sel-arrow-halo" d={line.d} vectorEffect="non-scaling-stroke" />
        ))}
        {hairlines.map((line) => (
          <rect key={line.id} className="wb-sel-hairline" x={line.box.x} y={line.box.y} width={line.box.w} height={line.box.h} transform={turnTransform(line.box, line.turn)} vectorEffect="non-scaling-stroke" />
        ))}
        {groups.map((box, index) => (
          <rect key={index} className="wb-sel-group" x={box.x} y={box.y} width={box.w} height={box.h} vectorEffect="non-scaling-stroke" />
        ))}
        {section ? (
          <path
            className="wb-sel-section-hover"
            d={shapePathData('frame', section.box.w, section.box.h)}
            transform={`${turnTransform(section.box, section.turn) ?? ''} translate(${section.box.x} ${section.box.y})`}
          />
        ) : null}
        {hover ? (
          <rect className="wb-sel-hover" x={hover.box.x} y={hover.box.y} width={hover.box.w} height={hover.box.h} transform={turnTransform(hover.box, hover.turn)} vectorEffect="non-scaling-stroke" />
        ) : null}
        {connect ? (
          <>
            <rect className="wb-sel-connect" x={connect.box.x} y={connect.box.y} width={connect.box.w} height={connect.box.h} transform={turnTransform(connect.box, connect.turn)} vectorEffect="non-scaling-stroke" />
            {connect.dot ? <circle className="wb-sel-connect-dot" cx={connect.dot.x} cy={connect.dot.y} r={5 / zoom} vectorEffect="non-scaling-stroke" /> : null}
          </>
        ) : null}
        {offer ? <DotOfferMarks offer={offer} scheme={scheme} zoom={zoom} /> : null}
        {guides.map((guide, index) =>
          guide.axis === 'x' ? (
            <line key={index} className="wb-sel-guide" data-kind={guide.kind} x1={guide.pos} x2={guide.pos} y1={guide.from} y2={guide.to} vectorEffect="non-scaling-stroke" />
          ) : (
            <line key={index} className="wb-sel-guide" data-kind={guide.kind} x1={guide.from} x2={guide.to} y1={guide.pos} y2={guide.pos} vectorEffect="non-scaling-stroke" />
          ),
        )}
        {marquee ? <AreaMarquee className="wb-sel-marquee" box={marquee} zoom={zoom} /> : null}
        {draft ? (
          <g className="wb-sel-draft" stroke={inkPaint(draft.color, scheme)} strokeWidth={ARROW_STROKE.width}>
            <path d={`M ${draft.from.x} ${draft.from.y} L ${draft.to.x} ${draft.to.y}`} />
            {Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) > ARROW_STROKE.head ? <path d={arrowHeadPath(draft.to, draft.from)} /> : null}
          </g>
        ) : null}
        {/* The pen preview: its `d` is written straight from the pen gesture (no render per sample). */}
        <path
          ref={registerInkPath}
          className="wb-sel-ink"
          stroke={ink ? inkPaint(ink.color, scheme) : 'none'}
          strokeWidth={ink?.width ?? 0}
          visibility={ink ? 'visible' : 'hidden'}
        />
      </g>
    </svg>
  );
}

/** The faint item (dashed) a click on the hovered side dot would add. */
function DotOfferMarks({ offer, scheme, zoom }: { offer: DotOffer; scheme: ColorScheme; zoom: number }): ReactNode {
  const { next } = offer;
  const style = { '--wb-offer-px': `${1 / zoom}px`, color: paperTextColor(next, scheme) } as CSSProperties;
  return (
    <g className="wb-sel-dot-offer" style={style}>
      {next.type === 'note' ? (
        <path d={`M${next.x} ${next.y}h${next.w}v${next.h}h${-next.w}Z`} fill={blockColorHex(next.color)} transform={`rotate(${next.tilt} ${next.x + next.w / 2} ${next.y + next.h / 2})`} />
      ) : (
        <path d={roundedPolygonPathData(next.kind, next.w, next.h, true)} fill={shapeFillPaint(next)} transform={`translate(${next.x} ${next.y})`} />
      )}
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Handles (screen units)                                                   */
/* ------------------------------------------------------------------------ */

/** Runs a handle's gesture from a React pointer press. */
function press(start: Parameters<typeof driveFromHandle>[2]) {
  return (event: ReactPointerEvent<HTMLElement>): void => {
    driveFromHandle(event.nativeEvent, event.currentTarget, start);
  };
}

/** The corners a selection turns from, with the angle their cursor's arrow points at. */
const TURN_CORNERS = [
  ['nw', 270],
  ['ne', 0],
  ['se', 90],
  ['sw', 180],
] as const;

const TURN_CURSOR_PATH = "%20d=%27M%204.5%2010.7%20L%205.4%2010.4%20A%206.5%206.5%200%200%201%2013.6%2018.6%20L%2013.3%2019.5%20M%206.3%207.8%20L%204.5%2010.7%20L%207.7%2012.0%20M%2012.0%2016.3%20L%2013.3%2019.5%20L%2016.2%2017.7%27";

/** The curved-arrow cursor over a turn zone, pointing round the corner at `degrees`. */
function turnCursor(degrees: number): string {
  const angle = Math.round(((degrees % 360) + 360) % 360);
  const svg =
    '%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2724%27%20height=%2724%27%20viewBox=%270%200%2024%2024%27%3E%3Cg%20transform=%27rotate%28' +
    angle +
    '%2012%2012%29%27%20fill=%27none%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E' +
    `%3Cpath${TURN_CURSOR_PATH}%20stroke=%27white%27%20stroke-width=%273.5%27/%3E` +
    `%3Cpath${TURN_CURSOR_PATH}%20stroke=%27black%27%20stroke-width=%271.5%27/%3E` +
    '%3C/g%3E%3C/svg%3E';
  return `url("data:image/svg+xml,${svg}") 12 12, grab`;
}

/**
 * The handles on a selection frame: resize, turn and side dots.
 * a selection turns from an invisible zone just outside each corner (the
 * cursor shows it), with the angle in a pill under the frame while it turns.
 */
function FrameHandles({
  handles,
  turnable,
  turn,
  dots,
  dotsFor,
  turning,
}: {
  handles: readonly HandleName[];
  turnable: boolean;
  turn: number;
  dots: readonly SideDotChoice[];
  dotsFor: BoardElement | undefined;
  turning: string | undefined;
}): ReactNode {
  return (
    <>
      {turnable
        ? TURN_CORNERS.map(([corner, base]) => (
            <div
              key={corner}
              className="wb-turn-zone"
              data-corner={corner}
              data-no-pan
              aria-hidden="true"
              style={{ cursor: turnCursor(base + turn) }}
              onPointerDown={press(turnGesture)}
            />
          ))
        : null}
      {handles.map((name) => (
        <div key={name} className="wb-handle" data-handle={name} data-no-pan aria-hidden="true" onPointerDown={press((sample) => resizeGesture(sample, name))} />
      ))}
      {turning !== undefined ? (
        <span className="wb-turn-badge" style={{ transform: `translate(-50%, -50%) rotate(${-turn}deg)` }}>
          {turning}
        </span>
      ) : null}
      {dotsFor !== undefined ? dots.map(({ side, adds }) => <SideDot key={side} element={dotsFor} side={side} adds={adds} />) : null}
    </>
  );
}

/** A side dot that shows, and whether a click on it adds an item (one fits beside or below). */
interface SideDotChoice {
  side: ArrowSide;
  adds: boolean;
}

/**
 * A side dot: drag to draw an arrow from that side. When the next item fits,
 * a click adds it there, and it shows faintly while the pointer rests on the dot.
 */
function SideDot({ element, side, adds }: { element: BoardElement; side: ArrowSide; adds: boolean }): ReactNode {
  const track = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!adds || event.buttons !== 0) return;
    hoverSideDot({ id: element.id, side });
  };
  return (
    <div
      className="wb-side-dot"
      data-side={side}
      data-no-pan
      aria-hidden="true"
      title={sideDotTitle(element.type, adds)}
      onPointerEnter={track}
      onPointerMove={track}
      onPointerLeave={(event) => {
        if (event.buttons === 0) hoverSideDot(null);
      }}
      onPointerDown={press((sample) => sideDotGesture(sample, element.id, side))}
    />
  );
}

/** The leg handles of the selected arrow, with the route they were placed on. */
interface ArrowLegs {
  route: readonly RoutePoint[];
  handles: readonly ArrowLegHandle[];
}

const NO_LEGS: ArrowLegs = { route: [], handles: [] };

/** An arrow's end handles, its leg handles (drag a leg to bend the route) and its label handle. */
function ArrowHandles({ arrow, camera, line, legs, labelAt, editable }: { arrow: ArrowElement; camera: Camera; line: ArrowGeometry; legs: ArrowLegs; labelAt: Point; editable: boolean }): ReactNode {
  const from = screenPoint(camera, line.x1, line.y1);
  const to = screenPoint(camera, line.x2, line.y2);
  const label = screenPoint(camera, labelAt.x, labelAt.y);
  if (!editable) return null;
  return (
    <>
      {legs.handles.map((handle) => {
        const at = screenPoint(camera, handle.x, handle.y);
        return (
          <div
            key={handle.leg}
            className="wb-arrow-leg"
            data-level={handle.level || undefined}
            data-no-pan
            aria-hidden="true"
            style={{ left: at.x, top: at.y }}
            onPointerDown={press((sample) => arrowLegGesture(sample, arrow.id, handle.leg, legs.route))}
          />
        );
      })}
      {(['from', 'to'] as const).map((end) => {
        const at = end === 'from' ? from : to;
        const attached = typeof arrow[end] === 'string';
        return (
          <div
            key={end}
            className="wb-arrow-end"
            data-end={end}
            data-attached={attached || undefined}
            data-no-pan
            aria-hidden="true"
            style={{ left: at.x, top: at.y }}
            onPointerDown={press((sample) => arrowEndGesture(sample, arrow.id, end))}
          />
        );
      })}
      {arrow.label === undefined || arrow.label === '' ? (
        <button
          type="button"
          className="wb-arrow-label-handle"
          data-no-pan
          aria-label="Add a label"
          title="Add a label"
          style={{ left: label.x, top: label.y }}
          onClick={() => useSelection.getState().edit({ kind: 'arrow-label', id: arrow.id })}
        >
          <Type size={11} strokeWidth={2.25} />
        </button>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Crop mode                                                                */
/* ------------------------------------------------------------------------ */

const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Wheel zoom: the factor per pixel of wheel travel. */
const CROP_WHEEL_RATE = 0.002;
/** A wheel pause this long starts a new undo step. */
const CROP_WHEEL_IDLE_MS = 400;

/** The source of an image element's on-board picture. */
function imageSource(id: ElementId): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const image = document.querySelector<HTMLImageElement>(`.wb-surface [data-wb-id="${CSS.escape(id)}"] img`);
  return image?.currentSrc || image?.src || undefined;
}

/** Leaves crop mode. */
function finishCrop(): void {
  useSelection.getState().setCropping(null);
}

/**
 * Crop mode on an image: drag the picture to pan it, drag the frame's
 * handles to crop, wheel to zoom. When someone else changes the picture,
 * cropping stops, gestures and all (`crop-guard.ts`).
 */
function CropFrame({ image, camera }: { image: ImageElement; camera: Camera }): ReactNode {
  const pan = useRef<HTMLDivElement>(null);
  const aborts = useRef<AbortController | null>(null);
  const id = image.id;
  const frame = screenFrame(camera, image, elementTurn(image));
  const natural = naturalImageSize(id, { w: image.w, h: image.h });
  const ghost = imageCropRect({ w: image.w, h: image.h }, natural, image.crop ?? { zoom: 1, x: 0.5, y: 0.5 });
  const source = useMemo(() => imageSource(id), [id]);
  const editable = canEditBoard() && !isElementLocked(image);

  // A change from elsewhere to the picture ends crop mode and the gestures under way.
  useEffect(() => {
    const controller = new AbortController();
    aborts.current = controller;
    const off = onRemoteChange((next, previous) => {
      if (controller.signal.aborted || !cropTargetChanged(id, next, previous)) return;
      controller.abort();
      finishCrop();
      announce(CROP_IMAGE_CHANGED_ELSEWHERE);
      notify(CROP_IMAGE_CHANGED_ELSEWHERE);
    });
    return () => {
      off();
      controller.abort();
      if (aborts.current === controller) aborts.current = null;
    };
  }, [id]);

  /** A press on the crop frame, driving `start`'s gesture until crop mode ends. */
  const cropPress =
    (start: Parameters<typeof driveFromHandle>[2]) =>
    (event: ReactPointerEvent<HTMLElement>): void => {
      driveFromHandle(event.nativeEvent, event.currentTarget, start, aborts.current?.signal);
    };

  // Wheel zooms the picture (not the board); Enter or Escape leaves.
  useEffect(() => {
    const node = pan.current;
    if (!node) return;
    let key = gestureKey('crop-zoom', id);
    let idle: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const surface = surfaceOf(node);
      if (!surface || aborts.current?.signal.aborted !== false) return;
      const rect = surface.getBoundingClientRect();
      const at = screenToBoard(useCamera.getState().camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      if (idle !== null) clearTimeout(idle);
      else key = gestureKey('crop-zoom', id);
      idle = setTimeout(() => (idle = null), CROP_WHEEL_IDLE_MS);
      zoomImageCropAt(id, Math.exp(-event.deltaY * CROP_WHEEL_RATE), at, key);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      finishCrop();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      if (idle !== null) clearTimeout(idle);
      node.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [id]);

  const zoom = camera.zoom;
  const radians = (frame.turn * Math.PI) / 180;
  const reach = Math.abs(frame.width * Math.sin(radians)) / 2 + Math.abs(frame.height * Math.cos(radians)) / 2;
  const barTop = frame.top + frame.height / 2 + reach + 12;
  return (
    <>
      <div className="wb-crop" style={frameStyle(frame)}>
        <div className="wb-crop-ghost" style={{ left: ghost.x * zoom, top: ghost.y * zoom, width: ghost.w * zoom, height: ghost.h * zoom }}>
          {source ? <img src={source} alt="" draggable={false} /> : null}
        </div>
        <div ref={pan} className="wb-crop-pan" data-no-pan aria-hidden="true" onPointerDown={editable ? cropPress((sample) => cropPanGesture(sample, id)) : undefined} />
        {editable
          ? CROP_HANDLES.map((handle) => (
              <div key={handle} className="wb-crop-handle" data-handle={handle} data-no-pan aria-hidden="true" onPointerDown={cropPress((sample) => cropFrameGesture(sample, id, handle))} />
            ))
          : null}
      </div>
      <div className="wb-crop-bar" data-wb-chrome role="toolbar" aria-label="Crop" style={{ left: frame.left + frame.width / 2, top: barTop }}>
        <button type="button" disabled={!editable || image.crop === undefined} onClick={() => writeImageCrop(id, undefined, gestureKey('crop-reset', id))}>
          <RotateCcw size={14} aria-hidden="true" />
          Reset
        </button>
        <button type="button" data-primary onClick={finishCrop}>
          <Check size={14} aria-hidden="true" />
          Done
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* The overlay                                                              */
/* ------------------------------------------------------------------------ */

/** Side dots of an element kind (`none` when it has none). */
function hasDots(element: BoardElement): boolean {
  return ELEMENT_KIND_AFFORDANCES[element.type].dots !== 'none';
}

/** True when an item is big enough on screen (and the zoom close enough) for side dots. */
function dotsFit(element: BoardElement, measures: ElementMeasures, zoom: number): boolean {
  const box = elementBounds(element, measures);
  return box !== undefined && zoom >= SIDE_DOTS_MIN_SIZE.zoom && Math.max(box.w, box.h) * zoom >= SIDE_DOTS_MIN_SIZE.px;
}

/**
 * The side dots of an item that have room around them, and whether a click
 * on each adds the next item.
 */
function sideDotChoices(element: BoardElement, elements: readonly BoardElement[], measures: ElementMeasures, zoom: number, coarse: boolean): SideDotChoice[] {
  const box = elementLayoutBox(element, measures);
  if (!box) return [];
  return sideDotsWithRoom(element, box, elementTurn(element), zoom, coarse, elements, measures).map((side) => ({
    side,
    adds: sideDotItem(element, side, 0, elements, measures) !== undefined,
  }));
}

/** The side dots of a hovered (unselected) item. */
function HoverDots({ element, dots, camera, measures }: { element: BoardElement; dots: readonly SideDotChoice[]; camera: Camera; measures: ElementMeasures }): ReactNode {
  const box = elementLayoutBox(element, measures);
  if (!box) return null;
  return (
    <div className="wb-hover-dots" style={frameStyle(screenFrame(camera, box, elementTurn(element)))}>
      {dots.map(({ side, adds }) => (
        <SideDot key={side} element={element} side={side} adds={adds} />
      ))}
    </div>
  );
}

/** The selection overlay (the board surface's `overlay`). */
export function SelectionOverlay(): ReactNode {
  const camera = useCamera((state) => state.camera);
  const elements = useBoard((state) => state.board.content.elements);
  const byId = useBoard((state) => state.byId);
  const measures = useMeasures((state) => state.measures);
  const ids = useSelection((state) => state.ids);
  const editing = useSelection((state) => state.editing);
  const hoverId = useSelection((state) => state.hover);
  const marquee = useSelection((state) => state.marquee);
  const cropping = useSelection((state) => state.cropping);
  const tool = useTool((state) => effectiveTool(state));
  const transform = useInteraction((state) => state.transform);
  const guides = useInteraction((state) => state.guides);
  const turnDegrees = useInteraction((state) => state.turnDegrees);
  const connectTarget = useInteraction((state) => state.connect);
  const draft = useInteraction((state) => state.arrowDraft);
  const ink = useInteraction((state) => state.ink);
  const scheme = useColorScheme();
  const coarse = useCoarsePointer();

  // Crop mode ends when the image is no longer the selection.
  useEffect(() => {
    if (cropping !== null && !(ids.length === 1 && ids[0] === cropping && byId.get(cropping)?.type === 'image')) finishCrop();
  }, [cropping, ids, byId]);

  const selection = useMemo(() => {
    const selected = ids.flatMap((id) => byId.get(id) ?? []);
    const boxes = selected.filter((element) => element.type !== 'arrow');
    const arrows = selected.filter((element): element is ArrowElement => element.type === 'arrow');
    const frame = selectionFrame(boxes, measures);
    const idSet = new Set(ids);
    const groups =
      selected.length > 1
        ? selectionGroupCells(elements, idSet).flatMap((cell) => {
            if (cell.group === undefined || cell.ids.length < 2) return [];
            const union = unionBounds(cell.ids.flatMap((id) => (byId.get(id) ? (elementBounds(byId.get(id)!, measures) ?? []) : [])));
            return union ? [union] : [];
          })
        : [];
    const hairlines =
      boxes.length > 1
        ? boxes.flatMap((element) => {
            const box = elementLayoutBox(element, measures);
            return box ? [{ id: element.id, box, turn: elementTurn(element) }] : [];
          })
        : [];
    const lines = arrows.flatMap((arrow) => {
      const line = measuredArrowGeometry(arrow, byId, measures);
      return line ? [{ arrow, line }] : [];
    });
    return { selected, boxes, arrows, frame, groups, hairlines, lines, locked: selected.some(isElementLocked) };
  }, [ids, byId, elements, measures]);

  const editable = canEditBoard();
  const selecting = tool === 'select';
  const { selected, boxes, frame, groups, hairlines, lines, locked } = selection;
  const typing = editing !== null;
  const lone = boxes.length === 1 && selected.length === 1 ? boxes[0] : undefined;
  const loneArrow = selected.length === 1 && lines.length === 1 ? lines[0] : undefined;
  const croppingImage = cropping !== null && lone?.id === cropping && lone.type === 'image' ? lone : undefined;

  // Leg handles of a lone arrow. While an arrow handle is dragged they stay
  // as they were when it started (hidden), so the pressed one keeps its
  // pointer capture however the route changes.
  const legsNow = useMemo((): ArrowLegs => {
    const elbow = loneArrow?.line.elbow;
    if (!loneArrow || !elbow || typing) return NO_LEGS;
    const { arrow, line } = loneArrow;
    const label = arrow.label ? measuredArrowLabelBox(arrow, line, byId, measures) : undefined;
    return { route: elbow, handles: arrowLegHandles(arrow, line, byId, layoutBoxResolver(measures), label, camera.zoom, coarse) };
  }, [loneArrow, typing, byId, measures, camera.zoom, coarse]);
  const legsHeld = useRef(legsNow);
  if (transform !== 'arrow') legsHeld.current = legsNow;

  // Handles: only for an editable, unlocked selection with the Select tool, outside text editing and crop mode.
  const active = editable && selecting && !locked && !typing && croppingImage === undefined;
  const handles = active ? resizeHandlesFor(boxes) : [];
  const turnable = active && boxes.length > 0 && canTurnSelection(elements, new Set(ids));
  const dotsFor =
    editable &&
    selecting &&
    !locked &&
    croppingImage === undefined &&
    lone &&
    hasDots(lone) &&
    dotsFit(lone, measures, camera.zoom) &&
    (!typing || (editing?.kind === 'element' && editing.id === lone.id && lone.type !== 'text' && lone.type !== 'container'))
      ? lone
      : undefined;
  //.
  const titling = typing && editing?.kind === 'element' && lone?.type === 'container' && editing.id === lone.id;
  const turning = transform === 'turn' && turnDegrees !== null ? `${Math.round(turnDegrees)}°` : undefined;

  // Hover: an unselected element under the pointer, with the Select tool.
  const hovered = hoverId !== null && selecting && transform === null && !ids.includes(hoverId) ? byId.get(hoverId) : undefined;
  //; the others show their side dots alone.
  const hover = hovered && ELEMENT_KIND_AFFORDANCES[hovered.type].hairline ? hoverOutline(elements, hovered, ids, measures) : undefined;

  // Side dots of the hovered item (the selected item's own dots win). While
  // a gesture runs they stay as they were when it started (hidden), so the
  // dot that started it keeps its pointer capture.
  const hoverDotsNow =
    editable && !typing && dotsFor === undefined && croppingImage === undefined && hovered && hasDots(hovered) && !isElementLocked(hovered) && dotsFit(hovered, measures, camera.zoom)
      ? hovered
      : undefined;
  const hoverDotsHeld = useRef(hoverDotsNow);
  if (transform === null) hoverDotsHeld.current = hoverDotsNow;
  const hoverDots = hoverDotsHeld.current !== undefined ? (byId.get(hoverDotsHeld.current.id) ?? hoverDotsHeld.current) : undefined;

  // The item an arrow end would attach to.
  const connectElement = connectTarget ? byId.get(connectTarget.id) : undefined;
  const connectBox = connectElement ? elementLayoutBox(connectElement, measures) : undefined;
  const connect =
    connectElement && connectBox
      ? { box: connectBox, turn: elementTurn(connectElement), ...(connectTarget?.side ? { dot: sideDotPoint(connectBox, connectTarget.side, camera.zoom, true) } : {}) }
      : undefined;

  // The dots with room around them, for the selected or the hovered item.
  const dotChoices = useMemo(() => (dotsFor ? sideDotChoices(dotsFor, elements, measures, camera.zoom, coarse) : []), [dotsFor, elements, measures, camera.zoom, coarse]);
  const hoverDotChoices = useMemo(
    () => (hoverDots ? sideDotChoices(hoverDots, elements, measures, camera.zoom, coarse) : []),
    [hoverDots, elements, measures, camera.zoom, coarse],
  );

  // What a click on the hovered side dot would add, while the pointer rests on it (not while it drags).
  const dotHover = useSideDotHover((state) => state.dot);
  const content = useBoard((state) => state.board.content);
  const dotOwner = dotHover && (dotHover.id === dotsFor?.id || dotHover.id === hoverDots?.id) ? byId.get(dotHover.id) : undefined;
  const offering = dotOwner !== undefined && editable && transform === null;
  const offer = useMemo((): DotOffer | undefined => {
    if (!offering || !dotOwner || !dotHover) return undefined;
    const next = sideDotItem(dotOwner, dotHover.side, dotHover.tilt, elements, measures);
    return next && !wouldExceedElementLimit(content) ? { next } : undefined;
  }, [offering, dotOwner, dotHover, elements, measures, content]);

  const sectionHoverId = useSectionHover((state) => state.id);
  const commenting = useTool((state) => state.commentMode);
  // The section under the pointer (not picked, not locked, not being edited) glows in the accent.
  const glowId = sectionHoverId ?? (hovered?.type === 'container' ? hovered.id : null);
  const glowing = glowId !== null ? byId.get(glowId) : undefined;
  const glow =
    editable && selecting && !commenting && transform === null && glowing?.type === 'container' && !isElementLocked(glowing) && !ids.includes(glowing.id) && editing?.id !== glowing.id
      ? glowing
      : undefined;
  const glowBox = glow ? elementLayoutBox(glow, measures) : undefined;
  const section = glow && glowBox ? { box: glowBox, turn: elementTurn(glow) } : undefined;

  const arrowLines = lines.map(({ arrow, line }) => ({ id: arrow.id, d: polylinePath(arrowPoints(line)) }));
  // A lone note's ring leans with its tilt.
  const ringTurn = frame ? frame.turn + (lone?.type === 'note' ? lone.tilt : 0) : 0;
  const screen = frame ? screenFrame(camera, frame.box, ringTurn) : undefined;

  return (
    <div className="wb-sel" data-transform={transform ?? undefined} data-typing={typing || undefined} style={{ '--wb-dot-offset': `${SIDE_DOT_OFFSET_PX}px` } as CSSProperties}>
      <Marks
        camera={camera}
        scheme={scheme}
        marquee={marquee}
        guides={guides}
        hover={hover}
        section={section}
        connect={connect}
        hairlines={hairlines}
        groups={groups}
        arrowLines={typing ? [] : arrowLines}
        draft={draft}
        ink={ink}
        offer={offer}
      />
      {screen && croppingImage === undefined && !titling ? (
        <div className="wb-sel-frame" data-locked={locked || undefined} data-thin={typing || undefined} data-sides={handles.length === 2 || undefined} style={frameStyle(screen)}>
          <FrameHandles handles={handles} turnable={turnable} turn={screen.turn} dots={dotChoices} dotsFor={dotsFor} turning={turning} />
        </div>
      ) : null}
      {loneArrow && !typing ? (
        <ArrowHandles
          arrow={loneArrow.arrow}
          camera={camera}
          line={loneArrow.line}
          legs={legsHeld.current}
          labelAt={labelPoint(loneArrow.arrow, loneArrow.line, byId, measures)}
          editable={editable && selecting && !isElementLocked(loneArrow.arrow)}
        />
      ) : null}
      {hoverDots ? <HoverDots element={hoverDots} dots={hoverDotChoices} camera={camera} measures={measures} /> : null}
      {croppingImage ? <CropFrame image={croppingImage} camera={camera} /> : null}
    </div>
  );
}

/** Where an arrow's label handle sits: on its label, or halfway along the line. */
function labelPoint(arrow: ArrowElement, line: ArrowGeometry, byId: ReadonlyMap<ElementId, BoardElement>, measures: ElementMeasures): Point {
  const box = arrow.label ? measuredArrowLabelBox(arrow, line, byId, measures) : undefined;
  return box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : polylineMidpoint(arrowPoints(line));
}
