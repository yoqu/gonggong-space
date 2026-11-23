/**
 * A past version of a board, from the host's version history: the history
 * names every document `db/<collection>/<doc>` (beside `project/…` files)
 * and stores its data as JSON text. This decodes such a version into a
 * normalized board for a read-only preview, and works out what restoring
 * some of its elements onto the current board changes.
 */

import { BOARD_COLLECTIONS, composeBoard, elementIdOfPath, type DocumentValue } from './codec.ts';
import { applyBoardDiff, diffBoardContents } from './history/board-diff.ts';
import { parseBoardContent } from './normalize.ts';
import type { Board, BoardContent, ElementId } from './schema.ts';

/** The prefix of a document path in the version history. */
export const HISTORY_DOC_PREFIX = 'db/';

/** The board document of a history path (`db/elements/x` → `elements/x`), else `undefined`. */
export function boardDocOfHistoryPath(path: string): string | undefined {
  if (!path.startsWith(HISTORY_DOC_PREFIX)) return undefined;
  const doc = path.slice(HISTORY_DOC_PREFIX.length);
  const collection = doc.slice(0, doc.indexOf('/'));
  return (BOARD_COLLECTIONS as readonly string[]).includes(collection) ? doc : undefined;
}

/** The history paths of a version that hold the board (element, meta, inks, timer documents). */
export function boardHistoryPaths(paths: Iterable<string>): string[] {
  return [...paths].filter((path) => boardDocOfHistoryPath(path) !== undefined);
}

/** How a history path reads in the version list: `Element abc123`, `Board title and order`, … */
export function formatBoardHistoryPath(path: string): string {
  const doc = boardDocOfHistoryPath(path);
  if (doc === undefined) return path.replace(/^(project|db)\//, '');
  const id = elementIdOfPath(doc);
  if (id !== undefined) return `Element ${id}`;
  if (doc === 'board/meta') return 'Board title and order';
  if (doc === 'board/inks') return 'Recent colors';
  if (doc === 'board/timer') return 'Timer';
  return doc;
}

/**
 * Decodes a version's documents (history path → JSON text) into a board.
 * Text that is not a JSON object is skipped, as are paths that are not
 * board documents; live state (claims, timer) is left out of the preview.
 */
export function boardFromHistoryFiles(files: Iterable<readonly [string, string]>): Board {
  const documents = new Map<string, DocumentValue>();
  for (const [path, text] of files) {
    const doc = boardDocOfHistoryPath(path);
    if (doc === undefined || doc.startsWith('board/claim-') || doc === 'board/timer') continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) documents.set(doc, value as DocumentValue);
  }
  const composed = composeBoard(documents);
  const content = parseBoardContent(composed.content);
  return { title: composed.title, content: { ...content, claimed: [] } };
}

/**
 * The current content with `ids` as they were in `past`: changed ones get
 * their past fields back, deleted ones return in their old drawing place,
 * ids added since are removed. Returns `current` when nothing differs.
 */
export function restoreElementsFrom(current: BoardContent, past: BoardContent, ids: Iterable<ElementId>): BoardContent {
  const diff = diffBoardContents(current, past, ids);
  return diff ? applyBoardDiff(current, diff, 'forward', true) : current;
}
