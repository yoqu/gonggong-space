/**
 * The Pen tool: freehand strokes. Samples are collected in board units and
 * previewed straight into the overlay's SVG path (no React render per
 * sample); Shift straightens the stroke's tail onto the nearest 45° line.
 * The stroke is written once, on release. The pen stays armed.
 */

import {
  DEFAULT_STROKE_WIDTH,
  appendPenPoint,
  createElementId,
  normalizeStrokePoints,
  straightenPenTail,
  strokePointsToPath,
  type StrokeElement,
} from '@open-artifact/whiteboard-core';
import { addElements } from '../services/actions.ts';
import { useCamera } from '../state/camera.ts';
import { useTool } from '../state/tool.ts';
import { drawInkPreview, reportInkTrail, useInteraction } from '../selection/store.ts';
import type { Gesture, PointerSample } from './gesture.ts';
import { snapEndToFortyFiveDegrees } from './hit.ts';
import { ensureRoom } from './place.ts';
import { forgetTap } from './select.ts';

/** Samples closer than this (screen pixels) to the last one are skipped as jitter on touch. */
export const POINTER_JITTER_PX = 4;

/** A finished stroke from samples (`[x0, y0, x1, y1, …]`, board units); a lone sample becomes a dot. */
export function strokeFromSamples(samples: readonly number[], color: StrokeElement['color'], width: number): StrokeElement | undefined {
  if (samples.length < 2) return undefined;
  const points = samples.length === 2 ? [samples[0]!, samples[1]!, samples[0]! + 0.5, samples[1]! + 0.5] : [...samples];
  const normalized = normalizeStrokePoints(points);
  return { type: 'stroke', id: createElementId(), x: normalized.x, y: normalized.y, points: normalized.points, color, width };
}

/** The Pen tool's press. */
export function penPress(sample: PointerSample): Gesture | null {
  forgetTap();
  if (!ensureRoom()) return null;
  const color = useTool.getState().ink;
  const width = DEFAULT_STROKE_WIDTH;
  const samples: number[] = [sample.board.x, sample.board.y];
  /** Where the straightened tail starts while Shift is held. */
  let lock: number | null = null;
  let frame = 0;
  const interaction = useInteraction.getState();
  interaction.setInk({ color, width });
  interaction.setTransform('draw');
  const paint = (): void => {
    frame = 0;
    drawInkPreview(strokePointsToPath(samples));
    reportInkTrail(samples);
  };
  const schedule = (): void => {
    if (frame !== 0) return;
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(paint);
    else paint();
  };
  const finish = (): void => {
    if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = 0;
    drawInkPreview('');
    reportInkTrail(null);
    useInteraction.getState().reset();
  };
  paint();
  return {
    cursor: 'crosshair',
    move(next) {
      const { x, y } = next.board;
      if (next.event.shiftKey) {
        lock ??= samples.length;
        const from = { x: samples[lock - 2] ?? x, y: samples[lock - 1] ?? y };
        const to = snapEndToFortyFiveDegrees(from, { x, y });
        straightenPenTail(samples, lock, to.x, to.y);
      } else {
        lock = null;
        if (next.event.pointerType === 'touch' && samples.length >= 2) {
          const zoom = useCamera.getState().camera.zoom;
          const lastX = samples[samples.length - 2]!;
          const lastY = samples[samples.length - 1]!;
          if (Math.hypot(x - lastX, y - lastY) * zoom < POINTER_JITTER_PX) return;
        }
        if (!appendPenPoint(samples, x, y)) return;
      }
      schedule();
    },
    up() {
      finish();
      const stroke = strokeFromSamples(samples, color, width);
      if (stroke) addElements([stroke], 'Draw', { select: false });
    },
    cancel() {
      finish();
    },
  };
}
