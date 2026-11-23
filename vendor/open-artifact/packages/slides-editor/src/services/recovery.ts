/**
 * Unsaved-work recovery: while edits are waiting to be saved, the slides and
 * index that differ from the saved files are copied to localStorage. If the
 * tab closes (or loses write access) before the save lands, the next visit
 * offers to bring them back. Copies older than three days are dropped.
 */

import { STASH_KEEP_MS, storedJson } from '@open-artifact/editor-kit';
import { parseDeckIndex, serializeDeckIndex, serializeSlide, type Slide } from '@open-artifact/slides-core';
import { isDirty, readSlide, deckFaces, useDeck } from '../state/deck.ts';
import { maybeSession } from './session.ts';

/** Debounce of copies while typing, ms. */
const WRITE_DELAY = 1500;

/** A stored copy. */
export interface Recovery {
  at: number;
  /** Slide id → its unsaved text (null: deleted here). */
  slides: Record<string, string | null>;
  /** The unsaved index text. */
  index?: string;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** This artifact's stored copy (by page URL: one artifact per editor page). */
const stored = () => storedJson<Recovery>(`open-artifact-slides:recovery:${location.pathname}`, (value) => value as Recovery | null);

function read(): Recovery | null {
  const store = stored();
  const value = store.read();
  if (value === null) return null;
  if (!value || typeof value.at !== 'number' || Date.now() - value.at > STASH_KEEP_MS) {
    store.clear();
    return null;
  }
  return value;
}

/** Copies the unsaved state now (`immediate`) or shortly. */
export function saveRecovery(immediate = false): void {
  if (!maybeSession()) return;
  const write = (): void => {
    timer = null;
    const state = useDeck.getState();
    if (!isDirty(state)) return;
    const record: Recovery = { at: Date.now(), slides: {} };
    for (const [id, entry] of Object.entries(state.slides)) {
      if (entry.slide !== entry.saved && !entry.held) record.slides[id] = serializeSlide(entry.slide);
    }
    for (const [id, entry] of Object.entries(state.trash)) if (entry.hash !== null) record.slides[id] = null;
    if (state.index !== state.indexSaved && !state.indexError) record.index = serializeDeckIndex(state.index);
    stored().write(record);
  };
  if (timer) clearTimeout(timer);
  if (immediate) write();
  else timer = setTimeout(write, WRITE_DELAY);
}

/** Forgets the stored copy (after a save landed). */
export function clearRecovery(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  stored().clear();
}

/**
 * A stored copy that still differs from the files as loaded, or null. Slides
 * whose saved text already equals the copy are left out.
 */
export function pendingRecovery(): Recovery | null {
  const record = read();
  if (!record) return null;
  const state = useDeck.getState();
  const slides: Record<string, string | null> = {};
  for (const [id, text] of Object.entries(record.slides)) {
    const entry = state.slides[id];
    if (text === null ? entry !== undefined : entry?.savedText !== text) slides[id] = text;
  }
  const index = record.index !== undefined && record.index !== (state.indexSaved ? serializeDeckIndex(state.indexSaved) : null) ? record.index : undefined;
  if (Object.keys(slides).length === 0 && index === undefined) {
    clearRecovery();
    return null;
  }
  return { at: record.at, slides, ...(index !== undefined ? { index } : {}) };
}

/** Applies a stored copy as one undoable edit. */
export function restoreRecovery(record: Recovery): void {
  const state = useDeck.getState();
  const faces = deckFaces(state.index);
  const slides: Record<string, Slide | null> = {};
  for (const [id, text] of Object.entries(record.slides)) {
    if (text === null) slides[id] = null;
    else {
      const read = readSlide(id, text, faces);
      if (!read.held) slides[id] = read.slide;
    }
  }
  let index = state.index;
  if (record.index) {
    const parsed = parseDeckIndex(record.index);
    if (!parsed.error) index = parsed.index;
  }
  state.apply('Restore unsaved changes', { slides, index });
  clearRecovery();
}
