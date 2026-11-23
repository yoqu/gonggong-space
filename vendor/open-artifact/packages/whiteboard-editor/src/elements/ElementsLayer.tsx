/**
 * The element layer: every element of the board, drawn in board units
 * inside the camera layer of `BoardSurface`.
 *
 * Draw order is the board's order (back to front), except that sections
 * are drawn behind everything else so their contents stay on top. Each
 * element renders as a positioned box `[data-wb-id][data-wb-type]` (arrows
 * and strokes as SVG with the id on their hit path) so tools find elements
 * with `closest('[data-wb-id]')`.
 *
 * Every view subscribes to its own element (`useShownElement`) and
 * re-renders only when that element changes. Views draw the *shown* board
 * (`state/shown.ts`): the stored board with other people's gestures in
 * progress applied, so a note a peer drags moves here too, and elements a
 * peer's gesture adds (an Alt-drag duplicate) are drawn in front until
 * they are saved. Elements whose drawn place jumps glide into place
 * ({@link SettleGlides}). Pan and zoom never re-render: the layer keeps
 * `--wb-zoom` current with a camera subscription, and section titles scale
 * themselves the same way.
 *
 * The layer also does the bookkeeping that needs the whole board: section
 * growth around their contents, nested title room, reading order for
 * screen readers, the fills behind free text, and dropping the measures of
 * removed elements.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  nestedSectionTitleRoom,
  orderElementsForReading,
  sectionGrowthForContents,
  textBackdropColors,
  withoutSectionHeights,
  type BoardElement,
  type ElementId,
} from '@open-artifact/whiteboard-core';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures, reportMeasure, useMeasures } from '../state/measures.ts';
import { useShown, useShownAdditions, useShownElement } from '../state/shown.ts';
import { useTheme } from '../state/theme.ts';
import { BOARD_ITEMS_LIST_LABEL } from './describe.ts';
import { HtmlView } from './HtmlView.tsx';
import { ImageView, StickerView } from './MediaViews.tsx';
import { ArrowView, StrokeView } from './LineViews.tsx';
import { LinkView, TableView, TimerView } from './CardViews.tsx';
import { NoteView, SectionView, ShapeView, TextView } from './BlockViews.tsx';
import { useBoardRecovery } from '../services/load-recovery.ts';
import { rotationStyle } from './style.ts';
import { elementDomId, useItemProps } from './item.tsx';
import { useElementView } from './view-state.ts';

/** How long an element takes to glide into place after its drawn place jumped, ms. */
export const SETTLE_GLIDE_MS = 160;

/** The ids in draw order: sections first (in board order), then the rest. */
export function layerOrder(elements: readonly BoardElement[]): ElementId[] {
  const sections: ElementId[] = [];
  const rest: ElementId[] = [];
  for (const element of elements) (element.type === 'container' ? sections : rest).push(element.id);
  return sections.length === 0 ? rest : [...sections, ...rest];
}

function PausedMedia({ element }: { element: Extract<BoardElement, { type: 'image' | 'html' }> }) {
  const item = useItemProps(element);
  return <div {...item} className="wb-el wb-paused-media" style={{
    left: element.x, top: element.y, width: element.w, height: element.h, ...rotationStyle(element),
  }}>{element.type === 'html' ? 'Embed paused' : 'Picture paused'}</div>;
}

/** One element, drawn by the view of its type. */
export const ElementView = memo(function ElementView({ id }: { id: ElementId }) {
  const element = useShownElement(id);
  const paused = useBoardRecovery((state) => state.paused);
  if (!element) return null;
  if (paused && (element.type === 'image' || element.type === 'html')) return <PausedMedia element={element} />;
  switch (element.type) {
    case 'note':
      return <NoteView element={element} />;
    case 'shape':
      return <ShapeView element={element} />;
    case 'text':
      return <TextView element={element} />;
    case 'container':
      return <SectionView element={element} />;
    case 'stroke':
      return <StrokeView element={element} />;
    case 'arrow':
      return <ArrowView element={element} />;
    case 'image':
      return <ImageView element={element} />;
    case 'sticker':
      return <StickerView element={element} />;
    case 'html':
      return <HtmlView element={element} />;
    case 'link':
      return <LinkView element={element} />;
    case 'table':
      return <TableView element={element} />;
    case 'timer':
      return <TimerView element={element} />;
  }
});

/** Keeps `--wb-zoom` on an element layer: hit strokes and chips keep their screen size without re-rendering. */
function useZoomVariable(root: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const apply = (zoom: number) => root.current?.style.setProperty('--wb-zoom', String(zoom));
    apply(useCamera.getState().camera.zoom);
    return useCamera.subscribe((state, previous) => {
      if (state.camera.zoom !== previous.camera.zoom) apply(state.camera.zoom);
    });
  }, [root]);
}

/** Every element of the board, in draw order (render inside the camera layer). */
export function ElementsLayer() {
  const stored = useBoard(useShallow((state) => layerOrder(state.board.content.elements)));
  const additions = useShownAdditions();
  const ids = useMemo(() => {
    const present = new Set(stored);
    return additions.length === 0 ? stored : [...stored, ...additions.filter((id) => !present.has(id))];
  }, [stored, additions]);
  const owns = useElementView(useShallow((state) => [...state.reading.keys()]));
  const root = useRef<HTMLDivElement>(null);
  useZoomVariable(root);

  return (
    <div ref={root} className="wb-elements" role="list" aria-label={BOARD_ITEMS_LIST_LABEL} aria-owns={owns.map((id) => `wb-${id}`).join(' ') || undefined}>
      <LayerBookkeeping />
      <SettleGlides />
      {ids.map((id) => (
        <ElementView key={id} id={id} />
      ))}
    </div>
  );
}

/**
 * Starts the queued settle glides (see `state/shown.ts`) once the elements
 * are drawn at their new places: each starts translated back to where it
 * was drawn and slides home. Skipped when motion is reduced.
 */
function SettleGlides() {
  const glides = useShown((state) => state.glides);
  useLayoutEffect(() => {
    if (glides.length === 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    for (const { id, dx, dy } of glides) {
      document.getElementById(elementDomId(id))?.animate?.({ translate: [`${dx}px ${dy}px`, '0px 0px'] }, { duration: SETTLE_GLIDE_MS, easing: 'ease-out' });
    }
  }, [glides]);
  return null;
}

/* ------------------------------------------------------------------------ */
/* Bookkeeping                                                              */
/* ------------------------------------------------------------------------ */

function sameNumberMap(a: ReadonlyMap<ElementId, number>, b: ReadonlyMap<ElementId, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, value] of a) if (b.get(id) !== value) return false;
  return true;
}

function sameStringMap(a: ReadonlyMap<ElementId, string>, b: ReadonlyMap<ElementId, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, value] of a) if (b.get(id) !== value) return false;
  return true;
}

/**
 * Board-wide derived state, recomputed after the board or the measures
 * change (once per frame at most): section heights and title room, reading
 * order and text backdrops; also forgets measures of removed elements.
 */
function LayerBookkeeping() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      const elements = useBoard.getState().board.content.elements;
      const byId = useBoard.getState().byId;
      const measures = currentMeasures();
      const frozen = useElementView.getState().frozen ?? undefined;

      // Sections grow around what sits in them, and nested titles get room.
      const growth = sectionGrowthForContents(elements, withoutSectionHeights(measures), frozen);
      const titleRoom = nestedSectionTitleRoom(elements, measures, frozen);
      for (const element of elements) {
        if (element.type !== 'container') continue;
        const sectionH = growth.get(element.id);
        const room = titleRoom.get(element.id);
        const measured = measures.get(element.id);
        if (measured?.sectionH !== sectionH || measured?.titleMost !== room) reportMeasure(element.id, { sectionH, titleMost: room });
      }

      // Measures of elements that are gone.
      for (const id of measures.keys()) if (!byId.has(id)) reportMeasure(id, null);

      // Reading order and backdrops.
      const view = useElementView.getState();
      const reading = new Map(orderElementsForReading(elements, measures).map((element, index) => [element.id, index + 1] as const));
      const backdrops = textBackdropColors(elements, measures, useTheme.getState().scheme);
      const patch: Partial<typeof view> = {};
      if (!sameNumberMap(view.reading, reading)) Object.assign(patch, { reading, readingSize: reading.size });
      if (!sameStringMap(view.backdrops, backdrops)) patch.backdrops = backdrops;
      if (Object.keys(patch).length > 0) useElementView.setState(patch);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(run);
    };
    run();
    const offBoard = useBoard.subscribe((state, previous) => {
      if (state.board !== previous.board) schedule();
    });
    const offMeasures = useMeasures.subscribe(schedule);
    const offFrozen = useElementView.subscribe((state, previous) => {
      if (state.frozen !== previous.frozen) schedule();
    });
    const offScheme = useTheme.subscribe((state, previous) => {
      if (state.scheme !== previous.scheme) schedule();
    });
    return () => {
      offBoard();
      offMeasures();
      offFrozen();
      offScheme();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
