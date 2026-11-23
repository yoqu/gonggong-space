/**
 * The deck document store: `deck.json` and every slide file, the edits made
 * here, undo history and save bookkeeping.
 *
 * Models are immutable; an edit replaces a slide (or the index) with a new
 * object. A slide needs writing when its model is not the one last saved or
 * read (`slide !== saved`); the index likewise. Saves and remote changes go
 * through `services/sync.ts`, which calls the bookkeeping actions here.
 */

import { mergeLines } from '@open-artifact/editor-kit';
import { create } from 'zustand';
import {
  addSectionAtSlide,
  compileSlide,
  createSourceDeck,
  DECK_PATH,
  deckFormatKind,
  flattenSlide,
  isFlatSlideHtml,
  patchSourceSlide,
  readSourceSlide,
  setSlideSize,
  stripSourcePlaces,
  type SourceDeck,
  heldReason,
  LIMITS,
  mergeDeckIndex,
  newDeckIndex,
  parseDeckIndex,
  resolveOrder,
  sectionedDeck,
  sectionsMap,
  serializeDeckIndex,
  serializeSlide,
  type DeckIndex,
  type Diagnostic,
  type Slide,
} from '@open-artifact/slides-core';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** What the save indicator shows. */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'readonly';

/** Someone else changed a slide this tab also changed: the person decides. */
export interface SlideConflict {
  /** Their text, or null when they deleted the file. */
  theirsText: string | null;
  theirsHash: string | null;
  /** Their slide as compiled (null when deleted). */
  theirsSlide: Slide | null;
  /** What happened, for the banner. */
  reason: 'changed' | 'deleted' | 'undo';
}

/** One slide file. */
export interface SlideEntry {
  /** The current model. */
  slide: Slide;
  /** The model as last saved or read (null: never written). */
  saved: Slide | null;
  /** The file text as last saved or read. */
  savedText: string | null;
  /** The file's hash as last saved or read (the next write's `ifMatch`). */
  hash: string | null;
  /** Set while the file does not compile (or is too large): shown, never written. */
  held?: string;
  /** Compiler findings of the file as read. */
  diagnostics: Diagnostic[];
  /**
   * In a source deck: the saved file as read, with each node's place in the
   * file (`origin`), which an edit is written back against. Absent: `saved`.
   */
  source?: Slide;
  conflict?: SlideConflict;
  /** When this tab last wrote the file (a save made at the same moment may replace it). */
  writtenAt?: number;
}

/** One undo step. */
export interface HistoryStep {
  label: string;
  /** Slides before and after (null: absent). */
  slides: Record<string, { before: Slide | null; after: Slide | null }>;
  index?: { before: DeckIndex; after: DeckIndex };
  /** Slide on stage when the step was made (restored on undo/redo). */
  focus?: string;
  /** Steps with the same key within a moment merge into one. */
  coalesce?: string;
  at: number;
}

/** A version of a slide that lost a conflict, kept so it can be brought back. */
export interface KeptSlide {
  id: string;
  slide: Slide;
  reason: 'theirs-chosen' | 'mine-chosen' | 'overwritten';
  at: number;
  /** The file text of the kept version (an overwritten one: what this tab had saved). */
  text?: string;
}

/** What applying someone else's version of a slide did. */
export type RemoteOutcome = 'applied' | 'conflict' | 'same' | 'merged' | 'overwritten';

/** What one save sent (so the acknowledgement knows what became saved). */
export interface SentBatch {
  index: { index: DeckIndex; text: string } | null;
  slides: Record<string, { slide: Slide; text: string }>;
  deleted: string[];
}

/** Initial load. */
export interface LoadInput {
  title: string;
  readOnly: boolean;
  index: { text: string | null; hash: string | null };
  slides: Record<string, { text: string; hash: string }>;
}

/** Result of an undo / redo request. */
export type UndoOutcome = { done: true; focus?: string } | { done: false; warning?: string };

interface DeckState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** The artifact's title as the host shows it. */
  title: string;
  readOnly: boolean;
  index: DeckIndex;
  /** The index as last saved or read (null: the file does not exist yet). */
  indexSaved: DeckIndex | null;
  indexHash: string | null;
  /** deck.json could not be parsed: shown read-only until fixed. */
  indexError: string | null;
  slides: Record<string, SlideEntry>;
  /** Deleted slides whose files still need deleting (keep their hash). */
  trash: Record<string, SlideEntry>;
  undo: HistoryStep[];
  redo: HistoryStep[];
  /** An undo that was warned about (a second request performs it). */
  undoWarned: HistoryStep | null;
  /** Hand edits made in this tab. */
  edits: number;
  kept: KeptSlide[];
  save: SaveState;
  /** Bumps on every local change (the save scheduler watches it). */
  revision: number;

  load(input: LoadInput): void;
  fail(message: string): void;
  setSave(save: SaveState): void;
  /** Applies an edit as one undo step. `slides` maps ids to the new model (null: delete). */
  apply(label: string, change: { slides?: Record<string, Slide | null>; index?: DeckIndex }, options?: { coalesce?: string; focus?: string }): void;
  undoStep(): UndoOutcome;
  redoStep(): UndoOutcome;
  acknowledge(sent: SentBatch, hashes: Record<string, string | null>): void;
  remoteIndex(text: string | null, hash: string | null): void;
  /**
   * Applies someone else's version of a slide. Returns 'conflict' when a
   * decision is needed, 'merged' when both sides' changes were merged by
   * line, 'overwritten' when it replaced a save this tab made moments ago.
   */
  remoteSlide(id: string, text: string | null, hash: string | null): RemoteOutcome;
  /** Puts this tab's overwritten version of a slide back (one undo step). */
  bringBack(index: number): void;
  resolveConflict(id: string, choice: 'mine' | 'theirs' | 'copy', copyId?: string): void;
  restoreKept(index: number, newId: string): void;
  /** Reads every unchanged slide again (the shared sheet, size or format changed). */
  rereadSlides(): void;
  dismissKept(index: number): void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Merge window of coalescing steps, ms. */
const COALESCE_MS = 1500;
/** Most kept versions remembered. */
const KEPT_MAX = 20;
/** A remote version arriving this soon after this tab saved the slide replaced a save made at the same moment. */
export const OVERWRITE_WINDOW_MS = 3_000;

/**
 * The deck's shared sheet when it is a source deck (deck.json `format`), and
 * each slide's place in it (for `counter()`). Set from the index and
 * `project/deck.css` by {@link configureDeck}; slides are read and written
 * through it.
 */
let sourceDeck: SourceDeck | undefined;
let sourcePlaces = new Map<string, number>();

/**
 * Sets the slide size and the shared sheet from the index and
 * `project/deck.css`. Returns true when how slides read changed (the caller
 * re-reads its clean slides).
 */
export function configureDeck(index: DeckIndex, css: string | null | undefined, slideIds: Iterable<string> = []): boolean {
  setSlideSize(index.size);
  const previous = sourceDeck;
  sourceDeck = deckFormatKind(index) === 'source' ? createSourceDeck(css ?? undefined, index.size) : undefined;
  sourcePlaces = new Map(resolveOrder(index.order, slideIds).map((id, i) => [id, i]));
  return previous !== undefined || sourceDeck !== undefined;
}

/** The current source deck, if the deck is one. */
export function currentSourceDeck(): SourceDeck | undefined {
  return sourceDeck;
}

/** Compiles a slide file for the editor (through the shared sheet in a source deck). */
export function readSlide(id: string, text: string, faces: Iterable<string>): Pick<SlideEntry, 'slide' | 'held' | 'diagnostics'> {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.slideFileBytes) {
    const result = compileSlide(`<section id="${id}"></section>`, { id, lints: false });
    return { slide: result.slide, held: `File is ${Math.round(bytes / 1024)} KB (max ${LIMITS.slideFileBytes / 1024} KB)`, diagnostics: [] };
  }
  const result = sourceDeck && !isFlatSlideHtml(text)
    ? readSourceSlide(text, sourceDeck, { id, faces, lints: false, index: sourcePlaces.get(id) ?? 0 })
    : compileSlide(text, { id, faces, lints: false });
  return { slide: result.slide, held: result.held ? heldReason(result.diagnostics) ?? 'The file has errors' : undefined, diagnostics: result.diagnostics };
}

/** Families the deck declares. */
export function deckFaces(index: DeckIndex): string[] {
  return Object.values(index.faces).map((face) => face.family);
}

/** True when the slide has edits not yet saved. */
export function slideNeedsWrite(entry: SlideEntry): boolean {
  return !entry.held && entry.slide !== entry.saved && !entry.conflict;
}

/** True when anything is waiting to be saved. */
export function isDirty(state: Pick<DeckState, 'index' | 'indexSaved' | 'indexError' | 'slides' | 'trash'>): boolean {
  if (!state.indexError && state.index !== state.indexSaved) return true;
  if (Object.values(state.slides).some(slideNeedsWrite)) return true;
  return Object.values(state.trash).some((entry) => entry.hash !== null);
}

/** The deck order resolved against the slide files that exist. */
export function deckOrder(state: Pick<DeckState, 'index' | 'slides'>): string[] {
  return resolveOrder(state.index.order, Object.keys(state.slides));
}

/**
 * The text a save writes for a slide. In a source deck an edit is written
 * into the slide's own markup when it can be; otherwise, and for a slide a
 * person added, the slide is saved flat (`data-flat`, inline styles).
 */
export function slideText(slide: Slide, entry?: Pick<SlideEntry, 'saved' | 'savedText' | 'source'>): string {
  if (!sourceDeck) return serializeSlide(slide);
  if (slide.flat) return flattenSlide(slide);
  const savedText = entry?.savedText;
  const saved = entry?.source ?? entry?.saved;
  if (!savedText || !saved || isFlatSlideHtml(savedText)) return flattenSlide(slide);
  if (sameSlide(slide, saved)) return savedText;
  return patchSourceSlide(savedText, saved, slide, sourceDeck, { id: slide.id, index: sourcePlaces.get(slide.id) ?? 0 }) ?? flattenSlide(slide);
}

/** True when two slide models write the same file (source places aside). */
export function sameSlide(a: Slide, b: Slide): boolean {
  return a === b || serializeSlide(stripSourcePlaces(a)) === serializeSlide(stripSourcePlaces(b));
}

/** Moves `data-section` markers on loaded slides into the index (one step, not undoable). */
function adoptSections(index: DeckIndex, slides: Record<string, SlideEntry>): DeckIndex {
  let next = index;
  const order = resolveOrder(index.order, Object.keys(slides));
  for (const id of order) {
    const entry = slides[id]!;
    const description = entry.slide.section;
    if (description === undefined || entry.held) continue;
    const deck = sectionedDeck(next, order);
    if (!deck.sections.some((s) => s.start === id)) {
      const added = addSectionAtSlide(deck, id, description);
      if (added) next = { ...next, sections: sectionsMap(added.sections) };
    }
    const { section: _drop, ...rest } = entry.slide;
    slides[id] = { ...entry, slide: rest as Slide };
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export const useDeck = create<DeckState>()((set, get) => ({
  status: 'loading',
  error: null,
  title: '',
  readOnly: true,
  index: newDeckIndex(),
  indexSaved: null,
  indexHash: null,
  indexError: null,
  slides: {},
  trash: {},
  undo: [],
  redo: [],
  undoWarned: null,
  edits: 0,
  kept: [],
  save: 'saved',
  revision: 0,

  load({ title, readOnly, index: indexFile, slides: files }) {
    const parsed = indexFile.text === null ? null : parseDeckIndex(indexFile.text);
    const index = parsed?.index ?? newDeckIndex(title);
    const faces = deckFaces(index);
    const slides: Record<string, SlideEntry> = {};
    for (const [id, file] of Object.entries(files)) {
      const read = readSlide(id, file.text, faces);
      slides[id] = { ...read, saved: read.slide, savedText: file.text, hash: file.hash };
    }
    const indexSaved = parsed && !parsed.error ? parsed.index : null;
    let next = index;
    if (!readOnly && !parsed?.error) next = adoptSections(index, slides);
    set({
      status: 'ready',
      error: null,
      title,
      readOnly,
      index: next,
      indexSaved,
      indexHash: indexFile.hash,
      indexError: parsed?.error ?? null,
      slides,
      trash: {},
      save: readOnly ? 'readonly' : 'saved',
      revision: get().revision + 1,
    });
  },

  fail(message) {
    set({ status: 'error', error: message });
  },

  setSave(save) {
    if (get().readOnly && save !== 'readonly') return;
    set({ save });
  },

  apply(label, change, options = {}) {
    const state = get();
    if (state.readOnly) return;
    const slides = { ...state.slides };
    const trash = { ...state.trash };
    const step: HistoryStep = { label, slides: {}, at: Date.now(), coalesce: options.coalesce, focus: options.focus };
    for (const [id, next] of Object.entries(change.slides ?? {})) {
      const current = slides[id];
      if (current?.held) continue;
      const before = current?.slide ?? null;
      if (before === next) continue;
      step.slides[id] = { before, after: next };
      if (next === null) {
        if (current) {
          delete slides[id];
          trash[id] = current;
        }
      } else if (current) {
        slides[id] = { ...current, slide: next };
      } else {
        const restored = trash[id];
        delete trash[id];
        slides[id] = restored ? { ...restored, slide: next } : { slide: next, saved: null, savedText: null, hash: null, diagnostics: [] };
      }
    }
    let index = state.index;
    if (change.index && change.index !== state.index && !state.indexError) {
      step.index = { before: state.index, after: change.index };
      index = change.index;
    }
    if (Object.keys(step.slides).length === 0 && !step.index) return;
    let undo = state.undo;
    const top = undo[undo.length - 1];
    if (top && step.coalesce && top.coalesce === step.coalesce && step.at - top.at < COALESCE_MS) {
      const merged: HistoryStep = { ...top, at: step.at, slides: { ...top.slides } };
      for (const [id, change] of Object.entries(step.slides)) {
        merged.slides[id] = { before: top.slides[id]?.before ?? change.before, after: change.after };
      }
      if (step.index) merged.index = { before: top.index?.before ?? step.index.before, after: step.index.after };
      undo = [...undo.slice(0, -1), merged];
    } else {
      undo = [...undo, step].slice(-LIMITS.undo);
    }
    set({ slides, trash, index, undo, redo: [], undoWarned: null, edits: state.edits + 1, revision: state.revision + 1 });
  },

  undoStep() {
    return travel(get, set, 'undo');
  },

  redoStep() {
    return travel(get, set, 'redo');
  },

  rereadSlides() {
    const state = get();
    const faces = deckFaces(state.index);
    const slides = { ...state.slides };
    let changed = false;
    for (const [id, entry] of Object.entries(slides)) {
      if (entry.savedText === null || entry.conflict || (entry.slide !== entry.saved && !entry.held)) continue;
      const read = readSlide(id, entry.savedText, faces);
      slides[id] = { ...entry, ...read, saved: read.slide, source: undefined };
      changed = true;
    }
    if (changed) set({ slides });
  },

  acknowledge(sent, hashes) {
    const state = get();
    const slides = { ...state.slides };
    const trash = { ...state.trash };
    let { indexSaved, indexHash } = state;
    if (sent.index) {
      indexSaved = sent.index.index;
      indexHash = hashes[DECK_PATH] ?? indexHash;
    }
    for (const [id, { slide, text }] of Object.entries(sent.slides)) {
      const entry = slides[id];
      const hash = hashes[`project/slides/${id}.html`] ?? null;
      if (entry) {
        // A source slide re-read from what was written knows where its new elements live.
        let source: Slide | undefined;
        if (sourceDeck && !isFlatSlideHtml(text)) {
          const read = readSlide(id, text, deckFaces(state.index));
          if (!read.held && sameSlide(read.slide, slide)) source = read.slide;
        }
        slides[id] = { ...entry, saved: slide, savedText: text, hash, source, writtenAt: Date.now() };
      } else if (trash[id]) trash[id] = { ...trash[id]!, saved: slide, savedText: text, hash };
    }
    for (const id of sent.deleted) {
      if (trash[id]) delete trash[id];
    }
    set({ slides, trash, indexSaved, indexHash });
  },

  remoteIndex(text, hash) {
    const state = get();
    if (text === null) {
      // deck.json was deleted: write ours back on the next save.
      set({ indexSaved: null, indexHash: null, revision: state.revision + 1 });
      return;
    }
    const parsed = parseDeckIndex(text);
    if (parsed.error) {
      set({ indexError: parsed.error, indexHash: hash });
      return;
    }
    const theirs = parsed.index;
    const base = state.indexSaved ?? theirs;
    const merged = state.index === state.indexSaved || state.indexError ? theirs : mergeDeckIndex(base, state.index, theirs);
    // The slide size follows the index before anything renders at the new size.
    setSlideSize(merged.size);
    set({ index: merged, indexSaved: theirs, indexHash: hash, indexError: null, revision: state.revision + (merged === theirs ? 0 : 1) });
  },

  remoteSlide(id, text, hash) {
    const state = get();
    const entry = state.slides[id] ?? state.trash[id];
    const inTrash = !state.slides[id] && Boolean(state.trash[id]);
    if (text === null) {
      if (!entry) return 'same';
      if (inTrash || entry.slide === entry.saved || entry.held) {
        const slides = { ...state.slides };
        const trash = { ...state.trash };
        delete slides[id];
        delete trash[id];
        set({ slides, trash });
        return 'applied';
      }
      set({ slides: { ...state.slides, [id]: { ...entry, conflict: { theirsText: null, theirsHash: null, theirsSlide: null, reason: 'deleted' } } } });
      return 'conflict';
    }
    const read = readSlide(id, text, deckFaces(state.index));
    if (!entry) {
      set({ slides: { ...state.slides, [id]: { ...read, saved: read.slide, savedText: text, hash } } });
      return 'applied';
    }
    if (entry.savedText === text) {
      set({ slides: { ...state.slides, [id]: { ...entry, hash } } });
      return 'same';
    }
    const dirty = entry.slide !== entry.saved && !entry.held;
    if (!dirty || inTrash) {
      if (inTrash) {
        // They edited a slide we deleted: theirs comes back.
        const trash = { ...state.trash };
        delete trash[id];
        set({ trash, slides: { ...state.slides, [id]: { ...read, saved: read.slide, savedText: text, hash } } });
        return 'applied';
      }
      // Our version came back (someone put it back): the notice about losing it is settled.
      const settled = state.kept.filter((item) => !(item.reason === 'overwritten' && item.id === id && item.text === text));
      // A save made at the same moment replaced the one this tab just made: keep ours to bring back.
      const overwritten =
        entry.writtenAt !== undefined && entry.savedText !== null && entry.saved !== null && Date.now() - entry.writtenAt <= OVERWRITE_WINDOW_MS && settled.length === state.kept.length;
      const kept = overwritten ? [{ id, slide: entry.saved!, reason: 'overwritten' as const, at: Date.now(), text: entry.savedText! }, ...settled].slice(0, KEPT_MAX) : settled;
      set({ kept, slides: { ...state.slides, [id]: { ...read, saved: read.slide, savedText: text, hash } } });
      return overwritten ? 'overwritten' : 'applied';
    }
    if (sourceDeck ? !read.held && sameSlide(entry.slide, read.slide) : slideText(entry.slide) === text) {
      set({ slides: { ...state.slides, [id]: { ...entry, saved: entry.slide, savedText: text, hash } } });
      return 'same';
    }
    // Both changed the slide: when they changed different lines of the file both started from, merge by line.
    if (entry.savedText !== null && !read.held) {
      const merged = mergeLines(entry.savedText, slideText(entry.slide, entry), text, { adjacent: 'conflict' });
      if (merged !== null) {
        const theirs = { ...read, saved: read.slide, savedText: text, hash };
        if (merged === text) {
          set({ slides: { ...state.slides, [id]: theirs } });
          return 'merged';
        }
        const mine = readSlide(id, merged, deckFaces(state.index));
        if (!mine.held) {
          // Shown as ours, saved over theirs (their hash is the next write's ifMatch).
          set({ slides: { ...state.slides, [id]: { ...theirs, slide: mine.slide } }, revision: state.revision + 1 });
          return 'merged';
        }
      }
    }
    set({ slides: { ...state.slides, [id]: { ...entry, conflict: { theirsText: text, theirsHash: hash, theirsSlide: read.held ? null : read.slide, reason: 'changed' } } } });
    return 'conflict';
  },

  bringBack(position) {
    const state = get();
    const item = state.kept[position];
    if (!item || !state.slides[item.id]) return;
    state.apply('Bring back your version', { slides: { [item.id]: { ...item.slide, id: item.id } } }, { focus: item.id });
    set({ kept: get().kept.filter((_, i) => i !== position) });
  },

  resolveConflict(id, choice, copyId) {
    const state = get();
    const entry = state.slides[id];
    if (!entry?.conflict) return;
    const { conflict } = entry;
    const slides = { ...state.slides };
    const kept = [...state.kept];
    let index = state.index;
    if (choice === 'mine') {
      // Overwrite theirs: write ours with their hash as ifMatch.
      if (conflict.theirsSlide) kept.unshift({ id, slide: conflict.theirsSlide, reason: 'mine-chosen', at: Date.now() });
      slides[id] = { ...entry, conflict: undefined, saved: conflict.theirsSlide, savedText: conflict.theirsText, hash: conflict.theirsHash };
    } else if (choice === 'theirs' || conflict.theirsText === null) {
      kept.unshift({ id, slide: entry.slide, reason: 'theirs-chosen', at: Date.now() });
      if (conflict.theirsText === null) delete slides[id];
      else {
        const read = readSlide(id, conflict.theirsText, deckFaces(state.index));
        slides[id] = { ...read, saved: read.slide, savedText: conflict.theirsText, hash: conflict.theirsHash };
      }
    } else {
      // Keep theirs in place and add mine as a new slide right after it.
      const newId = copyId!;
      const read = readSlide(id, conflict.theirsText, deckFaces(state.index));
      slides[id] = { ...read, saved: read.slide, savedText: conflict.theirsText, hash: conflict.theirsHash };
      slides[newId] = { slide: { ...entry.slide, id: newId }, saved: null, savedText: null, hash: null, diagnostics: [] };
      const order = resolveOrder(index.order, Object.keys(slides).filter((s) => s !== newId));
      const at = order.indexOf(id);
      index = { ...index, order: [...order.slice(0, at + 1), newId, ...order.slice(at + 1)] };
    }
    // History steps that touch this slide no longer apply.
    const undo = state.undo.filter((step) => !(id in step.slides));
    set({ slides, index, kept: kept.slice(0, KEPT_MAX), undo, redo: [], revision: state.revision + 1 });
  },

  restoreKept(position, newId) {
    const state = get();
    const item = state.kept[position];
    if (!item) return;
    const order = deckOrder(state);
    const at = order.indexOf(item.id);
    const nextOrder = at < 0 ? [...order, newId] : [...order.slice(0, at + 1), newId, ...order.slice(at + 1)];
    state.apply('Restore kept slide', { slides: { [newId]: { ...item.slide, id: newId } }, index: { ...state.index, order: nextOrder } }, { focus: newId });
    set({ kept: get().kept.filter((_, i) => i !== position) });
  },

  dismissKept(position) {
    set({ kept: get().kept.filter((_, i) => i !== position) });
  },
}));

/** Undo or redo one step, warning first when someone else changed what it touches. */
function travel(get: () => DeckState, set: (partial: Partial<DeckState>) => void, direction: 'undo' | 'redo'): UndoOutcome {
  const state = get();
  if (state.readOnly) return { done: false };
  const stack = direction === 'undo' ? state.undo : state.redo;
  const step = stack[stack.length - 1];
  if (!step) return { done: false };
  const expect = (side: { before: Slide | null; after: Slide | null }): Slide | null => (direction === 'undo' ? side.after : side.before);
  const target = (side: { before: Slide | null; after: Slide | null }): Slide | null => (direction === 'undo' ? side.before : side.after);

  // Changed elsewhere since this step?
  const changedSlides = Object.entries(step.slides).filter(([id, side]) => (state.slides[id]?.slide ?? null) !== expect(side) || state.slides[id]?.held);
  const orderChanged = step.index !== undefined && state.index !== (direction === 'undo' ? step.index.after : step.index.before);
  if ((changedSlides.length || orderChanged) && state.undoWarned !== step) {
    set({ undoWarned: step });
    const what = orderChanged ? 'Someone else reordered or changed the deck since this edit.' : 'Someone else changed this slide since this edit.';
    return { done: false, warning: `${what} ${direction === 'undo' ? 'Undo' : 'Redo'} again to apply it anyway.` };
  }

  const slides: Record<string, Slide | null> = {};
  for (const [id, side] of Object.entries(step.slides)) {
    if (state.slides[id]?.held) continue;
    slides[id] = target(side);
  }
  let index: DeckIndex | undefined;
  if (step.index) {
    const wanted = direction === 'undo' ? step.index.before : step.index.after;
    // Keep their other index changes: replay only this step's change onto the current index.
    index = orderChanged ? mergeDeckIndex(direction === 'undo' ? step.index.after : step.index.before, state.index, wanted) : wanted;
  }
  // Apply without recording a new step.
  const nextSlides = { ...state.slides };
  const trash = { ...state.trash };
  for (const [id, slide] of Object.entries(slides)) {
    const current = nextSlides[id];
    if (slide === null) {
      if (current) {
        delete nextSlides[id];
        trash[id] = current;
      }
    } else if (current) nextSlides[id] = { ...current, slide };
    else {
      const restored = trash[id];
      delete trash[id];
      nextSlides[id] = restored ? { ...restored, slide } : { slide, saved: null, savedText: null, hash: null, diagnostics: [] };
    }
  }
  const undo = direction === 'undo' ? state.undo.slice(0, -1) : [...state.undo, step];
  const redo = direction === 'undo' ? [...state.redo, step] : state.redo.slice(0, -1);
  set({ slides: nextSlides, trash, index: index ?? state.index, undo, redo, undoWarned: null, edits: state.edits + 1, revision: state.revision + 1 });
  return { done: true, focus: step.focus ?? Object.keys(step.slides)[0] };
}

/** The serialized index (what a save writes). */
export function indexText(index: DeckIndex): string {
  return serializeDeckIndex(index);
}
