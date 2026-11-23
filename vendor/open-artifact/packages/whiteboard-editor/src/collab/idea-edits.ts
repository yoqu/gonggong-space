/**
 * Putting an idea's option on the board, and taking it off again.
 *
 * An option is a list of edits written against the board as the agent read
 * it (the idea's `read` copies). Each edit:
 * - creates an element (`type` and its fields, a fresh id), stamped as the
 *   agent's (`by: 'agent'`);
 * - changes fields of an element on the board (`null` drops a field);
 * - or removes an element (`remove: true`), along with its arrows.
 *
 * An edit to an element that changed since the agent read it is skipped:
 * the element must match its `read` copy exactly (a field the copy leaves
 * out counts as changed), or match the values an edit's `was` lists.
 *
 * Applying returns a restore plan; restoring undoes only what nobody has
 * touched since (a created element that someone edited stays, a changed one
 * is put back only while it is still as the option left it).
 *
 * Pure: unit-tested without a DOM.
 */

import { normalizeElement, removeElements, type BoardElement, type IdeaVersion, type IdeaVersionEdit } from '@open-artifact/whiteboard-core';

/** What applying an option did, so it can be taken off again. */
export interface IdeaRestore {
  /** Elements it changed: as they were, and as the option left them. */
  changed: Array<{ before: BoardElement; after: BoardElement }>;
  /** Elements it created, as created. */
  created: BoardElement[];
  /** Elements it removed (arrows included), with their place in the drawing order. */
  removed: Array<{ element: BoardElement; index: number }>;
}

/** What {@link applyIdeaVersion} returns. */
export interface IdeaApplyResult {
  /** The next element list (the same array when nothing changed). */
  elements: readonly BoardElement[];
  restore: IdeaRestore;
  /** Edits applied. */
  applied: number;
  /** Edits skipped (the element changed since, or the edit was unusable). */
  skipped: number;
}

/** What {@link restoreIdeaVersion} returns. */
export interface IdeaRestoreResult {
  /** The next element list (the same array when nothing changed). */
  elements: readonly BoardElement[];
  /** Changes undone. */
  restored: number;
  /** Changes left because someone touched them since. */
  kept: number;
}

/** JSON with object keys sorted, so equal values compare equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

/** True when two values are the same JSON. */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** The kind of an edit. */
export function ideaEditKind(edit: IdeaVersionEdit): 'create' | 'change' | 'remove' {
  if (edit.remove === true) return 'remove';
  return 'type' in edit ? 'create' : 'change';
}

/** Ids of board elements an option changes or removes (what two options can fight over). */
export function ideaVersionTouches(version: IdeaVersion | undefined): Set<string> {
  return new Set((version?.edits ?? []).filter((edit) => ideaEditKind(edit) !== 'create').map((edit) => edit.id));
}

/** Indexes of the other options that change or remove an element `index` also does. */
export function conflictingIdeaOptions(versions: ReadonlyArray<IdeaVersion | undefined>, index: number): number[] {
  const mine = ideaVersionTouches(versions[index]);
  if (mine.size === 0) return [];
  return versions.flatMap((version, other) => (other !== index && [...ideaVersionTouches(version)].some((id) => mine.has(id)) ? [other] : []));
}

/** True when `current` is still as the agent read it, for the purpose of `edit`. */
function unchangedSinceRead(current: BoardElement, edit: IdeaVersionEdit, read: ReadonlyMap<string, BoardElement>): boolean {
  const was = edit.was;
  if (typeof was === 'object' && was !== null && !Array.isArray(was)) {
    const record = current as unknown as Record<string, unknown>;
    return Object.entries(was as Record<string, unknown>).every(([key, value]) => (value === null ? record[key] === undefined : sameJson(record[key], value)));
  }
  const copy = read.get(current.id);
  return copy !== undefined && sameJson(copy, current);
}

/** The fields an edit sets, without its bookkeeping keys. */
function editFields(edit: IdeaVersionEdit): Record<string, unknown> {
  const { id: _id, was: _was, remove: _remove, seen: _seen, along: _along, ...fields } = edit;
  return fields;
}

/** Where a new element goes: a section behind everything but other sections, anything else on top. */
function insertIndex(elements: readonly BoardElement[], element: BoardElement): number {
  if (element.type !== 'container') return elements.length;
  let index = 0;
  elements.forEach((other, at) => {
    if (other.type === 'container') index = at + 1;
  });
  return index;
}

/**
 * Applies one option's edits to the board's elements.
 *
 * @param elements - The board's elements, back to front.
 * @param version - The option's edits.
 * @param read - The elements as the agent read them (the idea's `read`).
 */
export function applyIdeaVersion(elements: readonly BoardElement[], version: IdeaVersion, read: readonly BoardElement[] = []): IdeaApplyResult {
  const readById = new Map(read.map((element) => [element.id, element]));
  let next = [...elements];
  const restore: IdeaRestore = { changed: [], created: [], removed: [] };
  let applied = 0;
  let skipped = 0;
  const removals: string[] = [];

  for (const edit of version.edits) {
    const kind = ideaEditKind(edit);
    const index = next.findIndex((element) => element.id === edit.id);
    const current = index >= 0 ? next[index] : undefined;
    if (kind === 'create') {
      if (current !== undefined) {
        skipped += 1;
        continue;
      }
      const fields = editFields(edit);
      const element = normalizeElement({ by: 'agent', ...fields, id: edit.id }, new Set(next.map((other) => other.id)));
      if (element === undefined || element.id !== edit.id) {
        skipped += 1;
        continue;
      }
      next.splice(insertIndex(next, element), 0, element);
      restore.created.push(element);
      applied += 1;
      continue;
    }
    if (current === undefined || !unchangedSinceRead(current, edit, readById)) {
      skipped += 1;
      continue;
    }
    if (kind === 'remove') {
      removals.push(current.id);
      continue;
    }
    const merged: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };
    for (const [key, value] of Object.entries(editFields(edit))) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    const after = normalizeElement(merged);
    if (after === undefined || after.id !== current.id || after.type !== current.type) {
      skipped += 1;
      continue;
    }
    if (sameJson(after, current)) {
      applied += 1;
      continue;
    }
    next[index] = after;
    restore.changed.push({ before: current, after });
    applied += 1;
  }

  if (removals.length > 0) {
    const ids = new Set(removals);
    const kept = removeElements({ elements: next }, ids).elements;
    const keptIds = new Set(kept.map((element) => element.id));
    next.forEach((element, index) => {
      if (!keptIds.has(element.id)) restore.removed.push({ element, index });
    });
    next = kept;
    applied += removals.length;
  }

  const changedAny = restore.changed.length + restore.created.length + restore.removed.length > 0;
  return { elements: changedAny ? next : elements, restore, applied, skipped };
}

/** Takes an applied option off the board, leaving what others touched since. */
export function restoreIdeaVersion(elements: readonly BoardElement[], restore: IdeaRestore): IdeaRestoreResult {
  let next = [...elements];
  let restored = 0;
  let kept = 0;

  // Created elements go, unless someone changed them since.
  const createdGone = new Set<string>();
  for (const created of restore.created) {
    const current = next.find((element) => element.id === created.id);
    if (current === undefined) continue;
    if (sameJson(current, created)) {
      createdGone.add(created.id);
      restored += 1;
    } else kept += 1;
  }
  if (createdGone.size > 0) next = next.filter((element) => !createdGone.has(element.id));

  // Changed elements go back, while still as the option left them.
  for (const { before, after } of restore.changed) {
    const index = next.findIndex((element) => element.id === after.id);
    if (index < 0) continue;
    if (sameJson(next[index], after)) {
      next[index] = before;
      restored += 1;
    } else kept += 1;
  }

  // Removed elements come back where they were, unless something took their id.
  const present = new Set(next.map((element) => element.id));
  for (const { element, index } of [...restore.removed].sort((a, b) => a.index - b.index)) {
    if (present.has(element.id)) {
      kept += 1;
      continue;
    }
    next.splice(Math.min(index, next.length), 0, element);
    present.add(element.id);
    restored += 1;
  }

  return { elements: restored > 0 ? next : elements, restored, kept };
}

/** What an option would do, for its preview: the elements as they would look, by kind. */
export interface IdeaPreview {
  added: BoardElement[];
  changed: BoardElement[];
  removed: BoardElement[];
}

/** What an option would do to the board now (skipped edits leave nothing). */
export function previewIdeaVersion(elements: readonly BoardElement[], version: IdeaVersion, read: readonly BoardElement[] = []): IdeaPreview {
  const { restore } = applyIdeaVersion(elements, version, read);
  return {
    added: restore.created,
    changed: restore.changed.map((entry) => entry.after),
    removed: restore.removed.map((entry) => entry.element),
  };
}
