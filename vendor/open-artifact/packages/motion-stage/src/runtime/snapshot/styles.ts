/*
 * Once a shorthand holding a var() (border: 2px solid var(--line)) has had a longhand set or removed, any write to
 * el.style makes the browser write the other longhands with no value ("border-top-width: ;"), and a copy drawn from
 * that text lacks them. The copy gets the values shown instead. A value over LONGEST_FILLED characters (in practice a
 * picture) fills none: the rest alone would show the background colour without its picture.
 */
const LONGEST_FILLED = 2048;

/**
 * getComputedStyle gives currentcolor as the element's own colour, which children would then inherit as fixed; and a
 * unitless line-height in px. It rounds a border, outline or column-rule width down to device pixels, which a
 * snapshot drawn at a ratio of 1 would draw thinner: the whole px just above is written.
 */
function shownValue(el: Element, shown: CSSStyleDeclaration, property: string): string {
  const value = shown.getPropertyValue(property);
  const up = Math.ceil(parseFloat(value));
  if (
    /^(border-(top|right|bottom|left|(block|inline)-(start|end))|outline|column-rule)-width$/.test(property) &&
    devicePixelRatio > 1 &&
    up - parseFloat(value) < 1 / devicePixelRatio
  )
    return up + 'px';
  if (/^(text-emphasis|-webkit-text-(fill|stroke))-color$/.test(property)) return value === shown.color ? 'currentcolor' : value;
  if (property !== 'line-height') return value;
  if (typeof el.computedStyleMap === 'function') return String(el.computedStyleMap().get(property));
  const ratio = parseFloat(value) / parseFloat(shown.fontSize);
  return isFinite(ratio) ? String(ratio) : value;
}

/** copy: el's clone, or the picture that stands in for it. */
export function sayWholeStyle(el: Element, copy: Element): void {
  try {
    const text = copy.getAttribute('style') ?? '';
    if (!/: ( !important)?;/.test(text) || !(el instanceof HTMLElement || el instanceof SVGElement)) return;
    const own = el.style;
    const shown = getComputedStyle(el);
    const unsaid = new Set([...own].filter((property) => own.getPropertyValue(property) === ''));
    let fits = true;
    // An escaped character and a quoted string are stepped over whole: a string may hold what looks like an empty value.
    const filled = text.replace(
      /\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(^|; )([-a-z]+): ( !important)?(?=;)/g,
      (found: string, lead: string | undefined, property: string | undefined, important: string | undefined) => {
        if (!property) return found;
        const value = unsaid.has(property) ? shownValue(el, shown, property) : '';
        if (value.length > LONGEST_FILLED) fits = false;
        return (lead ?? '') + property + ': ' + value + (important ?? '');
      },
    );
    if (fits) copy.setAttribute('style', filled);
  } catch {
    // The picture lacks what it lacked before.
  }
}

/**
 * The clone is searched first, the stage only if the clone has such a style. They are paired by position, so where
 * their counts differ (a custom element may change itself as it is cloned) nothing is filled.
 */
export function sayWholeStyles(node: Element, clone: Element): void {
  const lacking = (root: Element): Element[] => {
    const query = '[style*=": ;"], [style*=":  !important;"]';
    return [...root.querySelectorAll(query), ...(root.matches(query) ? [root] : [])];
  };
  const copies = lacking(clone);
  const originals = copies.length ? lacking(node) : [];
  if (originals.length !== copies.length) return;
  copies.forEach((copy, i) => {
    const original = originals[i];
    if (original) sayWholeStyle(original, copy);
  });
}

/*
 * For small previews: a shift of SLIGHT_PX px is hardly seen there, yet a browser filters a filter's whole region
 * for every snapshot. A feDisplacementMap moves a pixel by at most half its scale, in the element's own units.
 */
const SLIGHT_PX = 1.25;
const FILTER_ID = /^\s*url\(\s*["']?#([^"')\s]+)["']?\s*\)\s*$/;

export function dropSlightDisplacement(clone: Element, scale: number): void {
  const slight = new Map<string, boolean>();
  for (const filter of clone.querySelectorAll('filter')) {
    // Where two filters share an id, a browser uses the first.
    if (slight.has(filter.id)) continue;
    const last = filter.lastElementChild;
    slight.set(
      filter.id,
      !!last &&
        last.localName === 'feDisplacementMap' &&
        last.getAttribute('in') === 'SourceGraphic' &&
        (Math.abs(parseFloat(last.getAttribute('scale') ?? '') || 0) / 2) * scale <= SLIGHT_PX &&
        filter.getAttribute('primitiveUnits') !== 'objectBoundingBox' &&
        !filter.hasAttribute('href') &&
        !filter.hasAttribute('xlink:href'),
    );
  }
  const isSlight = (value: string): boolean => {
    const found = FILTER_ID.exec(value);
    return !!found && slight.get(found[1] ?? '') === true;
  };
  for (const named of clone.querySelectorAll('[filter]')) if (isSlight(named.getAttribute('filter') ?? '')) named.removeAttribute('filter');
  // Edited as text: a write to el.style re-serializes the attribute. Set to none, not removed, so no other filter applies.
  for (const styled of clone.querySelectorAll('[style*="url("]')) {
    const had = styled.getAttribute('style') ?? '';
    const now = had.replace(/(^|;)\s*filter\s*:([^;]*)/gi, (all: string, lead: string, value: string) => (isSlight(value) ? lead + 'filter:none' : all));
    if (now !== had) styled.setAttribute('style', now);
  }
}
