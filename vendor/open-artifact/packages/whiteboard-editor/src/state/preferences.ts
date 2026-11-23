/**
 * Per-viewer preferences kept in localStorage: single-key tool shortcuts
 * and the timer chime. Nothing here is shared with others.
 */

import { create } from 'zustand';

const LETTER_KEYS_KEY = 'open-artifact-whiteboard-letter-keys';
const CHIME_KEY = 'open-artifact-whiteboard-timer-chime';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage may be unavailable */
  }
}

export interface PreferencesState {
  /** Single-letter tool shortcuts (V, H, T…). Off by default. */
  letterKeys: boolean;
  /** The shared timer plays a chime when it ends. */
  timerChime: boolean;
  setLetterKeys(on: boolean): void;
  setTimerChime(on: boolean): void;
}

export const usePreferences = create<PreferencesState>()((set) => ({
  letterKeys: readFlag(LETTER_KEYS_KEY, false),
  timerChime: readFlag(CHIME_KEY, true),
  setLetterKeys(on) {
    writeFlag(LETTER_KEYS_KEY, on);
    set({ letterKeys: on });
  },
  setTimerChime(on) {
    writeFlag(CHIME_KEY, on);
    set({ timerChime: on });
  },
}));
