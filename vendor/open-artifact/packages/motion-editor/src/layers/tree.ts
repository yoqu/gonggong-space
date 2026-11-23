/**
 * What the list says of each layer, and how a picked layer is found again in a new reading. Pure.
 */

import { isSvgShapeId } from '@open-artifact/motion-core';
import { flattenLayers, findLayer, layerTree, type PlacedLayer } from '@open-artifact/motion-stage/layers';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';
import { DRAWN_LABELS, KIND_LABELS, OVAL, itemCount, ofSiblings } from './words.ts';

/** The icon a row shows, by what it is. */
export type LayerIconKind = 'text' | 'image' | 'rectangle' | 'oval' | 'group' | 'pack' | 'ground' | 'line' | 'path' | 'polygon' | 'graphic';

export function layerIconKind(row: LayerRow): LayerIconKind {
  if (row.kind === 'ground') return 'ground';
  if (row.many > 0) return 'pack';
  switch (row.drawn) {
    case 'line':
    case 'path':
    case 'polygon':
      return row.drawn;
    case 'graphic':
    case 'drawing':
      return 'graphic';
    case 'group':
      return 'group';
    default:
      break;
  }
  if (row.kind === 'text') return 'text';
  if (row.kind === 'image') return 'image';
  if (row.kind === 'group') return 'group';
  return row.round ? 'oval' : 'rectangle';
}

/** What a row is called: its name, else what it is ("Text", "Oval"); a pack of alike things takes theirs. */
export function layerTypeLabel(row: LayerRow): string {
  if (row.name) return row.name;
  const first = row.kids[0];
  if (row.many > 0 && first !== undefined && row.kids.every((kid) => layerTypeLabel(kid) === layerTypeLabel(first))) return layerTypeLabel(first);
  if (row.drawn !== '') return DRAWN_LABELS[row.drawn];
  if (row.kind === 'shape' && row.round) return OVAL;
  return KIND_LABELS[row.kind];
}

/** The words after the label: a pack's count, else the row's first words. */
export const layerSummary = (row: LayerRow): string => (row.many > 0 ? itemCount(row.many) : (row.texts[0] ?? ''));

/** Parts of a spoken label, the empty ones left out. */
export const joinLabel = (parts: readonly string[]): string => parts.filter((part) => part !== '').join(', ');

export const layerAccessibleLabel = (row: LayerRow): string => joinLabel([layerTypeLabel(row), layerSummary(row)]);

/** A short name for a row in a sentence (four words of its text at most). */
export function layerShortLabel(row: LayerRow): string {
  if (row.name) return row.name;
  const words = row.many > 0 ? itemCount(row.many) : (row.texts[0] ?? '').split(' ').slice(0, 4).join(' ').slice(0, 40);
  return joinLabel([layerTypeLabel(row), words]);
}

/**
 * The name the eye button says: the row's label, with "n of m" when siblings share it (so each button's name is its
 * own).
 */
export function layerToggleName(row: LayerRow, siblings: readonly LayerRow[]): string {
  const label = layerAccessibleLabel(row);
  const alike = siblings.filter((sibling) => layerAccessibleLabel(sibling) === label);
  return alike.length > 1 ? ofSiblings(label, alike.indexOf(row) + 1, alike.length) : label;
}

/** What tells a layer apart besides its id: its kind, name, how many it packs and its words (spaces aside). */
export const layerKey = (row: LayerRow, withTexts = true): string =>
  [row.kind, row.name, String(row.many), ...(withTexts ? row.texts.map((text) => text.replace(/\s+/g, '')) : [])].join('\n');

const tagOf = (id: string): string => id.slice(id.lastIndexOf('/'));

/**
 * The layer picked in an earlier reading (`previous`), found again in a new one (`list`), or null where it is gone or
 * cannot be told from others. `sameTime`: both readings are of the same moment.
 */
export function findLayerAgain(was: LayerRow, previous: readonly LayerRow[] | null, list: readonly LayerRow[] | null, sameTime = true): LayerRow | null {
  const found = findLayer(list, was.id);
  if (was.look !== null) {
    const { cls, kin } = was.look;
    if (found !== null && found.look?.cls === cls && found.look.kin === kin && layerKey(found) === layerKey(was)) return found;
    if (kin !== null) {
      const like = (rows: readonly LayerRow[] | null): Array<{ row: LayerRow; kin: string[] }> =>
        flattenLayers(rows).flatMap((row) =>
          row.look !== null && row.look.cls === cls && row.look.kin !== null && tagOf(row.id) === tagOf(was.id) ? [{ row, kin: row.look.kin.split('/') }] : [],
        );
      const [kin0, kin1, kin2] = kin.split('/');
      const now = like(list);
      const byWords = now.filter((each) => kin2 !== undefined && each.kin[2] === kin2);
      if (byWords.length > 0) return byWords.length === 1 ? byWords[0]!.row : null;
      const before = like(previous);
      const wordsBefore = new Set(before.map((each) => each.kin[2]));
      const settled =
        sameTime ||
        before.every((each) => each.row.id === was.id || now.every((other) => other.row.id !== each.row.id || other.kin.join() === each.kin.join()));
      const byTurn =
        !settled || (isSvgShapeId(was.id) && was.texts.length === 0)
          ? []
          : now.filter((each) => each.kin[0] === kin0 && each.kin[1] === kin1 && (each.kin[2] === undefined || !wordsBefore.has(each.kin[2])));
      if (byTurn.length === 1) return byTurn[0]!.row;
    }
  }
  const twin = (rows: readonly LayerRow[] | null, of: LayerRow): boolean => flattenLayers(rows).some((row) => row.id !== was.id && layerKey(row) === layerKey(of));
  const withTexts = !/[+*]/.test(was.id) || (found !== null && (twin(previous, found) || twin(list, was)));
  return found !== null &&
    (was.look === null || found.look === null) &&
    (was.texts.length > 0 || was.many > 0 || was.kind === 'ground') &&
    layerKey(found, withTexts) === layerKey(was, withTexts)
    ? found
    : null;
}

/** The rows the list shows: each whose holders are all open. */
export function visibleLayers(rows: readonly LayerRow[] | null, open: ReadonlySet<string>): PlacedLayer[] {
  return layerTree(rows).filter((placed) => placed.ups.every((up) => open.has(up.id)));
}

/** The ids of the rows that hold `id`, outermost first. */
export function holdersOf(rows: readonly LayerRow[] | null, id: string | null): string[] {
  if (id === null) return [];
  return layerTree(rows).find((placed) => placed.row.id === id)?.ups.map((up) => up.id) ?? [];
}

/** The row's siblings: those its holder (or the reading's top) holds. */
export function siblingsOf(rows: readonly LayerRow[] | null, placed: PlacedLayer): readonly LayerRow[] {
  const holder = placed.ups[placed.ups.length - 1];
  return holder !== undefined ? holder.kids : (rows ?? []);
}

/** Whether a row reserves space for an expand/collapse caret: nested rows always do, top-level rows only when one can expand. */
export function showsLayerCaretColumn(depth: number, siblings: readonly LayerRow[]): boolean {
  return depth > 0 || siblings.some((sibling) => sibling.kids.length > 0);
}
