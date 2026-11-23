import { MAX_EXPORT_ERROR_CHARS } from '@open-artifact/motion-core';
import type { ExportFormat, ExportProblem, PlaySeconds } from '@open-artifact/motion-core';
import { FrameRenderError } from './errors.ts';
import type { GifPlan } from './plan.ts';
import type { HeldFrames } from './types.ts';
import type { VideoPlan } from './video/format.ts';

/** The held frames of an export, as a problem to tell the agent about; null when every frame was drawn. */
export function heldProblem(held: HeldFrames, saved: boolean): ExportProblem | null {
  if (held.count === 0) return null;
  return {
    kind: 'held',
    count: held.count,
    total: held.total,
    ...(held.first !== undefined ? { first: { t: held.first.t, message: held.first.message.slice(0, MAX_EXPORT_ERROR_CHARS) } } : {}),
    ...(held.last !== undefined ? { last: held.last } : {}),
    saved,
  };
}

/** An export that stopped because of the film (a frame it could not draw); null for any other failure. */
export function failedProblem(error: unknown): ExportProblem | null {
  if (!(error instanceof FrameRenderError)) return null;
  const t: PlaySeconds = error.t;
  return { kind: 'failed', t, message: error.message.slice(0, MAX_EXPORT_ERROR_CHARS) };
}

export const videoExportFormat = (plan: Pick<VideoPlan, 'width' | 'height' | 'fps'>): ExportFormat => ({
  kind: 'video',
  height: Math.min(plan.width, plan.height),
  fps: plan.fps,
});

export const gifExportFormat = (plan: Pick<GifPlan, 'width' | 'height' | 'delayCs'>): ExportFormat => ({
  kind: 'gif',
  shortSide: Math.min(plan.width, plan.height),
  delayCs: plan.delayCs,
});
