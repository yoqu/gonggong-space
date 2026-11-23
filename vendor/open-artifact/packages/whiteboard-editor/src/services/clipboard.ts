/**
 * The board clipboard. {@link installClipboard} handles the page's copy,
 * cut and paste events:
 *
 * - Copy and cut write the selection (with what moves along) as plain text
 *   and as HTML carrying the elements, so another board can paste them.
 * - Paste of board elements lands them at the pointer (or the middle of the
 *   view), stepped off anything already there.
 * - Pasted text becomes a block, tab-separated text a table, an artifact
 *   address a link card, and a web address on a selected picture its link.
 * - Pasted picture and video files go to the file importer.
 *
 * Nothing happens while text is being typed or page text is selected; the
 * browser's own clipboard behavior applies there. Menu commands use
 * {@link copySelectionCommand} and {@link pasteFromMenu}, since a menu
 * cannot read the system clipboard.
 */

import {
  BOARD_CLIPBOARD_KIND,
  MAX_ELEMENT_SIZE,
  TABLE_LIMITS,
  TEXT_CUT_NOTICE,
  artifactClipboardHtml,
  arrowNeedsEndsMessage,
  boardClipboardCopy,
  boardClipboardPayload,
  clampElementText,
  clipboardTextIsFileNames,
  createElementId,
  elementLayoutBox,
  elementsMovingTogether,
  findFreePasteOffset,
  fittedBoxPatch,
  isElementLocked,
  isPastingCutItems,
  isUploadedBlobSource,
  linkCardFromPaste,
  normalizeHttpUrl,
  parseArtifactClipboardHtml,
  pasteElements,
  pastePlacementOffset,
  readBoardClipboardElements,
  selectionAsPlainText,
  stickersForPaste,
  tableFromPaste,
  topLevelSelectedIds,
  wouldExceedElementLimit,
  type BoardClipboardCopy,
  type BoardElement,
  type ElementId,
  type ShapeElement,
} from '@open-artifact/whiteboard-core';
import { screenToBoard, visibleRect, type Point } from '../lib/camera.ts';
import { isBoardMediaFile } from '../lib/media.ts';
import { modKey } from '../lib/tools.ts';
import { resolveAssetUrl } from '../elements/links.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { addElements, boardElements, canEditBoard, deleteIds, editContent, ensureEditable, selectedElements, selectedIds, setImageLink, viewerAuthor } from './actions.ts';
import { BOARD_FULL_MESSAGE, CUT_MESSAGE, LOCK_MESSAGES, NOTHING_SELECTED_MESSAGE, addedMessage, announce, notify, pastedMessage, refuse } from './announce.ts';
import { revealElements, viewCenter } from './navigation.ts';
import { isChromePopupTarget, isTypingTarget } from './keyboard.ts';

/* ------------------------------------------------------------------------ */
/* Messages                                                                 */
/* ------------------------------------------------------------------------ */

/** Refusals of a pasted table over a limit. */
export const TABLE_PASTE_MESSAGES = {
  cells:
    'A table holds at most ' + TABLE_LIMITS.cells.toLocaleString('en-US') + ' cells, so nothing was pasted. Paste it in parts, as several tables.',
  bytes: 'That is more than one table can hold, so nothing was pasted. Paste it in parts, as several tables.',
} as const;

/** Why the menu's Paste cannot run: it only has what was copied here. */
export const INTERNAL_PASTE_ONLY_MESSAGE = 'This menu can only paste right after you copy or cut here.';

/** Said when the menu's Copy or Cut could not reach the clipboard. */
export function clipboardCommandFailedMessage(kind: 'copy' | 'cut'): string {
  return kind === 'cut' ? 'That could not be cut. Press ' + modKey() + 'X instead.' : 'That could not be copied. Press ' + modKey() + 'C instead.';
}

/** The notice for pictures left out of a paste because they live in another board's store. */
export function leftOutMessage(count: number, videos: number): string {
  const noun = videos === 0 ? 'image' : videos === count ? 'video' : 'item';
  return count === 1
    ? 'One ' + noun + ' was left out. It lives in another board’s asset store.'
    : String(count) + ' ' + noun + 's were left out. They live in another board’s asset store.';
}

/* ------------------------------------------------------------------------ */
/* Pure helpers                                                             */
/* ------------------------------------------------------------------------ */

/** The step pasted items move by to stay clear of each other: 24 screen pixels, at least 24 board units. */
export function pasteStep(zoom: number): number {
  return Math.max(24, Math.round(24 / zoom));
}

/** Width of the block pasted text becomes. */
export const PASTED_TEXT_WIDTH = 280;

/**
 * The block pasted text becomes: a white rounded shape 280 wide, tall
 * enough for about 30 characters a line, centered on `center`, its text
 * capped like any element's (compare with the input to see whether it was cut).
 */
export function pastedTextShape(text: string, center: Point, id: ElementId = createElementId()): ShapeElement {
  const clamped = clampElementText(text);
  const lines = clamped.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 30)), 0);
  const w = PASTED_TEXT_WIDTH;
  const h = Math.min(MAX_ELEMENT_SIZE, Math.max(96, lines * 24 + 40));
  const shape: ShapeElement = { type: 'shape', id, kind: 'rounded', x: center.x - w / 2, y: center.y - h / 2, w, h, color: 'white', size: 'body', text: clamped };
  return { ...shape, ...fittedBoxPatch(shape) };
}

/** True when pasted text is a single web address (the kind a picture can link to). */
export function isWebAddress(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** What a paste event holds, as the board reads it. */
export type PasteKind = 'board' | 'files' | 'text' | 'none';

/**
 * Decides what a paste is: board elements (a payload in the HTML), files
 * (media files whose names are all the text says), text, or nothing.
 */
export function classifyPaste(input: { html: string; text: string; files: readonly { name: string; type: string }[] }): PasteKind {
  const payload = input.html === '' ? undefined : parseArtifactClipboardHtml(input.html);
  if (payload?.kind === BOARD_CLIPBOARD_KIND) return 'board';
  const media = input.files.filter(isBoardMediaFile);
  if (media.length > 0 && clipboardTextIsFileNames(input.files, input.text)) return 'files';
  if (input.text !== '') return 'text';
  return media.length > 0 ? 'files' : 'none';
}

/* ------------------------------------------------------------------------ */
/* State                                                                    */
/* ------------------------------------------------------------------------ */

/** The last copy made here, for the menu's Paste and for clipboards that drop the HTML. */
let lastCopy: BoardClipboardCopy | undefined;

/** The ids last cut, so pasting them back is a move (locks and groups kept). */
let cutIds: Set<ElementId> | undefined;

/** True when the menu's Paste has something to paste. */
export function canPasteFromMenu(): boolean {
  return lastCopy !== undefined && lastCopy.data.length > 0;
}

/* ------------------------------------------------------------------------ */
/* Copy and cut                                                             */
/* ------------------------------------------------------------------------ */

/** What copying the selection puts on the clipboard; `undefined` (with a reason when there is one) when nothing can be copied. */
function copyOfSelection(): BoardClipboardCopy | undefined {
  const ids = selectedIds();
  if (ids.size === 0) return undefined;
  const elements = boardElements();
  const copied = elementsMovingTogether(elements, ids, currentMeasures());
  if (copied.length === 0) {
    refuse(arrowNeedsEndsMessage('copy'));
    return undefined;
  }
  return boardClipboardCopy(copied, elements);
}

/** Writes a copy into a clipboard event; `false` when the event carries no clipboard. */
function writeCopy(event: ClipboardEvent, copy: BoardClipboardCopy): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  try {
    data.setData('text/plain', copy.text);
    data.setData('text/html', artifactClipboardHtml(boardClipboardPayload(copy), copy.text));
  } catch {
    return false;
  }
  lastCopy = copy;
  return true;
}

/** Whether the selection may be cut: refuses on a read-only board and when all of it is locked. */
function mayCut(): boolean {
  if (!ensureEditable()) return false;
  const selected = selectedElements();
  if (selected.length === 0) return refuse(NOTHING_SELECTED_MESSAGE);
  if (selected.every(isElementLocked)) return refuse(LOCK_MESSAGES.why);
  return true;
}

/** Removes what was just cut and remembers it, so pasting it back is a move. */
function finishCut(copy: BoardClipboardCopy): void {
  deleteIds(selectedIds(), CUT_MESSAGE);
  cutIds = new Set(copy.data.map((element) => element.id));
}

/**
 * Runs the browser's copy command with a one-shot listener that writes
 * `write` into the event (menus cannot write the clipboard otherwise).
 * Focus returns where it was. `true` when the listener ran and wrote.
 */
function copyThroughCommand(text: string, write: (event: ClipboardEvent) => boolean): boolean {
  if (typeof document === 'undefined') return false;
  let wrote = false;
  const listener = (event: ClipboardEvent): void => {
    event.preventDefault();
    wrote = write(event);
  };
  const active = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text === '' ? ' ' : text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.append(area);
  area.select();
  document.addEventListener('copy', listener, { capture: true, once: true });
  try {
    document.execCommand('copy');
  } catch {
    /* The command is unavailable: reported below. */
  }
  document.removeEventListener('copy', listener, { capture: true });
  area.remove();
  if (active instanceof HTMLElement && active.isConnected) active.focus({ preventScroll: true });
  return wrote;
}

/** The menu's Copy or Cut: puts the selection on the clipboard (and removes it for Cut). */
export function copySelectionCommand(kind: 'copy' | 'cut'): boolean {
  cutIds = undefined;
  if (kind === 'cut' && !mayCut()) return false;
  const copy = copyOfSelection();
  if (!copy) return false;
  if (!copyThroughCommand(copy.text, (event) => writeCopy(event, copy))) return refuse(clipboardCommandFailedMessage(kind));
  if (kind === 'cut') finishCut(copy);
  else announce('Copied');
  return true;
}

/** Copies the selection's words as plain text (texts and labels, link addresses, tables as TSV). */
export function copySelectionAsText(): boolean {
  const selected = selectedElements();
  if (selected.length === 0) return refuse(NOTHING_SELECTED_MESSAGE);
  const text = selectionAsPlainText(selected);
  if (text.trim() === '') return refuse('There is no text to copy');
  const copied = copyThroughCommand(text, (event) => {
    if (!event.clipboardData) return false;
    event.clipboardData.setData('text/plain', text);
    return true;
  });
  if (!copied) return refuse(clipboardCommandFailedMessage('copy'));
  announce('Copied as text');
  return true;
}

/* ------------------------------------------------------------------------ */
/* Paste                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Hands pasted files to the file importer, loaded on first use (it pulls in
 * the toast kit, which the clipboard's pure helpers do not need).
 */
async function insertMediaFiles(files: readonly File[], at?: Point): Promise<void> {
  const { insertFiles } = await import('./files.ts');
  await insertFiles(files, at);
}

/** The board point under the pointer, else the middle of the view. */
function pointerOrCenter(): Point {
  const { camera, pointer } = useCamera.getState();
  return pointer ? screenToBoard(camera, pointer) : viewCenter();
}

/** True when an uploaded source can be fetched from this board's store. */
async function reachable(src: string): Promise<boolean> {
  try {
    const response = await fetch(resolveAssetUrl(src), { credentials: 'same-origin' });
    response.body?.cancel().catch(() => {});
    return response.ok;
  } catch {
    return false;
  }
}

/** Splits pasted items into those this board can show and the pictures whose uploads live elsewhere. */
async function withoutForeignUploads(items: readonly BoardElement[]): Promise<{ kept: BoardElement[]; left: BoardElement[] }> {
  const uploads = items.filter((item) => item.type === 'image' && (isUploadedBlobSource(item.src) || item.video !== undefined));
  if (uploads.length === 0 || typeof fetch === 'undefined') return { kept: [...items], left: [] };
  const checks = await Promise.all(
    uploads.map(async (item) => {
      if (item.type !== 'image') return true;
      const sources = [item.src, item.video].filter((src): src is string => src !== undefined && isUploadedBlobSource(src));
      return (await Promise.all(sources.map(reachable))).every(Boolean);
    }),
  );
  const leftIds = new Set(uploads.filter((_, index) => !checks[index]).map((item) => item.id));
  return { kept: items.filter((item) => !leftIds.has(item.id)), left: items.filter((item) => leftIds.has(item.id)) };
}

/**
 * Pastes board elements centered on `at` (default: the pointer or the
 * middle of the view). `imageFile` is a picture that came along on the
 * clipboard: it is pasted instead when the elements are just that picture
 * from another board.
 */
export async function pasteBoardElements(items: readonly BoardElement[], at?: Point | null, imageFile?: File): Promise<boolean> {
  const cut = cutIds;
  cutIds = undefined;
  if (items.length === 0 || !ensureEditable()) return false;
  const center = at ?? pointerOrCenter();
  const { kept, left } = await withoutForeignUploads(items);
  const leftVideos = left.filter((item) => item.type === 'image' && item.video !== undefined).length;
  if (left.length === 1 && leftVideos === 0 && imageFile !== undefined && kept.every((item) => item.type === 'sticker')) {
    await insertMediaFiles([imageFile], center);
    return true;
  }
  if (left.length > 0) notify(leftOutMessage(left.length, leftVideos));
  if (kept.length === 0) return false;

  const measures = currentMeasures();
  const step = pasteStep(useCamera.getState().camera.zoom);
  const existing = boardElements();
  const placed = pastePlacementOffset(kept, existing, center, step, measures);
  const free = findFreePasteOffset(kept, existing, placed, step, measures);
  let newIds: ElementId[] = [];
  editContent(
    (content) => {
      const asMove = isPastingCutItems(kept, cut, content.elements);
      const result = pasteElements(content, stickersForPaste(kept, cut, content.elements, viewerAuthor().id, measures), free.dx, free.dy, asMove);
      newIds = result.newIds;
      return result.content;
    },
    { label: 'Paste' },
  );
  if (newIds.length === 0) return refuse(BOARD_FULL_MESSAGE);
  const elements = boardElements();
  const top = topLevelSelectedIds(elements, new Set(newIds), measures);
  useSelection.getState().select([...top]);
  announce(pastedMessage(top.size));
  const added = new Set(newIds);
  revealElements(elements.filter((element) => added.has(element.id)));
  return true;
}

/** The menu's Paste: pastes what was last copied or cut here, at `at` (default: the pointer or the view). */
export function pasteFromMenu(at?: Point | null): boolean {
  if (!ensureEditable()) return false;
  if (!lastCopy || lastCopy.data.length === 0) return refuse(INTERNAL_PASTE_ONLY_MESSAGE);
  void pasteBoardElements(lastCopy.data, at);
  return true;
}

/** True when the selected picture is on screen and may take a pasted web link. */
function linkablePicture(): (BoardElement & { type: 'image' }) | undefined {
  const selected = selectedElements();
  const [only] = selected;
  if (selected.length !== 1 || only?.type !== 'image' || only.video !== undefined || only.href !== undefined) return undefined;
  const box = elementLayoutBox(only, currentMeasures());
  const { camera, width, height } = useCamera.getState();
  const view = visibleRect(camera, width, height);
  const onScreen = box !== undefined && box.x < view.x + view.w && box.x + box.w > view.x && box.y < view.y + view.h && box.y + box.h > view.y;
  return onScreen ? only : undefined;
}

/**
 * Pastes text: a web address on a selected picture becomes its link;
 * otherwise an artifact address becomes a link card, tab-separated rows a
 * table, and anything else a block of text in the middle of the view.
 */
export function pasteText(text: string): boolean {
  if (!ensureEditable()) return false;
  const picture = linkablePicture();
  if (picture && isWebAddress(text)) {
    const href = normalizeHttpUrl(text.trim());
    if (href !== undefined) return setImageLink(picture.id, href);
  }
  const content = useBoard.getState().board.content;
  if (wouldExceedElementLimit(content)) return refuse(BOARD_FULL_MESSAGE);
  const center = viewCenter();
  const step = pasteStep(useCamera.getState().camera.zoom);
  const measures = currentMeasures();
  const table = tableFromPaste(text, content.elements, center, step, measures);
  if (typeof table === 'string') return refuse(TABLE_PASTE_MESSAGES[table]);
  const element: BoardElement = linkCardFromPaste(text, content.elements, center, step, measures) ?? table?.el ?? pastedTextShape(text, center);
  const label = element.type === 'link' ? 'Paste link' : element.type === 'table' ? 'Paste table' : 'Paste text';
  if (!addElements([element], label)) return false;
  announce(addedMessage(element.type));
  const cut = element.type === 'shape' ? element.text !== text : element.type === 'table' && table !== undefined && table.cut;
  if (cut) notify(TEXT_CUT_NOTICE);
  return true;
}

/* ------------------------------------------------------------------------ */
/* Install                                                                  */
/* ------------------------------------------------------------------------ */

/** True when the page has selected text of its own (the browser copies it). */
function hasPageTextSelection(): boolean {
  const selection = typeof document === 'undefined' ? null : document.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/** True when a clipboard event belongs to text, not to the board. */
function belongsToText(event: ClipboardEvent): boolean {
  return isTypingTarget(event.target) || isChromePopupTarget(event.target) || useSelection.getState().editing !== null;
}

/** Installs the board's copy, cut and paste handling; returns a function that removes it. */
export function installClipboard(): () => void {
  if (typeof document === 'undefined') return () => {};

  const onCopy = (event: ClipboardEvent): void => {
    if (event.defaultPrevented || belongsToText(event) || hasPageTextSelection()) return;
    cutIds = undefined;
    const copy = copyOfSelection();
    if (!copy) return;
    event.preventDefault();
    writeCopy(event, copy);
  };

  const onCut = (event: ClipboardEvent): void => {
    if (event.defaultPrevented || belongsToText(event) || hasPageTextSelection()) return;
    cutIds = undefined;
    if (selectedIds().size === 0) return;
    event.preventDefault();
    if (!mayCut()) return;
    const copy = copyOfSelection();
    if (copy && writeCopy(event, copy)) finishCut(copy);
  };

  const onPaste = (event: ClipboardEvent): void => {
    if (event.defaultPrevented || belongsToText(event) || !canEditBoard()) return;
    const data = event.clipboardData;
    if (!data) return;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    const files = [...data.files];
    const payload = html === '' ? undefined : parseArtifactClipboardHtml(html);
    if (payload !== undefined) {
      if (payload.kind !== BOARD_CLIPBOARD_KIND) return;
      event.preventDefault();
      const picture = files.find((file) => file.type.startsWith('image/'));
      void pasteBoardElements(readBoardClipboardElements(payload.data), null, picture);
      return;
    }
    // Some clipboards keep only the text: a copy made here pastes as elements still.
    if (lastCopy !== undefined && lastCopy.text !== '' && text === lastCopy.text && files.length === 0) {
      event.preventDefault();
      void pasteBoardElements(lastCopy.data);
      return;
    }
    const kind = classifyPaste({ html, text, files });
    if (kind === 'files') {
      event.preventDefault();
      void insertMediaFiles(files.filter(isBoardMediaFile));
      return;
    }
    if (kind === 'text') {
      event.preventDefault();
      pasteText(text);
    }
  };

  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
  };
}
