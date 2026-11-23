/**
 * The Canvas view: every slide laid out on a zoomable canvas, one row per
 * section, its label (and one-sentence description) on the left. Slides are
 * selected and dragged here as in the grid (a section label drags its row);
 * the "+" after a slide adds a slide or starts a section there. Wheel pans, ⌘/Ctrl-wheel or a pinch
 * zooms, dragging the background pans, and "Fit all slides" frames the deck.
 *
 * The board is drawn by the WebGL canvas engine (CanvasEngineBoard.tsx,
 * engineBoard.ts); with `?open_artifact_engine=off`, without WebGL2, or with no slides it
 * is DOM, as below.
 *
 * Double-click (or Enter) edits a slide in place: the stage shows it with
 * its neighbours on either side in place of the rail, and "Back to canvas"
 * (or Escape) returns to the canvas where it was.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Maximize, Minus, Plus } from 'lucide-react';
import { SLIDE_HEIGHT, SLIDE_WIDTH, slideTitle } from '@open-artifact/slides-core';
import { Button, cn } from '@open-artifact/ui';
import { useDeck } from '../../state/deck.ts';
import { useCommentCounts, useOrder, useOutline, usePeersBySlide } from '../../state/outline.ts';
import { useView } from '../../state/view.ts';
import { addSlide, canChange } from '../../services/commands.ts';
import { useElementSize } from '../../render/SlideView.tsx';
import { Card, ChromeButton, ChromeDivider, Tip } from '@open-artifact/editor-kit/react';
import { SlideThumb } from '../SlideThumb.tsx';
import { noteThumbsMoved } from '../../services/live.ts';
import { Stage } from '../Stage.tsx';
import { useSlideDrag } from '../useSlideDrag.ts';
import { useSectionDrag } from './sectionDrag.ts';
import { GapAdd, SectionLabel, SlideTile } from './shared.tsx';
import { CAPTION_H, GAP_X, GAP_Y, LABEL_W, TILE_W } from './canvasLayout.ts';
import { CanvasEngineBoard } from './CanvasEngineBoard.tsx';
import { engineOff } from './engineBoard.ts';

/** Height of a tile: the slide (16:9 or 4:3) plus its caption line. */
const tileHeight = (): number => (TILE_W * SLIDE_HEIGHT) / SLIDE_WIDTH + CAPTION_H;
/** Margin kept around the deck by "Fit all slides", screen px. */
const FIT_MARGIN = 48;
const MIN_SCALE = 0.05;
const MAX_SCALE = 2;

/** The camera: screen = world × scale + offset. */
interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** Where the canvas was when a slide was opened from it (restored on return). */
let savedCamera: Camera | null = null;

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** The camera that frames a world of `w` × `h` in a viewport of `vw` × `vh`. */
function fitCamera(w: number, h: number, vw: number, vh: number): Camera {
  const scale = clampScale(Math.min((vw - FIT_MARGIN * 2) / w, (vh - FIT_MARGIN * 2) / h, 1));
  return { scale, x: (vw - w * scale) / 2, y: Math.max(FIT_MARGIN, (vh - h * scale) / 2) };
}

/** Edits a slide in place on the canvas. */
function editSlide(id: string): void {
  useView.getState().editOnCanvas(id);
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                      */
/* -------------------------------------------------------------------------- */

/** The canvas view (or a slide being edited on it). */
export function CanvasView(): ReactNode {
  const editing = useView((s) => s.canvasEdit);
  return editing ? <CanvasEdit /> : <CanvasBoard />;
}

/** The engine failed to start once: the DOM board from then on. */
let engineFailed = false;

/** All slides on the zoomable canvas: drawn by the canvas engine, or by the DOM (`?open_artifact_engine=off`, no WebGL2, or no slides). */
function CanvasBoard(): ReactNode {
  const empty = useOrder().length === 0;
  const [, setFailed] = useState(engineFailed);
  if (engineOff || engineFailed || empty) return <DomBoard />;
  return (
    <CanvasEngineBoard
      onFail={(error) => {
        console.warn('Canvas engine unavailable; drawing the canvas with the DOM.', error);
        engineFailed = true;
        setFailed(true);
      }}
    />
  );
}

/** All slides on the zoomable canvas, as DOM. */
function DomBoard(): ReactNode {
  const { order, groups } = useOutline();
  const counts = useCommentCounts();
  const peers = usePeersBySlide();
  const dropGap = useView((s) => s.dropGap);
  const editable = useDeck((s) => !s.readOnly) && canChange();
  const viewport = useRef<HTMLDivElement>(null);
  const size = useElementSize(viewport);
  const { drag, onPointerDown } = useSlideDrag(viewport, 'grid');
  const sectionDrag = useSectionDrag((s) => s.drag);
  const dragging = new Set(drag?.ids ?? []);

  // Tiles follow the deck's size (deck.json `size`, 16:9 or 4:3).
  useDeck((s) => s.index.size);
  const TILE_H = tileHeight();
  const columns = Math.max(1, ...groups.map((g) => g.ids.length));
  const worldW = LABEL_W + columns * TILE_W + (columns - 1) * GAP_X;
  const worldH = Math.max(1, groups.length) * (TILE_H + GAP_Y) - GAP_Y;

  const [camera, setCamera] = useState<Camera | null>(savedCamera);
  const cameraRef = useRef<Camera | null>(camera);
  cameraRef.current = camera;
  const move = useCallback((next: Camera) => {
    cameraRef.current = next;
    savedCamera = next;
    setCamera(next);
    // Tiles near the view go live once the camera rests (services/live.ts).
    noteThumbsMoved();
  }, []);

  const fit = useCallback(() => {
    if (size) move(fitCamera(worldW, worldH, size.w, size.h));
  }, [size, worldW, worldH, move]);

  // Frame the deck the first time the canvas has a size.
  useLayoutEffect(() => {
    if (!cameraRef.current && size) fit();
  }, [size, fit]);

  /** Zooms by `factor` keeping the screen point (px, py) still. */
  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const cam = cameraRef.current;
      if (!cam) return;
      const scale = clampScale(cam.scale * factor);
      const k = scale / cam.scale;
      move({ scale, x: px - (px - cam.x) * k, y: py - (py - cam.y) * k });
    },
    [move],
  );

  // Wheel pans; ⌘/Ctrl-wheel and trackpad pinches zoom (non-passive to keep the page still).
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const cam = cameraRef.current;
      if (!cam) return;
      const rect = el.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
      } else {
        const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
        move({ ...cam, x: cam.x - dx, y: cam.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, move]);

  const center = (): { x: number; y: number } => ({ x: (size?.w ?? 0) / 2, y: (size?.h ?? 0) / 2 });

  // Dragging the background pans; a click on it clears the selection.
  const onBackgroundDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-slide-index], [data-section-label], [data-empty-section], button, textarea, [data-canvas-controls]')) return;
    const cam = cameraRef.current;
    if (!cam) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const onMove = (e: PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;
      moved = true;
      move({ ...cam, x: cam.x + e.clientX - startX, y: cam.y + e.clientY - startY });
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        const view = useView.getState();
        view.selectSections([]);
        view.selectSlides(view.current ? [view.current] : []);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  let start = 0;
  const starts = groups.map((group) => {
    const at = start;
    start += group.ids.length;
    return at;
  });

  return (
    <div
      ref={viewport}
      role="listbox"
      aria-label="Canvas"
      aria-multiselectable
      data-open-artifact-thumbs
      className={cn('relative min-h-0 flex-1 touch-none overflow-hidden bg-stage', !drag && 'cursor-grab active:cursor-grabbing')}
      onPointerDown={onBackgroundDown}
    >
      {order.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-chrome-muted">
          <p>No slides yet.</p>
          {editable ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => addSlide('blank', null)}>
              Add slide
            </Button>
          ) : null}
        </div>
      ) : camera ? (
        <div data-section-rows className="absolute left-0 top-0 origin-top-left" style={{ width: worldW, height: worldH, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
          {groups.map((group, row) => {
            const top = row * (TILE_H + GAP_Y);
            const first = starts[row]!;
            return (
              <section
                key={group.section?.key ?? '-'}
                aria-label={group.section?.description || `Section ${row + 1}`}
                className={cn(group.section && sectionDrag?.keys.includes(group.section.key) && 'opacity-40')}
              >
                {/* The row's extent, for section drags (its children are placed absolutely). */}
                <div data-section-row={row} data-section-key={group.section?.key ?? ''} aria-hidden className="pointer-events-none absolute left-0" style={{ top, width: 1, height: TILE_H }} />
                {sectionDrag?.gap === row ? <div aria-hidden className="pointer-events-none absolute left-0 h-1 rounded bg-accent" style={{ top: top - GAP_Y / 2, width: worldW }} /> : null}
                <div className="absolute" style={{ left: 0, top, width: LABEL_W - GAP_X }}>
                  {/* Labels stay readable when zoomed out: they scale up against the camera, up to 4×. */}
                  <div className="origin-top-left" style={{ transform: `scale(${Math.min(4, Math.max(1, 0.6 / camera.scale))})`, width: (LABEL_W - GAP_X) / Math.min(4, Math.max(1, 0.6 / camera.scale)) }}>
                    <SectionLabel
                      section={group.section}
                      n={row}
                      ids={group.ids}
                      previousGap={row > 0 ? row - 1 : null}
                      nextGap={row < groups.length - 1 ? row + 2 : null}
                    />
                  </div>
                </div>
                {group.ids.length === 0 ? (
                  <div
                    data-empty-section={group.section?.key}
                    className={cn(
                      'absolute flex items-center justify-center rounded-lg border-2 border-dashed border-line text-lg text-fg-subtle',
                      drag?.section === group.section?.key && 'border-accent bg-accent-soft text-accent',
                    )}
                    style={{ left: LABEL_W, top, width: TILE_W, height: TILE_H - CAPTION_H }}
                  >
                    An empty section. Drop slides here.
                  </div>
                ) : (
                  group.ids.map((id, i) => {
                    const index = first + i;
                    return (
                      <div key={id} className="group/gap absolute" style={{ left: LABEL_W + i * (TILE_W + GAP_X), top, width: TILE_W }}>
                        <SlideTile
                          id={id}
                          index={index}
                          width={TILE_W}
                          comments={counts.get(id) ?? 0}
                          peers={peers.get(id)}
                          dragging={dragging.has(id)}
                          dropBefore={drag !== null && dropGap === index}
                          dropAfter={drag !== null && i === group.ids.length - 1 && dropGap === index + 1}
                          onPointerDown={onPointerDown}
                          onOpen={editSlide}
                        />
                        {editable && !drag ? (
                          <div className="absolute top-0 z-10 flex items-center justify-center" style={{ left: TILE_W, width: GAP_X, height: TILE_H - CAPTION_H }}>
                            <GapAdd gap={index + 1} after={id} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      ) : null}

      <Card data-canvas-controls className="absolute bottom-3 right-3 h-9 px-1 py-px" onPointerDown={(event) => event.stopPropagation()}>
        <Tip label="Zoom out">
          <ChromeButton square aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, center().x, center().y)}>
            <Minus className="size-4" strokeWidth={1.5} />
          </ChromeButton>
        </Tip>
        <span className="min-w-11 text-center text-[13px] tabular-nums text-chrome-secondary">{camera ? `${Math.round(camera.scale * 100)}%` : ''}</span>
        <Tip label="Zoom in">
          <ChromeButton square aria-label="Zoom in" onClick={() => zoomAt(1.25, center().x, center().y)}>
            <Plus className="size-4" strokeWidth={1.5} />
          </ChromeButton>
        </Tip>
        <ChromeDivider />
        <ChromeButton className="pl-1.5 pr-2" onClick={fit}>
          <Maximize className="size-4" strokeWidth={1.5} />
          Fit all slides
        </ChromeButton>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Editing a slide on the canvas                                               */
/* -------------------------------------------------------------------------- */

/** How many neighbours are shown on each side of the slide being edited. */
const NEIGHBOURS = 2;

/** A neighbour slide beside the stage; clicking it edits that slide instead. */
function Neighbour({ id, n }: { id: string; n: number }): ReactNode {
  const slide = useDeck((s) => s.slides[id]?.slide);
  if (!slide) return null;
  return (
    <button
      type="button"
      aria-label={`Edit slide ${n}`}
      className="group w-full text-left"
      onClick={() => useView.getState().showSlide(id)}
    >
      <div className="overflow-hidden rounded-[6px] opacity-60 shadow-[0_0_0_1px_var(--chrome-line)] transition group-hover:opacity-100">
        <SlideThumb slide={slide} />
      </div>
      <div className="truncate pt-1 text-[11px] text-chrome-muted">
        <span className="tabular-nums">{n}</span> {slideTitle(slide)}
      </div>
    </button>
  );
}

/** The slide being edited, with its neighbours on either side. */
function CanvasEdit(): ReactNode {
  const order = useOrder();
  const current = useView((s) => s.current);
  const at = current ? order.indexOf(current) : -1;

  // The slide was deleted (here or elsewhere): back to the canvas.
  useEffect(() => {
    if (at < 0) useView.getState().editOnCanvas(null);
  }, [at]);
  if (at < 0) return null;

  const before = order.slice(Math.max(0, at - NEIGHBOURS), at);
  const after = order.slice(at + 1, at + 1 + NEIGHBOURS);
  const column = (ids: string[], offset: number): ReactNode => (
    <div className="flex w-40 shrink-0 flex-col justify-center gap-4 overflow-hidden px-3 pb-14 pt-14 max-md:hidden">
      {ids.map((id, i) => (
        <Neighbour key={id} id={id} n={offset + i + 1} />
      ))}
    </div>
  );

  return (
    <div className="relative flex min-h-0 flex-1 bg-stage">
      {column(before, at - before.length)}
      <div className="relative min-w-0 flex-1">
        <Stage />
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <Card className="h-9 px-1 py-px">
            <Tip label="Back to canvas" shortcut="Esc">
              <ChromeButton className="pl-1.5 pr-2" onClick={() => useView.getState().editOnCanvas(null)}>
                <ArrowLeft className="size-4" strokeWidth={1.5} />
                Canvas
              </ChromeButton>
            </Tip>
            <ChromeDivider />
            <span className="px-2 text-[13px] tabular-nums text-chrome-secondary">
              Slide {at + 1} of {order.length}
            </span>
          </Card>
        </div>
      </div>
      {column(after, at + 1)}
    </div>
  );
}
