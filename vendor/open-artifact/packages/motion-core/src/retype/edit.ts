import { MAX_MODULE_CHARS } from '../limits.ts';
import {
  MAX_RETYPED_LINES,
  decodeHtmlEntities,
  normalizeRetypedText,
  serializeRetypedRecord,
  type RetypedLine,
  type RetypedRecord,
} from '../records/retyped.ts';
import { foldRetypedText, readScriptText } from './escapes.ts';
import { isLineGone, type TextScan } from './sites.ts';

/**
 * The `v` to record for words typed over a line: normalized, or `''` when they show what the code already says (the
 * line is then put back). `inScriptOnly`: every place that says `was` is a JS string, so its escapes are read.
 */
export function retypedWords(was: string, typed: string, inScriptOnly = false): string {
  const v = normalizeRetypedText(typed);
  const shown = (inScriptOnly ? readScriptText(was) : null) ?? was;
  return v === '' || v === normalizeRetypedText(decodeHtmlEntities(shown) ?? shown) ? '' : v;
}

/** The record with one line's `v` set as given (already normalized), or the line taken out for `''`. */
export function withRetypedLine(record: RetypedRecord, was: string, v: string): RetypedRecord {
  const rest = record.lines.filter((line) => line.was !== was);
  return { ...record, lines: v === '' ? rest : [...rest, { was, v }] };
}

/** True when the record would hold too many lines, or too much text for its module. */
export function isRetypedRecordFull(record: RetypedRecord): boolean {
  return record.lines.length > MAX_RETYPED_LINES || (serializeRetypedRecord(record)?.length ?? 0) > MAX_MODULE_CHARS;
}

export type RetypeOutcome =
  /** The line already shows those words. */
  | { kind: 'same' }
  /** Nothing in the film says the line any more, so the change could not show. */
  | { kind: 'gone' }
  /** The record cannot hold more text. */
  | { kind: 'full' }
  /**
   * `dropped`: lines nothing says any more, put back to make room (none in a film the player cut short, where
   * an unread module may still say them).
   */
  | { kind: 'changed'; record: RetypedRecord; v: string; was: string; dropped: RetypedLine[] };

export interface RetypeContext {
  /** The film's text scan, or `null` when it failed. */
  scan: TextScan | null;
  /** The player read only part of the film's modules. */
  cut?: boolean;
}

/** A person types `typed` over the line the code spells `was`. */
export function retypeLine(record: RetypedRecord, was: string, typed: string, context: RetypeContext): RetypeOutcome {
  const { scan } = context;
  if (isLineGone(scan, was)) {
    if (normalizeRetypedText(typed) !== '') return { kind: 'gone' };
    return { kind: 'changed', record: withRetypedLine(record, was, ''), v: '', was, dropped: [] };
  }
  const inScriptOnly = scan !== null && !scan.sites.some((site) => site.was === was && !site.inScript);
  const v = retypedWords(was, typed, inScriptOnly);
  const current = record.lines.find((line) => line.was === was)?.v ?? '';
  if (v === current) return { kind: 'same' };
  let next = withRetypedLine(record, was, v);
  const dropped: RetypedLine[] = [];
  for (const line of record.lines) {
    if (!isRetypedRecordFull(next)) break;
    if (context.cut === true || !isLineGone(scan, line.was)) continue;
    dropped.push(line);
    next = withRetypedLine(next, line.was, '');
  }
  if (isRetypedRecordFull(next)) return { kind: 'full' };
  return { kind: 'changed', record: next, v, was, dropped };
}

/**
 * The record without the lines nothing in the film reads any more: neither their `was` nor, folded, its words
 * (`texts`: the cut and every module's text, the record's own left out). The same record when none is dropped, or
 * when the smaller record would still not fit its module.
 */
export function pruneRetypedLines(record: RetypedRecord, texts: readonly string[]): RetypedRecord {
  let folded: string[] | undefined;
  const readSomewhere = (was: string): boolean => {
    const fold = foldRetypedText(was);
    if (!/[\p{L}\p{N}]/u.test(fold)) return false;
    folded ??= texts.map(foldRetypedText);
    return folded.some((text) => text.includes(fold));
  };
  const kept = record.lines.filter((line) => texts.some((text) => text.includes(line.was)) || readSomewhere(line.was));
  if (kept.length === record.lines.length) return record;
  const pruned = { ...record, lines: kept };
  return (serializeRetypedRecord(pruned)?.length ?? 0) > MAX_MODULE_CHARS ? record : pruned;
}
