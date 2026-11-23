import type { LayerRow } from './protocol.ts';

/** A row with the rows that hold it, outermost first. */
export interface PlacedLayer {
  row: LayerRow;
  ups: LayerRow[];
}

/** Every row of a report, each before what it holds, with the rows that hold it. */
export function layerTree(rows: readonly LayerRow[] | null, ups: LayerRow[] = []): PlacedLayer[] {
  return (rows ?? []).flatMap((row) => [{ row, ups }, ...layerTree(row.kids, [...ups, row])]);
}

/** Every row of a report, each before what it holds. */
export const flattenLayers = (rows: readonly LayerRow[] | null): LayerRow[] => layerTree(rows).map((placed) => placed.row);

export const findLayer = (rows: readonly LayerRow[] | null, id: string | null): LayerRow | null => (id === null ? null : (flattenLayers(rows).find((row) => row.id === id) ?? null));

/** Whether a row is on the picture at a played moment. */
export const isLayerOnAt = (row: LayerRow, t: number): boolean => row.spans.some(([from, to]) => t >= from - 0.001 && t < to + 0.001);

export interface LayerHitTest {
  /** A point on the picture, in film pixels. */
  x: number;
  y: number;
  /** The innermost row under the point, at once, as a press with a modifier picks. */
  deep: boolean;
  /** How far outside a row's box, in film pixels, a press still finds it when none is found inside one. */
  slack: number;
  /** A row of things alike whose box is this area or less is picked whole, not passed over to what it holds. */
  small: number;
}

const area = (row: LayerRow): number => (row.box ? row.box[2] * row.box[3] : Infinity);

/**
 * The row a press at a point picks. A row that only holds others (a pack, a group) is passed over to what it holds.
 * A first press picks the outermost row under the point; pressing again where the selected row, or one it holds,
 * lies goes one level further in. Of rows that overlap, the smallest wins.
 */
export function hitTestLayers(rows: readonly LayerRow[] | null, selected: string | null, at: LayerHitTest): LayerRow | null {
  const { x, y, deep, slack, small } = at;
  const smallest = (some: LayerRow[]): LayerRow | null => some.sort((a, b) => area(a) - area(b))[0] ?? null;
  const holder = (row: LayerRow, whole: boolean): boolean =>
    row.kids.length > 0 && (row.many > 0 ? row.kids.length >= row.many : row.drawn === 'group') && !(whole && row.box !== null && row.box[2] * row.box[3] <= small);
  const under = (row: LayerRow, give: number, whole: boolean): boolean => {
    const box = row.box;
    return (
      row.kind !== 'ground' &&
      !row.full &&
      row.hidden === false &&
      box !== null &&
      x >= box[0] - give &&
      x < box[0] + box[2] + give &&
      y >= box[1] - give &&
      y < box[1] + box[3] + give &&
      (!holder(row, whole) || row.kids.some((kid) => under(kid, give, whole)))
    );
  };
  const open = (some: readonly LayerRow[], whole: boolean): LayerRow[] =>
    some.flatMap((row) =>
      row.kids.length === 0
        ? [row]
        : row.full || row.drawn === 'drawing' || (holder(row, whole) && (whole || row.many > 0))
          ? open(row.kids, whole)
          : row.many > 0
            ? [row, ...open(row.kids, whole)]
            : [row],
    );
  const tries: Array<[number, boolean]> = [
    [0, false],
    [slack, false],
    [0, true],
  ];
  const hits = (some: readonly LayerRow[]): LayerRow[] => tries.reduce<LayerRow[]>((found, [give, whole]) => (found.length ? found : open(some, whole).filter((row) => under(row, give, whole))), []);
  const inmost = (some: readonly LayerRow[]): LayerRow[] =>
    hits(some).flatMap((row) => {
      const inner = inmost(row.kids);
      return inner.length ? inner : [row];
    });
  if (deep) return smallest(inmost(rows ?? []));
  const path: LayerRow[] = [];
  for (let row = smallest(hits(rows ?? [])); row; row = smallest(hits(row.kids))) path.push(row);
  const last = path.map((row) => row.id === selected || flattenLayers(row.kids).some((kid) => kid.id === selected)).lastIndexOf(true);
  return path[Math.min(last + 1, path.length - 1)] ?? null;
}
