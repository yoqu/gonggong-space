/**
 * Playback as the page asks for it: buttons, keys, the timeline and comments call these, never the engine's parts.
 * Each is a no-op before the engine runs. Calls from a click or key press also wake the sound (browsers allow
 * audio to start only then).
 */

import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { writePreferences } from '../stores/preferences.ts';
import { filmEngine } from './engine-context.ts';

export function play(): void {
  const engine = filmEngine();
  if (engine === null) return;
  engine.sound.prime();
  engine.playback.play();
}

export function pause(): void {
  filmEngine()?.playback.pause();
}

export function togglePlay(): void {
  if (usePlayback.getState().playing) pause();
  else play();
}

/** Moves the playhead to `t` seconds as played; playing goes on from there. */
export function seekTo(t: number): void {
  filmEngine()?.playback.seek(t);
}

export function seekBy(delta: number): void {
  seekTo(usePlayback.getState().time + delta);
}

export function restart(): void {
  seekTo(0);
  play();
}

/** Steps whole frames (pausing first): a frame forward with 1, back with -1. */
export function stepFrames(frames: number): void {
  pause();
  const fps = useFilm.getState().meta?.fps ?? 30;
  const at = Math.round(usePlayback.getState().time * fps) + frames;
  seekTo(at / fps);
}

export function setLoop(loop: boolean): void {
  filmEngine()?.playback.setLoop(loop);
  usePlayback.setState({ loop });
  writePreferences({ loop, volume: usePlayback.getState().volume });
}

export function setMuted(muted: boolean): void {
  const engine = filmEngine();
  if (engine === null) return;
  engine.sound.setMuted(muted);
}

export function toggleMuted(): void {
  setMuted(!usePlayback.getState().muted);
}

export function setVolume(volume: number): void {
  const engine = filmEngine();
  if (engine === null) return;
  engine.sound.setVolume(volume);
  if (volume > 0 && usePlayback.getState().muted) engine.sound.setMuted(false);
  writePreferences({ loop: usePlayback.getState().loop, volume: Math.min(1, Math.max(0, volume)) });
}

/** Play seconds per second for the whole film (the sound follows). */
export function setRate(rate: number): void {
  filmEngine()?.sound.setRate(rate);
}
