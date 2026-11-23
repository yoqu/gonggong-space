/**
 * The selection bar's controls for a selected video: play or pause, a time
 * slider, and the sound. They act on the video playing on the board
 * (`elements/video-playback.ts`); a video that is not playing can only be
 * started (the slider and the sound button say why they wait).
 *
 * The slider follows the video every frame while it plays (unless motion
 * is reduced), keeps showing where it was moved until the video gets
 * there, and moves by a second with the arrow keys (5 with Page Up and
 * Page Down). After a drag, the keyboard goes back where it was.
 */

import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ElementId } from '@open-artifact/whiteboard-core';
import {
  SCRUB_KEY_STEPS,
  formatPlaybackTime,
  liveVideoTime,
  seekVideo,
  setVideoMuted,
  toggleVideo,
  useVideoClock,
  useVideoPlayback,
} from '../elements/video-playback.ts';
import { type ChromeSide, ToolButton } from './chrome.tsx';
import { useCoarsePointer, useMediaQuery } from './hooks.ts';

/** Why the slider waits for a video not playing. */
const PLAY_TO_SCRUB = 'Play the video to move through it.';
/** Why the slider is off for a video without a length. */
const NO_LENGTH = 'This video doesn’t say how long it is (a screen recording often doesn’t), so you can’t move through it.';

/** Play or pause the selected video, move through it, and turn its sound off or on. */
export function VideoControls({ id, side }: { id: ElementId; side: ChromeSide }) {
  return (
    <>
      <VideoPlayButton id={id} side={side} />
      <VideoScrubber id={id} />
      <VideoSoundButton id={id} side={side} />
    </>
  );
}

/** Plays the video, or pauses it while it plays. */
function VideoPlayButton({ id, side }: { id: ElementId; side: ChromeSide }) {
  const playing = useVideoPlayback((state) => state.playing === id && !state.paused);
  const label = playing ? 'Pause video' : 'Play video';
  return <ToolButton label={label} tipSide={side} size="lg" icon={playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} onClick={() => toggleVideo(id)} />;
}

/** The time slider, with where the video is and how long it is. */
function VideoScrubber({ id }: { id: ElementId }) {
  const clock = useVideoClock((state) => (state.clock?.id === id ? state.clock : null));
  const playing = useVideoPlayback((state) => state.playing === id && !state.paused);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const coarse = useCoarsePointer();
  const duration = clock?.duration ?? 0;
  const reason =
    clock === null || !clock.ready ? PLAY_TO_SCRUB : !clock.seekable ? NO_LENGTH : clock.reach < duration - 0.5 ? 'This video is still loading.' : undefined;

  // Where the video was moved to, shown until the clock catches up.
  const clockKey = `${clock?.time} ${playing}`;
  const [pending, setPending] = useState<{ to: number; since: string } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  if (pending !== undefined && !dragging && pending.since !== clockKey) setPending(undefined);

  // While it plays, the slider follows it every frame.
  const [live, setLive] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!playing || reducedMotion) return undefined;
    let frame = requestAnimationFrame(function tick() {
      setLive(liveVideoTime(id));
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      setLive(undefined);
    };
  }, [playing, reducedMotion, id]);

  const shown = pending?.to ?? (playing ? live : undefined) ?? clock?.time ?? 0;
  const seekTo = (to: number): void => {
    const clamped = Math.max(0, Math.min(to, duration));
    setPending({ to: clamped, since: clockKey });
    seekVideo(id, clamped);
  };

  // A drag gives the keyboard back to where it was once let go.
  const [focused, setFocused] = useState(false);
  const dragAbort = useRef<AbortController | null>(null);
  useEffect(() => () => dragAbort.current?.abort(), []);
  const onPointerDownCapture = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    dragAbort.current?.abort();
    if (event.button !== 0) return;
    const slider = event.currentTarget;
    const doc = slider.ownerDocument;
    const pointerId = event.pointerId;
    const previousFocus = doc.activeElement;
    const abort = new AbortController();
    dragAbort.current = abort;
    abort.signal.addEventListener('abort', () => setDragging(false));
    setDragging(true);
    const release = (up: PointerEvent): void => {
      if (up.pointerId !== pointerId) return;
      abort.abort();
      if (previousFocus instanceof HTMLElement && !slider.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    };
    for (const name of ['pointerup', 'pointercancel'] as const) doc.addEventListener(name, release, { signal: abort.signal });
  };
  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLSpanElement>): void => {
    const step = event.altKey || event.ctrlKey || event.metaKey ? undefined : SCRUB_KEY_STEPS[event.key];
    if (step === undefined || reason !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    seekTo(shown + step);
  };

  return (
    <span
      className="flex items-center gap-2 px-1"
      title={reason}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerDownCapture={onPointerDownCapture}
      onKeyDownCapture={onKeyDownCapture}
    >
      <BaseSlider.Root
        value={focused && !dragging && playing ? Math.floor(shown) : shown}
        min={0}
        max={Math.max(0.1, duration)}
        step={0.01}
        disabled={reason !== undefined}
        onValueChange={(next) => seekTo(Array.isArray(next) ? (next[0] ?? 0) : next)}
        className={coarse ? 'flex h-8 w-36 items-center' : 'flex h-7 w-28 items-center'}
      >
        <BaseSlider.Control className="flex h-4 w-full items-center data-[disabled]:opacity-40">
          <BaseSlider.Track className="h-1 w-full rounded-full bg-chrome-line">
            <BaseSlider.Indicator className="rounded-full bg-chrome-accent" />
            <BaseSlider.Thumb
              aria-label="Time"
              getAriaValueText={(_formatted, value) => `${formatPlaybackTime(value)} of ${formatPlaybackTime(duration)}`}
              className="size-3 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.2),0_1px_2px_rgb(0_0_0/0.2)] outline-none focus-visible:outline-2 focus-visible:outline-chrome-accent"
            />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
      <span aria-hidden="true" className="min-w-[4.5rem] whitespace-pre text-[12px] tabular-nums">
        <span className="text-chrome-fg">{formatPlaybackTime(shown)}</span>
        {duration > 0 ? <span className="text-chrome-muted">{` / ${formatPlaybackTime(duration)}`}</span> : null}
      </span>
    </span>
  );
}

/** Turns the playing video's sound off or on. */
function VideoSoundButton({ id, side }: { id: ElementId; side: ChromeSide }) {
  const started = useVideoPlayback((state) => state.playing === id);
  const muted = useVideoPlayback((state) => state.playing === id && state.muted);
  const silent = useVideoClock((state) => state.clock?.id === id && state.clock.silent);
  const reason = !started ? 'Play the video to change its sound.' : silent ? 'This video has no sound.' : undefined;
  const label = muted ? 'Unmute' : 'Mute';
  return (
    <ToolButton
      label={label}
      tip={reason ?? label}
      tipSide={side}
      size="lg"
      icon={muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      pressed={muted}
      aria-disabled={reason !== undefined}
      className="aria-disabled:opacity-40"
      onClick={() => {
        if (reason === undefined) setVideoMuted(id, !muted);
      }}
    />
  );
}
