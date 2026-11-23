import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { VoiceoverLine } from '@open-artifact/motion-audio';
import { cn } from '@open-artifact/ui';
import { useComments } from '../comments/comments.ts';
import { pause, seekTo } from '../engine/actions.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { useWorking } from '../stores/working.ts';
import type { LaneContext } from '../timeline/lanes.ts';
import {
  DRAG_START_PX,
  MOVE_WAIT_MS,
  NUDGE_COMMIT_MS,
  NUDGE_SECONDS,
  NUDGE_SHIFT_SECONDS,
  clampTo,
  laneSpan,
  lineBounds,
  lineKeys,
  peaksPath,
  snapVoiceTime,
  voiceClock,
  voiceClockTenths,
  wordsRoom,
} from './lines.ts';
import { moveVoiceLine } from './move.ts';
import { movableTakes } from './narration-code.ts';
import { useVoiceover } from './store.ts';
import * as words from './words.ts';

export const LANE_HEIGHT = 30;

/** A move under way (`moving`) or sent and waiting for the film to come back with it. */
interface LineMove {
  audio: string;
  to: number;
  moving: boolean;
}

interface Grip {
  pointer: number;
  x0: number;
  audio: string;
  moving: boolean;
}

/** The field of line `n` in the Voiceover section, once it is there (the panel may be opening): tries for a second. */
function focusVoiceLine(n: number, tries = 20): void {
  const field = document.querySelector<HTMLElement>(`[data-voice-line="${n}"] textarea`);
  field?.focus();
  if (document.activeElement !== field && tries > 0) setTimeout(() => focusVoiceLine(n, tries - 1), 50);
}

function pressLine(line: VoiceoverLine, n: number): void {
  seekTo(line.at);
  useUi.getState().openPanel('tweaks');
  focusVoiceLine(n);
}

const Peaks = memo(function Peaks({ peaks }: { peaks: readonly number[] }): ReactElement {
  return (
    <svg viewBox={`0 0 ${peaks.length} 1`} preserveAspectRatio="none" className="h-full w-full">
      <path d={peaksPath(peaks)} fill="currentColor" />
    </svg>
  );
});

/** The voiceover under the scene strip: each line where it plays, with its words and its wave, to press or move. */
export function VoiceoverLane({ context }: { context: LaneContext }): ReactElement | null {
  const lines = useVoiceover((s) => s.lines);
  const fresh = useVoiceover((s) => s.fresh);
  const selected = useVoiceover((s) => s.selected);
  const out = useVoiceover((s) => s.out);
  const film = useFilm((s) => s.film);
  const live = useFilm((s) => s.stage === 'ready');
  const t = usePlayback((s) => s.time);
  const readOnly = useWorking((s) => s.readOnlyReason !== null);
  const atWork = useWorking((s) => s.activity === 'working');
  const commenting = useComments((s) => s.on);
  const locked = readOnly || atWork || commenting || !fresh;
  const across = context.total;
  const ends = context.total;
  const laneRef = useRef<HTMLDivElement | null>(null);
  const gripRef = useRef<Grip | null>(null);
  const draggedRef = useRef(false);
  const nudgeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [move, setMove] = useState<LineMove | null>(null);
  const waiting = move !== null && !move.moving;
  const keys = useMemo(() => (lines === null ? [] : lineKeys(lines)), [lines]);
  const movable = useMemo(() => (film === null || lines === null ? new Set<string>() : movableTakes(film, lines)), [film, lines]);
  const now = useRef({ lines, off: !live || locked, waiting });
  now.current = { lines, off: !live || locked, waiting };

  const clearNudge = (): void => {
    if (nudgeRef.current !== null) clearTimeout(nudgeRef.current);
    nudgeRef.current = null;
  };
  const cancel = (): void => {
    gripRef.current = null;
    clearNudge();
    setMove(null);
  };

  // The film came back: a move sent is done; one under way stays while its take is there.
  useEffect(() => {
    setMove((current) => (current === null || (current.moving && lines?.some((line) => line.audio === current.audio) === true) ? current : null));
  }, [lines]);
  useEffect(() => {
    if (move === null || move.moving) return;
    const timer = setTimeout(() => setMove(null), MOVE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [move]);
  useEffect(() => () => clearNudge(), []);
  const moving = move?.moving === true;
  useEffect(() => {
    if (!moving) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [moving]);
  useEffect(() => {
    if (moving && (!live || locked)) cancel();
  }, [moving, live, locked]);

  if (lines === null || lines.length === 0 || !(across > 0)) return null;

  const send = (audio: string, to: number): void => {
    const state = now.current;
    if (state.waiting) return;
    const line = state.lines?.find((each) => each.audio === audio);
    if (line === undefined || state.off || Math.abs(to - line.at) < 0.005) return setMove(null);
    setMove({ audio, to, moving: false });
    if (!moveVoiceLine(line, to)) setMove(null);
  };
  const canMove = (line: VoiceoverLine, index: number): boolean => live && !locked && movable.has(line.audio) && !out.has(keys[index] ?? '');
  // A nudge on another line still waiting to be sent goes now.
  const flush = (audio: string): boolean => {
    if (move === null || move.audio === audio || nudgeRef.current === null) return false;
    clearNudge();
    send(move.audio, move.to);
    return true;
  };
  const dragTo = (index: number, x: number, grip: Grip): number => {
    const line = lines[index]!;
    const perSecond = (laneRef.current?.clientWidth ?? 0) / Math.max(0.001, across);
    return clampTo(lineBounds(lines, index, ends), snapVoiceTime(line.at + (x - grip.x0) / Math.max(0.001, perSecond)));
  };
  const moved = lines.find((line) => line.audio === move?.audio);
  const shift = move !== null && moved !== undefined ? move.to - moved.at : 0;
  const starts = lines.map((line) => (move?.audio === line.audio ? move.to : line.at));

  return (
    <div ref={laneRef} role="group" aria-label={words.VOICEOVER_LANE} data-voice-lane="" className="relative h-full min-w-0">
      {moving && moved !== undefined ? (
        <div aria-hidden="true" className="absolute inset-y-0 rounded-md border border-dashed border-chrome-line" style={laneSpan(moved.at, moved.dur, across)} />
      ) : null}
      {lines.map((line, index) => {
        const held = move?.audio === line.audio;
        const at = held && move !== null ? move.to : line.at;
        const playing = t >= at && t < at + line.dur;
        const going = out.has(keys[index] ?? '');
        const movesHere = canMove(line, index);
        const dragging = held && moving;
        return (
          <button
            key={`${line.audio}\u0000${index}`}
            type="button"
            data-now={playing ? '' : undefined}
            data-selected={selected === index + 1 ? '' : undefined}
            data-out={going ? '' : undefined}
            aria-label={words.laneLineLabel(index + 1, voiceClock(at), line.text)}
            aria-disabled={!live || locked}
            aria-keyshortcuts={movesHere ? 'ArrowLeft ArrowRight' : undefined}
            className={cn(
              'absolute inset-y-0 touch-none select-none overflow-visible rounded-md border bg-chrome text-left outline-none',
              'focus-visible:ring-2 focus-visible:ring-chrome-ring',
              selected === index + 1 || dragging ? 'border-[var(--vid-played)]' : 'border-chrome-line',
              going && 'opacity-50',
              movesHere ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
            )}
            style={laneSpan(at, line.dur, across)}
            onPointerDown={(event) => {
              draggedRef.current = false;
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              gripRef.current = { pointer: event.pointerId, x0: event.clientX, audio: line.audio, moving: false };
            }}
            onPointerMove={(event) => {
              const grip = gripRef.current;
              if (grip === null || grip.pointer !== event.pointerId || grip.audio !== line.audio) return;
              if (event.buttons === 0) {
                if (grip.moving) cancel();
                else gripRef.current = null;
                return;
              }
              if (!grip.moving && Math.abs(event.clientX - grip.x0) < DRAG_START_PX) return;
              draggedRef.current = true;
              if (!movesHere || waiting) return;
              if (!grip.moving) {
                if (flush(line.audio)) return;
                grip.moving = true;
                clearNudge();
                pause();
              }
              setMove({ audio: line.audio, to: dragTo(index, event.clientX, grip), moving: true });
            }}
            onPointerUp={(event) => {
              const grip = gripRef.current;
              if (grip === null || grip.pointer !== event.pointerId) return;
              gripRef.current = null;
              if (grip.moving) send(line.audio, dragTo(index, event.clientX, grip));
            }}
            onPointerCancel={() => {
              draggedRef.current = false;
              if (gripRef.current?.moving === true) cancel();
              else gripRef.current = null;
            }}
            onLostPointerCapture={() => {
              if (gripRef.current?.moving === true) cancel();
              else gripRef.current = null;
            }}
            onClick={(event) => {
              // The click that ends a drag is not a press (a keyboard click, detail 0, is).
              if (draggedRef.current && event.detail !== 0) {
                draggedRef.current = false;
                return;
              }
              if (live && !locked && !waiting) pressLine(line, index + 1);
            }}
            onKeyDown={(event) => {
              if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.altKey || event.ctrlKey || event.metaKey || !movesHere) return;
              event.preventDefault();
              event.stopPropagation();
              if (waiting || gripRef.current?.moving === true || flush(line.audio)) return;
              const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? NUDGE_SHIFT_SECONDS : NUDGE_SECONDS);
              const to = clampTo(lineBounds(lines, index, ends), snapVoiceTime(at + step));
              setMove({ audio: line.audio, to, moving: true });
              clearNudge();
              // Nudges add up: the line goes once the keys rest.
              nudgeRef.current = setTimeout(() => {
                nudgeRef.current = null;
                send(line.audio, to);
              }, NUDGE_COMMIT_MS);
            }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center truncate px-1.5 text-[11px] leading-none"
              style={{ maxWidth: `calc(${(wordsRoom(starts, index, line.dur, across) / Math.max(0.001, line.dur)) * 100}% - 2px)` }}
            >
              <span className="truncate">{line.text}</span>
            </span>
            {line.peaks !== null ? (
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 text-[var(--vid-track)]">
                <Peaks peaks={line.peaks} />
                {playing ? (
                  <span className="absolute inset-0 text-[var(--vid-played)]" style={{ clipPath: `inset(0 ${100 - ((t - at) / Math.max(0.001, line.dur)) * 100}% 0 0)` }}>
                    <Peaks peaks={line.peaks} />
                  </span>
                ) : null}
              </span>
            ) : null}
            {dragging ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-tip px-1.5 py-0.5 text-[11px] tabular-nums text-tip-fg"
              >
                {voiceClockTenths(at)}
                {Math.abs(shift) >= 0.005 ? ` · ${words.shiftText(shift)}` : null}
              </span>
            ) : null}
          </button>
        );
      })}
      <div aria-hidden="true" className="pointer-events-none absolute -top-1 bottom-0 w-px bg-[var(--vid-played)]" style={{ left: `${(t / across) * 100}%` }} />
      <span role="status" className="sr-only">
        {moving && Math.abs(shift) >= 0.005 ? words.shiftText(shift) : null}
      </span>
    </div>
  );
}
