/**
 * Presenting: the playable slides full screen, one at a time.
 *
 * - Forward: → ↓ PgDn Space Enter, a click or a swipe left. Back: ← ↑
 *   PgUp Backspace or a swipe right. Home / End go to the first / last
 *   slide; typing a number jumps to that slide; F toggles full screen;
 *   Escape exits.
 * - Builds play one step per press (an `auto` step follows the one before
 *   it by itself); going back to a slide shows it with all builds done.
 * - Transitions: fade, push and magic move (see transitions.ts).
 * - Clips start with the slide or on a click, at most four at once.
 * - The control bar hides after 3 s without pointer movement.
 * - With speaker notes, a popup shows notes, the next step and a timer; if
 *   the popup is blocked the notes show under the slide instead.
 * - Opened from a `.only` link, one slide shows on its own on its own
 *   background: every build done, arrows page whole slides, no control bar,
 *   no full screen; Escape returns to the editor at that slide.
 */

import { reportSlide } from '../../services/location.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronLeft, ChevronRight, Maximize, Minimize, StickyNote, X } from 'lucide-react';
import { SLIDE_HEIGHT, SLIDE_WIDTH, slideTitle, type Slide } from '@open-artifact/slides-core';
import { IconButton, cn, toast } from '@open-artifact/ui';
import { useDeck } from '../../state/deck.ts';
import { useView } from '../../state/view.ts';
import { buildPhases, buildSteps, hiddenFragments, playableSlides } from '../../services/present.ts';
import { resolveSrc } from '../../services/session.ts';
import { BUILD_MS } from '../../render/css.ts';
import { SlideView, type RenderOptions } from '../../render/SlideView.tsx';
import { NotesEditor } from '../NotesPane.tsx';
import { SpeakerWindow, openSpeakerPopup, type ShowClock } from './SpeakerWindow.tsx';
import { prefersReducedMotion, runTransition, transitionBetween } from './transitions.ts';
import { useSlideMotion } from './motion.ts';
import { pagerText } from '../../lib/inline-view.ts';

/** Idle time before the control bar hides, ms. */
const CONTROLS_HIDE_MS = 3000;

/** Where the show is. */
export interface ShowPosition {
  /** Slide on screen. */
  id: string;
  /** Build steps played on it. */
  done: number;
  /** The last step was just played (draw it entering / exiting). */
  animate: boolean;
}

/** A transition in progress: the slide leaving and how. */
interface Leaving {
  slide: Slide;
  done: number;
  direction: 1 | -1;
  kind: NonNullable<ReturnType<typeof transitionBetween>>;
}

/** One slide drawn at full size, scaled into the screen. */
function ShowSlide({
  slide,
  done,
  animate,
  scale,
  rootRef,
  startedClips,
  onStartClip,
  className,
  motion = false,
}: {
  slide: Slide;
  done: number;
  animate: boolean;
  scale: number;
  rootRef?: React.RefObject<HTMLDivElement | null>;
  startedClips?: ReadonlySet<string>;
  onStartClip?: (key: string) => void;
  className?: string;
  /** Play the slide's motion as it appears (the slide shown, not the one leaving). */
  motion?: boolean;
}): ReactNode {
  const steps = useMemo(() => buildSteps(slide), [slide]);
  const builds = useMemo(() => buildPhases(slide, steps, done, animate), [slide, steps, done, animate]);
  const hidden = useMemo(() => hiddenFragments(slide, steps, done), [slide, steps, done]);
  const options = useMemo<RenderOptions>(() => ({ mode: 'present', resolveSrc, builds, startedClips, onStartClip }), [builds, startedClips, onStartClip]);
  const box = useRef<HTMLDivElement>(null);
  useSlideMotion(box, slide, hidden, motion);
  return (
    <div ref={box} className={cn('absolute left-1/2 top-1/2', className)} style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale, translate: '-50% -50%' }}>
      <div className="origin-top-left overflow-hidden" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }}>
        <SlideView slide={slide} options={options} rootRef={rootRef} />
      </div>
    </div>
  );
}

/** The show. Mounted while `view.presenting` is set. */
export function Presenter(): ReactNode {
  const presenting = useView((s) => s.presenting);
  const run = useView((s) => s.presentRun);
  if (!presenting) return null;
  const only = presenting.only === true;
  return <Show key={run} start={presenting.start} speaker={presenting.speaker && !only} only={only} />;
}

/** Build steps of a slide in the deck (0 when it is gone). */
function stepCount(id: string): number {
  const slide = useDeck.getState().slides[id]?.slide;
  return slide ? buildSteps(slide).length : 0;
}

/** A slide's own colour or gradient, to fill around it when it shows on its own. */
function backdrop(slide: Slide): string | undefined {
  const value = slide.style.background;
  return value && !value.includes('url(') ? value : undefined;
}

function Show({ start, speaker, only }: { start: string; speaker: boolean; only: boolean }): ReactNode {
  const playable = useDeck(useShallow(() => playableSlides()));
  const [position, setPosition] = useState<ShowPosition>(() => ({ id: start, done: only ? stepCount(start) : 0, animate: false }));
  const index = Math.max(0, playable.indexOf(position.id));
  const slide = useDeck((s) => s.slides[position.id]?.slide);
  const steps = useMemo(() => (slide ? buildSteps(slide) : []), [slide]);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [startedClips, setStartedClips] = useState<ReadonlySet<string>>(() => new Set());
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [speakerWindow, setSpeakerWindow] = useState<Window | null>(null);
  const [clock, setClock] = useState<ShowClock>(() => ({ startedAt: Date.now(), pausedAt: null }));
  const root = useRef<HTMLDivElement>(null);
  const currentRoot = useRef<HTMLDivElement>(null);
  const leavingRoot = useRef<HTMLDivElement>(null);
  const finishTransition = useRef<(() => void) | null>(null);
  /** Where a touch began (swipes turn slides on touch screens). */
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const notesUnder = speaker && popupBlocked;
  const stageH = notesUnder ? size.h * 0.72 : size.h;
  const scale = Math.min(size.w / SLIDE_WIDTH, stageH / SLIDE_HEIGHT);

  useEffect(() => {
    reportSlide(position.id, only ? { position: index + 1, count: playable.length } : undefined);
  }, [position.id, only, index, playable.length]);

  // A slide that left the show (deleted, skipped) hands over to its neighbour.
  useEffect(() => {
    if (playable.length === 0) {
      useView.getState().present(null);
      return;
    }
    if (!playable.includes(position.id)) {
      const id = playable[Math.min(index, playable.length - 1)]!;
      setPosition({ id, done: only ? stepCount(id) : 0, animate: false });
    }
  }, [playable, position.id, index, only]);

  /* ----- Navigation ----- */

  const go = useCallback(
    (target: number, direction: 1 | -1, options: { allDone?: boolean; cut?: boolean } = {}) => {
      const list = playableSlides();
      const id = list[target];
      if (!id || id === position.id) return;
      finishTransition.current?.();
      const deck = useDeck.getState();
      const from = deck.slides[position.id]?.slide;
      const to = deck.slides[id]?.slide;
      if (!to) return;
      const done = options.allDone ? buildSteps(to).length : 0;
      const kind = !options.cut && from && !prefersReducedMotion() ? transitionBetween(from, to, direction) : null;
      setLeaving(kind && from ? { slide: from, done: position.done, direction, kind } : null);
      setStartedClips(new Set());
      setPosition({ id, done, animate: false });
    },
    [position],
  );

  const next = useCallback(() => {
    if (leaving) {
      finishTransition.current?.();
      return;
    }
    if (only) {
      if (index < playable.length - 1) go(index + 1, 1, { allDone: true });
      return;
    }
    if (position.done < steps.length) {
      setPosition((p) => ({ ...p, done: p.done + 1, animate: true }));
      return;
    }
    if (index < playable.length - 1) go(index + 1, 1);
  }, [leaving, only, position.done, steps.length, index, playable.length, go]);

  const previous = useCallback(() => {
    if (leaving) finishTransition.current?.();
    if (only) {
      if (index > 0) go(index - 1, -1, { allDone: true });
      return;
    }
    if (position.done > 0) {
      setPosition((p) => ({ ...p, done: p.done - 1, animate: false }));
      return;
    }
    if (index > 0) go(index - 1, -1, { allDone: true });
  }, [leaving, only, position.done, index, go]);

  const exit = useCallback(() => {
    const id = position.id;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    useView.getState().present(null);
    useView.getState().showSlide(id);
    reportSlide(id);
  }, [position.id]);

  // Auto steps: the first plays as the slide settles, the rest right after the step before.
  useEffect(() => {
    if (leaving) return;
    const step = steps[position.done];
    if (!step?.auto) return;
    const timer = setTimeout(() => setPosition((p) => (p.id === position.id ? { ...p, done: p.done + 1, animate: true } : p)), position.done === 0 ? 0 : BUILD_MS);
    return () => clearTimeout(timer);
  }, [leaving, steps, position.id, position.done]);

  /* ----- Transitions ----- */

  useLayoutEffect(() => {
    if (!leaving || !leavingRoot.current || !currentRoot.current || !slide) return;
    const run = runTransition(leaving.kind, { slide: leaving.slide, root: leavingRoot.current }, { slide, root: currentRoot.current }, leaving.direction, scale);
    let live = true;
    finishTransition.current = run.finish;
    void run.done.then(() => {
      if (!live) return;
      finishTransition.current = null;
      setLeaving(null);
    });
    return () => {
      live = false;
    };
    // The transition runs once per slide change; a resize mid-way does not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  /* ----- Input ----- */

  const digits = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({ text: '', timer: null });
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('textarea, input, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (/^[0-9]$/.test(key)) {
        const state = digits.current;
        state.text = (state.text + key).slice(-3);
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          const n = Number(state.text);
          state.text = '';
          if (n >= 1 && n <= playableSlides().length) go(n - 1, n - 1 >= index ? 1 : -1, { cut: true, allDone: only });
        }, 500);
        return;
      }
      switch (key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
        case 'n':
          event.preventDefault();
          next();
          return;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
        case 'p':
          event.preventDefault();
          previous();
          return;
        case 'Home':
          event.preventDefault();
          go(0, -1, { cut: true, allDone: only });
          return;
        case 'End':
          event.preventDefault();
          go(playableSlides().length - 1, 1, { cut: true, allDone: true });
          return;
        case 'f':
        case 'F':
          if (only) return;
          event.preventDefault();
          toggleFullscreen(root.current);
          return;
        case 'Escape':
          event.preventDefault();
          exit();
          return;
      }
    },
    [next, previous, go, exit, index, only],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    speakerWindow?.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      speakerWindow?.removeEventListener('keydown', onKey);
    };
  }, [onKey, speakerWindow]);

  // Size, full screen, and the control bar's idle timer.
  useEffect(() => {
    const onResize = (): void => setSize({ w: window.innerWidth, h: window.innerHeight });
    const onFullscreen = (): void => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    // Full screen right away (the Present click is still a user gesture).
    if (!only && root.current?.requestFullscreen && !document.fullscreenElement) void root.current.requestFullscreen().catch(() => undefined);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [only]);

  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setControls(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [wake]);

  /* ----- Speaker window ----- */

  const openSpeaker = useCallback(() => {
    if (speakerWindow && !speakerWindow.closed) {
      speakerWindow.focus();
      return;
    }
    const popup = openSpeakerPopup();
    if (!popup) {
      setPopupBlocked(true);
      toast.add({ title: 'The speaker window was blocked', description: 'Speaker notes show under the slide instead. Allow pop-ups for this site to open them in their own window.' });
      return;
    }
    setPopupBlocked(false);
    setSpeakerWindow(popup);
  }, [speakerWindow]);

  useEffect(() => {
    if (speaker) openSpeaker();
    // Only when the show starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The show ends: the popup closes with it.
  useEffect(() => () => speakerWindow?.close(), [speakerWindow]);

  const onStartClip = useCallback((key: string) => setStartedClips((set) => new Set([...set, key])), []);

  if (!slide) return null;
  const nextId = playable[index + 1] ?? null;

  return (
    <div
      ref={root}
      role={only ? 'group' : 'dialog'}
      aria-modal={only ? undefined : true}
      aria-label={only ? pagerText(index, playable.length, slideTitle(slide)).announcement : 'Presentation'}
      tabIndex={only ? 0 : undefined}
      data-presenter-only={only ? '' : undefined}
      className={cn(
        'fixed inset-0 z-[2000] select-none overflow-hidden',
        only ? 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent' : 'bg-black',
        !controls && !only && 'cursor-none',
      )}
      style={only ? { background: backdrop(slide) ?? '#000' } : undefined}
      onPointerMove={only ? undefined : wake}
      onPointerDown={(event) => {
        swipe.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const startAt = swipe.current;
        swipe.current = null;
        if (!startAt) return;
        const dx = event.clientX - startAt.x;
        if (event.pointerType !== 'mouse' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(event.clientY - startAt.y)) {
          if (dx < 0) next();
          else previous();
        }
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('a, button, video, iframe, [data-presenter-controls], [data-presenter-notes]')) return;
        if (event.detail > 1) return;
        next();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        previous();
      }}
    >
      <div className="absolute inset-x-0 top-0" style={{ height: stageH }}>
        {leaving ? <ShowSlide slide={leaving.slide} done={leaving.done} animate={false} scale={scale} rootRef={leavingRoot} className="z-[1]" /> : null}
        <ShowSlide
          key={position.id}
          slide={slide}
          done={position.done}
          animate={position.animate}
          scale={scale}
          rootRef={currentRoot}
          startedClips={startedClips}
          onStartClip={onStartClip}
          className="z-[2]"
          motion
        />
      </div>

      {notesUnder ? (
        <div data-presenter-notes className="absolute inset-x-0 bottom-0 flex flex-col border-t border-white/15 bg-neutral-950 text-white" style={{ height: size.h - stageH }}>
          <div className="px-4 pt-2 text-[11px] uppercase tracking-wide text-white/50">
            Speaker notes · Slide {index + 1} of {playable.length}
          </div>
          <NotesEditor key={position.id} slideId={position.id} className="h-full w-full resize-none bg-transparent px-4 py-2 text-lg leading-relaxed text-white outline-none placeholder:text-white/40" />
        </div>
      ) : null}

      {only ? null : <div
        data-presenter-controls
        className={cn(
          'absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900/85 px-2 py-1 text-white shadow-lg backdrop-blur transition-opacity duration-300',
          controls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={notesUnder ? { bottom: size.h - stageH + 16 } : undefined}
      >
        <IconButton label="Previous" shortcut="←" icon={<ChevronLeft className="size-4" />} className="text-white hover:bg-white/15 hover:text-white" disabled={index === 0 && position.done === 0} onClick={previous} />
        <span className="min-w-16 text-center text-xs tabular-nums text-white/80">
          {index + 1} / {playable.length}
        </span>
        <IconButton
          label="Next"
          shortcut="→"
          icon={<ChevronRight className="size-4" />}
          className="text-white hover:bg-white/15 hover:text-white"
          disabled={index === playable.length - 1 && position.done >= steps.length}
          onClick={next}
        />
        <span className="mx-1 h-4 w-px bg-white/20" />
        <IconButton label="Speaker notes" icon={<StickyNote className="size-4" />} className="text-white hover:bg-white/15 hover:text-white" onClick={openSpeaker} />
        <IconButton
          label={fullscreen ? 'Exit full screen' : 'Full screen'}
          shortcut="F"
          icon={fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          className="text-white hover:bg-white/15 hover:text-white"
          onClick={() => toggleFullscreen(root.current)}
        />
        <IconButton label="Stop presenting" shortcut="Esc" icon={<X className="size-4" />} className="text-white hover:bg-white/15 hover:text-white" onClick={exit} />
      </div>}

      {speakerWindow ? (
        <SpeakerWindow
          popup={speakerWindow}
          position={position}
          index={index}
          count={playable.length}
          steps={steps.length}
          nextId={nextId}
          clock={clock}
          onClock={setClock}
          onNext={next}
          onPrevious={previous}
          onClosed={() => setSpeakerWindow(null)}
        />
      ) : null}
    </div>
  );
}

/** Enters or leaves full screen. */
function toggleFullscreen(el: HTMLElement | null): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void el?.requestFullscreen?.().catch(() => undefined);
}
