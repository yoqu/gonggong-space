/**
 * The stage overlay, drawn in screen pixels over the slide: selection
 * frames with resize, rotate and connector-end handles, the hover outline,
 * snap guides, the marquee, the shape being drawn, other people's
 * selections and the crop frame.
 *
 * The overlay itself lets pointer events through to the slide; only its
 * handles (and the crop pan area) take them.
 */

import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Plus, RotateCcw, RotateCw } from 'lucide-react';
import { isAncestorPath, nodeAt, pathKey, resolveContextId, rotationOf, samePath, type ImageNode, type NodePath, type Slide, type TableNode } from '@open-artifact/slides-core';
import { Button, SliderInput, Tooltip, cn } from '@open-artifact/ui';
import { editTable, tableAddRefusal } from '../../services/commands.ts';
import { useComments } from '../../services/comments.ts';
import { resolveSrc } from '../../services/session.ts';
import { usePeersBySlide } from '../../state/outline.ts';
import { useView } from '../../state/view.ts';
import { connectorEnds, elementOf, hostRect, HANDLES, measureBox, rectFromPoints, unionRect, type Box } from './geometry.ts';
import { CROP_EDGES, type CropEdge } from './crop.ts';
import {
  cropGeometry,
  cropHandlesOff,
  cropOf,
  resetCrop,
  setCropZoom,
  stageEditable,
  startConnectorEnd,
  startCropEdge,
  startCropPan,
  startResize,
  startRotate,
  type CropGeometry,
  type StageContext,
} from './gestures.ts';
import { useStageGesture } from './store.ts';

/** Props of the overlay. */
export interface OverlayProps {
  ctx: StageContext;
  /** The slide as drawn (the draft while a gesture previews). */
  slide: Slide;
  /** Extra layers drawn over the slide (comment pins). */
  children?: ReactNode;
}

/** A measured element frame. */
interface Frame {
  key: string;
  path: NodePath;
  box: Box;
}

/** Measures the frames of `paths` on the drawn slide. */
function measureFrames(ctx: StageContext, slide: Slide, paths: readonly NodePath[]): Frame[] {
  const out: Frame[] = [];
  for (const path of paths) {
    const node = nodeAt(slide, path);
    const el = elementOf(ctx.root, path);
    if (!node || !el) continue;
    out.push({ key: pathKey(path), path, box: measureBox(ctx.root, el, ctx.scale, rotationOf(node)) });
  }
  return out;
}

/** Re-measures whenever the selected elements change size (typing, images, fonts). */
function useResizeTick(ctx: StageContext, paths: readonly NodePath[]): void {
  const relayout = useStageGesture((s) => s.relayout);
  const keys = paths.map(pathKey).join(',');
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => relayout());
    observer.observe(ctx.root);
    for (const key of keys ? keys.split(',') : []) {
      const el = elementOf(ctx.root, key);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ctx.root, keys, relayout]);
}

/** The overlay. */
export function Overlay({ ctx, slide, children }: OverlayProps): ReactNode {
  const selection = useView((s) => s.selection);
  const textEdit = useView((s) => s.textEdit);
  const cropping = useView((s) => s.cropping);
  const hover = useStageGesture((s) => s.hover);
  const move = useStageGesture((s) => s.move);
  const guides = useStageGesture((s) => s.guides);
  const marquee = useStageGesture((s) => s.marquee);
  const draw = useStageGesture((s) => s.draw);
  const tick = useStageGesture((s) => s.layoutTick);
  const gesturing = useStageGesture((s) => Boolean(s.draft || s.move));
  // Comment mode outlines what a click comments on, in the comments' color, until a card or composer opens.
  const commenting = useComments((s) => s.on);
  const commentOpen = useComments((s) => s.draft !== null || s.active !== null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [hoverFrame, setHoverFrame] = useState<Frame | null>(null);
  const editable = stageEditable(ctx);
  const s = ctx.scale;

  useResizeTick(ctx, selection);

  useLayoutEffect(() => {
    setFrames(measureFrames(ctx, slide, selection));
    const showHover = hover && (commenting || !selection.some((p) => samePath(p, hover)));
    setHoverFrame(showHover ? (measureFrames(ctx, slide, [hover])[0] ?? null) : null);
  }, [ctx, slide, selection, hover, tick, textEdit, commenting]);

  /** Shifts frames that are being moved. */
  const shifted = (frame: Frame): Box =>
    move && move.keys.includes(frame.key) ? { ...frame.box, x: frame.box.x + move.dx, y: frame.box.y + move.dy } : frame.box;

  const single = frames.length === 1 ? frames[0]! : null;
  const singleNode = single ? nodeAt(slide, single.path) : undefined;
  const showHandles = Boolean(single && singleNode && editable && !textEdit && !cropping && !move);
  const union = frames.length > 1 ? unionRect(frames.map(shifted)) : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible" data-open-artifact-overlay>
      {hoverFrame && !gesturing && !commenting ? <FrameBox box={hoverFrame.box} scale={s} className="border border-accent/60" /> : null}
      {hoverFrame && commenting && !commentOpen ? <FrameBox box={hoverFrame.box} scale={s} className="rounded-[2px] border-2 border-warning/80" /> : null}

      {frames.map((frame) => (
        <FrameBox key={frame.key} box={shifted(frame)} scale={s} className={cn('border-accent', frames.length > 1 ? 'border' : 'border-[1.5px]', textEdit && 'border-dashed')}>
          {showHandles && single === frame && singleNode && singleNode.kind !== 'connector' ? <ResizeHandles ctx={ctx} path={frame.path} /> : null}
          {showHandles && single === frame && singleNode?.kind === 'table' ? <TableAddButtons table={singleNode} path={frame.path} /> : null}
        </FrameBox>
      ))}

      {showHandles && single && singleNode?.kind === 'connector' && singleNode.points ? <ConnectorHandles ctx={ctx} slide={slide} path={single.path} /> : null}

      {union ? (
        <div
          className="absolute border border-dashed border-accent/70"
          style={{ left: union.x * s - 4, top: union.y * s - 4, width: union.w * s + 8, height: union.h * s + 8 }}
        />
      ) : null}

      <PeerFrames ctx={ctx} slide={slide} />

      {guides ? (
        <>
          {guides.x.map((x) => (
            <div key={`x${x}`} className="absolute top-0 h-full w-px bg-danger" style={{ left: x * s }} />
          ))}
          {guides.y.map((y) => (
            <div key={`y${y}`} className="absolute left-0 h-px w-full bg-danger" style={{ top: y * s }} />
          ))}
        </>
      ) : null}

      {marquee ? (
        <div className="absolute border border-accent bg-accent/10" style={{ left: marquee.x * s, top: marquee.y * s, width: marquee.w * s, height: marquee.h * s }} />
      ) : null}

      {draw ? <DrawPreview scale={s} /> : null}

      {cropping && editable ? <CropLayer ctx={ctx} slide={slide} path={cropping} /> : null}

      {children}
    </div>
  );
}

/** A box drawn at slide coordinates (rotated with its element). */
function FrameBox({ box, scale, className, children }: { box: Box; scale: number; className?: string; children?: ReactNode }): ReactNode {
  return (
    <div
      className={cn('absolute', className)}
      style={{
        left: box.x * scale,
        top: box.y * scale,
        width: box.w * scale,
        height: box.h * scale,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** The eight resize handles and the rotation handle of one element. */
function ResizeHandles({ ctx, path }: { ctx: StageContext; path: NodePath }): ReactNode {
  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle.id}
          role="presentation"
          className="pointer-events-auto absolute size-2.5 rounded-[2px] border border-accent bg-surface shadow-sm"
          style={{
            left: `calc(${((handle.hx + 1) / 2) * 100}% - 5px)`,
            top: `calc(${((handle.hy + 1) / 2) * 100}% - 5px)`,
            cursor: handle.cursor,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.preventDefault();
            startResize(ctx, event, path, handle);
          }}
        />
      ))}
      <div className="absolute left-1/2 top-0 h-5 w-px -translate-y-full bg-accent" />
      <div
        role="presentation"
        title="Rotate (Shift snaps to 15°)"
        className="pointer-events-auto absolute left-1/2 top-0 flex size-4 -translate-x-1/2 -translate-y-[calc(100%+18px)] cursor-grab items-center justify-center rounded-full border border-accent bg-surface text-accent shadow-sm"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          startRotate(ctx, event, path);
        }}
      >
        <RotateCw className="size-2.5" />
      </div>
    </>
  );
}

/** "+" buttons past a selected table's right and bottom edges: add a column, add a row. */
function TableAddButtons({ table, path }: { table: TableNode; path: NodePath }): ReactNode {
  const buttons = [
    { what: 'column' as const, label: 'Add a column', style: { left: 'calc(100% + 14px)', top: '50%', transform: 'translateY(-50%)' } },
    { what: 'row' as const, label: 'Add a row', style: { top: 'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)' } },
  ];
  return (
    <>
      {buttons.map(({ what, label, style }) => {
        const refusal = tableAddRefusal(table, what);
        return (
          <Tooltip key={what} label={refusal ?? label}>
            <button
              type="button"
              tabIndex={-1}
              data-open-artifact-table-add={what}
              aria-label={label}
              aria-disabled={refusal !== null}
              className={cn(
                'pointer-events-auto absolute flex size-5 items-center justify-center rounded-full border border-accent bg-surface text-accent shadow-sm',
                refusal ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent hover:text-accent-fg',
              )}
              style={style}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (!refusal) editTable(path, what === 'row' ? 'addRow' : 'addColumn');
              }}
            >
              <Plus className="size-3" strokeWidth={2} />
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}

/** The two end handles of a pinned connector. */
function ConnectorHandles({ ctx, slide, path }: { ctx: StageContext; slide: Slide; path: NodePath }): ReactNode {
  const node = nodeAt(slide, path);
  if (node?.kind !== 'connector') return null;
  const host = hostRect(ctx.root, slide, path, ctx.scale);
  const ends = connectorEnds(node, host.w, host.h);
  if (!ends) return null;
  return (
    <>
      {ends.map((end, i) => (
        <div
          key={i}
          role="presentation"
          title={i === 0 ? 'Start' : 'End'}
          className="pointer-events-auto absolute size-3 cursor-move rounded-full border-2 border-accent bg-surface shadow-sm"
          style={{ left: (host.x + end.x) * ctx.scale - 6, top: (host.y + end.y) * ctx.scale - 6 }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.preventDefault();
            startConnectorEnd(ctx, event, path, i as 0 | 1);
          }}
        />
      ))}
    </>
  );
}

/** The element being drawn by a draw tool. */
function DrawPreview({ scale }: { scale: number }): ReactNode {
  const draw = useStageGesture((s) => s.draw);
  if (!draw) return null;
  if (draw.tool === 'line' || draw.tool === 'connector') {
    return (
      <svg className="absolute inset-0 size-full overflow-visible">
        <line x1={draw.from.x * scale} y1={draw.from.y * scale} x2={draw.to.x * scale} y2={draw.to.y * scale} stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="6 4" />
      </svg>
    );
  }
  const r = rectFromPoints(draw.from, draw.to);
  return (
    <div
      className={cn('absolute border-2 border-dashed border-accent bg-accent/5', draw.tool === 'ellipse' && 'rounded-full', draw.tool === 'rounded' && 'rounded-xl')}
      style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
    />
  );
}

/** Other people's (and the agent's) selections on this slide. */
function PeerFrames({ ctx, slide }: { ctx: StageContext; slide: Slide }): ReactNode {
  const peers = usePeersBySlide().get(ctx.slideId);
  const tick = useStageGesture((s) => s.layoutTick);
  const [frames, setFrames] = useState<{ id: string; name: string; agent: boolean; box: Box }[]>([]);
  const wanted = useMemo(
    () =>
      (peers ?? []).flatMap((peer) =>
        (peer.state?.selected ?? []).flatMap((entry) => {
          const address = resolveContextId(slide, entry);
          return address ? [{ peer, path: address.path }] : [];
        }),
      ),
    [peers, slide],
  );
  useLayoutEffect(() => {
    setFrames(
      wanted.flatMap(({ peer, path }) => {
        const node = nodeAt(slide, path);
        const el = elementOf(ctx.root, path);
        if (!node || !el) return [];
        return [{ id: `${peer.id}:${pathKey(path)}`, name: peer.name, agent: peer.kind === 'agent', box: measureBox(ctx.root, el, ctx.scale, rotationOf(node)) }];
      }),
    );
  }, [ctx, slide, wanted, tick]);
  return (
    <>
      {frames.map((frame) => (
        <FrameBox key={frame.id} box={frame.box} scale={ctx.scale} className={cn('border-2', frame.agent ? 'border-accent/70' : 'border-success/80')}>
          <span className={cn('absolute -top-5 left-0 rounded px-1 text-[10px] font-medium leading-4 text-white', frame.agent ? 'bg-accent' : 'bg-success')}>{frame.name}</span>
        </FrameBox>
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Crop                                                                        */
/* -------------------------------------------------------------------------- */

/** Cursors of the crop handles. */
const CROP_CURSORS: Record<CropEdge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** Names of the crop handles. */
const CROP_LABELS: Record<CropEdge, string> = {
  n: 'top edge',
  s: 'bottom edge',
  e: 'right edge',
  w: 'left edge',
  ne: 'top right',
  nw: 'top left',
  se: 'bottom right',
  sw: 'bottom left',
};

/**
 * The crop frame: the whole picture ghosted, a pan area, side and corner
 * handles that move the frame's edges, and the crop bar.
 */
function CropLayer({ ctx, slide, path }: { ctx: StageContext; slide: Slide; path: NodePath }): ReactNode {
  const node = nodeAt(slide, path);
  const tick = useStageGesture((s) => s.layoutTick);
  const relayout = useStageGesture((s) => s.relayout);
  const [geometry, setGeometry] = useState<CropGeometry | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (node?.kind !== 'image') return;
    const measured = cropGeometry(ctx, path, node);
    setGeometry(measured);
    if (!measured) {
      // Measure again once the picture's pixels arrive.
      const img = elementOf(ctx.root, path)?.querySelector('img');
      if (img && !img.complete) img.addEventListener('load', relayout, { once: true });
    }
  }, [ctx, node, path, tick, relayout]);

  if (node?.kind !== 'image' || !node.src) return null;
  const s = ctx.scale;
  const done = (): void => useView.getState().setCropping(null);
  if (!geometry) return null;
  const { frame, picture } = geometry;
  const current = zoom ?? cropOf(node as ImageNode).zoom;
  const handlesOff = cropHandlesOff(node as ImageNode);
  return (
    <>
      <img
        src={resolveSrc(node.src)}
        alt=""
        draggable={false}
        className="absolute max-w-none opacity-35"
        style={{ left: picture.x * s, top: picture.y * s, width: picture.w * s, height: picture.h * s }}
      />
      <div
        role="presentation"
        title="Drag to move the picture; drag a side to crop"
        className="pointer-events-auto absolute cursor-move outline outline-2 outline-accent"
        style={{ left: frame.x * s, top: frame.y * s, width: frame.w * s, height: frame.h * s }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          startCropPan(ctx, event, path);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          done();
        }}
        onWheel={(event) => {
          event.stopPropagation();
          const next = Math.min(Math.max(5, current), Math.max(1, current * Math.exp(-event.deltaY * 0.002)));
          setCropZoom(ctx.slideId, path, next);
        }}
      />
      {handlesOff
        ? CROP_EDGES.map((edge) => {
            const reason = handlesOff[edge];
            const fx = edge.includes('w') ? 0 : edge.includes('e') ? 1 : 0.5;
            const fy = edge.includes('n') ? 0 : edge.includes('s') ? 1 : 0.5;
            const corner = edge.length === 2;
            return (
              <div
                key={edge}
                role="presentation"
                aria-label={`Crop handle, ${CROP_LABELS[edge]}`}
                title={reason ?? `Crop from the ${CROP_LABELS[edge]}`}
                className={cn(
                  'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 border border-accent bg-surface shadow-sm',
                  corner ? 'size-3' : edge === 'n' || edge === 's' ? 'h-1.5 w-6 rounded-full' : 'h-6 w-1.5 rounded-full',
                  reason && 'opacity-40',
                )}
                style={{ left: (frame.x + frame.w * fx) * s, top: (frame.y + frame.h * fy) * s, cursor: reason ? 'not-allowed' : CROP_CURSORS[edge] }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  event.preventDefault();
                  if (!reason) startCropEdge(ctx, event, path, edge);
                }}
              />
            );
          })
        : null}
      <div
        className="pointer-events-auto absolute flex w-72 items-center gap-2 rounded-control border border-line bg-surface px-2 py-1 shadow-popup"
        style={{ left: frame.x * s + (frame.w * s) / 2 - 144, top: (frame.y + frame.h) * s + 12 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="text-xs text-fg-muted">Zoom</span>
        <div className="min-w-0 flex-1">
          <SliderInput
            aria-label="Crop zoom"
            value={current}
            min={1}
            max={Math.max(5, current)}
            step={0.05}
            onChange={(value) => {
              setZoom(value);
              setCropZoom(ctx.slideId, path, value);
            }}
            onCommit={() => setZoom(null)}
          />
        </div>
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => resetCrop(ctx.slideId, path)} aria-label="Reset crop" />
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={done}>
          Done
        </Button>
      </div>
    </>
  );
}

/** True when `path` is `selection` or inside it. */
export function withinSelection(selection: readonly NodePath[], path: NodePath): boolean {
  return selection.some((p) => samePath(p, path) || isAncestorPath(p, path));
}
