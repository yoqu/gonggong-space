/**
 * Editor commands shared by the toolbar, menus and keyboard: undo/redo and
 * board-level records such as the shared custom ink colors.
 *
 * Undo is installed by the sync service once history exists, so chrome can
 * import these before the board has loaded.
 */

import { MAX_BOARD_INKS, type BoardInk, type HexColor } from '@open-artifact/whiteboard-core';
import { changeBoard } from '../state/board.ts';

/** What undo needs from the history service. */
export interface UndoHandler {
  undo(): void;
  redo(): void;
}

let undoHandler: UndoHandler | null = null;

/** Installs the history behind {@link undo} and {@link redo}; returns an uninstall function. */
export function installUndoHandler(handler: UndoHandler): () => void {
  undoHandler = handler;
  return () => {
    if (undoHandler === handler) undoHandler = null;
  };
}

/** Reverts this person's last change. */
export function undo(): void {
  undoHandler?.undo();
}

/** Re-applies the last undone change. */
export function redo(): void {
  undoHandler?.redo();
}

/** Adds a custom ink color for everyone (oldest drop off past the limit). */
export function addBoardInk(color: HexColor): void {
  const value = color.toLowerCase() as HexColor;
  changeBoard(
    (board) => {
      const inks = board.content.inks ?? [];
      if (inks.some((ink) => ink.color === value)) return board;
      const next: BoardInk[] = [...inks, { color: value, at: Date.now() }].slice(-MAX_BOARD_INKS);
      return { ...board, content: { ...board.content, inks: next } };
    },
    { label: 'Add color' },
  );
}

/** Removes a custom ink color for everyone (what was drawn with it keeps it). */
export function removeBoardInk(color: string): void {
  const value = color.toLowerCase();
  changeBoard(
    (board) => {
      const inks = board.content.inks ?? [];
      if (!inks.some((ink) => ink.color === value)) return board;
      const next = inks.filter((ink) => ink.color !== value);
      const content = { ...board.content };
      if (next.length) content.inks = next;
      else delete content.inks;
      return { ...board, content };
    },
    { label: 'Remove color' },
  );
}
