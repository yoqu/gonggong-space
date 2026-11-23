/**
 * Video playback on the board: one video plays at a time.
 *
 * A board video shows its first frame (its picture) with a play button;
 * nothing plays on its own. Pressing the button, or for someone who cannot
 * edit a press anywhere on a video not yet started, plays it, with sound
 * and looping; starting one stops any other. A press on a playing video
 * pauses or resumes it when it is the one item selected (or for a viewer),
 * but not within {@link VIDEO_CLICK_GUARD_MS} of starting it (the second
 * press of a double click). A video stops when it leaves the view, while
 * it is cropped, and when it leaves the board; stopping takes it back to
 * its first frame.
 *
 * The decisions are pure ({@link videoPressAction},
 * {@link videoPlayButtonSize}) and the playing video is kept here
 * ({@link useVideoPlayback}): unit-tested. `MediaViews.tsx` draws and
 * drives the `<video>`, and announces what happens.
 */

import { create } from 'zustand';
import type { ElementId } from '@open-artifact/whiteboard-core';

/** Attribute on a video's play button; its value is the button's mode ({@link VideoPlayMode}). */
export const VIDEO_PLAY_ATTRIBUTE = 'data-video-play';
/** A press on a playing video within this long of starting it does not pause it, ms. */
export const VIDEO_CLICK_GUARD_MS = 500;
/** A video at least this big on screen (its shorter side, px) gets the large play button. */
export const VIDEO_PLAY_BUTTON_LARGE_FROM_PX = 256;
/** Smaller play buttons, from the biggest: each from a video this big on screen (shorter side, px). */
export const VIDEO_PLAY_BUTTON_SIZES = [
  { from: 160, size: 'lg' },
  { from: 96, size: 'md' },
  { from: 48, size: 'sm' },
  { from: 32, size: 'xs' },
] as const;
/** On a touch screen the play button is one size (`lg`), on a video at least this big (px). */
export const VIDEO_PLAY_BUTTON_TOUCH_MIN_PX = 48;
/** Side of each play button on screen, px. */
export const VIDEO_PLAY_BUTTON_PX: Readonly<Record<VideoPlayButtonSize, number>> = { xl: 64, lg: 40, md: 32, sm: 24, xs: 20 };

/** A play button's size. */
export type VideoPlayButtonSize = 'xl' | 'lg' | 'md' | 'sm' | 'xs';

/**
 * The play button's mode: hidden while playing; a sign (not pressable) for
 * someone who cannot edit, whose press anywhere plays; else pressable.
 */
export type VideoPlayMode = 'playing' | 'sign' | 'pressable';

/**
 * The play button's size on a video whose shorter side is `framePx` on
 * screen; `undefined` for none (the video is too small). `touch` is a touch
 * screen where the viewer can edit.
 */
export function videoPlayButtonSize(framePx: number, touch: boolean): VideoPlayButtonSize | undefined {
  if (framePx >= VIDEO_PLAY_BUTTON_LARGE_FROM_PX) return 'xl';
  if (touch) return framePx >= VIDEO_PLAY_BUTTON_TOUCH_MIN_PX ? 'lg' : undefined;
  return VIDEO_PLAY_BUTTON_SIZES.find((step) => framePx >= step.from)?.size;
}

/** What a press on a video knows. */
export interface VideoPress {
  /** The press is on the play button. */
  onPlayButton: boolean;
  /** The viewer cannot edit. */
  viewer: boolean;
  /** The video is playing (or paused mid-play). */
  started: boolean;
  /** The video was the one item selected when pressed. */
  alone: boolean;
}

/** What a click on a video does: start it, or pause or resume it. */
export type VideoPressAction = 'play' | 'toggle';

/** What a click (a press let go in place) on a video does; `undefined` for nothing (it just selects). */
export function videoPressAction(press: VideoPress): VideoPressAction | undefined {
  if (press.onPlayButton || (press.viewer && !press.started)) return 'play';
  if (!press.started || !(press.viewer || press.alone)) return undefined;
  return 'toggle';
}

/* ------------------------------------------------------------------------ */
/* The playing video                                                        */
/* ------------------------------------------------------------------------ */

interface VideoPlaybackState {
  /** The video playing (or paused mid-play), if any. */
  playing: ElementId | null;
  /** The playing video was paused. */
  paused: boolean;
  /** The playing video's sound is off. */
  muted: boolean;
}

/** The video playing on the board. */
export const useVideoPlayback = create<VideoPlaybackState>()(() => ({ playing: null, paused: false, muted: false }));

/** The last time a click on a video started, paused or resumed it (a `performance.now()` time). */
let lastClickAt = -Infinity;
/** The last time a click started a video. */
let lastPlayAt = -Infinity;
/** A stop that came with its own notice (so "Stopped video." is not announced too). */
let toldStop = false;

/** Whether a click on a video did something within {@link VIDEO_CLICK_GUARD_MS} (a double click then does not crop it). */
export function videoClickedRecently(now: number = performance.now()): boolean {
  return now - lastClickAt < VIDEO_CLICK_GUARD_MS;
}

/** Plays video `id` (with sound, from the start), stopping any other; a paused one resumes. */
export function playVideo(id: ElementId): void {
  const state = useVideoPlayback.getState();
  if (state.playing === id) {
    if (state.paused) useVideoPlayback.setState({ paused: false });
    return;
  }
  useVideoPlayback.setState({ playing: id, paused: false, muted: false });
}

/** Pauses video `id` if it is playing; returns whether it did. */
export function pauseVideo(id: ElementId): boolean {
  const state = useVideoPlayback.getState();
  if (state.playing !== id || state.paused) return false;
  useVideoPlayback.setState({ paused: true });
  return true;
}

/** Pauses video `id` when it plays, else plays (or resumes) it. */
export function toggleVideo(id: ElementId): void {
  if (!pauseVideo(id)) playVideo(id);
}

/** Turns the playing video's sound off or on. */
export function setVideoMuted(id: ElementId, muted: boolean): void {
  if (useVideoPlayback.getState().playing === id) useVideoPlayback.setState({ muted });
}

/**
 * Stops video `id` if it is the one playing (back to its first frame).
 * With `told`, the caller shows its own notice instead of "Stopped video.".
 */
export function stopVideo(id: ElementId, told = false): void {
  if (useVideoPlayback.getState().playing !== id) return;
  toldStop = told;
  useVideoPlayback.setState({ playing: null, paused: false, muted: false });
}

/** Whether the last stop came with its own notice (and forgets it). */
export function takeToldStop(): boolean {
  const told = toldStop;
  toldStop = false;
  return told;
}

/** Runs a click's action on video `id` at `now` (a `performance.now()` time). */
export function runVideoPress(id: ElementId, action: VideoPressAction, now: number = performance.now()): void {
  lastClickAt = now;
  if (action === 'play') {
    lastPlayAt = now;
    playVideo(id);
  } else if (now - lastPlayAt > VIDEO_CLICK_GUARD_MS) toggleVideo(id);
}

/* ------------------------------------------------------------------------ */
/* The playing video's clock                                                */
/* ------------------------------------------------------------------------ */

/** What the playing video reports, for the selection bar's controls (`ui/VideoControls.tsx`). */
export interface VideoClock {
  /** The video. */
  id: ElementId;
  /** Where it is, seconds. */
  time: number;
  /** How long it is, seconds (0 until known). */
  duration: number;
  /** How far it has loaded without a gap from the start, seconds. */
  reach: number;
  /** Its length and first frame are known. */
  ready: boolean;
  /** It says how long it is, so it can be moved through (screen recordings often do not). */
  seekable: boolean;
  /** It has no sound. */
  silent: boolean;
}

/** The playing video's clock (`null` while no video plays). */
export const useVideoClock = create<{ clock: VideoClock | null }>()(() => ({ clock: null }));

/** Seconds each scrubber key moves the playing video by. */
export const SCRUB_KEY_STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 };

/** The playing video's element, while it plays. */
let clockVideo: { id: ElementId; video: HTMLVideoElement } | null = null;

/** How far ranges loaded (`[start, end]` seconds, in order) reach without a gap from the start. */
export function contiguousReach(ranges: ReadonlyArray<readonly [number, number]>, slack = 0.5): number {
  let reach = 0;
  for (const [start, end] of ranges) {
    if (start > reach + slack) break;
    reach = Math.max(reach, end);
  }
  return reach;
}

/** A playback time as `m:ss` (`h:mm:ss` from an hour). */
export function formatPlaybackTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Whether a video is known to have no sound track (browsers tell this in different ways). */
function hasNoSound(video: HTMLVideoElement): boolean {
  const media = video as HTMLVideoElement & { mozHasAudio?: boolean; audioTracks?: { length: number }; webkitAudioDecodedByteCount?: number };
  if (typeof media.mozHasAudio === 'boolean') return !media.mozHasAudio;
  if (media.audioTracks !== undefined) return media.audioTracks.length === 0;
  if (typeof media.webkitAudioDecodedByteCount === 'number') return media.currentTime > 1 && media.webkitAudioDecodedByteCount === 0;
  return false;
}

function readClock(id: ElementId, video: HTMLVideoElement): VideoClock {
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < video.buffered.length; index += 1) ranges.push([video.buffered.start(index), video.buffered.end(index)]);
  const seekable = Number.isFinite(video.duration) && video.duration > 0;
  return {
    id,
    time: video.currentTime,
    duration: seekable ? video.duration : 0,
    reach: contiguousReach(ranges),
    ready: video.readyState >= HTMLMediaElement.HAVE_METADATA,
    seekable,
    silent: hasNoSound(video),
  };
}

const CLOCK_EVENTS = ['loadedmetadata', 'loadeddata', 'durationchange', 'timeupdate', 'progress', 'seeked', 'play', 'pause'] as const;

/** Reads the clock of video `id` from its element while it plays; returns a function that stops. */
export function attachVideoClock(id: ElementId, video: HTMLVideoElement): () => void {
  clockVideo = { id, video };
  const read = (): void => {
    if (clockVideo?.video === video) useVideoClock.setState({ clock: readClock(id, video) });
  };
  for (const name of CLOCK_EVENTS) video.addEventListener(name, read);
  read();
  return () => {
    for (const name of CLOCK_EVENTS) video.removeEventListener(name, read);
    if (clockVideo?.video !== video) return;
    clockVideo = null;
    useVideoClock.setState({ clock: null });
  };
}

/** Where the playing video `id` is right now, seconds (between clock events). */
export function liveVideoTime(id: ElementId): number | undefined {
  return clockVideo?.id === id ? clockVideo.video.currentTime : undefined;
}

/** Moves the playing video `id` to `seconds` (kept within its length). */
export function seekVideo(id: ElementId, seconds: number): void {
  if (clockVideo?.id !== id) return;
  const { video } = clockVideo;
  video.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(video.duration) ? video.duration : seconds));
}
