/**
 * Dragging one leg of an elbow arrow sideways to bend its route.
 *
 * A selected elbow arrow shows a handle on each leg that can move. Dragging
 * it slides the leg across its own direction (neighboring legs stretch) and
 * stores the new route as manual `bends`. A drag that lands back on the
 * automatic route, or on the straight line between the ends, clears the
 * bends instead, so an arrow straightens by being dragged back into line.
 *
 * The leg handle and clearance math runs in WebAssembly
 * (`crates/open-artifact-wb-geom/src/bend_drag.rs`). The drag itself stays here: it
 * combines board lookups and arrow layouts that already run there.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { encodePoints } from '../geom-codec.ts';
import { distanceToSegmentSq } from '../hit-test.ts';
import { MAX_ARROW_BENDS, arrowHeads, type ArrowBends, type ArrowElement } from '../schema.ts';
import type { ArrowLabelBox } from './labels.ts';
import {
  NO_ARROW_SPREAD,
  arrowEndAsBox,
  arrowEndCenter,
  arrowGeometry,
  bendOrigins,
  insetArrowEndsToOutline,
  resolveArrowEndGeometry,
  routeElbowArrow,
  routePlanForArrow,
  type ArrowGeometry,
  type BoardIndex,
  type ElementLayoutBoxResolver,
} from './layout.ts';
import {
  ARROW_POINT_SNAP_DISTANCE,
  bendsFromRoute,
  moveRouteSegment,
  routeFromBendsOrUndefined,
  type RouteBends,
  type RoutePoint,
} from './routing.ts';

/** How close (screen pixels) a dragged leg counts as back on the automatic route. */
export const ARROW_LEG_GRAB_PX = 4;

/** Extra room a fitted manual route must keep from the end boxes to count as routable. */
export const BEND_FIT_TOLERANCE = 4;

/** Handle reach from an arrow end, screen pixels: a leg handle this close to an end moves along the leg. */
export const ARROW_LEG_HANDLE_REACH = { fine: 24, coarse: 40 } as const;

/** The arrow without a manual route (no `bends` and no `jog`). */
function withoutRoute(arrow: ArrowElement): ArrowElement {
  const { bends: _bends, jog: _jog, ...rest } = arrow;
  return rest;
}

/**
 * The shortest end leg each end of `route` must keep: room for the arrow
 * head (bounded by how long the end leg already is, on this route or the
 * automatic one), or the plain minimum for an end without a head.
 */
export function arrowEndClearances(arrow: ArrowElement, route: readonly RoutePoint[], board: BoardIndex, layoutBox: ElementLayoutBoxResolver): [number, number] {
  const auto = arrowGeometry(withoutRoute(arrow), board, layoutBox)?.elbow ?? [];
  const heads = arrowHeads(arrow);
  const values = wbGeom().arrow_end_clearances(encodePoints(route), encodePoints(auto), heads[0] !== 'none', heads[1] !== 'none');
  return [values[0]!, values[1]!];
}

/**
 * What dragging leg `leg` of `route` to the point `x, y` does to the
 * arrow's manual route:
 * - `'same'`: the leg cannot move there (nothing changes);
 * - bends: the new manual route;
 * - `null`: the drag lands on the automatic or straight route (clear the bends);
 * - `undefined`: no valid route (keep the last one).
 *
 * `tolerance` is how close (board units) counts as landing on a route.
 */
export function bendsForDraggedSegment(
  arrow: ArrowElement,
  route: readonly RoutePoint[],
  leg: number,
  x: number,
  y: number,
  tolerance: number,
  board: BoardIndex,
  layoutBox: ElementLayoutBoxResolver,
): ArrowBends | null | undefined | 'same' {
  const legStart = route[leg];
  const legEnd = route[leg + 1];
  const fromEnd = resolveArrowEndGeometry(arrow.from, board, layoutBox);
  const toEnd = resolveArrowEndGeometry(arrow.to, board, layoutBox);
  if (!legStart || !legEnd || !fromEnd || !toEnd) return undefined;
  const horizontal = Math.abs(legEnd[0] - legStart[0]) >= Math.abs(legEnd[1] - legStart[1]);
  const dragged = moveRouteSegment(route, leg, horizontal ? y : x, ['w' in fromEnd, 'w' in toEnd], arrowEndClearances(arrow, route, board, layoutBox));
  if (dragged.length === route.length && dragged.every((point, index) => point[0] === route[index]?.[0] && point[1] === route[index]?.[1])) return 'same';

  const unbent = withoutRoute(arrow);
  const straight = arrowGeometry(unbent, board, layoutBox);
  // A drag that keeps every corner on the straight line between the ends straightens the arrow.
  const straightResult =
    straight?.elbow?.length === 2 && dragged.every((point) => distanceToSegmentSq(point[0], point[1], straight.x1, straight.y1, straight.x2, straight.y2) < ARROW_POINT_SNAP_DISTANCE ** 2)
      ? null
      : undefined;
  const fit = bendsFromRoute(dragged);
  if (fit === undefined) return straightResult;
  // One bend back at the middle of a straight arrow: straight again.
  if (straight?.elbow?.length === 2 && fit.at.length === 1 && Math.abs((fit.at[0] ?? NaN) - (fit.first === 'h' ? straight.x1 + straight.x2 : straight.y1 + straight.y2) / 2) < tolerance) return null;
  if (fit.at.length > MAX_ARROW_BENDS) return undefined;

  const origins = bendOrigins(fit.first, fit.at.length, arrowEndCenter(fromEnd), arrowEndCenter(toEnd));
  const bends: ArrowBends = [fit.first, ...fit.at.map((at, index) => at - origins[index]!)];
  const candidate: ArrowElement = { ...unbent, bends };
  const candidateLine = arrowGeometry(candidate, board, layoutBox);
  if (!candidateLine?.bent) return straightResult;

  // Landing on the automatic route clears the bends.
  const matchesStraight = (elbow: readonly RoutePoint[] | undefined): boolean =>
    straight?.elbow?.length === elbow?.length &&
    (straight?.elbow ?? []).every((point, index) => Math.abs(point[0] - (elbow?.[index]?.[0] ?? NaN)) < tolerance && Math.abs(point[1] - (elbow?.[index]?.[1] ?? NaN)) < tolerance);
  const autoExits = routeElbowArrow(unbent, fromEnd, toEnd, routePlanForArrow(unbent, board, layoutBox))?.exits ?? NO_ARROW_SPREAD.exits;
  const autoRoute = routeElbowArrow(candidate, fromEnd, toEnd, { exits: autoExits, stagger: 0 });
  if (
    matchesStraight(candidateLine.elbow) ||
    (autoRoute?.bent && autoRoute.pts.length === candidateLine.elbow?.length && matchesStraight(insetArrowEndsToOutline(autoRoute.pts, arrow, board, autoRoute.sides, autoRoute.exits, layoutBox)))
  )
    return null;

  // Keep the new bends when they route (with or without spreading); when the
  // old route did not route either, keep them anyway rather than getting stuck.
  const exitOptions = [NO_ARROW_SPREAD.exits, routePlanForArrow(candidate, board, layoutBox).exits];
  const routable = (bendsFit: RouteBends | undefined): boolean =>
    bendsFit === undefined ||
    exitOptions.some(
      (exits) =>
        routeFromBendsOrUndefined(
          arrowEndAsBox(fromEnd),
          'w' in fromEnd ? arrow.fromSide : undefined,
          arrowEndAsBox(toEnd),
          'w' in toEnd ? arrow.toSide : undefined,
          bendsFit.first,
          bendsFit.at,
          BEND_FIT_TOLERANCE,
          exits,
        ) !== undefined,
    );
  return routable(fit) || !routable(bendsFromRoute(route)) ? bends : straightResult;
}

/** A handle that drags one leg of an arrow. */
export interface ArrowLegHandle {
  /** Index of the leg (it runs from route point `leg` to `leg + 1`). */
  leg: number;
  /** Where the handle sits, board units. */
  x: number;
  y: number;
  /** Whether the leg runs horizontally (the handle drags up and down). */
  level: boolean;
}

/**
 * The leg handles of a selected arrow drawn as `line`: one at the middle of
 * each leg that can move, slid along the leg off the label and away from the
 * end handles. A straight arrow gets no handle too close to its ends.
 *
 * `zoom` is the camera zoom; `coarse` is a touch pointer (wider reach).
 */
export function arrowLegHandles(arrow: ArrowElement, line: ArrowGeometry, board: BoardIndex, layoutBox: ElementLayoutBoxResolver, label: ArrowLabelBox | undefined, zoom: number, coarse: boolean): ArrowLegHandle[] {
  const elbow = line.elbow;
  if (!elbow) return [];
  const clearances = arrowEndClearances(arrow, elbow, board, layoutBox);
  const reach = (coarse ? ARROW_LEG_HANDLE_REACH.coarse : ARROW_LEG_HANDLE_REACH.fine) / zoom;
  const labelValues = label ? Float64Array.of(1, label.onLine ? 1 : 0, label.x, label.y, label.w, label.h) : new Float64Array(6);
  const lineValues = Float64Array.of(line.x1, line.y1, line.x2, line.y2, line.bent ? 1 : 0);
  const values = wbGeom().arrow_leg_handles(encodePoints(elbow), typeof arrow.from === 'string', typeof arrow.to === 'string', clearances[0], clearances[1], labelValues, reach, zoom, lineValues);
  const handles: ArrowLegHandle[] = [];
  for (let index = 0; index + 3 < values.length; index += 4) handles.push({ leg: values[index]!, x: values[index + 1]!, y: values[index + 2]!, level: values[index + 3] === 1 });
  return handles;
}
