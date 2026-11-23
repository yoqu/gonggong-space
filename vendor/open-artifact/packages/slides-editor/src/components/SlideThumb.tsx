/**
 * A slide drawn small: the full 1920×1080 slide scaled into its box. Used by
 * the rail, the grid, the canvas view and the speaker window.
 *
 * A `virtual` thumbnail (rail, grid, canvas tiles) is live only near its
 * view; otherwise it shows a snapshot image of the slide, or the slide's
 * background until it has one (services/live.ts). Neither the image nor the
 * placeholder takes pointer events, so clicks, drags and context menus land
 * on the thumbnail's own box as they do when it is live.
 */

import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from '@open-artifact/slides-core';
import { useDeck } from '../state/deck.ts';
import { SlideView, useElementSize, type RenderOptions } from '../render/SlideView.tsx';
import { resolveSrc } from '../services/session.ts';
import { hoverThumb, liveAll, registerThumb, useLive } from '../services/live.ts';

/** Props of {@link SlideThumb}. */
export interface SlideThumbProps {
  slide: Slide;
  /** Render mode (thumbnails by default; the speaker window shows 'present'). */
  mode?: RenderOptions['mode'];
  className?: string;
  /** Live only near its view, a snapshot otherwise (services/live.ts). */
  virtual?: boolean;
}

/** What a thumbnail shows before its snapshot exists: the slide's own background (a color or gradient). */
function placeholderBackground(slide: Slide): string | undefined {
  const value = slide.style.background;
  return value && !value.includes('url(') ? value : undefined;
}

/** A slide scaled to the width of its box (16:9, or 4:3 in a 4:3 deck). */
export const SlideThumb = memo(function SlideThumb({ slide, mode = 'thumb', className, virtual = false }: SlideThumbProps): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const id = slide.id;
  const managed = virtual && !liveAll;
  // Re-render when the deck's size changes (the box's aspect follows it).
  useDeck((s) => s.index.size);
  const live = useLive((s) => !managed || s.live.has(id));
  const snapshot = useLive((s) => (managed ? (s.snapshots[id]?.url ?? null) : null));
  useLayoutEffect(() => (managed && box.current ? registerThumb(box.current, id) : undefined), [managed, id]);
  return (
    <div
      ref={box}
      className={['relative w-full overflow-hidden bg-white', className].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${SLIDE_WIDTH} / ${SLIDE_HEIGHT}` }}
      data-open-artifact-thumb={managed ? (live ? 'live' : snapshot ? 'snapshot' : 'placeholder') : undefined}
      onPointerEnter={managed ? () => hoverThumb(id, true) : undefined}
      onPointerLeave={managed ? () => hoverThumb(id, false) : undefined}
    >
      {live ? (
        <LiveSlide slide={slide} mode={mode} />
      ) : snapshot ? (
        <img src={snapshot} alt="" draggable={false} decoding="async" aria-hidden className="pointer-events-none absolute inset-0 size-full select-none" />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: placeholderBackground(slide) }} />
      )}
    </div>
  );
});

/** The slide itself, scaled to the box it fills. */
function LiveSlide({ slide, mode }: { slide: Slide; mode: RenderOptions['mode'] }): ReactNode {
  const fill = useRef<HTMLDivElement>(null);
  const size = useElementSize(fill);
  const scale = size ? size.w / SLIDE_WIDTH : 0;
  const options = useMemo<RenderOptions>(() => ({ mode, resolveSrc }), [mode]);
  return (
    <div ref={fill} className="pointer-events-none absolute inset-0">
      {scale > 0 ? (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }} aria-hidden>
          <SlideView slide={slide} options={options} />
        </div>
      ) : null}
    </div>
  );
}
