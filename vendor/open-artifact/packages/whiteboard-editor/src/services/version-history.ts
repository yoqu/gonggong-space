/**
 * Version history of the board: the host's `history` capability, the
 * panel's open state, a read-only preview of a past version, and restores.
 *
 * The history keeps the board's documents (`db/elements/<id>`,
 * `db/board/meta`, `db/board/inks`); a preview reads a version's documents
 * and decodes them with the board codec, then paints them like an export.
 * Restoring the whole version goes through the host, which writes the
 * documents like any other write (sync merges them in). Restoring some
 * elements is a board change of this page: one undo step, synced as usual.
 *
 * In a Shell, the Shell draws the history button (the page reports
 * `history: true` and answers `{cmd:'history'}`); outside one, the zoom
 * menu has the entry.
 */

import { toast } from '@open-artifact/ui';
import { boardFromHistoryFiles, boardHistoryPaths, restoreElementsFrom, type Board, type ElementId } from '@open-artifact/whiteboard-core';
import type { HistoryCapability } from '@open-artifact/runtime';
import { create } from 'zustand';
import { changeBoard } from '../state/board.ts';
import { maybeSession } from './session.ts';
import { readVersionFiles, wireVersionHistory } from '@open-artifact/editor-kit';
import { onShellCommand, setShellReport } from './shell.ts';

/** A version loaded for preview. */
export interface VersionPreview {
  n: number;
  board: Board;
}

interface VersionHistoryState {
  /** The host keeps a history of this board. */
  available: boolean;
  /** The panel is open. */
  open: boolean;
  /** The version previewed (`null`: the current board). */
  previewing: number | null;
  preview: VersionPreview | null;
  loading: boolean;
  error: string | null;
  /** This viewer may restore (owner or editor). */
  canRestore: boolean;
  /** Elements picked in the preview, to restore on their own. */
  picked: readonly ElementId[];
}

export const useVersionHistory = create<VersionHistoryState>()(() => ({
  available: false,
  open: false,
  previewing: null,
  preview: null,
  loading: false,
  error: null,
  canRestore: false,
  picked: [],
}));

/** How many documents a preview reads at once. */
const READ_WORKERS = 12;

/** Bumped per preview request, so a slow answer never replaces a newer one. */
let request = 0;

/** The history capability, when the host keeps one. */
export function historyCapability(): HistoryCapability | null {
  return maybeSession()?.history ?? null;
}

/** Opens or closes the panel (closing ends a preview). */
export function toggleVersionHistory(open?: boolean): void {
  const state = useVersionHistory.getState();
  if (!state.available) return;
  const next = open ?? !state.open;
  if (next === state.open) return;
  if (next) useVersionHistory.setState({ open: true });
  else {
    request++;
    useVersionHistory.setState({ open: false, previewing: null, preview: null, loading: false, error: null, picked: [] });
  }
}

/** Reads every board document of version `n` and decodes the board. */
export async function readVersionBoard(history: Pick<HistoryCapability, 'files' | 'read'>, n: number): Promise<Board> {
  return boardFromHistoryFiles(await readVersionFiles(history, n, boardHistoryPaths, READ_WORKERS));
}

/** Shows version `n` read-only (`null`: back to the current board). */
export async function previewVersion(n: number | null): Promise<void> {
  const id = ++request;
  const history = historyCapability();
  if (n === null || !history) {
    useVersionHistory.setState({ previewing: null, preview: null, loading: false, error: null, picked: [] });
    return;
  }
  useVersionHistory.setState({ previewing: n, loading: true, error: null, picked: [] });
  try {
    const board = await readVersionBoard(history, n);
    if (id !== request) return;
    useVersionHistory.setState({ preview: { n, board }, loading: false });
  } catch (error) {
    if (id !== request) return;
    useVersionHistory.setState({ preview: null, loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Picks or unpicks an element of the preview. */
export function togglePicked(id: ElementId): void {
  const { picked } = useVersionHistory.getState();
  useVersionHistory.setState({ picked: picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id] });
}

/** Restores the whole version through the host. */
export async function restoreVersion(n: number): Promise<void> {
  const history = historyCapability();
  if (!history || !useVersionHistory.getState().canRestore) return;
  try {
    const result = await history.restore(n);
    toast.add({ title: result.changed.length ? `Restored version ${n}` : `The board already matches version ${n}` });
    await previewVersion(null);
  } catch (error) {
    toast.add({ title: 'The version could not be restored', description: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Brings the picked elements back as the previewed version had them: one
 * undoable change of the board. Returns how many elements changed.
 */
export function restorePickedElements(): number {
  const { preview, picked, canRestore } = useVersionHistory.getState();
  if (!preview || picked.length === 0 || !canRestore || !(maybeSession()?.canEdit ?? false)) return 0;
  let count = 0;
  const changed = changeBoard(
    (board) => {
      const content = restoreElementsFrom(board.content, preview.board.content, picked);
      if (content === board.content) return board;
      const before = new Map(board.content.elements.map((element) => [element.id, element]));
      count = picked.filter((id) => before.get(id) !== content.elements.find((element) => element.id === id)).length;
      return { ...board, content };
    },
    { label: `Restore from version ${preview.n}` },
  );
  toast.add({
    title: changed ? `Restored ${count === 1 ? 'an element' : `${count} elements`} from version ${preview.n}` : `Already as in version ${preview.n}`,
  });
  if (changed) useVersionHistory.setState({ picked: [] });
  return changed ? count : 0;
}

/**
 * Finds the history, reports it to the Shell and answers its `history`
 * command. Returns a stop function.
 */
export function startVersionHistory(): () => void {
  const history = historyCapability();
  if (!history) return () => {};
  useVersionHistory.setState({ available: true });
  const stop = wireVersionHistory({
    history,
    roleMayRestore: maybeSession()?.canRestore ?? false,
    report: setShellReport,
    onCommand: onShellCommand,
    toggle: () => toggleVersionHistory(),
    setCanRestore: (canRestore) => useVersionHistory.setState({ canRestore }),
  });
  return () => {
    stop();
    useVersionHistory.setState({ available: false, open: false, previewing: null, preview: null, picked: [] });
  };
}
