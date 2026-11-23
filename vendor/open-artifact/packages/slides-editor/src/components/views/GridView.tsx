/**
 * The Grid view: every slide as a tile, wrapped into rows and grouped by
 * section. Click selects, Shift / ⌘-click extend, drag reorders (or drops
 * into an empty section), double-click or Enter opens a slide in the
 * one-slide view. Section labels take a one-sentence description; dragging
 * a label moves the section (or the selected sections) between rows.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button, cn } from '@open-artifact/ui';
import { useDeck } from '../../state/deck.ts';
import { useCommentCounts, useOutline, usePeersBySlide } from '../../state/outline.ts';
import { useView } from '../../state/view.ts';
import { addSlide, canChange } from '../../services/commands.ts';
import { useElementSize } from '../../render/SlideView.tsx';
import { useSlideDrag } from '../useSlideDrag.ts';
import { useSectionDrag } from './sectionDrag.ts';
import { CreationView, GridPlanned } from '../Creation.tsx';
import { useCreation } from '../../services/creation.ts';
import { sendGridCursor } from '../../services/cursors.ts';
import { TileCursors } from '../Presence.tsx';
import { GapAdd, SectionLabel, SlideTile } from './shared.tsx';

/** Smallest tile width, px; the columns stretch tiles to fill the row. */
const MIN_TILE = 220;
/** Space between tiles, px (the drop line sits in it). */
const GAP = 24;
/** Horizontal padding of the grid, px. */
const PAD = 32;

/** Opens a slide in the one-slide view. */
function openSlide(id: string): void {
  const view = useView.getState();
  view.setMode('edit');
  view.showSlide(id);
}

/** The grid view. */
export function GridView(): ReactNode {
  const { order, groups } = useOutline();
  const counts = useCommentCounts();
  const peers = usePeersBySlide();
  const dropGap = useView((s) => s.dropGap);
  const current = useView((s) => s.current);
  const editable = useDeck((s) => !s.readOnly) && canChange();
  const writing = useCreation((s) => s.writing);
  const scroller = useRef<HTMLDivElement>(null);
  const size = useElementSize(scroller);
  const { drag, onPointerDown } = useSlideDrag(scroller, 'grid');
  const sectionDrag = useSectionDrag((s) => s.drag);
  const dragging = new Set(drag?.ids ?? []);
  const columns = size ? Math.max(1, Math.floor((size.w - PAD * 2 + GAP) / (MIN_TILE + GAP))) : 4;
  const tile = size ? Math.floor((size.w - PAD * 2 - GAP * (columns - 1)) / columns) : MIN_TILE;

  // Bring the current slide into view when the grid opens.
  const [revealed, setRevealed] = useState(false);
  useLayoutEffect(() => {
    if (revealed || !size || !current) return;
    scroller.current?.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'center' });
    setRevealed(true);
  }, [revealed, size, current]);

  if (order.length === 0) {
    if (writing) return <CreationView />;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-stage text-sm text-chrome-muted">
        <p>No slides yet.</p>
        {editable ? (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => addSlide('blank', null)}>
            Add slide
          </Button>
        ) : null}
      </div>
    );
  }

  let start = 0;
  const starts = groups.map((group) => {
    const at = start;
    start += group.ids.length;
    return at;
  });

  return (
    <div
      ref={scroller}
      role="listbox"
      aria-label="Slides"
      aria-multiselectable
      data-open-artifact-grid-columns={columns}
      data-section-rows
      data-section-scroll
      data-open-artifact-thumbs
      className="min-h-0 flex-1 overflow-y-auto bg-stage pb-6 pt-[60px]"
      style={{ paddingInline: PAD }}
      onPointerMove={(event) => {
        // Where this pointer is on a tile goes to the others (as a fraction of the tile).
        const tile = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slide-id]') : null;
        const slideId = tile?.dataset.slideId;
        if (!tile || !slideId) return sendGridCursor(null);
        const box = tile.getBoundingClientRect();
        sendGridCursor({ slideId, x: (event.clientX - box.left) / Math.max(1, box.width), y: (event.clientY - box.top) / Math.max(1, box.height) });
      }}
      onPointerLeave={() => sendGridCursor(null)}
      onPointerDown={(event) => {
        // A click on the background keeps only the current slide selected.
        if (event.target === event.currentTarget) {
          const view = useView.getState();
          view.selectSections([]);
          view.selectSlides(view.current ? [view.current] : []);
        }
      }}
    >
      {groups.map((group, row) => {
        const first = starts[row]!;
        const previousGap = row > 0 ? row - 1 : null;
        const nextGap = row < groups.length - 1 ? row + 2 : null;
        const showLabel = group.section !== null || groups.length > 1 || editable;
        const lifted = Boolean(group.section && sectionDrag?.keys.includes(group.section.key));
        return (
          <section
            key={group.section?.key ?? '-'}
            data-section-row={row}
            data-section-key={group.section?.key ?? ''}
            className={cn('relative mb-8', lifted && 'opacity-40')}
            aria-label={group.section?.description || `Section ${row + 1}`}
          >
            {sectionDrag?.gap === row ? <RowDropLine /> : null}
            {showLabel ? (
              <SectionLabel section={group.section} n={row} ids={group.ids} previousGap={previousGap} nextGap={nextGap} className="mb-3 max-w-2xl" />
            ) : null}
            {group.ids.length === 0 ? (
              <div
                data-empty-section={group.section?.key}
                className={cn(
                  'flex h-24 items-center justify-center rounded-md border border-dashed border-line text-xs text-fg-subtle',
                  drag?.section === group.section?.key && 'border-accent bg-accent-soft text-accent',
                )}
              >
                An empty section. Drop slides here.
              </div>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, ${tile}px)`, columnGap: GAP, rowGap: GAP }}>
                {group.ids.map((id, i) => {
                  const index = first + i;
                  const last = index === order.length - 1;
                  return (
                    <div key={id} className="group/gap relative">
                      <SlideTile
                        id={id}
                        index={index}
                        comments={counts.get(id) ?? 0}
                        peers={peers.get(id)}
                        dragging={dragging.has(id)}
                        dropBefore={drag !== null && dropGap === index}
                        dropAfter={drag !== null && last && dropGap === order.length}
                        onPointerDown={onPointerDown}
                        onOpen={openSlide}
                      />
                      <TileCursors id={id} />
                      {editable && !drag ? (
                        <div className="absolute -right-[18px] top-0 z-10 flex w-3 items-center justify-center" style={{ height: (tile * 9) / 16 }}>
                          <GapAdd gap={index + 1} after={id} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      <GridPlanned first={order.length} columns={columns} tile={tile} gap={GAP} />
      {sectionDrag?.gap === groups.length ? (
        <div className="relative h-0">
          <RowDropLine />
        </div>
      ) : null}
      {editable ? (
        <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => addSlide('blank', order.at(-1) ?? null)}>
          Add slide
        </Button>
      ) : null}
    </div>
  );
}

/** Where dragged sections would land: a line above the row. */
function RowDropLine(): ReactNode {
  return <div className="pointer-events-none absolute -top-4 left-0 right-0 h-0.5 rounded bg-accent" aria-hidden />;
}
