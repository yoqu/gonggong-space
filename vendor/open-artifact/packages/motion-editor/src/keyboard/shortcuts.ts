/**
 * Playback and seeking keys. None applies in fields, dialogs, menus or side panels (Mod+\ aside). Comment mode adds
 * its own keys on top (`comments/keys.ts`).
 */

import { pause, seekTo, stepFrames, togglePlay, toggleMuted } from '../engine/actions.ts';
import { togglePanel } from '../panels/registry.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { toggleFullscreen } from '../transport/fullscreen.ts';
import { shortcuts, type KeyRegistry, type Shortcut } from './registry.ts';
import { SEEK_ARROW_SECONDS, SEEK_PAGE_SECONDS, SEEK_STEP_SECONDS, pageSeek, seekedBy } from './seek.ts';
import * as words from './words.ts';

/** Chapter starts as played: the film's chapters, else its scenes when it has more than one. */
export function chapterStarts(): number[] {
  const { meta, clock } = useFilm.getState();
  if (meta !== null && meta.chapters.length > 0) return meta.chapters.map((chapter) => chapter.t);
  const parts = clock?.parts ?? [];
  return parts.length > 1 ? parts.map((part) => part.playStart) : [];
}

const total = (): number => useFilm.getState().meta?.duration ?? 0;
const now = (): number => usePlayback.getState().time;
const fps = (): number => useFilm.getState().meta?.fps ?? 30;
const hasFilm = (): boolean => useFilm.getState().meta !== null;
const by = (delta: number) => (): void => seekTo(seekedBy(now(), delta, total()));

export const PLAYBACK_SHORTCUTS: readonly Shortcut[] = [
  { id: 'play', keys: [{ key: ' ' }, { key: 'k' }], label: words.PLAY_PAUSE, when: hasFilm, run: () => togglePlay() },
  { id: 'fullscreen', keys: [{ key: 'f' }], label: words.FULL_SCREEN, run: () => toggleFullscreen() },
  { id: 'mute', keys: [{ key: 'm' }], label: words.MUTE, run: () => toggleMuted() },
  { id: 'back', keys: [{ key: 'ArrowLeft' }], label: words.backSeconds(SEEK_ARROW_SECONDS), repeats: true, when: hasFilm, run: by(-SEEK_ARROW_SECONDS) },
  { id: 'forward', keys: [{ key: 'ArrowRight' }], label: words.forwardSeconds(SEEK_ARROW_SECONDS), repeats: true, when: hasFilm, run: by(SEEK_ARROW_SECONDS) },
  { id: 'back-long', keys: [{ key: 'j' }], label: words.backSeconds(SEEK_PAGE_SECONDS), repeats: true, when: hasFilm, run: by(-SEEK_PAGE_SECONDS) },
  { id: 'forward-long', keys: [{ key: 'l' }], label: words.forwardSeconds(SEEK_PAGE_SECONDS), repeats: true, when: hasFilm, run: by(SEEK_PAGE_SECONDS) },
  { id: 'step-up', keys: [{ key: 'ArrowUp' }], label: words.forwardSeconds(SEEK_STEP_SECONDS), repeats: true, when: hasFilm, run: by(SEEK_STEP_SECONDS) },
  { id: 'step-down', keys: [{ key: 'ArrowDown' }], label: words.backSeconds(SEEK_STEP_SECONDS), repeats: true, when: hasFilm, run: by(-SEEK_STEP_SECONDS) },
  {
    id: 'frame-back',
    keys: [{ key: 'ArrowLeft', shift: true }, { key: ',' }],
    label: words.FRAME_BACK,
    repeats: true,
    when: hasFilm,
    run: () => stepFrames(-1),
  },
  {
    id: 'frame-forward',
    keys: [{ key: 'ArrowRight', shift: true }, { key: '.' }],
    label: words.FRAME_FORWARD,
    repeats: true,
    when: hasFilm,
    run: () => stepFrames(1),
  },
  { id: 'start', keys: [{ key: 'Home' }], label: words.TO_START, when: hasFilm, run: () => seekTo(0) },
  {
    id: 'end',
    keys: [{ key: 'End' }],
    label: words.TO_END,
    when: hasFilm,
    run: () => {
      pause();
      seekTo(total());
    },
  },
  { id: 'chapter-next', keys: [{ key: 'PageUp' }], label: words.NEXT_CHAPTER, repeats: true, when: hasFilm, run: () => seekTo(pageSeek(now(), 1, chapterStarts(), fps(), total())) },
  {
    id: 'chapter-previous',
    keys: [{ key: 'PageDown' }],
    label: words.PREVIOUS_CHAPTER,
    repeats: true,
    when: hasFilm,
    run: () => seekTo(pageSeek(now(), -1, chapterStarts(), fps(), total())),
  },
  { id: 'panel', keys: [{ key: '\\', mod: true }], label: words.TOGGLE_PANEL, everywhere: true, run: () => togglePanel() },
];

/** Adds the playback keys to the registry; returns a function that takes them away. */
export function registerPlaybackShortcuts(registry: KeyRegistry = shortcuts): () => void {
  const stops = PLAYBACK_SHORTCUTS.map((shortcut) => registry.register(shortcut));
  return () => {
    for (const stop of stops) stop();
  };
}
