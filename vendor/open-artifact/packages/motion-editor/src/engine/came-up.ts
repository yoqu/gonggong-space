import { create } from 'zustand';
import { NO_PALETTE_FALLBACK, type PaletteFallback } from '@open-artifact/motion-core';

/** How the film on show came up: which load of it (the film's revision) and what of a person's records it dropped. */
export interface CameUp extends PaletteFallback {
  /** The film revision on show, -1 before one came up. */
  revision: number;
}

export const useCameUp = create<CameUp>()(() => ({ revision: -1, ...NO_PALETTE_FALLBACK }));
