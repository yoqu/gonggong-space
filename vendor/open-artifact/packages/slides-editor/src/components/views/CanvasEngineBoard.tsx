/**
 * The Canvas view's board on the WebGL canvas engine (engineBoard.ts has the
 * how and why). Three layers in one box:
 *
 * - under the canvas, the live slides: real slide DOM, shown through the
 *   engine's holes and placed by them;
 * - the canvas: every slide as a texture, the selection, hover and marquee;
 * - over it, what stays DOM: section labels, captions and badges, the "+",
 *   drop lines and empty sections, moved with the camera by one transform
 *   and re-culled when it settles.
 *
 * The box is the context-menu trigger; the slide right-clicked is found by
 * hit-testing the layout.
 */

import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { AlertTriangle, EyeOff, Maximize, MessageCircle, Minus, Plus } from 'lucide-react';
import { slideTitle } from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { useDeck } from '../../state/deck.ts';
import { useCommentCounts, usePeersBySlide } from '../../state/outline.ts';
import { useView } from '../../state/view.ts';
import { canChange, targetSlides } from '../../services/commands.ts';
import type { PeerView } from '../../services/agent.ts';
import { Card, ChromeButton, ChromeDivider, Tip } from '@open-artifact/editor-kit/react';
import { ContextMenu } from '../ContextMenu.tsx';
import { PeerDots } from '../Rail.tsx';
import { SlideMenuItems } from '../SlideMenu.tsx';
import { SlideThumb } from '../SlideThumb.tsx';
import { useSectionDrag } from './sectionDrag.ts';
import { GapAdd, SectionLabel } from './shared.tsx';
import { CAPTION_H, dropLineBoxes, GAP_X, GAP_Y, grow, LABEL_W, TILE_W, tilesIn, type TileBox } from './canvasLayout.ts';
import { EngineBoard } from './engineBoard.ts';

/** Below this zoom captions and badges are too small to read, and are not rendered. */
const CAPTION_MIN_ZOOM = 0.25;
/** How far past the view (a fraction of its size) the overlay renders, so short pans show it before the camera settles. */
const OVERSCAN = 0.5;

/** Props of {@link CanvasEngineBoard}. */
export interface CanvasEngineBoardProps {
  /** The engine could not start (no WebGL2, or its module failed to load): show the DOM board instead. */
  onFail: (error: unknown) => void;
}

/** All slides on the engine-drawn canvas. */
export function CanvasEngineBoard({ onFail }: CanvasEngineBoardProps): ReactNode {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [board, setBoard] = useState<EngineBoard | null>(null);
  const fail = useRef(onFail);
  fail.current = onFail;

  useEffect(() => {
    const next = new EngineBoard();
    setBoard(next);
    next.start(surface.current!, canvas.current!).catch((error: unknown) => {
      next.destroy();
      fail.current(error);
    });
    return () => next.destroy();
  }, []);

  return (
    // Always a menu (an empty one before the engine starts), so the trigger, and the canvas in it, never remount.
    <ContextMenu menu={board ? <BoardMenu board={board} /> : <></>} className="relative flex min-h-0 flex-1 bg-stage outline-none">
      <div ref={surface} role="listbox" aria-label="Canvas" aria-multiselectable data-open-artifact-canvas-engine className="relative min-h-0 flex-1 touch-none overflow-hidden">
        {board ? <LiveLayer board={board} /> : null}
        <canvas ref={canvas} className="absolute inset-0 size-full" />
        {board ? <Overlay board={board} /> : null}
        {board ? <Controls board={board} /> : null}
      </div>
    </ContextMenu>
  );
}

/** The right-clicked slide's menu (or the selection's, when it is selected). */
function BoardMenu({ board }: { board: EngineBoard }): ReactNode {
  const id = useStore(board.store, (s) => s.menu);
  if (!id) return null;
  return <SlideMenuItems ids={useView.getState().slideSelection.includes(id) ? targetSlides() : [id]} />;
}

/* -------------------------------------------------------------------------- */
/* Live slides (under the canvas)                                              */
/* -------------------------------------------------------------------------- */

function LiveLayer({ board }: { board: EngineBoard }): ReactNode {
  const live = useStore(board.store, (s) => s.live);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {live.map((id) => (
        <LiveTile key={id} board={board} id={id} />
      ))}
    </div>
  );
}

/** One live slide: placed by its hole, shown once it has drawn. */
const LiveTile = memo(function LiveTile({ board, id }: { board: EngineBoard; id: string }): ReactNode {
  const el = useRef<HTMLDivElement>(null);
  const slide = useDeck((s) => s.slides[id]?.slide);
  const slideH = useStore(board.store, (s) => s.layout.slideH);
  const row = useStore(board.store, (s) => s.layout.rows[s.layout.byId.get(id)?.row ?? -1]?.key ?? null);
  const lifted = useSectionDrag((s) => row !== null && (s.drag?.keys.includes(row) ?? false));
  useLayoutEffect(() => board.attachLive(id, el.current!), [board, id]);
  return (
    <div
      ref={el}
      className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-md"
      style={{ width: TILE_W, height: slideH, visibility: 'hidden', opacity: (slide?.hidden ? 0.5 : 1) * (lifted ? 0.4 : 1) }}
    >
      {slide ? <SlideThumb slide={slide} /> : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* Overlay (over the canvas)                                                   */
/* -------------------------------------------------------------------------- */

function Overlay({ board }: { board: EngineBoard }): ReactNode {
  const world = useRef<HTMLDivElement>(null);
  const layout = useStore(board.store, (s) => s.layout);
  const view = useStore(board.store, (s) => s.view);
  const zoom = useStore(board.store, (s) => s.zoom);
  const drag = useStore(board.store, (s) => s.drag);
  const dropGap = useView((s) => s.dropGap);
  const sectionDrag = useSectionDrag((s) => s.drag);
  const editable = useDeck((s) => !s.readOnly) && canChange();
  useLayoutEffect(() => board.attachWorld(world.current!), [board]);

  const near = view ? grow(view, OVERSCAN) : null;
  const rows = near ? layout.rows.filter((r) => r.top < near.y + near.h && r.top + layout.tileH > near.y) : [];
  const tiles = near && zoom >= CAPTION_MIN_ZOOM ? tilesIn(layout, near) : [];
  // Labels stay readable when zoomed out: they scale up against the camera, up to 4×.
  const labelScale = Math.min(4, Math.max(1, 0.6 / zoom));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={world} data-section-rows className="absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height }}>
        {/* Every row's extent, for section drags (sectionDrag.ts measures them). */}
        {layout.rows.map((row) => (
          <div key={row.key ?? '-'} data-section-row={row.row} data-section-key={row.key ?? ''} aria-hidden className="absolute left-0" style={{ top: row.top, width: 1, height: layout.tileH }} />
        ))}
        {sectionDrag && sectionDrag.gap !== null ? (
          <div aria-hidden className="absolute left-0 h-1 rounded bg-accent" style={{ top: sectionDrag.gap * (layout.tileH + GAP_Y) - GAP_Y / 2, width: layout.width }} />
        ) : null}
        {rows.map((row) => (
          <div key={row.key ?? '-'} className={cn('pointer-events-auto absolute', row.key && sectionDrag?.keys.includes(row.key) && 'opacity-40')} style={{ left: 0, top: row.top, width: LABEL_W - GAP_X }}>
            <div className="origin-top-left" style={{ transform: `scale(${labelScale})`, width: (LABEL_W - GAP_X) / labelScale }}>
              <SectionLabel
                section={row.section}
                n={row.row}
                ids={row.ids}
                previousGap={row.row > 0 ? row.row - 1 : null}
                nextGap={row.row < layout.rows.length - 1 ? row.row + 2 : null}
              />
            </div>
          </div>
        ))}
        {layout.rows.map((row) =>
          row.empty && row.key ? (
            <div
              key={row.key}
              data-empty-section={row.key}
              className={cn(
                'absolute flex items-center justify-center rounded-lg border-2 border-dashed border-line text-lg text-fg-subtle',
                drag?.section === row.key && 'border-accent bg-accent-soft text-accent',
              )}
              style={{ left: row.empty.x, top: row.empty.y, width: row.empty.w, height: row.empty.h }}
            >
              An empty section. Drop slides here.
            </div>
          ) : null,
        )}
        {drag && !drag.section && dropGap !== null
          ? dropLineBoxes(layout, dropGap).map((box, i) => (
              <span key={i} aria-hidden className="absolute rounded bg-accent" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
            ))
          : null}
        {tiles.length ? <Captions tiles={tiles} slideH={layout.slideH} dragging={drag?.ids ?? null} /> : null}
        {editable && !drag ? <HoverAdd board={board} /> : null}
      </div>
    </div>
  );
}

/** Captions and badges of the tiles near the view (the slides themselves are on the canvas). */
function Captions({ tiles, slideH, dragging }: { tiles: readonly TileBox[]; slideH: number; dragging: readonly string[] | null }): ReactNode {
  const counts = useCommentCounts();
  const peers = usePeersBySlide();
  return tiles.map((tile) => (
    <Caption key={tile.id} tile={tile} slideH={slideH} comments={counts.get(tile.id) ?? 0} peers={peers.get(tile.id)} dragging={dragging?.includes(tile.id) ?? false} />
  ));
}

/** One slide's caption (number, title, marks) and badges; an option of the listbox for assistive tech. */
const Caption = memo(function Caption({ tile, slideH, comments, peers, dragging }: { tile: TileBox; slideH: number; comments: number; peers: readonly PeerView[] | undefined; dragging: boolean }): ReactNode {
  const entry = useDeck((s) => s.slides[tile.id]);
  const current = useView((s) => s.current === tile.id);
  const selected = useView((s) => s.slideSelection.includes(tile.id));
  if (!entry) return null;
  const problem = entry.held ?? (entry.conflict ? 'Changed elsewhere at the same time' : null);
  const title = slideTitle(entry.slide);
  return (
    <div
      data-slide-index={tile.index}
      data-slide-id={tile.id}
      role="option"
      aria-selected={selected || current}
      aria-label={`Slide ${tile.index + 1}${title ? `: ${title}` : ''}`}
      className={cn('absolute', dragging && 'opacity-40')}
      style={{ left: tile.x, top: tile.y, width: tile.w, height: slideH + CAPTION_H }}
    >
      <div className="absolute right-1.5 flex items-center gap-1" style={{ top: slideH - 6, transform: 'translateY(-100%)' }}>
        <PeerDots peers={peers} />
        {comments ? (
          <span className="flex items-center gap-0.5 rounded-full bg-surface px-1.5 text-[10px] text-fg shadow-popup">
            <MessageCircle className="size-2.5" />
            {comments}
          </span>
        ) : null}
      </div>
      <div className="absolute inset-x-0 flex items-center gap-1.5 pt-1.5 text-[11px] text-fg-muted" style={{ top: slideH }}>
        <span className={cn('tabular-nums', (selected || current) && 'font-semibold text-fg')}>{tile.index + 1}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {entry.slide.hidden ? <EyeOff className="size-3 shrink-0" aria-label="Skipped" /> : null}
        {problem ? <AlertTriangle className="size-3 shrink-0 text-warning" aria-label={problem} /> : null}
      </div>
    </div>
  );
});

/** The "+" in the gap after the slide under the pointer (kept while the pointer moves onto it). */
function HoverAdd({ board }: { board: EngineBoard }): ReactNode {
  const hover = useStore(board.store, (s) => s.hover);
  const layout = useStore(board.store, (s) => s.layout);
  const last = useRef<string | null>(null);
  if (hover && layout.byId.has(hover)) last.current = hover;
  const tile = last.current ? layout.byId.get(last.current) : undefined;
  if (!tile) return null;
  return (
    <div
      className={cn('group/gap pointer-events-none absolute flex items-center justify-center [&_button]:pointer-events-auto', hover === tile.id && '[&_button]:opacity-100')}
      style={{ left: tile.x + tile.w, top: tile.y, width: GAP_X, height: tile.h }}
    >
      <GapAdd gap={tile.index + 1} after={tile.id} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Zoom controls                                                               */
/* -------------------------------------------------------------------------- */

function Controls({ board }: { board: EngineBoard }): ReactNode {
  const readout = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => board.attachZoomReadout(readout.current!), [board]);
  return (
    <Card data-canvas-controls className="absolute bottom-3 right-3 h-9 px-1 py-px" onPointerDown={(event) => event.stopPropagation()}>
      <Tip label="Zoom out">
        <ChromeButton square aria-label="Zoom out" onClick={() => board.zoomBy(1 / 1.25)}>
          <Minus className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      </Tip>
      <span ref={readout} className="min-w-11 text-center text-[13px] tabular-nums text-chrome-secondary" />
      <Tip label="Zoom in">
        <ChromeButton square aria-label="Zoom in" onClick={() => board.zoomBy(1.25)}>
          <Plus className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      </Tip>
      <ChromeDivider />
      <ChromeButton className="pl-1.5 pr-2" onClick={() => board.fit()}>
        <Maximize className="size-4" strokeWidth={1.5} />
        Fit all slides
      </ChromeButton>
    </Card>
  );
}
