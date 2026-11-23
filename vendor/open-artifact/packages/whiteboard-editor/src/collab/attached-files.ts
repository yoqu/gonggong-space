/**
 * Text files attached to a request for the agent.
 *
 * A person can attach text files (CSV, Markdown, JSON, notes, code…) to the
 * Ask panel: by dropping them on the panel or the board, or by pasting them
 * into the panel's field. They show as chips (each with a remove button) and
 * travel with the next request only, in its context as
 * `files: [{ name, text }]` ({@link attachedFilesContext}).
 *
 * Limits:
 * - {@link ATTACHED_FILES_MAX_BYTES} for all files of one request, measured
 *   as the UTF-8 JSON that travels ({@link attachedFileBytes});
 * - a file is read whole up to {@link ATTACHED_FILE_READ_MAX}; a bigger one
 *   is only sniffed ({@link ATTACHED_FILE_SNIFF_BYTES}), to tell a text file
 *   that is too large from a file that is not text;
 * - names are cleaned and clipped to {@link ATTACHED_FILE_NAME_MAX} characters,
 *   and a file of the same name replaces the one attached before.
 *
 * Sending takes the files ({@link takeAttachedFiles}); a request that fails
 * gives them back ({@link giveBackAttachedFiles}). Files read while a request
 * was being sent are not attached to the next one by surprise: the person is
 * told to attach them again.
 *
 * Pure apart from the store: unit-tested. `AskPanel.tsx` draws the chips and
 * wires the panel; `services/files.ts` offers files dropped on the board.
 */

import { create } from 'zustand';
import { isBoardMediaFile } from '../lib/media.ts';

/** Most bytes the files of one request may take in all. */
export const ATTACHED_FILES_MAX_BYTES = 40_000;
/** Files up to this size are read whole; bigger ones only sniffed. */
export const ATTACHED_FILE_READ_MAX = 2 * ATTACHED_FILES_MAX_BYTES;
/** Bytes read from a file too big to read whole, to tell whether it is text. */
export const ATTACHED_FILE_SNIFF_BYTES = 4096;
/** Longest file name kept, in characters. */
export const ATTACHED_FILE_NAME_MAX = 120;

/** Why files over the budget were refused. */
export const ATTACHED_FILES_TOO_LARGE = `Files on one request are limited to ${ATTACHED_FILES_MAX_BYTES / 1000} KB in total. Remove a file, or attach a smaller one.`;

/* ------------------------------------------------------------------------ */
/* Text                                                                     */
/* ------------------------------------------------------------------------ */

const INVISIBLE_CHAR_PATTERN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Noncharacter_Code_Point}\p{Default_Ignorable_Code_Point}]/u;
const ZERO_WIDTH_JOINER_PATTERN = /[‌‍]/u;
const EMOJI_VARIATION_SELECTOR_PATTERN = /[︎️]/u;
const IDEOGRAPHIC_VARIATION_SELECTOR_PATTERN = /[\u{E0100}-\u{E01EF}]/u;
const HAN_SCRIPT_PATTERN = /\p{Script=Han}/u;
const MONGOLIAN_VARIATION_SELECTOR_PATTERN = /[᠋-᠍᠏]/u;
const MONGOLIAN_SCRIPT_PATTERN = /\p{Script=Mongolian}/u;
const LETTER_CHAR_PATTERN = /\p{L}/u;
const ODD_WHITESPACE_PATTERN = /[\t\r\f\v\u0085\p{Zl}\p{Zp}]/u;

/**
 * `text` without invisible characters (controls, format characters, private
 * use, unassigned and default-ignorable code points). Line breaks stay; odd
 * whitespace (tabs, form feeds, line and paragraph separators) becomes a
 * space. Joiners stay only inside a word or emoji, and variation selectors
 * only where they belong (after an emoji, a Han or a Mongolian letter).
 */
export function stripInvisibleChars(text: string): string {
  let output = '';
  let afterBreak = true;
  let afterJoinerBreak = true;
  let afterHan = false;
  let afterMongolian = false;
  for (const char of text.replace(/\r\n/g, '\n')) {
    if (ZERO_WIDTH_JOINER_PATTERN.test(char)) {
      if (!afterJoinerBreak) output += char;
      afterJoinerBreak = true;
      afterHan = afterMongolian = false;
    } else if (
      EMOJI_VARIATION_SELECTOR_PATTERN.test(char) ||
      (afterHan && IDEOGRAPHIC_VARIATION_SELECTOR_PATTERN.test(char)) ||
      (afterMongolian && MONGOLIAN_VARIATION_SELECTOR_PATTERN.test(char))
    ) {
      if (!afterBreak) output += char;
      afterBreak = true;
    } else if (char === '\n' || !INVISIBLE_CHAR_PATTERN.test(char)) {
      output += char;
      afterBreak = afterJoinerBreak = /\s/u.test(char);
      afterHan = HAN_SCRIPT_PATTERN.test(char);
      afterMongolian = MONGOLIAN_SCRIPT_PATTERN.test(char) && LETTER_CHAR_PATTERN.test(char);
    } else if (ODD_WHITESPACE_PATTERN.test(char)) {
      output += ' ';
      afterBreak = afterJoinerBreak = true;
    }
  }
  return output;
}

/** A file name cleaned of invisible characters and runs of whitespace, middle-clipped to {@link ATTACHED_FILE_NAME_MAX}. */
export function clipAttachedFileName(name: string): string {
  const chars = [...stripInvisibleChars(name).replace(/\s+/g, ' ').trim()];
  if (chars.length <= ATTACHED_FILE_NAME_MAX) return chars.join('');
  return `${chars.slice(0, ATTACHED_FILE_NAME_MAX - 41).join('')}…${chars.slice(-40).join('')}`;
}

/** A file's text as it travels: line breaks made `\n`, invisible characters gone, tabs kept (columns of a TSV). */
export function normalizeAttachedFileText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\t').map(stripInvisibleChars).join('\t');
}

/**
 * True when bytes that are not UTF-8 still read as Latin-1 text: no run of
 * three or more high bytes, and no pair that looks like a UTF-8 lead and
 * continuation byte (a broken UTF-8 file rather than a Latin-1 one).
 */
export function looksLikeLatin1Text(bytes: Uint8Array): boolean {
  let highRun = 0;
  return bytes.every((byte, index) => {
    highRun = byte > 127 ? highRun + 1 : 0;
    return highRun < 3 && !(highRun === 2 && (bytes[index - 1] ?? 0) >= 194 && byte <= 191);
  });
}

/**
 * The text of a file's bytes, or `undefined` when it is not text. UTF-8 (or
 * UTF-16 with a byte-order mark) first, then Windows-1252 for bytes that
 * look like Latin-1. Control characters other than tabs, line breaks, form
 * feeds and escape mean binary. `whole` is false for the first bytes of a
 * bigger file (a character cut at the end is fine then).
 */
export function decodeTextFileBytes(bytes: Uint8Array, whole = true): string | undefined {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const decodeAs = (charset: string): string => new TextDecoder(charset, { fatal: true }).decode(bytes, { stream: !whole });
  const unlessControls = (text: string, pattern: RegExp): string | undefined => (pattern.test(text) ? undefined : text);
  try {
    return unlessControls(decodeAs(encoding), /[\0-\x08\x0e-\x1a\x1c-\x1f]/);
  } catch {
    return looksLikeLatin1Text(bytes) ? unlessControls(decodeAs('windows-1252'), /[\0-\x08\x0e-\x1a\x1c-\x1f\x7f-\x9f]/) : undefined;
  }
}

/** The bytes a file takes on a request: its UTF-8 JSON as it travels. */
export function attachedFileBytes(file: { name: string; text: string }): number {
  return new TextEncoder().encode(JSON.stringify({ name: file.name, text: file.text })).length;
}

/** Up to three names in quotes, then "and N more". */
export function quotedNameList(names: readonly string[]): string {
  const listed = names
    .slice(0, 3)
    .map((name) => `“${name}”`)
    .join(', ');
  return names.length > 3 ? `${listed} and ${names.length - 3} more` : listed;
}

/** Message for dropped files the board cannot take (`textToo`: text files could have been attached). */
export function unsupportedDropMessage(textToo: boolean): string {
  return textToo ? 'Whiteboards can only take pictures, videos, and text files.' : 'Whiteboards can only take picture and video files.';
}

/**
 * True when pasted plain text only names the pasted files (what a file
 * manager puts beside the files it copies), so the files are what was meant.
 */
export function clipboardTextIsFileNames(files: readonly Pick<File, 'name'>[], text: string): boolean {
  const names = new Set(files.map((file) => file.name));
  const lines = text
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.length > 0 && lines.every((line) => names.has(line) || names.has(line.split(/[\\/]/).pop() ?? line));
}

/* ------------------------------------------------------------------------ */
/* The store                                                                */
/* ------------------------------------------------------------------------ */

/** A file attached to the next request. */
export interface AttachedFile {
  /** Its number (stable while attached; for keys and removing). */
  n: number;
  /** Its cleaned name. */
  name: string;
  /** Its text, normalized as it travels. */
  text: string;
  /** What it takes of the budget ({@link attachedFileBytes}). */
  bytes: number;
}

/** A file as attaching reads it. */
export type AttachableFile = Pick<Blob, 'size' | 'slice'> & { name?: string };

interface AttachedFilesState {
  files: readonly AttachedFile[];
}

/** The files attached to the next request. */
export const useAttachedFiles = create<AttachedFilesState>()(() => ({ files: [] }));

let fileCount = 0;
let takeCount = 0;

function setFiles(files: readonly AttachedFile[]): void {
  useAttachedFiles.setState({ files });
}

/** Whether a file of `name` taking `bytes` fits with the others attached (one of the same name is replaced). */
function fitsBudget(name: string, bytes: number): boolean {
  const others = useAttachedFiles.getState().files.reduce((total, file) => total + (file.name === name ? 0 : file.bytes), 0);
  return others + bytes <= ATTACHED_FILES_MAX_BYTES;
}

/** What attaching did: the names attached, and sentences about those that were not. */
export interface AttachResult {
  took: string[];
  said: string[];
}

/**
 * Reads and attaches files. Each is attached unless it is not text, is
 * empty, would take the request over the budget, or was still being read
 * when a request went (then the person is asked to attach it again).
 */
export async function attachFiles(dropped: readonly AttachableFile[]): Promise<AttachResult> {
  const took: string[] = [];
  const unreadable: string[] = [];
  const empty: string[] = [];
  const tooLarge: string[] = [];
  const late: string[] = [];
  const takesAtStart = takeCount;
  for (const file of dropped) {
    const name = clipAttachedFileName(file.name ?? '') || `Untitled ${fileCount + 1}`;
    const whole = file.size <= ATTACHED_FILE_READ_MAX;
    const buffer = await file
      .slice(0, whole ? file.size : ATTACHED_FILE_SNIFF_BYTES)
      .arrayBuffer()
      .catch(() => undefined);
    const raw = buffer === undefined ? undefined : decodeTextFileBytes(new Uint8Array(buffer), whole);
    const text = raw === undefined ? undefined : normalizeAttachedFileText(raw);
    const bytes = whole && text !== undefined ? attachedFileBytes({ name, text }) : Number.POSITIVE_INFINITY;
    if (raw === undefined || text === undefined) unreadable.push(name);
    else if (raw === '') empty.push(name);
    else if (!fitsBudget(name, bytes)) tooLarge.push(name);
    else if (takeCount !== takesAtStart) late.push(name);
    else {
      fileCount += 1;
      setFiles([...useAttachedFiles.getState().files.filter((existing) => existing.name !== name), { n: fileCount, name, text, bytes }]);
      took.push(name);
    }
  }
  const failed = (names: readonly string[], reason: string): string[] => (names.length > 0 ? [`Couldn’t attach ${quotedNameList(names)}. ${reason}`] : []);
  return {
    took,
    said: [
      ...(unreadable.length > 0 ? [unsupportedDropMessage(true)] : []),
      ...failed(empty, empty.length === 1 ? 'It’s empty.' : 'They’re empty.'),
      ...failed(tooLarge, ATTACHED_FILES_TOO_LARGE),
      ...failed(late, 'The request had already gone. Attach again.'),
    ],
  };
}

/** Removes attached file `n`. */
export function dropAttachedFile(n: number): void {
  const files = useAttachedFiles.getState().files;
  if (files.some((file) => file.n === n)) setFiles(files.filter((file) => file.n !== n));
}

/** Takes the attached files for a request being sent (none are attached after). */
export function takeAttachedFiles(): AttachedFile[] {
  const taken = [...useAttachedFiles.getState().files];
  takeCount += 1;
  if (taken.length > 0) setFiles([]);
  return taken;
}

/**
 * Gives back the files of a request that failed, beside any attached since
 * (a newer file of the same name wins). Returns sentences about files that
 * no longer fit.
 */
export function giveBackAttachedFiles(files: readonly AttachedFile[]): string[] {
  const lost: string[] = [];
  for (const file of files) {
    if (useAttachedFiles.getState().files.some((existing) => existing.name === file.name)) continue;
    if (fitsBudget(file.name, file.bytes)) setFiles([...useAttachedFiles.getState().files, file]);
    else lost.push(file.name);
  }
  return lost.length > 0 ? [`No longer attached: ${quotedNameList(lost)}. ${ATTACHED_FILES_TOO_LARGE}`] : [];
}

/** The files as a request's context carries them. */
export function attachedFilesContext(files: readonly AttachedFile[]): Array<{ name: string; text: string }> {
  return files.map((file) => ({ name: file.name, text: file.text }));
}

/** Forgets every attached file and count (tests). */
export function resetAttachedFiles(): void {
  fileCount = 0;
  takeCount = 0;
  setFiles([]);
}

/* ------------------------------------------------------------------------ */
/* Offering dropped files                                                   */
/* ------------------------------------------------------------------------ */

/** What offering dropped files needs from the page. */
export interface AttachHost {
  /** Whether this viewer may ask the agent now (the panel can open). */
  canAsk(): boolean;
  /** Whether the Ask panel is open. */
  isOpen(): boolean;
  /** Opens the Ask panel. */
  open(): void;
  /** Shows a notice. */
  toast(message: string): void;
  /** Speaks to screen readers. */
  announce(message: string): void;
}

/**
 * Offers the files of a drop that are not pictures or videos to the Ask
 * panel: they are attached (with a notice about any that could not be) and
 * the panel opens. When this viewer cannot ask, the board says what it takes
 * instead. Resolves once the files were read.
 */
export async function offerTextFiles(dropped: readonly (AttachableFile & Pick<File, 'type' | 'name'>)[], host: AttachHost): Promise<void> {
  const textFiles = dropped.filter((file) => !isBoardMediaFile(file));
  if (textFiles.length === 0) return;
  if (!host.isOpen() && !host.canAsk()) {
    host.toast(unsupportedDropMessage(false));
    return;
  }
  const { took, said } = await attachFiles(textFiles);
  if (said.length > 0) host.toast(said.join(' '));
  if (took.length === 0) return;
  host.announce(`Attached ${quotedNameList(took)}.`);
  if (!host.isOpen()) host.open();
}
