/**
 * Backpressure for renders: at most a few renders may be on their way to the stage before it says one is on show
 * (`presented`). A render that has to wait is not queued; the next one sent carries the latest moment instead.
 */

export const MAX_UNPRESENTED_RENDERS = 2;

export interface RenderGate {
  /** The last render's `seq` sent. */
  sent: number;
  /** The last render's `seq` the stage said is on show. */
  presented: number;
  /** A render was held back and should go as soon as the gate opens. */
  waiting: boolean;
  readonly max: number;
}

export const createRenderGate = (max: number = MAX_UNPRESENTED_RENDERS): RenderGate => ({ sent: 0, presented: 0, waiting: false, max });

export const canSendRender = (gate: RenderGate): boolean => gate.sent - gate.presented < gate.max;

export function markSent(gate: RenderGate, seq: number): void {
  gate.sent = Math.max(gate.sent, seq);
  gate.waiting = false;
}

export function markHeld(gate: RenderGate): void {
  gate.waiting = true;
}

/** The stage has shown `seq`; returns whether a held render should go now. */
export function markPresented(gate: RenderGate, seq: number): boolean {
  if (seq <= gate.presented) return false;
  gate.presented = seq;
  return gate.waiting && canSendRender(gate);
}

/** A new stage starts with nothing on its way: everything sent before `seq` counts as shown. */
export function resetGate(gate: RenderGate, seq: number): void {
  gate.sent = seq;
  gate.presented = seq;
  gate.waiting = false;
}
