/**
 * Downloads of the whole board: a PNG picture and the board file (JSON).
 *
 * The Shell's Share panel lists these formats in its Export tab. The board
 * reports availability and progress, and saves the requested file through
 * the host's downloads capability or a browser download.
 */

import { saveFile as saveKit } from '@open-artifact/editor-kit';
import type { ColorScheme } from '@open-artifact/whiteboard-core';
import { boardPngFilename, EXPORT_MAX_PX, exportFrameFor } from '../export/frame.ts';
import { exportBoardFile } from '../export/board-file.ts';
import { exportBoardPng } from '../export/png.ts';
import { useBoard } from '../state/board.ts';
import { currentMeasures } from '../state/measures.ts';
import { usePresence } from '../state/presence.ts';
import { useTheme } from '../state/theme.ts';
import { paintLooksForExport } from './drawing-looks.ts';
import { maybeSession } from './session.ts';
import { onShellCommand, setShellReport } from './shell.ts';

/** Hosts cap a single download at 16 MB. */
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;
/** Smallest longest edge a picture shrinks to when it is over the download cap. */
const MIN_RETRY_PX = 512;
/** How long a plain download's object URL is kept, ms. */
const OBJECT_URL_LIFETIME_MS = 30_000;

/** The formats this board exports. */
type ExportFormat = 'png' | 'json';

/** Options of {@link renderBoardPng}. */
export interface RenderBoardPngOptions {
  /** Color scheme of the picture (default: the board's current one). */
  scheme?: ColorScheme;
  /** Draw note authors and face sticker colors and initials (default: yes). */
  showAuthors?: boolean;
  /** Longest edge, pixels (default 4096). */
  maxPx?: number;
  /** Largest file; bigger pictures are drawn again smaller (default 16 MB). */
  maxBytes?: number;
}

/** An export is running (one at a time). */
let busy = false;

/** True when the board has nothing to export. */
function boardIsEmpty(): boolean {
  return useBoard.getState().board.content.elements.length === 0;
}

/**
 * Display names by person id, for face sticker initials: note authors,
 * people on the board now, and the viewer.
 */
export function faceNameResolver(): (personId: string) => string | undefined {
  const names = new Map<string, string>();
  for (const element of useBoard.getState().board.content.elements)
    if (element.type === 'note' && element.authorId !== undefined && element.author !== undefined) names.set(element.authorId, element.author);
  for (const peer of usePresence.getState().peers.values()) names.set(peer.id, peer.name);
  const session = maybeSession();
  if (session) {
    names.set(session.viewer.id, session.viewer.name);
    names.set(session.peerId, session.viewer.name);
  }
  return (personId) => names.get(personId);
}

/**
 * Renders the whole board as a PNG in the board's current color scheme;
 * `undefined` for an empty board. Drawings in textured looks are painted
 * first (`paintLooksForExport`; those that take too long draw as written). A
 * picture over `maxBytes` is drawn again at three quarters the size until
 * it fits (or gets small).
 */
export async function renderBoardPng(options: RenderBoardPngOptions = {}): Promise<Blob | undefined> {
  const { board } = useBoard.getState();
  if (board.content.elements.length === 0) return undefined;
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const input = {
    elements: board.content.elements,
    title: board.title,
    measures: currentMeasures(),
    scheme: options.scheme ?? useTheme.getState().scheme,
    showAuthors: options.showAuthors ?? true,
    faceName: faceNameResolver(),
  };
  const frame = exportFrameFor(input.elements, input.measures, options.maxPx ?? EXPORT_MAX_PX);
  const painted = await paintLooksForExport(input.elements, input.scheme, frame?.scale ?? 1);
  try {
    let maxPx = options.maxPx;
    for (;;) {
      const { blob } = await exportBoardPng({ ...input, looks: painted.looks, ...(maxPx !== undefined ? { maxPx } : {}) });
      const next = Math.floor((maxPx ?? 4096) * 0.75);
      if (blob.size <= maxBytes || next < MIN_RETRY_PX) return blob;
      maxPx = next;
    }
  } finally {
    painted.release();
  }
}

/** Builds a format's file: its name and bytes; `undefined` for an empty board. */
async function produce(format: ExportFormat): Promise<{ name: string; data: Blob } | undefined> {
  const { board } = useBoard.getState();
  if (board.content.elements.length === 0) return undefined;
  if (format === 'png') {
    const data = await renderBoardPng();
    return data ? { name: boardPngFilename(board.title), data } : undefined;
  }
  const { name, data } = await exportBoardFile({ board, measures: currentMeasures() });
  return { name, data };
}

/** Runs a Shell `export_format` request, reporting each step back to the Shell. */
async function runShellExport(request: string, format: string, variant: string | undefined): Promise<void> {
  const shell = maybeSession()?.shell;
  if (!shell) return;
  if ((format !== 'png' && format !== 'json') || variant !== undefined || boardIsEmpty()) {
    // Unknown formats, variants and the formats disabled on an empty board.
    shell.exportState(request, 'unsupported');
    return;
  }
  if (busy) {
    shell.exportState(request, 'busy');
    return;
  }
  busy = true;
  shell.exportState(request, 'started');
  try {
    const file = await produce(format);
    if (!file) {
      shell.exportState(request, 'declined', 'The board is empty.');
      return;
    }
    await saveKit(maybeSession()?.downloads, file.name, file.data, OBJECT_URL_LIFETIME_MS);
    shell.exportState(request, 'done');
  } catch (error) {
    shell.exportState(request, 'failed', error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
  }
}

/** Reports the export formats to the Shell, disabled while the board is empty. */
function reportFormats(): void {
  const empty = boardIsEmpty();
  const state = empty ? { disabled: true, why: 'other' as const } : {};
  setShellReport({
    formats: [
      { format: 'png', label: 'PNG image', ...state },
      { format: 'json', label: 'Board file', ...state },
    ],
    exports: false,
    hasContent: !empty,
  });
}

/**
 * Offers the board's exports to the Shell: reports the formats (again
 * whenever the board becomes empty or not) and answers `export_format`
 * requests. Returns a stop function.
 */
export function startExport(): () => void {
  reportFormats();
  const unsubscribe = useBoard.subscribe((state, previous) => {
    if ((state.board.content.elements.length === 0) !== (previous.board.content.elements.length === 0)) reportFormats();
  });
  const stopCommands = onShellCommand((command) => {
    if (command.cmd === 'export_format') void runShellExport(command.request, command.format, command.variant);
  });
  return () => {
    unsubscribe();
    stopCommands();
    setShellReport({ formats: undefined, exports: undefined, hasContent: undefined });
  };
}
