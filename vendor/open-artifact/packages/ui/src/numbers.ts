/**
 * Number text for {@link ScrubNumberField}: reading what was typed (a
 * number, a unit, simple arithmetic) and rounding to a step. No DOM.
 */

/** A typed number and the unit typed after it, if any. */
export interface TypedNumber {
  value: number;
  /** The unit written after the number (`px`, `%`…), or undefined. */
  unit?: string;
}

/**
 * Reads typed text: `12`, `12px`, `-4.5`, `.5`, or arithmetic with `+ - * /`
 * and parentheses (`10 + 4`, `100/3`, `(8+2)*2px`). A unit may follow the
 * whole expression or its first number. Null when the text is not that.
 */
export function evaluateNumberInput(text: string): TypedNumber | null {
  const source = text.trim().replace(/,/g, '.');
  if (!source) return null;
  // Units: letters or % after a number; all of them must be the same.
  let unit: string | undefined;
  const bare = source.replace(/(\d|\.)\s*([a-z]+|%)/gi, (_match, digit: string, u: string) => {
    const lower = u.toLowerCase();
    if (unit !== undefined && unit !== lower) unit = '\u0000';
    else unit = lower;
    return digit;
  });
  if (unit === '\u0000') return null;
  if (!/^[\d.\s+\-*/()]+$/.test(bare)) return null;
  let at = 0;
  const peek = () => {
    while (bare[at] === ' ') at++;
    return bare[at];
  };
  const number = (): number | null => {
    const match = /^(?:\d+\.?\d*|\.\d+)/.exec(bare.slice(at));
    if (!match) return null;
    at += match[0].length;
    return Number(match[0]);
  };
  const factor = (): number | null => {
    const ch = peek();
    if (ch === '-' || ch === '+') {
      at++;
      const inner = factor();
      return inner === null ? null : ch === '-' ? -inner : inner;
    }
    if (ch === '(') {
      at++;
      const inner = sum();
      if (inner === null || peek() !== ')') return null;
      at++;
      return inner;
    }
    return number();
  };
  const product = (): number | null => {
    let left = factor();
    while (left !== null && (peek() === '*' || peek() === '/')) {
      const op = bare[at++];
      const right = factor();
      if (right === null) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };
  const sum = (): number | null => {
    let left = product();
    while (left !== null && (peek() === '+' || peek() === '-')) {
      const op = bare[at++];
      const right = product();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const value = sum();
  if (value === null || peek() !== undefined || !Number.isFinite(value)) return null;
  return unit === undefined ? { value } : { value, unit };
}

/** Decimals needed to show multiples of `step` (0.25 → 2). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const exp = /e-(\d+)$/.exec(text);
  if (exp) return Number(exp[1]);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Rounds `value` to `decimals` places, without `-0`. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const out = Math.round(value * factor) / factor;
  return Object.is(out, -0) ? 0 : out;
}

/** Clamps into `[min, max]` (either bound optional). */
export function clampNumber(value: number, min?: number, max?: number): number {
  let out = value;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

/** The nearest multiple of `step` (no snapping for a step that is not a positive number). */
export function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Where stepping starts in an empty (or mixed) field: 0, kept inside `[min, max]`. */
export function stepStart(min?: number, max?: number): number {
  return clampNumber(0, min, max);
}

/** Formats a value for a number field: rounded, no trailing zeros. */
export function formatNumber(value: number, decimals: number): string {
  return String(roundTo(value, decimals));
}
