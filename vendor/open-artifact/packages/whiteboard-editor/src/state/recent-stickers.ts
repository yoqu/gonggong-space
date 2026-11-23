/**
 * Stickers this person used lately, newest first, kept in this browser so
 * the picker can offer them again.
 */

import { create } from 'zustand';

/** How many recent stickers the picker shows. */
export const RECENT_STICKERS_LIMIT = 7;
const STORAGE_KEY = 'open-artifact-whiteboard-recent-stickers';

function load(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, RECENT_STICKERS_LIMIT) : [];
  } catch {
    return [];
  }
}

/** The recent stickers, and how one is used. */
export interface RecentStickersState {
  /** Catalog keys of the stickers used lately, newest first (at most {@link RECENT_STICKERS_LIMIT}). */
  arts: string[];
  /** Moves an art to the front. */
  use(art: string): void;
}

/** The stickers this person used lately (kept in this browser's storage when it allows). */
export const useRecentStickers = create<RecentStickersState>()((set, get) => ({
  arts: load(),
  use(art) {
    const arts = [art, ...get().arts.filter((item) => item !== art)].slice(0, RECENT_STICKERS_LIMIT);
    set({ arts });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arts));
    } catch {
      // Storage is optional (private windows, blocked site data).
    }
  },
}));
