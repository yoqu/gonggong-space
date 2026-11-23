/**
 * Argument encoding shared by the modules whose geometry runs in
 * WebAssembly (`crates/open-artifact-wb-geom`): kinds and sides as small codes, point
 * and command lists as flat number arrays, seeds as UTF-16 code units.
 * The codes match `crates/open-artifact-wb-geom/src/shape_paths.rs` and `routing.rs`.
 */

import type { ArrowSide } from './schema.ts';
import type { PathCommand } from './shape-paths.ts';

const KIND_CODES: Readonly<Record<string, number>> = {
  rect: 0,
  rounded: 1,
  ellipse: 2,
  diamond: 3,
  pill: 4,
  hexagon: 5,
  parallelogram: 6,
  database: 7,
  queue: 8,
  document: 9,
  cloud: 10,
  person: 11,
  frame: 12,
};

/** A shape (or outline) kind's code; unknown kinds draw like `rect` (0). */
export function kindCode(kind: unknown): number {
  return typeof kind === 'string' && Object.hasOwn(KIND_CODES, kind) ? KIND_CODES[kind]! : 0;
}

/** Sides in code order. */
export const SIDE_ORDER: readonly ArrowSide[] = ['top', 'bottom', 'left', 'right'];

/** A side's code; 255 for anything that is not a side. */
export function sideCode(side: ArrowSide | undefined): number {
  const index = side === undefined ? -1 : SIDE_ORDER.indexOf(side);
  return index < 0 ? 255 : index;
}

/** Points `[x, y]` as `[x0, y0, x1, y1, …]`. */
export function encodePoints(points: ReadonlyArray<readonly [number, number]>): Float64Array {
  const out = new Float64Array(points.length * 2);
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    out[index * 2] = point[0];
    out[index * 2 + 1] = point[1];
  }
  return out;
}

/** `count` points from `values` at `start`. */
export function decodePoints(values: ArrayLike<number>, start = 0, count = (values.length - start) >> 1): Array<[number, number]> {
  const points: Array<[number, number]> = new Array(count);
  for (let index = 0; index < count; index++) points[index] = [values[start + index * 2]!, values[start + index * 2 + 1]!];
  return points;
}

const COMMAND_CODES: Readonly<Record<string, number>> = { M: 0, L: 1, C: 2, Z: 3 };

/** Outline commands as `[code, …args]` (0 M, 1 L, 2 C, 3 Z). */
export function encodeCommands(commands: readonly PathCommand[]): Float64Array {
  let length = 0;
  for (const command of commands) length += command.length;
  const out = new Float64Array(length);
  let at = 0;
  for (const command of commands) {
    out[at++] = COMMAND_CODES[command[0]] ?? 3;
    for (let index = 1; index < command.length; index++) out[at++] = command[index] as number;
  }
  return out;
}

/** The inverse of {@link encodeCommands}. */
export function decodeCommands(values: ArrayLike<number>): PathCommand[] {
  const commands: PathCommand[] = [];
  let at = 0;
  while (at < values.length) {
    const code = values[at]!;
    if (code === 0) commands.push(['M', values[at + 1]!, values[at + 2]!]);
    else if (code === 1) commands.push(['L', values[at + 1]!, values[at + 2]!]);
    else if (code === 2) {
      commands.push(['C', values[at + 1]!, values[at + 2]!, values[at + 3]!, values[at + 4]!, values[at + 5]!, values[at + 6]!]);
      at += 4;
    } else {
      commands.push(['Z']);
      at += 1;
      continue;
    }
    at += 3;
  }
  return commands;
}

/** A string's UTF-16 code units (lone surrogates kept). */
export function utf16(text: string): Uint16Array {
  const out = new Uint16Array(text.length);
  for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index);
  return out;
}

/** A dragged edge's code: 0 left/top, 1 right/bottom, 2 none (`null`), 3 anything else. */
export function edgeCode(edge: string | null): number {
  return edge === 'left' || edge === 'top' ? 0 : edge === 'right' || edge === 'bottom' ? 1 : edge === null ? 2 : 3;
}
