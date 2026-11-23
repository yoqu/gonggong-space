import { drawnValue, isArtWords, styleOf } from '../layers/parts.ts';
import type { Entry, Verdict } from './entry.ts';
import { CORNERS, KEYS, propsOf, same, seenLook, trial } from './look.ts';
import type { Key, Seen, Value } from './look.ts';

/*
 * Whether a pair still holds on its thing: it yields only to a value the film gives this element itself. A value
 * that reaches the element from elsewhere (a variable set higher up, a rule for many) is one it shares, and a change
 * there would show on every element that shares it, so the pair is held to it.
 */

/** Each scene's box as it came up, with the classes in it, so a class counts as the element's own alike in every runner. */
export const boxes: Array<{ node: HTMLElement; names: Set<string> }> = [];

function alone(stage: HTMLElement, name: string): boolean {
  return stage.getElementsByClassName(name).length < 2 && !boxes.some((box) => box.names.has(name) && !stage.contains(box.node));
}

function probe(el: Element): CSSStyleDeclaration | null {
  return styleOf(el.ownerDocument.createElementNS(el.namespaceURI, 'i'));
}

/**
 * Whether a style attribute's text, read anew, lists the declarations el.style has, in whatever order. Not once a
 * longhand is set over a shorthand holding a var() and the film has written to el.style: taken off, it could not be
 * put back.
 */
export function intact(el: Element, text: string): boolean {
  const style = styleOf(el);
  const fresh = probe(el);
  if (!style || !fresh) return false;
  const all = (s: CSSStyleDeclaration): string => s.cssText.replace(/;\s*$/, '').split('; ').sort().join('; ');
  fresh.cssText = text;
  return all(fresh) === all(style);
}

/** The attributes of an svg text that set what a person may change. */
const WORN = ['fill', 'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing'];

/** An attribute's value as the engine takes it for the property of that name; '': none, or the engine drops it. */
function taken(el: Element, name: string): string {
  const style = probe(el);
  if (!style) return '';
  const said = (el.getAttribute(name) ?? '').trim();
  style.setProperty(name, said);
  // An attribute may leave out a length's unit, which not every engine allows in a declaration.
  if (!style.getPropertyValue(name) && /^[-+]?(\d*\.)?\d+(e[-+]?\d+)?$/i.test(said)) style.setProperty(name, said + 'px');
  return style.getPropertyValue(name);
}

/**
 * Reads how the film would draw the element but for what is its own: its style attribute, its id, each class nothing
 * else has, and on an svg text its paint and font attributes. `style` goes in place of its style attribute; null is
 * given back where that cannot be done.
 */
export function bare<T>(stage: HTMLElement, el: Element, style: string | null, read: () => T): T | null {
  const own = ['class', 'style', 'id'].concat(isArtWords(el) ? WORN.filter((name) => !/^\s*currentcolor\s*$|var\(/i.test(el.getAttribute(name) ?? '')) : []);
  const had = own.map((name) => el.getAttribute(name));
  const attribute = had[1];
  const torn = attribute !== null && attribute !== undefined && !intact(el, attribute);
  const outer = trial.on;
  if (torn && style) return null;
  if (torn) {
    own.splice(1, 1);
    had.splice(1, 1);
  }
  try {
    if (!torn) {
      if (style) el.setAttribute('style', style);
      else el.removeAttribute('style');
    }
    trial.on = !torn;
    for (const name of own.slice(torn ? 1 : 2)) el.removeAttribute(name);
    if (had[0] !== null) el.setAttribute('class', Array.from(el.classList).filter((name) => !alone(stage, name)).join(' '));
    return read();
  } finally {
    trial.on = outer;
    own.forEach((name, i) => {
      const value = had[i];
      if (value === null || value === undefined) el.removeAttribute(name);
      else el.setAttribute(name, value);
    });
  }
}

const bareSeen = (stage: HTMLElement, el: Element, style: string | null): Seen | null => bare(stage, el, style, () => seenLook(getComputedStyle(el), el));

/** The style rules that find the element, nested ones too, none under a media rule that does not apply. A sheet that may not be read is passed over. */
function rulesOf(el: Element): CSSStyleDeclaration[] {
  const out: CSSStyleDeclaration[] = [];
  const walk = (rules: CSSRuleList, within: string): void => {
    for (const rule of Array.from(rules)) {
      const own = rule instanceof CSSStyleRule ? rule.selectorText : '';
      const selector = !own || !within ? own || within : own.includes('&') ? own.split('&').join(':is(' + within + ')') : ':is(' + within + ') :is(' + own + ')';
      const style: unknown = Reflect.get(rule, 'style');
      try {
        if (style instanceof CSSStyleDeclaration && selector && el.matches(selector)) out.push(style);
      } catch {
        // A selector the engine does not take.
      }
      const kids: unknown = Reflect.get(rule, 'cssRules');
      if (kids instanceof CSSRuleList && !(rule instanceof CSSMediaRule && !window.matchMedia(rule.media.mediaText).matches)) walk(kids, selector);
    }
  };
  for (const sheet of Array.from(el.ownerDocument.styleSheets)) {
    try {
      walk(sheet.cssRules, '');
    } catch {
      // A sheet from elsewhere.
    }
  }
  return out;
}

interface Declaration {
  name: string;
  /** As drawn with each fallback that uses no var() taken out; null: it uses no var(). */
  value: string | null;
  important: boolean;
}

function declarations(key: Key, text: string, el: Element): Declaration[] {
  const props = propsOf(key, el);
  return text
    .split(';')
    .map((d) => {
      const i = d.indexOf(':');
      return { name: d.slice(0, i).trim().toLowerCase(), value: drawnValue(d.slice(i + 1).replace(/!\s*important\s*$/i, '').trim()), important: /!\s*important\s*$/i.test(d) };
    })
    .filter(({ name }) =>
      props.some((p) => p === name || ((name === 'background' || name === 'font') && p.startsWith(name + '-')) || (name === 'border-radius' && /-radius$/.test(p)) || (name === 'font' && p === 'line-height')),
    );
}

/** Leading and tracking are read as multiples of the font size, and corners may be given in em: a trial keeps the size. */
function pin(el: Element, key: Key): string[] {
  return key === 'leading' || key === 'tracking' || key === 'radius' ? ['font-size: ' + getComputedStyle(el).fontSize + ' !important'] : [];
}

/**
 * Whether the film's value `v` only reaches the element from elsewhere: in one of the blocks every declaration of the
 * property uses a var(), and those, put on the element in place of all that is its own, give `v`. Tried with each
 * made !important; unless `force`, also as important as each is.
 */
function handed(stage: HTMLElement, el: Element, key: Key, v: Value, texts: readonly string[], force: boolean): boolean {
  return texts.some((text) => {
    const mine = declarations(key, text, el);
    const gives = (all: boolean): boolean => {
      const seen = bareSeen(
        stage,
        el,
        mine
          .map((d) => d.name + ': ' + d.value + (all || d.important ? ' !important' : ''))
          .concat(pin(el, key))
          .join('; '),
      );
      return !seen || same(key, seen.values[key], v);
    };
    return mine.length > 0 && mine.every((d) => d.value !== null) && (gives(true) || (!force && gives(false)));
  });
}

/**
 * Judges the pairs of entry `e` on `el`. `so`: the verdict so far; a later look only turns a yes into a no. `must`:
 * at the entry's own moment; at others an element that is not displayed is passed over.
 */
export function judge(stage: HTMLElement, el: Element, e: Entry, so: Verdict | null, must: boolean): Verdict | null {
  const cs = getComputedStyle(el);
  if (!must && cs.display === 'none') return so;
  const now = seenLook(cs, el);
  let without: Seen | null = null;
  const shared = (key: Key, v: Value): boolean => {
    const set = Array.from(styleOf(el) ?? []);
    // Where the style attribute sets the property, only it is tried, less its comments.
    if (propsOf(key, el).some((p) => set.includes(p))) return handed(stage, el, key, v, [(el.getAttribute('style') ?? '').replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ')], false);
    // Else an svg text's attribute for the property, where what it says is what shows.
    const attribute = isArtWords(el) ? propsOf(key, el)[0] : undefined;
    const says = attribute !== undefined && WORN.includes(attribute) ? taken(el, attribute) : '';
    const tried = says && !/^(currentcolor|inherit|unset|revert|revert-layer)$/i.test(says) ? bareSeen(stage, el, [attribute + ': ' + says + ' !important', ...pin(el, key)].join('; ')) : null;
    if (tried && same(key, tried.values[key], v)) return handed(stage, el, key, v, [attribute + ': ' + says], false);
    // Else the rules.
    const pinned = pin(el, key)[0];
    const kept = pinned ? bareSeen(stage, el, pinned) : null;
    const b = kept ?? (without ??= bareSeen(stage, el, null));
    if (!b) return false;
    // Where the style attribute is left on, not being intact, only the rules that find the element by its id or a class of its own count.
    const ownRules = (): string[] => {
      let all = rulesOf(el);
      const text = el.getAttribute('style');
      if (text !== null && !intact(el, text))
        bare(stage, el, '', () => {
          const still = rulesOf(el);
          all = all.filter((rule) => !still.includes(rule));
        });
      return all.map((rule) => rule.cssText);
    };
    // Nor can the font size be kept there: a reading at another size tells nothing.
    if (pinned && b === without && b.values.px !== now.values.px) return !ownRules().some((rule) => declarations(key, rule, el).some((d) => d.value === null));
    return same(key, b.values[key], v) || handed(stage, el, key, v, ownRules(), true);
  };
  const verdict: Verdict = so ?? { round: now.round, art: isArtWords(el), own: {}, holds: {} };
  for (const key of KEYS) {
    const pair = e.pairs[key];
    if (!pair || verdict.holds[key] === false) continue;
    const value = now.values[key];
    if (!so) verdict.own[key] = !same(key, value, pair.was) && value !== null && shared(key, value) ? value : pair.was;
    verdict.holds[key] = same(key, value, verdict.own[key] ?? pair.was);
  }
  return verdict;
}

/** What of an entry holds (`good`) or has lapsed, as the marks say it. The film's own choice of round corners takes the new radius; if none is round, all four do. */
export function marksOf(e: Entry, verdict: Verdict, good: boolean): string {
  return KEYS.filter((key) => e.pairs[key] && verdict.holds[key] === good)
    .map((key) => (good && key === 'radius' ? (verdict.round.length ? verdict.round : CORNERS).join(' ') : good && key === 'ink' && verdict.art ? 'paint' : key))
    .join(' ');
}
