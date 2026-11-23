/**
 * Over the picture while the layers can be read: an outline round the picked layer and the one under the pointer,
 * and presses that pick. A press again where the picked layer lies goes one level in; with Cmd or Ctrl held it goes
 * to the innermost layer at once.
 */

import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { findLayer } from '@open-artifact/motion-stage/layers';
import type { LayerBox } from '@open-artifact/motion-stage/protocol';
import { useComments } from '../comments/comments.ts';
import type { StageOverlayContext } from '../player/overlays.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { layerAt, pickLayer, TWEAKS_PANEL } from './reader.ts';
import { setNear, useLayers } from './store.ts';
import { layerAccessibleLabel } from './tree.ts';

/** How far outside a layer's box, in screen pixels, a press still finds it. */
const SLACK_PX = 6;

/** The last point the pointer was at over the picture (film pixels), to look again when Cmd or Ctrl is pressed. */
let lastPoint: { x: number; y: number; slack: number; width: number; height: number } | null = null;

/** Finds the layer under the pointer again (Cmd or Ctrl went down or up). */
export function refreshHover(): void {
  if (lastPoint === null) return;
  const { x, y, slack, width, height } = lastPoint;
  setNear(layerAt({ x, y, slack, deep: useLayers.getState().deep }, width, height)?.id ?? null);
}

function Outline({ box, scale, picked }: { box: LayerBox; scale: number; picked: boolean }): ReactElement {
  const [x, y, w, h] = box;
  return (
    <div
      aria-hidden
      className={picked ? 'absolute rounded-[2px] border-2 border-accent' : 'absolute rounded-[2px] border border-accent/70'}
      style={{ left: x * scale - (picked ? 2 : 1), top: y * scale - (picked ? 2 : 1), width: w * scale + (picked ? 4 : 2), height: h * scale + (picked ? 4 : 2), pointerEvents: 'none' }}
    />
  );
}

export function SelectionOverlay({ context }: { context: StageOverlayContext }): ReactElement | null {
  const { scale, filmWidth, filmHeight } = context;
  const state = useLayers((s) => s.state);
  const report = useLayers((s) => s.report);
  const pickedId = useLayers((s) => s.pickedId);
  const nearId = useLayers((s) => s.nearId);
  const panel = useUi((s) => s.panel);
  const fullscreen = useUi((s) => s.fullscreen);
  const ready = useFilm((s) => s.stage === 'ready');
  const playing = usePlayback((s) => s.playing);
  const commenting = useComments((s) => s.on);
  const area = useRef<HTMLDivElement>(null);

  const on = panel === TWEAKS_PANEL && !fullscreen && ready && !playing && report !== null && (state === 'read' || state === 'reading');
  if (!on || report === null) return null;
  const rows = report.rows;
  const picked = findLayer(rows, pickedId);
  const near = nearId !== pickedId ? findLayer(rows, nearId) : null;
  const capture = !commenting;

  const pointAt = (event: ReactPointerEvent | ReactMouseEvent): { x: number; y: number } | null => {
    const rect = area.current?.getBoundingClientRect();
    if (rect === undefined || scale <= 0) return null;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };
  const slack = SLACK_PX / (scale > 0 ? scale : 1);

  return (
    <div
      ref={area}
      className="absolute inset-0"
      data-video-layers=""
      style={{ pointerEvents: capture ? 'auto' : 'none', cursor: capture && near !== null ? 'pointer' : undefined }}
      onPointerMove={(event) => {
        const point = pointAt(event);
        if (point === null) return;
        lastPoint = { ...point, slack, width: filmWidth, height: filmHeight };
        const deep = event.metaKey || event.ctrlKey;
        if (deep !== useLayers.getState().deep) useLayers.setState({ deep });
        setNear(layerAt({ ...point, slack, deep }, filmWidth, filmHeight)?.id ?? null);
      }}
      onPointerLeave={() => {
        lastPoint = null;
        setNear(null);
      }}
      onClick={(event) => {
        const point = pointAt(event);
        if (point === null) return;
        event.stopPropagation();
        const row = layerAt({ ...point, slack, deep: event.metaKey || event.ctrlKey }, filmWidth, filmHeight);
        pickLayer(row, 'keep');
      }}
    >
      {near !== null && near.box !== null ? <Outline box={near.box} scale={scale} picked={false} /> : null}
      {picked !== null && picked.box !== null ? <Outline box={picked.box} scale={scale} picked /> : null}
      {picked !== null ? (
        <span className="sr-only" role="status">
          {layerAccessibleLabel(picked)}
        </span>
      ) : null}
    </div>
  );
}
