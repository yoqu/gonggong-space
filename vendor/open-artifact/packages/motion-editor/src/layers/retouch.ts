/**
 * Writes changes by hand on a layer (Appearance, hiding, text styles) into `modules/retouched.json`, lays values
 * being dragged on the stage without writing them, and makes each write an undo step.
 */

import { toast } from '@open-artifact/ui';
import {
  RETOUCHED_MODULE,
  serializeRetouchedRecord,
  setRetouchProperty,
  type RetouchChange,
  type RetouchLayer,
  type RetouchProperty,
  type RetouchedRecord,
  type RetouchTarget,
} from '@open-artifact/motion-core';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';
import { filmEngine } from '../engine/engine-context.ts';
import { pushUndo } from '../engine/undo.ts';
import { writeFilmDocument } from '../host/live-film.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { applyChange, entryOf, entryTarget, knownEntryId, pairChange, takesEntries, touchKey, type EntryLook, type SeenTarget } from './entry.ts';
import { liveKey, useLayers } from './store.ts';
import { CANNOT_WRITE, CHANGE_STALE, RECORD_FULL } from './words.ts';

export const RETOUCHED_PATH = `modules/${RETOUCHED_MODULE}`;
/** A value being dragged is written once the drag is let go, or has rested this long. */
export const RETOUCH_COMMIT_WAIT_MS = 400;

type Value = string | number | null;

/** One property of one thing to set (`v: null` takes it back). */
export interface LayerChange {
  row: LayerRow;
  /** How the film itself draws it (the row's look, or the asked look of a line of words). */
  look: EntryLook & Partial<Record<RetouchProperty, unknown>>;
  property: RetouchProperty;
  v: Value;
}

/** The record as this page last wrote it, until the store's decode brings it back. */
let written: { record: RetouchedRecord; from: RetouchedRecord | null } | null = null;

/** The record changes by hand go into: this page's last write while the film has not caught up, else the film's. */
export function currentRecord(): RetouchedRecord | null {
  const film = useFilm.getState().records.retouched;
  if (written !== null && film === written.from) return written.record;
  written = null;
  return film;
}

const digits = (): number => Math.floor(Math.random() * 1e6);

/** The entry a row's changes are in now, if any. */
export function rowEntry(row: LayerRow, look: EntryLook | null): RetouchLayer | null {
  if (look === null) return null;
  const id = knownEntryId(row, look, useLayers.getState().seen);
  return entryOf(currentRecord(), id);
}

function remember(target: RetouchTarget, row: LayerRow, look: EntryLook & { kin: string }, properties: readonly RetouchProperty[]): void {
  useLayers.setState((state) => {
    const seen: SeenTarget[] = [
      ...state.seen.filter((each) => !(each.thing === row.id && each.cls === look.cls && each.kin === look.kin)),
      { thing: row.id, cls: look.cls, kin: look.kin, entry: target.id },
    ];
    const touched = new Set(state.touched);
    for (const property of properties) touched.add(touchKey(target.id, property));
    return { seen, touched };
  });
}

function save(record: RetouchedRecord): boolean {
  const text = serializeRetouchedRecord(record);
  const from = useFilm.getState().records.retouched;
  const ok = writeFilmDocument(RETOUCHED_PATH, text === null ? null : { kind: 'json', text });
  if (!ok) {
    toast.add({ title: CANNOT_WRITE, ...(useWorking.getState().readOnlyReason ? { description: useWorking.getState().readOnlyReason! } : {}) });
    return false;
  }
  written = { record, from };
  filmEngine()?.send({ type: 'retouch', record });
  return true;
}

interface Step {
  target: RetouchTarget;
  property: RetouchProperty;
  before: RetouchChange['value'];
  after: RetouchChange['value'];
}

function replay(steps: readonly Step[], which: 'before' | 'after'): void {
  let record = currentRecord() ?? { layers: [] };
  for (const step of which === 'before' ? [...steps].reverse() : steps)
    record = setRetouchProperty(record, step.target, { property: step.property, value: step[which] } as RetouchChange);
  save(record);
}

/**
 * Writes changes on one or more things as one undo step. `label` names it for undo's toast. False when nothing was
 * written (the record is full, the page may not write, the film changed under the reading).
 */
export function setLayerProperties(changes: readonly LayerChange[], label: string): boolean {
  dropLive(changes);
  if (changes.length === 0) return false;
  const state = useLayers.getState();
  if (state.revision !== useFilm.getState().revision) {
    toast.add({ title: CHANGE_STALE });
    return false;
  }
  const lost = state.report?.lost ?? [];
  let record = currentRecord();
  const steps: Step[] = [];
  const made: Array<{ target: RetouchTarget; row: LayerRow; look: EntryLook & { kin: string }; property: RetouchProperty }> = [];
  for (const change of changes) {
    if (!takesEntries(change.row, change.look)) continue;
    const look = change.look;
    const target = entryTarget(change.row, look, record, useLayers.getState().seen, lost, digits, change.property);
    const pair = pairChange(change.property, look[change.property] as Value | undefined, change.v);
    if (pair === null) continue;
    const before = (entryOf(record, target.id)?.[change.property] ?? null) as RetouchChange['value'];
    const result = applyChange(record, target, pair);
    if (!result.took) {
      toast.add({ title: RECORD_FULL });
      return false;
    }
    record = result.record;
    steps.push({ target, property: change.property, before, after: pair.value });
    made.push({ target, row: change.row, look, property: change.property });
    remember(target, change.row, look, [change.property]);
  }
  if (steps.length === 0 || record === null || !save(record)) return false;
  pushUndo({ label, undo: () => replay(steps, 'before'), redo: () => replay(steps, 'after') });
  return true;
}

export const setLayerProperty = (change: LayerChange, label: string): boolean => setLayerProperties([change], label);

let commitTimer: ReturnType<typeof setTimeout> | undefined;
let waiting: { changes: LayerChange[]; label: string } | null = null;

function dropLive(changes: readonly LayerChange[]): void {
  if (commitTimer !== undefined) clearTimeout(commitTimer);
  commitTimer = undefined;
  waiting = null;
  const live = useLayers.getState().live;
  if (live.size === 0) return;
  const next = new Map(live);
  for (const change of changes) next.delete(liveKey(change.row.id, change.property));
  if (changes.length === 0) next.clear();
  useLayers.setState({ live: next });
}

/**
 * Shows values being dragged on the stage without writing them; they are written when the drag is let go
 * ({@link commitLive}) or rests for {@link RETOUCH_COMMIT_WAIT_MS}.
 */
export function previewLayerProperties(changes: readonly LayerChange[], label: string): void {
  const state = useLayers.getState();
  const live = new Map(state.live);
  let record = currentRecord() ?? { layers: [] };
  for (const change of changes) {
    if (!takesEntries(change.row, change.look)) continue;
    live.set(liveKey(change.row.id, change.property), change.v ?? '');
    const target = entryTarget(change.row, change.look, record, state.seen, state.report?.lost ?? [], () => 0, change.property);
    const pair = pairChange(change.property, change.look[change.property] as Value | undefined, change.v);
    if (pair !== null) record = applyChange(record, target, pair).record;
  }
  useLayers.setState({ live });
  filmEngine()?.send({ type: 'retouch', record });
  waiting = { changes: [...changes], label };
  if (commitTimer !== undefined) clearTimeout(commitTimer);
  commitTimer = setTimeout(commitLive, RETOUCH_COMMIT_WAIT_MS);
}

/** Writes the values being dragged. */
export function commitLive(): void {
  const now = waiting;
  if (now === null) return;
  setLayerProperties(now.changes, now.label);
}

/** Lets go of values being dragged without writing them (the stage shows the record again). */
export function cancelLive(): void {
  if (waiting === null && useLayers.getState().live.size === 0) return;
  dropLive([]);
  filmEngine()?.send({ type: 'retouch', record: currentRecord() });
}

/** The value a control shows: what is being dragged, else what the entry sets (where it counts), else the film's. */
export function shownValue(row: LayerRow, look: (EntryLook & Partial<Record<RetouchProperty, unknown>>) | null, property: RetouchProperty, counts: (entry: RetouchLayer) => boolean): Value {
  if (look === null) return null;
  const live = useLayers.getState().live.get(liveKey(row.id, property));
  if (live !== undefined) return live === '' ? null : live;
  const entry = rowEntry(row, look);
  const pair = entry?.[property];
  if (entry !== null && pair !== undefined && counts(entry)) return pair.v as Value;
  return (look[property] ?? null) as Value;
}
