/**
 * Loading, autosave and changes made elsewhere.
 *
 * - Load: `project/deck.json` and every `project/slides/<id>.html`.
 * - Save: shortly after each local change, one publish batch with `ifMatch`
 *   on every file it writes. A conflict means someone wrote first: their
 *   files are read and merged (the index three-way; a slide we also changed
 *   becomes a per-slide conflict the person resolves) and the save retries.
 * - Remote changes: pushed by the host and merged the same way, live. A slide
 *   being typed into is merged when the typing ends.
 *
 * The timing, retries and deferral are editor-kit's `createProjectSync`; this
 * file says what a deck writes and how its files merge.
 */

import { createProjectSync, readProject, type RemoteFile } from '@open-artifact/editor-kit';
import type { PublishBatch } from '@open-artifact/runtime';
import { DECK_PATH, DECK_STYLESHEET_PATH, parseDeckIndex, slideIdFromPath, slidePath } from '@open-artifact/slides-core';
import { toast } from '@open-artifact/ui';
import { configureDeck, deckOrder, indexText, isDirty, slideNeedsWrite, slideText, useDeck, type SentBatch } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { noteRemoteSlides } from './creation.ts';
import { clearRecovery, saveRecovery } from './recovery.ts';
import { session } from './session.ts';

/** Delay between the last change and the save, ms. */
const SAVE_DELAY = 700;

/** `project/deck.css` as last read (a source deck's shared rules). */
let deckCss: string | null = null;
let deckCssHash: string | null = null;

/** Re-applies the index and sheet to how slides read; re-reads clean slides when that changed. */
function reconfigure(): void {
  const state = useDeck.getState();
  if (configureDeck(state.index, deckCss, Object.keys(state.slides))) state.rereadSlides();
}

/** One pass of remote changes. */
interface RemoteRun {
  textEdit: ReturnType<typeof useView.getState>['textEdit'];
  conflicts: string[];
  mergedSlides: string[];
  changedSlides: string[];
  merged: number;
}

const sync = createProjectSync<SentBatch, RemoteRun>({
  artifact: () => session().artifact,
  saveDelay: SAVE_DELAY,
  readOnly: () => useDeck.getState().readOnly,
  isDirty: () => isDirty(useDeck.getState()),
  save: () => useDeck.getState().save,
  setSave: (save) => useDeck.getState().setSave(save),
  collect,
  acknowledge(sent, published) {
    const hashes: Record<string, string | null> = { ...published };
    // Unchanged slides keep their hash.
    for (const [id] of Object.entries(sent.slides)) {
      if (!(slidePath(id) in hashes)) hashes[slidePath(id)] = useDeck.getState().slides[id]?.hash ?? null;
    }
    useDeck.getState().acknowledge(sent, hashes);
  },
  unsent(sent) {
    // Same bytes as the files: just mark them saved.
    if (Object.keys(sent.slides).length) useDeck.getState().acknowledge(sent, {});
  },
  saved: () => clearRecovery(),
  lostWriteAccess() {
    useDeck.setState({ readOnly: true, save: 'readonly' });
    toast.add({ title: 'You can no longer edit this deck', description: 'Your changes since the last save are kept in this browser for 3 days.' });
    saveRecovery(true);
  },
  remote: {
    begin: () => ({ textEdit: useView.getState().textEdit, conflicts: [], mergedSlides: [], changedSlides: [], merged: 0 }),
    file: remoteFile,
    end: remoteDone,
  },
  watchChanges(changed) {
    useDeck.subscribe((state, previous) => {
      if (state.revision !== previous.revision) {
        changed();
        saveRecovery();
      }
    });
  },
  watchTextEdit(ended) {
    useView.subscribe((state, previous) => {
      if (previous.textEdit && !state.textEdit) ended();
    });
  },
  beforeUnload: () => saveRecovery(true),
});

/** Loads the deck into the document store; `readOnly` keeps it from writing even when the viewer may edit. */
export async function loadDeck(options: { readOnly?: boolean } = {}): Promise<void> {
  const { artifact, canEdit } = session();
  const readOnly = options.readOnly || !canEdit;
  const store = useDeck.getState();
  try {
    const { title, files, items: slides } = await readProject(artifact, { files: [DECK_PATH, DECK_STYLESHEET_PATH], item: slideIdFromPath });
    const index = files[DECK_PATH];
    const css = files[DECK_STYLESHEET_PATH];
    deckCss = css?.text ?? null;
    deckCssHash = css?.hash ?? null;
    // Slides read through the sheet and at the deck's size from the start.
    if (index) configureDeck(parseDeckIndex(index.text).index, deckCss, Object.keys(slides));
    store.load({ title, readOnly, index: { text: index?.text ?? null, hash: index?.hash ?? null }, slides });
  } catch (error) {
    store.fail(error instanceof Error ? error.message : String(error));
    return;
  }
  sync.start();
  if (isDirty(useDeck.getState())) schedule();
}

/** Schedules a save. */
export function schedule(delay = SAVE_DELAY): void {
  sync.schedule(delay);
}

/** Saves now (coalescing with a save already running). */
export function flush(): Promise<void> {
  return sync.flush();
}

/** Retries a failed save now (the "click to retry" of the save badge). */
export function retryNow(): void {
  sync.retryNow();
}

/**
 * Applies changes made elsewhere. `changes` maps artifact paths to their new
 * hash (`null`: deleted). Changes we already have are skipped.
 */
export function applyRemote(changes: Record<string, string | null>, options: { force?: boolean } = {}): Promise<void> {
  return sync.applyRemote(changes, options);
}

/** Builds the next publish batch from the store. */
function collect(): { batch: PublishBatch; sent: SentBatch } {
  const state = useDeck.getState();
  const batch: PublishBatch = {};
  const sent: SentBatch = { index: null, slides: {}, deleted: [] };
  if (state.index !== state.indexSaved && !state.indexError) {
    const text = indexText(state.index);
    batch[DECK_PATH] = { content: text, ifMatch: state.indexHash };
    sent.index = { index: state.index, text };
  }
  for (const [id, entry] of Object.entries(state.slides)) {
    if (!slideNeedsWrite(entry)) continue;
    const text = slideText(entry.slide, entry);
    if (text === entry.savedText) {
      // Same bytes as the file: nothing to send, just mark it saved.
      sent.slides[id] = { slide: entry.slide, text };
      continue;
    }
    batch[slidePath(id)] = { content: text, ifMatch: entry.hash };
    sent.slides[id] = { slide: entry.slide, text };
  }
  for (const [id, entry] of Object.entries(state.trash)) {
    if (entry.hash === null || state.slides[id]) continue;
    batch[slidePath(id)] = null;
    sent.deleted.push(id);
  }
  return { batch, sent };
}

/** How one changed file of the deck is taken. */
function remoteFile(path: string, hash: string | null, run: RemoteRun): RemoteFile | undefined {
  const state = useDeck.getState();
  if (path === DECK_PATH) {
    const wasDirty = state.index !== state.indexSaved;
    return {
      hash: state.indexHash,
      apply(text, hash) {
        useDeck.getState().remoteIndex(text, hash);
        reconfigure();
        if (wasDirty) run.merged++;
      },
    };
  }
  if (path === DECK_STYLESHEET_PATH) {
    // Never written here, so never forced: a known hash is always skipped.
    if (hash === deckCssHash) return undefined;
    return {
      hash: undefined,
      apply(text, hash) {
        deckCss = text;
        deckCssHash = hash;
        reconfigure();
      },
    };
  }
  const id = slideIdFromPath(path);
  if (!id) return undefined;
  const entry = state.slides[id] ?? state.trash[id];
  return {
    hash: entry?.hash,
    held: run.textEdit?.slideId === id,
    apply(text, hash) {
      const outcome = useDeck.getState().remoteSlide(id, text, text === null ? null : hash);
      if (outcome === 'conflict') run.conflicts.push(id);
      else if (outcome === 'merged') run.mergedSlides.push(id);
      if (outcome !== 'same' && outcome !== 'conflict') run.changedSlides.push(id);
    },
  };
}

/** After a pass of remote changes: follow the stage and tell the person. */
function remoteDone({ conflicts, mergedSlides, changedSlides, merged }: RemoteRun): void {
  if (changedSlides.length) noteRemoteSlides(changedSlides);
  // A slide on stage that vanished: show its neighbour.
  const view = useView.getState();
  const slides = useDeck.getState().slides;
  if (view.current && !slides[view.current]) {
    const order = Object.keys(slides);
    view.showSlide(order[0] ?? null);
  }
  if (conflicts.length) {
    toast.add({
      title: conflicts.length === 1 ? 'This slide was changed by someone else' : `${conflicts.length} slides were changed by someone else`,
      description: 'Choose which version to keep in the banner above the slide.',
    });
  } else if (mergedSlides.length) {
    const order = deckOrder(useDeck.getState());
    const numbers = mergedSlides.map((id) => order.indexOf(id) + 1).filter((n) => n > 0).sort((a, b) => a - b);
    toast.add({
      title: numbers.length === 1 ? `Merged changes made elsewhere into slide ${numbers[0]}` : `Merged changes made elsewhere into ${numbers.length} slides`,
      description: 'You and someone else changed different lines, so both changes were kept.',
    });
  } else if (merged) {
    toast.add({ title: 'Merged with a newer version of the deck' });
  }
}
