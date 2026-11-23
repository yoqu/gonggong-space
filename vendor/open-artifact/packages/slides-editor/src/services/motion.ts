/**
 * Motion of source decks when presenting: the pure half. Reads the
 * animations, transitions and `@starting-style` the source reader kept for
 * each element (`Slide.motion`) and the deck's `@keyframes` / `@property`
 * rules, and works out what plays:
 *
 * - CSS animations play as the slide appears, as the sheet wrote them.
 * - `@starting-style` plays as a one-time animation from the starting style,
 *   with the element's transition duration, easing and delay (so
 *   `transition-delay` staggers a list in).
 * - A count-up: an animation whose first keyframe sets a registered numeric
 *   `@property` (`@keyframes count { from { --n: 0 } }`) counts the first
 *   number in the element's text up from that value.
 * - Flash guard: nothing changes more than three times a second. A looping
 *   animation faster than that stands still; a finite one is slowed down;
 *   a two-step one-shot between 100 and 333 ms takes 334 ms. SVG SMIL that
 *   flashes, or that cannot be read, is removed (see {@link guardSmil}).
 *
 * No DOM here: components/present/motion.ts applies it.
 */

/** The flash limit: changes per second. */
const FLASH_RATE = 3;
/** The shortest step of the flash guard, ms. */
const FLASH_STEP_MS = 1000 / FLASH_RATE;
/** A two-step one-shot between these takes {@link ONE_SHOT_MS}. */
const ONE_SHOT_RANGE: readonly [number, number] = [100, 333];
const ONE_SHOT_MS = 334;

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** Splits a value at top-level commas or spaces (parentheses kept whole). */
export function splitTop(value: string, by: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    const splits = depth === 0 && (by === ',' ? ch === ',' : /\s/.test(ch));
    if (splits) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * A time in ms: `1.2s`, `200ms`, `0`, or a `calc()` of times and numbers
 * (`calc(2 * 80ms)`, what `calc(var(--i) * 80ms)` becomes). Undefined when
 * it is not a time.
 */
export function parseTime(text: string): number | undefined {
  const value = text.trim().toLowerCase();
  const plain = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(value);
  if (plain) return Number(plain[1]) * (plain[2] === 's' ? 1000 : 1);
  if (value === '0') return 0;
  const calc = /^calc\((.*)\)$/.exec(value);
  if (!calc) return undefined;
  // Times as ms numbers, then a small + - * / evaluator.
  let sawTime = false;
  const expression = calc[1]!.replace(/(-?(?:\d+\.?\d*|\.\d+))(ms|s)\b/g, (_m, n: string, unit: string) => {
    sawTime = true;
    return String(Number(n) * (unit === 's' ? 1000 : 1));
  });
  const result = evaluate(expression);
  return sawTime && result !== undefined && Number.isFinite(result) ? result : undefined;
}

/** Evaluates `+ - * /` over numbers and parentheses; undefined for anything else. */
function evaluate(text: string): number | undefined {
  const tokens = text.match(/\d+\.?\d*|\.\d+|[-+*/()]|\S/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const primary = (): number | undefined => {
    const token = tokens[at++];
    if (token === undefined) return undefined;
    if (token === '(' || token === 'calc') {
      if (token === 'calc' && tokens[at++] !== '(') return undefined;
      const value = sum();
      return tokens[at++] === ')' ? value : undefined;
    }
    if (token === '-') {
      const value = primary();
      return value === undefined ? undefined : -value;
    }
    const n = Number(token);
    return Number.isFinite(n) ? n : undefined;
  };
  const product = (): number | undefined => {
    let value = primary();
    while (value !== undefined && (peek() === '*' || peek() === '/')) {
      const op = tokens[at++];
      const right = primary();
      if (right === undefined) return undefined;
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number | undefined => {
    let value = product();
    while (value !== undefined && (peek() === '+' || peek() === '-')) {
      const op = tokens[at++];
      const right = product();
      if (right === undefined) return undefined;
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  const value = sum();
  return at === tokens.length ? value : undefined;
}

/* -------------------------------------------------------------------------- */
/* Animations                                                                  */
/* -------------------------------------------------------------------------- */

/** One animation of an element. */
export interface Animation {
  name: string;
  duration: number;
  delay: number;
  /** Iterations (Infinity for `infinite`). */
  iterations: number;
  timing: string;
  direction: string;
  fill: string;
}

const TIMING = /^(?:ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\)|linear\(.*\))$/;
const DIRECTION = /^(?:normal|reverse|alternate|alternate-reverse)$/;
const FILL = /^(?:none|forwards|backwards|both)$/;
const PLAY_STATE = /^(?:running|paused)$/;

/** The animations an element's declarations name (`animation` and its longhands). */
export function parseAnimations(declarations: Readonly<Record<string, string>>): Animation[] {
  const list: Animation[] = [];
  const shorthand = declarations.animation;
  if (shorthand !== undefined) {
    for (const item of splitTop(shorthand, ',')) {
      const animation: Animation = { name: 'none', duration: 0, delay: 0, iterations: 1, timing: 'ease', direction: 'normal', fill: 'none' };
      let times = 0;
      for (const token of splitTop(item, ' ')) {
        const lower = token.toLowerCase();
        const time = parseTime(lower);
        if (time !== undefined && /[a-z)]$/.test(lower)) {
          if (times++ === 0) animation.duration = time;
          else animation.delay = time;
        } else if (lower === 'infinite') animation.iterations = Infinity;
        else if (/^\d+\.?\d*$/.test(lower)) animation.iterations = Number(lower);
        else if (TIMING.test(lower)) animation.timing = token;
        else if (DIRECTION.test(lower)) animation.direction = lower;
        else if (FILL.test(lower)) animation.fill = lower;
        else if (PLAY_STATE.test(lower)) continue;
        else animation.name = token;
      }
      list.push(animation);
    }
  }
  const longhand = (name: string): string[] | undefined => {
    const value = declarations[`animation-${name}`];
    return value === undefined ? undefined : splitTop(value, ',');
  };
  const names = longhand('name');
  if (names) {
    names.forEach((name, i) => {
      list[i] ??= { name: 'none', duration: 0, delay: 0, iterations: 1, timing: 'ease', direction: 'normal', fill: 'none' };
      list[i]!.name = name;
    });
  }
  const apply = (name: string, set: (animation: Animation, value: string) => void): void => {
    const values = longhand(name);
    if (!values?.length) return;
    list.forEach((animation, i) => set(animation, values[i % values.length]!));
  };
  apply('duration', (a, v) => (a.duration = parseTime(v) ?? a.duration));
  apply('delay', (a, v) => (a.delay = parseTime(v) ?? a.delay));
  apply('iteration-count', (a, v) => (a.iterations = v.trim() === 'infinite' ? Infinity : Number(v) || 1));
  apply('timing-function', (a, v) => (a.timing = v.trim()));
  apply('direction', (a, v) => (a.direction = v.trim()));
  apply('fill-mode', (a, v) => (a.fill = v.trim()));
  return list.filter((a) => a.name !== 'none' && /^-?[_a-zA-Z][-\w]*$/.test(a.name));
}

/** An animation as a CSS `animation` value. */
export function animationText(animation: Animation): string {
  const iterations = animation.iterations === Infinity ? 'infinite' : String(animation.iterations);
  return `${animation.name} ${Math.round(animation.duration)}ms ${animation.timing} ${Math.round(animation.delay)}ms ${iterations} ${animation.direction} ${animation.fill}`;
}

/** One `@keyframes` rule, read for the flash guard and count-ups. */
export interface Keyframes {
  /** Keyframe stops (`from`, `50%`, `to` → 3). */
  stops: number;
  /** Declarations of the first keyframe (`from` / `0%`). */
  from: Record<string, string>;
}

/** Index of the `}` closing the block opened just before `from`. */
function closeOf(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length;
}

/** Declarations of a block body. */
function declarationsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    out[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
  }
  return out;
}

/** The deck's `@keyframes` by name, and its registered `@property` syntaxes by name. */
export function readMotionRules(rules: readonly string[]): { keyframes: Map<string, Keyframes>; properties: Map<string, { syntax: string; initial?: string }> } {
  const keyframes = new Map<string, Keyframes>();
  const properties = new Map<string, { syntax: string; initial?: string }>();
  for (const rule of rules) {
    const head = /^@(keyframes|property)\s+([^{\s]+)\s*\{/.exec(rule);
    if (!head) continue;
    const body = rule.slice(head[0].length, rule.lastIndexOf('}'));
    if (head[1] === 'property') {
      const declarations = declarationsOf(body);
      const syntax = (declarations.syntax ?? '').replace(/^['"]|['"]$/g, '').trim();
      properties.set(head[2]!, declarations['initial-value'] !== undefined ? { syntax, initial: declarations['initial-value'] } : { syntax });
      continue;
    }
    let stops = 0;
    let from: Record<string, string> = {};
    let at = 0;
    while (at < body.length) {
      const open = body.indexOf('{', at);
      if (open < 0) break;
      const close = closeOf(body, open + 1);
      const selectors = body.slice(at, open).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      stops += selectors.length;
      if (selectors.some((s) => s === 'from' || s === '0%')) from = { ...from, ...declarationsOf(body.slice(open + 1, close)) };
      at = close + 1;
    }
    keyframes.set(head[2]!.replace(/^['"]|['"]$/g, ''), { stops, from });
  }
  return { keyframes, properties };
}

/**
 * The flash guard over an element's animations: looping animations that
 * change faster than three times a second are dropped, finite ones slowed
 * down to that rate, and a two-step one-shot between 100 and 333 ms takes
 * 334 ms. Animations of keyframes the deck does not define are dropped.
 */
export function guardAnimations(animations: readonly Animation[], keyframes: ReadonlyMap<string, Keyframes>): Animation[] {
  const out: Animation[] = [];
  for (const animation of animations) {
    const frames = keyframes.get(animation.name);
    if (!frames) continue;
    const changes = Math.max(1, frames.stops - 1);
    if (animation.iterations === Infinity) {
      if (animation.duration / changes < FLASH_STEP_MS) continue;
      out.push(animation);
      continue;
    }
    const total = changes * Math.max(1, Math.ceil(animation.iterations));
    if (total >= FLASH_RATE && animation.duration / changes < FLASH_STEP_MS) {
      out.push({ ...animation, duration: Math.ceil(changes * FLASH_STEP_MS) });
    } else if (total === 1 && animation.duration >= ONE_SHOT_RANGE[0] && animation.duration <= ONE_SHOT_RANGE[1]) {
      out.push({ ...animation, duration: ONE_SHOT_MS });
    } else out.push(animation);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Count-up                                                                    */
/* -------------------------------------------------------------------------- */

/** A number counting up to the one in the element's text. */
export interface CountUp {
  from: number;
  duration: number;
  delay: number;
}

const NUMERIC_SYNTAX = /^<(?:integer|number|percentage)>$/;

/**
 * The count-up of an element: its first animation whose first keyframe sets
 * a registered numeric property. Null when it has none.
 */
export function countUpOf(
  animations: readonly Animation[],
  keyframes: ReadonlyMap<string, Keyframes>,
  properties: ReadonlyMap<string, { syntax: string; initial?: string }>,
): CountUp | null {
  for (const animation of animations) {
    const frames = keyframes.get(animation.name);
    if (!frames || animation.duration <= 0) continue;
    for (const [name, value] of Object.entries(frames.from)) {
      const property = properties.get(name);
      if (!name.startsWith('--') || !property || !NUMERIC_SYNTAX.test(property.syntax)) continue;
      const from = Number.parseFloat(value);
      const initial = Number.parseFloat(property.initial ?? '0');
      return { from: Number.isFinite(from) ? from : Number.isFinite(initial) ? initial : 0, duration: animation.duration, delay: animation.delay };
    }
  }
  return null;
}

/** The first number of a text: its value, where it is, and how it is written. */
export { findNumber, countText, easeOut } from './count-player.ts';

/* -------------------------------------------------------------------------- */
/* @starting-style                                                             */
/* -------------------------------------------------------------------------- */

/** One transition of an element. */
interface TransitionItem {
  property: string;
  duration: number;
  delay: number;
  timing: string;
}

/** An element's transitions (`transition` and its longhands). */
export function parseTransitions(declarations: Readonly<Record<string, string>>): TransitionItem[] {
  const list: TransitionItem[] = [];
  const shorthand = declarations.transition;
  if (shorthand !== undefined) {
    for (const item of splitTop(shorthand, ',')) {
      const transition: TransitionItem = { property: 'all', duration: 0, delay: 0, timing: 'ease' };
      let times = 0;
      for (const token of splitTop(item, ' ')) {
        const time = parseTime(token);
        if (time !== undefined && /[a-z)]$/i.test(token)) {
          if (times++ === 0) transition.duration = time;
          else transition.delay = time;
        } else if (TIMING.test(token.toLowerCase())) transition.timing = token;
        else if (token !== 'allow-discrete' && token !== 'normal') transition.property = token.toLowerCase();
      }
      list.push(transition);
    }
  }
  const longhand = (name: string): string[] | undefined => {
    const value = declarations[`transition-${name}`];
    return value === undefined ? undefined : splitTop(value, ',');
  };
  const properties = longhand('property');
  if (properties) {
    properties.forEach((property, i) => {
      list[i] ??= { property: 'all', duration: 0, delay: 0, timing: 'ease' };
      list[i]!.property = property.toLowerCase();
    });
  }
  const apply = (name: string, set: (item: TransitionItem, value: string) => void): void => {
    const values = longhand(name);
    if (!values?.length) return;
    if (list.length === 0) list.push({ property: 'all', duration: 0, delay: 0, timing: 'ease' });
    list.forEach((item, i) => set(item, values[i % values.length]!));
  };
  apply('duration', (t, v) => (t.duration = parseTime(v) ?? t.duration));
  apply('delay', (t, v) => (t.delay = parseTime(v) ?? t.delay));
  apply('timing-function', (t, v) => (t.timing = v.trim()));
  return list;
}

/** CSS property names a transition property covers (`transform` covers `translate`, …). */
function covers(transition: string, property: string): boolean {
  if (transition === 'all' || transition === property) return true;
  if (transition === 'transform') return property === 'translate' || property === 'rotate' || property === 'scale';
  return property.startsWith(`${transition}-`);
}

/**
 * The entrance an element's `@starting-style` plays: one animation from the
 * starting style to its own style, per transitioned property, with that
 * transition's duration, easing and delay. Null when nothing it starts from
 * is transitioned (it would only cut).
 */
export function startingEntrance(
  name: string,
  starting: Readonly<Record<string, string>>,
  declarations: Readonly<Record<string, string>>,
): { keyframes: string; animations: Animation[] } | null {
  const transitions = parseTransitions(declarations).filter((t) => t.duration > 0);
  if (transitions.length === 0) return null;
  // Group the starting declarations by the transition that carries them.
  const groups = new Map<TransitionItem, Array<[string, string]>>();
  for (const [property, value] of Object.entries(starting)) {
    if (/[{};<]/.test(value) || !/^[a-z-]+$/.test(property)) continue;
    const transition = [...transitions].reverse().find((t) => covers(t.property, property));
    if (!transition) continue;
    groups.set(transition, [...(groups.get(transition) ?? []), [property, value]]);
  }
  if (groups.size === 0) return null;
  let css = '';
  const animations: Animation[] = [];
  [...groups].forEach(([transition, list], i) => {
    const keyframesName = `${name}-${i}`;
    css += `@keyframes ${keyframesName} { from { ${list.map(([p, v]) => `${p}: ${v}`).join('; ')} } }\n`;
    animations.push({ name: keyframesName, duration: transition.duration, delay: transition.delay, iterations: 1, timing: transition.timing, direction: 'normal', fill: 'backwards' });
  });
  return { keyframes: css, animations };
}

/* -------------------------------------------------------------------------- */
/* SVG SMIL                                                                    */
/* -------------------------------------------------------------------------- */

const SMIL = /<(animate|animateTransform|animateMotion|animateColor|set)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/gi;

/** One attribute of an SMIL element's attribute text. */
function attributeOf(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return match ? (match[1] ?? match[2]) : undefined;
}

/** An SMIL clock value in ms (`2s`, `500ms`, `1.5`, `00:02`); undefined when unreadable. */
export function smilClock(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = text.trim();
  const unit = /^(\d+\.?\d*|\.\d+)(h|min|s|ms)?$/.exec(value);
  if (unit) {
    const n = Number(unit[1]);
    return n * ({ h: 3_600_000, min: 60_000, s: 1000, ms: 1 }[unit[2] ?? 's'] ?? 1000);
  }
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (clock) return ((Number(clock[1] ?? 0) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000;
  return undefined;
}

/**
 * Whether one SMIL element may play: it changes at most three times a
 * second (a `<set>` at most six times a second) and its timing can be read
 * (one `begin`, a readable `dur`, a known `calcMode`).
 */
export function smilPlays(tag: string, attrs: string): boolean {
  const begin = attributeOf(attrs, 'begin');
  if (begin !== undefined && begin.includes(';')) return false;
  const calcMode = attributeOf(attrs, 'calcMode');
  if (calcMode !== undefined && !/^(?:linear|discrete|paced|spline)$/.test(calcMode.trim())) return false;
  const repeat = attributeOf(attrs, 'repeatCount');
  const repeatDur = attributeOf(attrs, 'repeatDur');
  const repeats = repeat?.trim() === 'indefinite' || repeatDur?.trim() === 'indefinite' ? Infinity : repeat !== undefined ? Number(repeat) : 1;
  if (!Number.isFinite(repeats) && repeats !== Infinity) return false;
  if (tag.toLowerCase() === 'set') {
    // A set changes once per begin; it flashes only when begun repeatedly.
    const dur = smilClock(attributeOf(attrs, 'dur'));
    if (dur === undefined) return repeats <= 1;
    return dur === 0 ? repeats <= 1 : 1000 / dur <= 6;
  }
  const dur = smilClock(attributeOf(attrs, 'dur'));
  if (dur === undefined || dur <= 0) return false;
  const values = attributeOf(attrs, 'values');
  const changes = values !== undefined ? Math.max(1, values.split(';').filter((v) => v.trim()).length - 1) : 1;
  const total = changes * (repeats === Infinity ? Infinity : Math.max(1, Math.ceil(repeats)));
  const rate = (changes * 1000) / dur;
  // One change played once is a move, not a flash.
  if (total === 1) return true;
  return total < FLASH_RATE || rate <= FLASH_RATE;
}

/**
 * SVG markup with its SMIL animation kept only where it may play: in
 * present mode, with motion allowed, and passing the flash guard.
 * Elsewhere every `<animate>`, `<set>`, … is removed, so the drawing
 * stands still at its own attributes.
 */
export function guardSmil(markup: string, play: boolean): string {
  if (!/<(?:animate|set)\b/i.test(markup)) return markup;
  return markup.replace(SMIL, (whole, tag: string, attrs: string) => (play && smilPlays(tag, attrs) ? whole : ''));
}

/** Resolve one source element's motion for both the live presenter and HTML export. */
export function elementMotion(
  declarations: Readonly<Record<string, string>>,
  starting: Readonly<Record<string, string>> | undefined,
  rules: ReturnType<typeof readMotionRules>,
  name: string,
) {
  const animations = guardAnimations(parseAnimations(declarations), rules.keyframes);
  const entrance = starting ? startingEntrance(name, starting, declarations) : null;
  return {
    animation: [...animations, ...(entrance?.animations ?? [])].map(animationText).join(', '),
    keyframes: entrance?.keyframes ?? '',
    count: countUpOf(animations, rules.keyframes, rules.properties),
  };
}
