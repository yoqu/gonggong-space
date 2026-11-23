/**
 * The deck framed read only by another page (`#view-inline`): one slide
 * fitted to the frame with every build shown, and, when there is more than
 * one slide, a pager under it. ← and → page while the pager has focus.
 * Skipped slides are left out unless every slide is skipped.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronLeft, ChevronRight, Loader2, Presentation, TriangleAlert } from 'lucide-react';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from '@open-artifact/slides-core';
import { CrashBoundary, EmptyState, IconButton } from '@open-artifact/ui';
import { useDeck } from '../state/deck.ts';
import { useInlineView } from '../state/inline.ts';
import { pagerText, slideAfterChange } from '../lib/inline-view.ts';
import { startInlineView, viewedSlides, viewedTitle } from '../services/inline.ts';
import { buildPhases, buildSteps } from '../services/present.ts';
import { resolveSrc } from '../services/session.ts';
import { syncDeckFonts } from '../render/fonts.ts';
import { SlideView, useElementSize, type RenderOptions } from '../render/SlideView.tsx';
import { CrashCard } from './CrashCard.tsx';

let started = false;

/** A slide as it looks once all its builds have played, scaled to `scale`. */
function ViewedSlide({ slide, scale }: { slide: Slide; scale: number }): ReactNode {
  const builds = useMemo(() => {
    const steps = buildSteps(slide);
    return buildPhases(slide, steps, steps.length, false);
  }, [slide]);
  const [startedClips, setStartedClips] = useState<ReadonlySet<string>>(() => new Set());
  const onStartClip = useCallback((key: string) => setStartedClips((keys) => new Set(keys).add(key)), []);
  const options = useMemo<RenderOptions>(() => ({ mode: 'present', resolveSrc, builds, startedClips, onStartClip }), [builds, startedClips, onStartClip]);
  return (
    <div className="absolute left-1/2 top-1/2 overflow-hidden" style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale, translate: '-50% -50%' }}>
      <div className="origin-top-left" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }}>
        <SlideView slide={slide} options={options} />
      </div>
    </div>
  );
}

function Pager({ index, count, title, go }: { index: number; count: number; title: string | undefined; go: (index: number) => void }): ReactNode {
  const { counter, announcement } = pagerText(index, count, title);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' && index > 0) go(index - 1);
    else if (event.key === 'ArrowRight' && index < count - 1) go(index + 1);
    else return;
    event.preventDefault();
  };
  return (
    <nav aria-label="Slides" className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-chrome-sep bg-chrome text-chrome-fg" onKeyDown={onKeyDown}>
      <IconButton label="Previous slide" icon={<ChevronLeft className="size-4" />} disabled={index === 0} onClick={() => go(index - 1)} />
      <span className="min-w-14 text-center text-xs tabular-nums text-chrome-muted" aria-hidden="true">
        {counter}
      </span>
      <IconButton label="Next slide" icon={<ChevronRight className="size-4" />} disabled={index >= count - 1} onClick={() => go(index + 1)} />
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </nav>
  );
}

export function InlineView(): ReactNode {
  const status = useDeck((s) => s.status);
  const error = useDeck((s) => s.error);
  const faces = useDeck((s) => s.index.faces);
  const slides = useDeck(useShallow(() => viewedSlides()));
  const current = useInlineView((s) => s.current);
  const slide = useDeck((s) => (current ? s.slides[current]?.slide : undefined));
  const held = useDeck((s) => (current ? s.slides[current]?.held : undefined));
  const box = useRef<HTMLDivElement>(null);
  const size = useElementSize(box);
  const lastIndex = useRef(0);

  useEffect(() => {
    if (started) return;
    started = true;
    void startInlineView();
  }, []);

  useEffect(() => {
    if (status === 'ready') syncDeckFonts(faces, resolveSrc);
  }, [status, faces]);

  // Slides added, removed or skipped elsewhere: stay on this slide, or take the one now in its place.
  useEffect(() => {
    if (status !== 'ready') return;
    const next = slideAfterChange(slides, current, lastIndex.current);
    if (next !== current) useInlineView.getState().show(next);
    else if (current) lastIndex.current = slides.indexOf(current);
  }, [status, slides, current]);

  const go = useCallback((index: number) => {
    const id = slides[index];
    if (id) useInlineView.getState().show(id);
  }, [slides]);

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Loader2 className="size-5 animate-spin text-fg-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="h-full bg-canvas">
        <EmptyState icon={<TriangleAlert className="size-6" />} title="This presentation could not be opened">
          {error}
        </EmptyState>
      </div>
    );
  }
  if (slides.length === 0) {
    return (
      <div className="h-full bg-canvas">
        <EmptyState icon={<Presentation className="size-6" />} title="This presentation has no slides yet">
          <p>Slides will show here once they are added.</p>
        </EmptyState>
      </div>
    );
  }

  const index = current ? Math.max(0, slides.indexOf(current)) : 0;
  const scale = size ? Math.min(size.w / SLIDE_WIDTH, size.h / SLIDE_HEIGHT) : 0;
  return (
    <CrashBoundary fallback={<CrashCard viewing />}>
      <div data-open-artifact-inline-view="" className="flex h-full flex-col bg-stage">
        <div ref={box} className="relative min-h-0 flex-1 overflow-hidden" data-open-artifact-slide={current ?? undefined}>
          {slide && scale > 0 ? <ViewedSlide key={slide.id} slide={slide} scale={scale} /> : null}
        </div>
        {held ? (
          <p role="note" className="flex shrink-0 items-center gap-1.5 border-t border-chrome-sep bg-chrome px-3 py-1.5 text-xs text-chrome-muted">
            <TriangleAlert className="size-3.5 shrink-0" />
            This slide's file has errors, so it may not show as written: {held}
          </p>
        ) : null}
        {slides.length > 1 ? <Pager index={index} count={slides.length} title={current ? viewedTitle(current) : undefined} go={go} /> : null}
      </div>
    </CrashBoundary>
  );
}
