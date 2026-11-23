/**
 * The shared timer in the top pill.
 *
 * - At rest the button is a timer icon. Counting, the icon becomes a ring
 *   that drains (with a hand going round) next to the time left; ten seconds
 *   from the end the button tints in the accent; at the end it turns into an
 *   accent pill whose icon shakes and whose digits blink, the board edges
 *   glow, every animated emoji sticker in view plays once
 *   (`lib/sticker-party.ts`) and (unless turned off) a chime rings.
 * - Its panel shows a round Start/Pause key, the clock in large digits
 *   (minutes and seconds typed in place while stopped), one minute more or
 *   less (Reset while paused), and a hairline along its bottom edge that
 *   drains with the time left.
 *
 * Everyone sees the same countdown: the timer is the `board/timer` document.
 */

import { Minus, Play, Plus, RotateCcw, Timer as TimerIcon } from 'lucide-react';
import { useEffect, useReducer, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react';
import {
  DEFAULT_TIMER,
  TIMER_DONE_LINGER_MS,
  TIMER_SOON_MS,
  applyTimerAction,
  describeTimer,
  digitsToTimerMs,
  formatTimerDuration,
  formatTimerFace,
  isTimerEnded,
  isTimerIdle,
  isTimerRunning,
  nudgeTimerMinutes,
  setTimerDuration,
  timerDigits,
  timerRemainingMs,
  withTimerContent,
  type TimerAction,
  type TimerFields,
} from '@open-artifact/whiteboard-core';
import { startStickerParty, warmStickerParty } from '../lib/sticker-party.ts';
import { scheduleAtDeadline, useTimerChime } from '../services/chime.ts';
import { maybeSession } from '../services/session.ts';
import { changeBoard, useBoard } from '../state/board.ts';
import { usePreferences } from '../state/preferences.ts';
import { ChromeButton, ChromePopover, Tip } from './chrome.tsx';

/** Accessible name of the timer. */
const SHARED_TIMER_LABEL = 'Shared timer';

/** A click this soon after the panel switched to Reset (a double click on a step) is dropped. */
const TIMER_CLICK_GUARD_MS = 400;

/** Writes the timer for everyone (not an undo step: a timer is a live control). */
function writeTimer(timer: TimerFields): void {
  changeBoard((board) => ({ ...board, content: withTimerContent(board.content, timer) }), { label: 'Timer', history: false });
}

/** The board's timer, or the default one when nobody set it yet. */
function useBoardTimer(): TimerFields {
  return useBoard((state) => state.board.content.timer) ?? DEFAULT_TIMER;
}

/** Re-renders four times a second until `until` (epoch ms) passes. */
function useTicking(until: number | null): number {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    const interval = setInterval(() => {
      tick();
      if (until <= Date.now()) clearInterval(interval);
    }, 250);
    const timeout = setTimeout(tick, until - Date.now());
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [until]);
  return Date.now();
}

/** Minutes and seconds being typed (null: not typed, shows the timer's). */
type TimerDraft = [string | null, string | null] | null;

/** The two halves shown: what is typed, else the time's. */
function fieldDigits(ms: number, draft: TimerDraft): [string, string] {
  const [minutes, seconds] = timerDigits(ms);
  return [draft?.[0] ?? minutes, draft?.[1] ?? seconds];
}

/** The timer button and panel. Viewers see it only while it runs. */
export function BoardTimer() {
  const timer = useBoardTimer();
  const readOnly = !(maybeSession()?.canEdit ?? false);
  const chime = usePreferences((state) => state.timerChime);
  const now = useTicking(timer.endsAt === null ? null : timer.endsAt + TIMER_DONE_LINGER_MS);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TimerDraft>(null);
  const play = useRef<HTMLButtonElement>(null);
  useTimerChime(timer.endsAt, chime);

  const resting = isTimerIdle(timer, now);
  const running = isTimerRunning(timer, now);
  const ended = isTimerEnded(timer, now);
  const paused = !running && !resting && !ended;
  const editable = !readOnly && !running && !ended;
  const leftMs = timerRemainingMs(timer, now);
  const shownMs = resting ? timer.durationMs : Math.ceil(leftMs / 1000) * 1000;
  const left = String(Math.min(1, leftMs / Math.max(1, timer.durationMs)));
  const faced = !resting && !open;

  // A typed length is dropped when the clock starts (or ends).
  const [wasEditable, setWasEditable] = useState(editable);
  if (editable !== wasEditable) {
    setWasEditable(editable);
    if (!editable) setDraft(null);
  }
  // Steps turn into Reset under the pointer on a pause: a click right after is dropped.
  const [guard, setGuard] = useState({ paused, at: 0 });
  if (guard.paused !== paused) setGuard({ paused, at: now });
  const guarded = (detail: number): boolean => detail > 1 || (paused && Date.now() - guard.at < TIMER_CLICK_GUARD_MS);

  if (readOnly && resting) return null;

  const act = (action: TimerAction) => writeTimer(applyTimerAction(timer, action, Date.now()));
  const step = (minutes: number) => {
    const next = nudgeTimerMinutes(timer, minutes, Date.now());
    if (next) writeTimer(next);
  };
  const goLabel = running ? 'Pause' : paused ? 'Resume' : 'Start';

  return (
    <span className="relative inline-flex" data-wb-timer="">
      <ChromePopover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDraft(null);
        }}
        side="bottom"
        align="end"
        label={SHARED_TIMER_LABEL}
        className="wb-timer-panel"
        trigger={
          <ChromeButton
            aria-label={resting ? SHARED_TIMER_LABEL : describeTimer(shownMs, timer.endsAt !== null)}
            className="wb-timer-face shrink-0 tabular-nums"
            data-wb-faced={faced ? '' : undefined}
            data-wb-clock={resting || ended ? undefined : running ? 'running' : 'held'}
            data-ending={!faced ? undefined : ended ? 'ended' : running && leftMs <= TIMER_SOON_MS ? 'soon' : undefined}
            style={{ '--wb-timer-left': left } as CSSProperties}
          >
            {!resting && !ended ? <TimerRing /> : <TimerIcon className="wb-timer-icon" aria-hidden="true" />}
            <TimerFold face={formatTimerFace(shownMs)} faced={faced} ended={ended} />
          </ChromeButton>
        }
      >
        <div className="wb-timer-top">
          <div className="wb-timer-clock">
            {readOnly ? null : (
              <Tip label={goLabel} side="bottom">
                <button
                  ref={play}
                  type="button"
                  className="wb-timer-key wb-timer-go"
                  data-go={running ? 'pause' : 'start'}
                  aria-label={goLabel}
                  onClick={() => {
                    if (!running || isTimerRunning(timer, Date.now())) act(running ? 'pause' : 'start');
                  }}
                >
                  {running ? <PauseGlyph /> : <Play fill="currentColor" strokeWidth={1.5} aria-hidden="true" />}
                </button>
              </Tip>
            )}
            <div className="wb-timer-facebox">
              <TimerDigits text={fieldDigits(shownMs, draft).join(':')} ended={ended} />
              {editable ? (
                <TimerLengthInput
                  ms={shownMs}
                  name={resting ? `Timer length, ${formatTimerDuration(shownMs)}` : `Timer length, ${formatTimerDuration(shownMs)} left`}
                  rests={resting}
                  draft={draft}
                  onDraft={setDraft}
                  onLength={(ms) => writeTimer(setTimerDuration(timer, ms, Date.now()))}
                />
              ) : (
                <span className="sr-only">{formatTimerFace(shownMs)}</span>
              )}
            </div>
            {readOnly ? null : (
              <span className="wb-timer-slot">
                <span className="wb-timer-pop wb-timer-steps" inert={paused}>
                  {[1, -1].map((minutes) => (
                    <Tip key={minutes} label={minutes > 0 ? 'One minute more' : 'One minute less'} side={minutes > 0 ? 'top' : 'bottom'}>
                      <button
                        type="button"
                        className="wb-timer-key"
                        aria-label={minutes > 0 ? 'One minute more' : 'One minute less'}
                        disabled={nudgeTimerMinutes(timer, minutes, now) === undefined}
                        onClick={(event) => {
                          if (guarded(event.detail)) return;
                          setDraft(null);
                          step(minutes);
                        }}
                      >
                        {minutes > 0 ? <Plus aria-hidden="true" /> : <Minus aria-hidden="true" />}
                      </button>
                    </Tip>
                  ))}
                </span>
                <span className="wb-timer-pop" inert={!paused}>
                  <Tip label={`Reset to ${formatTimerFace(timer.durationMs)}`} side="bottom">
                    <button
                      type="button"
                      className="wb-timer-key wb-timer-reset"
                      aria-label="Reset"
                      onClick={(event) => {
                        if (guarded(event.detail)) return;
                        act('reset');
                        play.current?.focus();
                      }}
                    >
                      <RotateCcw aria-hidden="true" />
                    </button>
                  </Tip>
                </span>
              </span>
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {ended ? 'Time’s up' : paused ? 'Paused' : 'One shared countdown for this board'}
          </p>
          <i className="wb-timer-hair" data-on={running || paused ? '' : undefined} data-held={paused ? '' : undefined} style={{ '--wb-timer-left': left } as CSSProperties} aria-hidden="true" />
        </div>
      </ChromePopover>
    </span>
  );
}

/** The face's digits; they fold away while the timer rests or its panel is open. */
function TimerFold({ face, faced, ended }: { face: string; faced: boolean; ended: boolean }) {
  // While folding away the digits keep the last face shown.
  const [shown, setShown] = useState(face);
  if (faced && shown !== face) setShown(face);
  return (
    <span className="wb-timer-fold">
      <span>
        <TimerDigits text={faced ? face : shown} ended={faced && ended} />
      </span>
    </span>
  );
}

/** `mm:ss` with a lighter colon; blinks at the end. */
function TimerDigits({ text, ended }: { text: string; ended: boolean }) {
  const [minutes, seconds] = text.split(':');
  return (
    <span className="wb-timer-digits" data-ended={ended ? '' : undefined} aria-hidden="true">
      {minutes}
      <span className="wb-timer-colon">:</span>
      {seconds}
    </span>
  );
}

/** Radius of the ring (a 15px ring with a 1.5px stroke in a 20px box). */
const RING_RADIUS = (15 - 1.5) / 2;
/** Vertical center of the ring (below the stopwatch's crown). */
const RING_CY = 11.6;

/** A stopwatch whose ring drains (and whose hand goes round) with `--wb-timer-left`. */
function TimerRing() {
  const round = 2 * Math.PI * RING_RADIUS;
  return (
    <svg className="wb-timer-ring" viewBox="0 0 20 20" fill="none" style={{ '--wb-timer-round': round } as CSSProperties} aria-hidden="true">
      <path d="M8.75 2.7h2.5" />
      <g transform={`rotate(-90 10 ${RING_CY})`} strokeWidth={1.5}>
        <circle cx={10} cy={RING_CY} r={RING_RADIUS} />
        <circle className="wb-timer-arc" cx={10} cy={RING_CY} r={RING_RADIUS} strokeDasharray={round} />
      </g>
      <path className="wb-timer-hand" d={`M10 ${RING_CY}v-3.75`} style={{ transformOrigin: `10px ${RING_CY}px` }} />
    </svg>
  );
}

/** Two filled bars. */
function PauseGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" strokeWidth={1} aria-hidden="true">
      <rect x={3.5} y={3.5} width={5} height={13} rx={1} />
      <rect x={11.5} y={3.5} width={5} height={13} rx={1} />
    </svg>
  );
}

/** What separates minutes from seconds when typed. */
const TIMER_SEPARATORS = [':', '.', ','];
/** A whole length typed or pasted at once (`5:30`). */
const TIMER_TYPED_PATTERN = /^\s*(\d{1,2})\s*[:.,]\s*([0-5]?\d)\s*$/;

/** One digit typed into a half: a fresh half starts as `0d`, a second digit fills it. */
function typeTimerDigit(half: 0 | 1, text: string, fresh: boolean, digit: string): { text: string; full: boolean } {
  return fresh ? { text: `0${digit}`, full: half === 1 && digit > '5' } : { text: text.slice(-1) + digit, full: true };
}

/** The halves one up or down (seconds wrap; undefined past the ends). */
function stepTimerDigits([minutes, seconds]: [string, string], half: 0 | 1, step: number): [string, string] | undefined {
  const pad = (value: number) => String(value).padStart(2, '0');
  if (half === 0) {
    const next = Math.min(99, Number(minutes) + step);
    return next < 0 || (step > 0 && next <= Number(minutes)) || (next === 0 && Number(seconds) === 0) ? undefined : [pad(next), seconds];
  }
  if (Number(minutes) > 99) return undefined;
  const wrap = (value: number) => (value + step + 60) % 60;
  const next = wrap(Number(seconds));
  return [minutes, pad(next === 0 && Number(minutes) === 0 ? wrap(next) : next)];
}

/**
 * The clock as two fields over the digits: minutes and seconds, typed digit
 * by digit (two fill a half and move on), stepped with the arrow keys, or
 * typed whole (`5:30`). Enter (or leaving both) sets the length.
 */
function TimerLengthInput({
  ms,
  name,
  rests,
  draft,
  onDraft,
  onLength,
}: {
  ms: number;
  name: string;
  rests: boolean;
  draft: TimerDraft;
  onDraft(draft: TimerDraft): void;
  onLength(ms: number): void;
}) {
  const halfRefs = useRef<[HTMLInputElement | null, HTMLInputElement | null]>([null, null]);
  const fresh = useRef(true);
  const halves = fieldDigits(ms, draft);

  const withHalf = (half: 0 | 1, text: string, base: TimerDraft = draft): TimerDraft =>
    half === 0 ? [text, base?.[1] ?? null] : [base?.[0] ?? null, text];
  const focusSeconds = () => {
    halfRefs.current[1]?.focus();
    fresh.current = true;
  };
  const commit = () => {
    fresh.current = true;
    if (draft === null) return;
    const parsed = digitsToTimerMs(halves);
    onDraft(null);
    if (parsed !== undefined && !(rests && parsed === ms)) onLength(parsed);
  };
  const typeInto = (half: 0 | 1, typed: string) => {
    const text = typed.normalize('NFKC');
    const whole = TIMER_TYPED_PATTERN.exec(text);
    if (whole !== null || (half === 0 && TIMER_SEPARATORS.includes(text))) {
      if (whole !== null) onDraft([whole[1]!.padStart(2, '0'), whole[2]!.padStart(2, '0')]);
      return focusSeconds();
    }
    let next = draft;
    let at = half;
    for (const digit of text.replace(/\D/g, '')) {
      const typedDigit = typeTimerDigit(at, next?.[at] ?? halves[at], fresh.current, digit);
      next = withHalf(at, typedDigit.text, next);
      fresh.current = typedDigit.full;
      if (typedDigit.full) at = 1;
    }
    if (next === draft) return;
    onDraft(next);
    if (at !== half) focusSeconds();
  };
  const onInput = (half: 0 | 1, event: ChangeEvent<HTMLInputElement>) => {
    const { data, inputType } = event.nativeEvent as InputEvent;
    if (inputType?.startsWith('delete')) {
      fresh.current = true;
      onDraft(withHalf(half, '00'));
    } else typeInto(half, data ?? '');
  };
  const onKeyDown = (half: 0 | 1, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape' && draft !== null) {
      event.preventDefault();
      event.stopPropagation();
      fresh.current = true;
      onDraft(null);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const stepped = stepTimerDigits(halves, half, event.key === 'ArrowUp' ? 1 : -1);
      fresh.current = true;
      if (stepped !== undefined) onDraft(withHalf(half, stepped[half]));
    } else if (half === 0 ? event.key === 'ArrowRight' || TIMER_SEPARATORS.includes(event.key) : event.key === 'ArrowLeft') {
      event.preventDefault();
      halfRefs.current[half === 0 ? 1 : 0]?.focus();
    }
  };

  return (
    <span
      className="wb-timer-halves"
      role="group"
      aria-label={name}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
      }}
    >
      {([0, 1] as const).map((half) => (
        <input
          key={half}
          ref={(node) => void (halfRefs.current[half] = node)}
          className="wb-timer-half"
          style={{ flexGrow: halves[half].length }}
          role="spinbutton"
          aria-label={half === 0 ? 'Minutes' : 'Seconds'}
          aria-valuemin={0}
          aria-valuemax={half === 0 ? 99 : 59}
          aria-valuenow={Number(halves[half])}
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          value={halves[half]}
          {...(draft === null ? { 'data-wb-committed': '' } : {})}
          onChange={(event) => onInput(half, event)}
          onPaste={(event) => {
            event.preventDefault();
            typeInto(half, event.clipboardData.getData('text'));
          }}
          onKeyDown={(event) => onKeyDown(half, event)}
          onKeyUp={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') commit();
          }}
          onFocus={(event) => {
            fresh.current = true;
            event.currentTarget.select();
          }}
          onPointerDown={() => {
            fresh.current = true;
          }}
          onSelect={(event) => {
            // The caret never shows: the whole half stays selected.
            const input = event.currentTarget;
            if (input.selectionStart !== 0 || input.selectionEnd !== input.value.length) input.setSelectionRange(0, input.value.length);
          }}
        />
      ))}
    </span>
  );
}

/** How long the end glow lasts. */
const TIMER_GLOW_MS = 3000;
/** The end is only celebrated when it is this fresh (not when a tab wakes up late). */
const TIMER_GLOW_FRESH_MS = 1000;
/** The stickers' animations are fetched this long before the end. */
const TIMER_WARM_MS = 15_000;

/** The board edges glow, and the animated stickers in view play once, when the shared timer ends. */
export function TimerEndGlow() {
  const endsAt = useBoard((state) => state.board.content.timer?.endsAt ?? null);
  const [glowing, setGlowing] = useState(false);
  useEffect(() => {
    if (endsAt === null || endsAt <= Date.now()) return;
    const cancelWarm = scheduleAtDeadline(endsAt - TIMER_WARM_MS, warmStickerParty);
    const cancel = scheduleAtDeadline(endsAt, () => {
      const fresh = !document.hidden && Date.now() - endsAt < TIMER_GLOW_FRESH_MS;
      setGlowing(fresh);
      if (fresh) startStickerParty();
    });
    return () => {
      cancelWarm();
      cancel();
      setGlowing(false);
    };
  }, [endsAt]);
  return glowing ? <i className="wb-timer-glow" style={{ animationDuration: `${TIMER_GLOW_MS}ms` }} aria-hidden="true" onAnimationEnd={() => setGlowing(false)} /> : null;
}
