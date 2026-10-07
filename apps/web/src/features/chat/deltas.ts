import { create } from 'zustand'

/** Streamed text per run, kept out of the timeline state so a delta re-renders only its run card. */
export const useRunDeltas = create<Record<string, string>>()(() => ({}))
