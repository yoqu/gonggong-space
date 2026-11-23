/**
 * Ideas: suggestions the agent leaves for one person.
 *
 * The agent saves an idea in the person's own document
 * (`data/users/<viewer id>/idea`): what it says, the elements it is about
 * and up to four options, each a set of edits. The board shows a mark near
 * those elements; its menu previews an option on hover (outlines of what
 * it would add, change or remove), applies it on click (one undo step) and
 * takes it off again on a second click. The idea goes away when cleared,
 * and the saved document is deleted once the idea was shown and settled
 * (or after half an hour), by the core reader.
 *
 * Everything in an idea is untrusted: its text renders as plain text, and
 * its edits go through the board's normalizer before reaching the board.
 */

import { create } from 'zustand';
import { agentResultMessage } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { createIdeaStore, watchSavedIdea, type Idea, type SyncTransport } from '@open-artifact/whiteboard-core';
import { sendToAgent, useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { changeElements, useBoard } from '../state/board.ts';
import { onAskSent } from './asks.ts';
import { applyIdeaVersion, conflictingIdeaOptions, restoreIdeaVersion, type IdeaRestore } from './idea-edits.ts';

interface IdeaState {
  /** The idea shown, if any. */
  idea: Idea | undefined;
  /** The idea's menu is open. */
  menuOpen: boolean;
  /** The option whose preview shows (hovered or focused). */
  hover: number | null;
  /** Options applied, by index, with what undoes each. */
  applied: ReadonlyMap<number, IdeaRestore>;
  setMenuOpen(open: boolean): void;
  setHover(index: number | null): void;
}

/** The idea shown and its menu. */
export const useIdea = create<IdeaState>()((set) => ({
  idea: undefined,
  menuOpen: false,
  hover: null,
  applied: new Map(),
  setMenuOpen(menuOpen) {
    set(menuOpen ? { menuOpen } : { menuOpen, hover: null });
  },
  setHover(hover) {
    set({ hover });
  },
}));

let store: ReturnType<typeof createIdeaStore> | null = null;

/** Takes an applied option off the board; false when it was not applied. */
function unapply(index: number): boolean {
  const restore = useIdea.getState().applied.get(index);
  if (!restore) return false;
  let kept = 0;
  changeElements(
    (elements) => {
      const result = restoreIdeaVersion(elements, restore);
      kept = result.kept;
      return result.elements;
    },
    { label: 'Undo idea' },
  );
  const applied = new Map(useIdea.getState().applied);
  applied.delete(index);
  useIdea.setState({ applied });
  if (kept > 0) toast.add({ title: 'Some changes were kept', description: 'They were edited after the idea was applied.' });
  return true;
}

/**
 * Applies an option, or takes it off when it is applied. Options touching
 * the same elements exclude each other: applying one takes the others off.
 */
export function toggleIdeaOption(index: number): void {
  const { idea, applied } = useIdea.getState();
  const option = idea?.options[index];
  if (!idea || !option?.version || !(maybeSession()?.canEdit ?? false)) return;
  if (applied.has(index)) {
    unapply(index);
    return;
  }
  const versions = idea.options.map((other) => other.version);
  for (const other of conflictingIdeaOptions(versions, index)) unapply(other);
  const version = option.version;
  let restore: IdeaRestore | undefined;
  let skipped = 0;
  let done = 0;
  changeElements(
    (elements) => {
      const result = applyIdeaVersion(elements, version, idea.read ?? []);
      restore = result.restore;
      skipped = result.skipped;
      done = result.applied;
      return result.elements;
    },
    { label: 'Apply idea' },
  );
  if (restore && done > 0) {
    const next = new Map(useIdea.getState().applied);
    next.set(index, restore);
    useIdea.setState({ applied: next });
  }
  if (done === 0) toast.add({ title: 'This idea no longer fits the board', description: 'What it was about changed since.' });
  else if (skipped > 0) toast.add({ title: `${skipped} ${skipped === 1 ? 'change was' : 'changes were'} skipped`, description: 'Those parts of the board changed since the idea was made.' });
}

/**
 * Makes an option that needs another agent turn: applies its version (which
 * places a stand-in on the board) and sends the agent the fixed "make it"
 * request, naming the stand-in so the result replaces it.
 */
export async function makeIdeaOption(index: number): Promise<void> {
  const option = useIdea.getState().idea?.options[index];
  const later = option?.later;
  if (!option || !later) return;
  if (!useIdea.getState().applied.has(index)) toggleIdeaOption(index);
  const standIn = useIdea.getState().applied.get(index)?.created[0];
  const at = standIn && 'x' in standIn && 'y' in standIn ? { x: Math.round(Number(standIn.x)), y: Math.round(Number(standIn.y)) } : undefined;
  const result = await sendToAgent({
    text: later.request,
    title: 'Make an idea',
    context: { action: 'make', label: option.label, note: later.note, ...(standIn ? { box: standIn.id } : {}), ...(at ? { at } : {}) },
  });
  if (result.status === 'failed') toast.add({ title: 'Could not reach the agent', description: result.reason ?? '' });
  else toast.add(agentResultMessage(result, 'this board', useAgent.getState()));
  if (result.status !== 'failed') clearIdea();
}

/** Dismisses the idea (applied options stay on the board). */
export function clearIdea(): void {
  useIdea.setState({ menuOpen: false, hover: null });
  store?.settle();
}

/** Starts showing saved ideas; returns a function that stops. */
export function startIdeas(): () => void {
  const session = maybeSession();
  if (!session) return () => {};
  const db = session.db;
  const ideas = createIdeaStore({ versions: { agentAuthor: 'agent' } });
  store = ideas;
  const offIdeas = ideas.subscribe(() => {
    const idea = ideas.now();
    const previous = useIdea.getState().idea;
    if (idea === previous) return;
    if (idea?.serial !== previous?.serial) useIdea.setState({ idea, applied: new Map(), hover: null, menuOpen: false });
    else useIdea.setState({ idea });
  });
  const transport: SyncTransport = {
    get: (path) => db.get(path),
    list: (collection) => db.list(collection),
    // The reader only deletes the person's own idea document.
    write: (writes) => db.write(writes as Parameters<typeof db.write>[0]),
    onChange: (listener) => db.onChange(listener),
  };
  const watch = watchSavedIdea({
    transport,
    userId: session.viewer.id,
    ideas,
    held: () => useAgent.getState().busy || useIdea.getState().menuOpen,
    ready: () => useBoard.getState().status === 'ready',
    seen: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  });
  const offAgent = useAgent.subscribe((state, previous) => {
    if (previous.busy && !state.busy) watch.look();
  });
  const offMenu = useIdea.subscribe((state, previous) => {
    if (previous.menuOpen && !state.menuOpen) watch.look();
  });
  const offBoard = useBoard.subscribe((state, previous) => {
    if (state.status === 'ready' && previous.status !== 'ready') watch.look();
  });
  const offAsk = onAskSent(() => watch.reread());
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') watch.shown();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    offIdeas();
    offAgent();
    offMenu();
    offBoard();
    offAsk();
    document.removeEventListener('visibilitychange', onVisibility);
    watch.dispose();
    if (store === ideas) store = null;
    useIdea.setState({ idea: undefined, menuOpen: false, hover: null, applied: new Map() });
  };
}
