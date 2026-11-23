/**
 * The speaker window: a popup beside the show with the current slide, the
 * next step ("Next: build 2 of 3", or the next slide), a timer (pause,
 * resume, reset) and the editable speaker notes.
 *
 * It is a same-origin popup rendered from the show's React tree through a
 * portal, so it shares state with the show directly; the editor's styles
 * and the deck's typefaces are copied into it.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from '@open-artifact/slides-core';
import { Button, IconButton, cn } from '@open-artifact/ui';
import { useDeck } from '../../state/deck.ts';
import { buildPhases, buildSteps } from '../../services/present.ts';
import { resolveSrc } from '../../services/session.ts';
import { installSlideStyles } from '../../render/css.ts';
import { syncDeckFonts } from '../../render/fonts.ts';
import { SlideView, type RenderOptions } from '../../render/SlideView.tsx';
import { NotesEditor } from '../NotesPane.tsx';
import type { ShowPosition } from './Presenter.tsx';

/** The show's clock: running since `startedAt`, frozen at `pausedAt` while paused. */
export interface ShowClock {
  startedAt: number;
  pausedAt: number | null;
}

const POPUP_NAME = 'open-artifact-slides-speaker';
const ROOT_ID = 'open-artifact-speaker-root';

/** Head elements carried over to the popup. */
const COPIED = 'style, link[rel="stylesheet"]';

/**
 * Opens (or reuses) the speaker popup and prepares its document. Returns
 * null when the browser blocked it.
 */
export function openSpeakerPopup(): Window | null {
  const popup = window.open('', POPUP_NAME, 'popup,width=1100,height=720');
  if (!popup) return null;
  const doc = popup.document;
  doc.title = 'Speaker notes';
  // Start from a clean document (a reused popup keeps its old content).
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.appendChild(meta);
  for (const el of document.head.querySelectorAll(COPIED)) doc.head.appendChild(doc.importNode(el, true));
  installSlideStyles(doc);
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme) doc.documentElement.setAttribute('data-theme', theme);
  else doc.documentElement.removeAttribute('data-theme');
  doc.body.className = 'm-0 bg-canvas text-fg antialiased';
  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.className = 'h-screen';
  doc.body.appendChild(root);
  return popup;
}

/** Elapsed time as m:ss or h:mm:ss. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A slide at a given width, with builds shown up to `done` steps. */
function Preview({ slide, done, width }: { slide: Slide; done: number; width: number }): ReactNode {
  const steps = useMemo(() => buildSteps(slide), [slide]);
  const builds = useMemo(() => buildPhases(slide, steps, done, false), [slide, steps, done]);
  // Thumb mode: builds are drawn, clips stay still.
  const options = useMemo<RenderOptions>(() => ({ mode: 'thumb', resolveSrc, builds }), [builds]);
  const scale = width / SLIDE_WIDTH;
  return (
    <div className="relative overflow-hidden rounded-md bg-white ring-1 ring-line" style={{ width, height: SLIDE_HEIGHT * scale }}>
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }}>
        <SlideView slide={slide} options={options} />
      </div>
    </div>
  );
}

/** Props of {@link SpeakerWindow}. */
export interface SpeakerWindowProps {
  popup: Window;
  position: ShowPosition;
  /** 0-based place of the slide in the show. */
  index: number;
  /** Slides in the show. */
  count: number;
  /** Build steps of the slide on screen. */
  steps: number;
  /** The slide after this one, if any. */
  nextId: string | null;
  clock: ShowClock;
  onClock: (clock: ShowClock) => void;
  onNext: () => void;
  onPrevious: () => void;
  /** The person closed the popup. */
  onClosed: () => void;
}

/** Renders the speaker view into the popup. */
export function SpeakerWindow({ popup, onClosed, ...props }: SpeakerWindowProps): ReactNode {
  const container = popup.document.getElementById(ROOT_ID);
  const faces = useDeck((s) => s.index.faces);

  // Typefaces follow the deck; styles added to the editor later (lazy CSS) follow too.
  useEffect(() => {
    syncDeckFonts(faces, resolveSrc, popup.document);
  }, [faces, popup]);
  useEffect(() => {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches(COPIED) && !node.hasAttribute('data-open-artifact-face')) popup.document.head.appendChild(popup.document.importNode(node, true));
        }
      }
    });
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [popup]);

  // Closing the popup ends the speaker view (the show goes on).
  useEffect(() => {
    const check = setInterval(() => {
      if (popup.closed) onClosed();
    }, 500);
    return () => clearInterval(check);
  }, [popup, onClosed]);

  if (!container) return null;
  return createPortal(<SpeakerView popup={popup} {...props} />, container);
}

function SpeakerView({ popup, position, index, count, steps, nextId, clock, onClock, onNext, onPrevious }: Omit<SpeakerWindowProps, 'onClosed'>): ReactNode {
  const slide = useDeck((s) => s.slides[position.id]?.slide);
  const nextSlide = useDeck((s) => (nextId ? s.slides[nextId]?.slide : undefined));
  const [now, setNow] = useState(Date.now());
  const [width, setWidth] = useState(popup.innerWidth);
  const [notesSize, setNotesSize] = useState(20);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    const onResize = (): void => setWidth(popup.innerWidth);
    popup.addEventListener('resize', onResize);
    return () => {
      clearInterval(tick);
      popup.removeEventListener('resize', onResize);
    };
  }, [popup]);

  if (!slide) return null;
  const paused = clock.pausedAt !== null;
  const elapsed = (clock.pausedAt ?? now) - clock.startedAt;
  const moreBuilds = position.done < steps;
  const nextLabel = moreBuilds ? `Next: build ${position.done + 1} of ${steps}` : nextSlide ? `Next: slide ${index + 2}` : 'End of presentation';
  const currentW = Math.max(240, Math.floor(width * 0.56) - 32);
  const nextW = Math.max(160, width - currentW - 72);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-center gap-3">
        <span className="text-sm font-medium tabular-nums">
          Slide {index + 1} of {count}
        </span>
        <span className="flex-1" />
        <span className={cn('font-mono text-2xl tabular-nums', paused && 'text-fg-muted')} aria-label="Elapsed time">
          {formatElapsed(elapsed)}
        </span>
        {/* Tooltips would open in the main window: the popup's buttons go without. */}
        <IconButton
          noTooltip
          label={paused ? 'Resume timer' : 'Pause timer'}
          icon={paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          onClick={() =>
            onClock(paused ? { startedAt: clock.startedAt + (Date.now() - clock.pausedAt!), pausedAt: null } : { startedAt: clock.startedAt, pausedAt: Date.now() })
          }
        />
        <IconButton noTooltip label="Reset timer" icon={<RotateCcw className="size-4" />} onClick={() => onClock({ startedAt: Date.now(), pausedAt: paused ? Date.now() : null })} />
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="flex min-w-0 flex-col gap-3" style={{ width: currentW }}>
          <Preview slide={slide} done={position.done} width={currentW} />
          <div className="flex min-h-0 flex-1 flex-col rounded-md border border-line bg-surface">
            <div className="flex items-center gap-1 border-b border-line px-3 py-1 text-xs text-fg-muted">
              <span className="flex-1">Speaker notes</span>
              <Button size="sm" variant="ghost" aria-label="Smaller notes" onClick={() => setNotesSize((n) => Math.max(12, n - 2))}>
                A−
              </Button>
              <Button size="sm" variant="ghost" aria-label="Larger notes" onClick={() => setNotesSize((n) => Math.min(48, n + 2))}>
                A+
              </Button>
            </div>
            <div className="min-h-0 flex-1" style={{ fontSize: notesSize }}>
              <NotesEditor key={position.id} slideId={position.id} className="h-full w-full resize-none bg-transparent px-3 py-2 leading-relaxed text-fg outline-none placeholder:text-fg-subtle [font-size:inherit]" />
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2" style={{ width: nextW }}>
          <div className="text-xs font-medium text-fg-muted">{nextLabel}</div>
          {moreBuilds ? (
            <Preview slide={slide} done={position.done + 1} width={nextW} />
          ) : nextSlide ? (
            <Preview slide={nextSlide} done={0} width={nextW} />
          ) : (
            <div className="flex items-center justify-center rounded-md border border-dashed border-line text-xs text-fg-subtle" style={{ width: nextW, height: (nextW * 9) / 16 }}>
              End of presentation
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button icon={<ChevronLeft className="size-4" />} disabled={index === 0 && position.done === 0} onClick={onPrevious}>
              Previous
            </Button>
            <Button variant="primary" disabled={!moreBuilds && !nextSlide} onClick={onNext}>
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
