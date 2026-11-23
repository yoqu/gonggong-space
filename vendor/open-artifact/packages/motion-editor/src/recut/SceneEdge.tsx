import type { KeyboardEvent, PointerEvent, ReactElement } from 'react';
import { create } from 'zustand';
import { SCENE_DURATION_STEP } from '@open-artifact/motion-core';
import { cn } from '@open-artifact/ui';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import type { LaneContext } from '../timeline/lanes.ts';
import type { PartSpan } from '../timeline/timeline-math.ts';
import { clockParts, setSceneLength } from './actions.ts';
import { clampSceneLength, roundTenths, sceneLengthBounds, type LengthBounds } from './bounds.ts';
import * as words from './words.ts';

interface Drag {
  index: number;
  pointer: number;
  startX: number;
  startLength: number;
  pxPerSecond: number;
  bounds: LengthBounds;
  length: number;
}

/** The edge being dragged, with the length it would set; the strip itself redraws only once the record is written. */
const useDrag = create<{ drag: Drag | null }>()(() => ({ drag: null }));

function start(event: PointerEvent<HTMLDivElement>, span: PartSpan, context: LaneContext): void {
  if (event.button !== 0 || !(context.total > 0) || !(context.width > 0)) return;
  const bounds = sceneLengthBounds(clockParts(), span.index);
  if (bounds === null) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
  // Focused so Escape reaches it and takes the drag back.
  event.currentTarget.focus({ preventScroll: true });
  // Fixed for the whole drag: the strip's scale changes only once the new length is written.
  const pxPerSecond = context.width / context.total;
  useDrag.setState({ drag: { index: span.index, pointer: event.pointerId, startX: event.clientX, startLength: span.dur, pxPerSecond, bounds, length: span.dur } });
}

function move(event: PointerEvent<HTMLDivElement>): void {
  const { drag } = useDrag.getState();
  if (drag === null || drag.pointer !== event.pointerId) return;
  const length = clampSceneLength(drag.bounds, drag.startLength + (event.clientX - drag.startX) / drag.pxPerSecond);
  if (length !== drag.length) useDrag.setState({ drag: { ...drag, length } });
}

function end(event: PointerEvent<HTMLDivElement>, cancel: boolean): void {
  const { drag } = useDrag.getState();
  if (drag === null || drag.pointer !== event.pointerId) return;
  useDrag.setState({ drag: null });
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  if (!cancel && Math.abs(drag.length - drag.startLength) > 1e-6) void setSceneLength(drag.index, drag.length);
}

function step(event: KeyboardEvent<HTMLDivElement>, span: PartSpan): void {
  if (event.key === 'Escape' && useDrag.getState().drag !== null) {
    useDrag.setState({ drag: null });
    event.preventDefault();
    return;
  }
  const by = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
  if (by === 0) return;
  event.preventDefault();
  event.stopPropagation();
  void setSceneLength(span.index, span.dur + by * (event.shiftKey ? 10 : 1) * SCENE_DURATION_STEP);
}

/** The handle on a scene card's right edge: drag it, or use the arrow keys, to make the scene play longer or shorter. */
export function SceneEdge({ span, context }: { span: PartSpan; context: LaneContext }): ReactElement | null {
  const playing = usePlayback((s) => s.playing);
  const readOnly = useWorking((s) => s.readOnlyReason !== null);
  const drag = useDrag((s) => (s.drag?.index === span.index ? s.drag : null));
  if (readOnly || span.width < 12) return null;
  const bounds = drag?.bounds ?? null;
  return (
    <>
      {drag !== null ? (
        <div className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left: drag.length * drag.pxPerSecond }}>
          <div className="absolute top-0 bottom-0 -left-px w-0.5 rounded-full bg-chrome-accent" />
          <div className="absolute -top-6 left-0 -translate-x-1/2 rounded-md bg-[var(--vid-tip)] px-1.5 py-0.5 text-[11px] tabular-nums whitespace-nowrap text-[var(--vid-tip-fg)]">
            {words.sceneLengthHint(drag.length)}
          </div>
        </div>
      ) : null}
      <div
        role="slider"
        tabIndex={playing ? -1 : 0}
        aria-label={words.sceneLength(span.index + 1)}
        aria-description={words.DRAG_LENGTH}
        aria-valuenow={roundTenths(drag?.length ?? span.dur)}
        aria-valuetext={words.sceneLengthHint(drag?.length ?? span.dur)}
        {...(bounds !== null ? { 'aria-valuemin': bounds.min, 'aria-valuemax': bounds.max } : {})}
        aria-disabled={playing || undefined}
        title={words.DRAG_LENGTH}
        className={cn(
          'group absolute top-0 -right-1.5 bottom-0 z-10 flex w-3 justify-center outline-none',
          playing ? 'pointer-events-none' : 'cursor-ew-resize',
        )}
        onPointerDown={(event) => {
          if (!playing) start(event, span, context);
        }}
        onPointerMove={move}
        onPointerUp={(event) => end(event, false)}
        onPointerCancel={(event) => end(event, true)}
        onKeyDown={(event) => {
          if (!playing) step(event, span);
        }}
      >
        <span
          className={cn(
            'my-2 w-1 rounded-full bg-chrome-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
            drag !== null && 'opacity-100',
          )}
        />
      </div>
    </>
  );
}
