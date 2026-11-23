/**
 * The playhead as the page shows it. The engine writes this store; the page changes playback only through
 * `engine/actions.ts`, so the stage and the sound never drift from what is shown.
 */

import { create } from 'zustand';
import { playSeconds, type PlaySeconds } from '@open-artifact/motion-core';
import { readPreferences } from './preferences.ts';

export interface PlaybackState {
  playing: boolean;
  /** Where the playhead is, as played. */
  time: PlaySeconds;
  /** Play seconds per second. */
  rate: number;
  loop: boolean;
  muted: boolean;
  /** 0…1. */
  volume: number;
  /** Playing, but the stage is behind the clock (frames not yet on show). */
  buffering: boolean;
  /** Stopped at the end (not looping); the ended offers show. */
  ended: boolean;
  /** Sound can be heard here. */
  soundAvailable: boolean;
}

const preferences = readPreferences();

export const usePlayback = create<PlaybackState>()(() => ({
  playing: false,
  time: playSeconds(0),
  rate: 1,
  loop: preferences.loop,
  muted: false,
  volume: preferences.volume,
  buffering: false,
  ended: false,
  soundAvailable: false,
}));
