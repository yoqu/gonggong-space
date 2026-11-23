/**
 * Template holes: `{{ path }}`.
 *
 * A hole is a dotted lookup or a literal, never an expression. Anything else
 * renders as an empty value (and `check` reports it), so a broken hole fails
 * visibly in checks but never throws while rendering.
 */

/** A literal hole value. */
export type HoleLiteral = string | number | boolean | null | undefined;

/** A parsed hole. */
export type Hole =
  | { kind: 'path'; segments: string[]; raw: string }
  | { kind: 'literal'; value: HoleLiteral; raw: string }
  | { kind: 'invalid'; raw: string };

/** A piece of interpolated text: literal text or a hole. */
export type Part = { kind: 'text'; text: string } | { kind: 'hole'; hole: Hole };

const HOLE = /\{\{([\s\S]*?)\}\}/g;
const PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$0-9][\w$]*)*$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/** Parses the inside of one `{{ … }}`. */
export function parseHole(inner: string): Hole {
  const raw = inner.trim();
  if (raw === 'true') return { kind: 'literal', value: true, raw };
  if (raw === 'false') return { kind: 'literal', value: false, raw };
  if (raw === 'null') return { kind: 'literal', value: null, raw };
  if (raw === 'undefined') return { kind: 'literal', value: undefined, raw };
  if (NUMBER.test(raw)) return { kind: 'literal', value: Number(raw), raw };
  if (/^'[^']*'$|^"[^"]*"$/.test(raw)) return { kind: 'literal', value: raw.slice(1, -1), raw };
  if (PATH.test(raw)) return { kind: 'path', segments: raw.split('.'), raw };
  return { kind: 'invalid', raw };
}

/** Splits text into literal parts and holes. */
export function splitHoles(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of text.matchAll(HOLE)) {
    if (match.index > last) parts.push({ kind: 'text', text: text.slice(last, match.index) });
    parts.push({ kind: 'hole', hole: parseHole(match[1]!) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** True when the text contains at least one hole. */
export function hasHoles(text: string): boolean {
  return /\{\{[\s\S]*?\}\}/.test(text);
}

/** When the whole text is exactly one hole (ignoring surrounding spaces), returns it. */
export function wholeHole(text: string): Hole | null {
  const parts = splitHoles(text.trim());
  return parts.length === 1 && parts[0]!.kind === 'hole' ? parts[0]!.hole : null;
}

/** A lookup scope: loop variables shadow the render values. */
export type Scope = Readonly<Record<string, unknown>>;

/** Evaluates a hole against the scopes (innermost first). */
export function evaluateHole(hole: Hole, scopes: readonly Scope[]): unknown {
  if (hole.kind === 'literal') return hole.value;
  if (hole.kind === 'invalid') return undefined;
  const [head, ...rest] = hole.segments;
  let value: unknown = undefined;
  for (const scope of scopes) {
    if (scope && Object.prototype.hasOwnProperty.call(scope, head!)) {
      value = scope[head!];
      break;
    }
  }
  for (const key of rest) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Converts a value to the text a hole renders as. */
export function holeText(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

/** Interpolates text: every hole becomes its text. */
export function interpolate(text: string, scopes: readonly Scope[]): string {
  if (!text.includes('{{')) return text;
  return splitHoles(text)
    .map((part) => (part.kind === 'text' ? part.text : holeText(evaluateHole(part.hole, scopes))))
    .join('');
}
