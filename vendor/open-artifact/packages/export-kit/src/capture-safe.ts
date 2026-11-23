/**
 * Making a page readable by dom-to-svg for the length of one capture.
 *
 * dom-to-svg reads computed styles and SVG attributes as they are, and two
 * things in them break it:
 *
 * - a `linear-gradient()` written with CSS Color 4: an interpolation space
 *   (`in oklch`) or stops in `oklch()`, `lab()`, `color()`... Its gradient
 *   parser only knows `rgb()`, `rgba()`, hex and names, and throws on the
 *   rest, which fails the whole capture. {@link safeBackgroundImage} rewrites
 *   such a value with plain `rgba()` stops;
 * - a shape inside an inline `<svg>` sized in percentages (`<circle r="50%">`).
 *   The shape is copied into the drawing's own coordinates, where the
 *   percentage is taken of the whole drawing. {@link withCaptureSafeDom}
 *   pins those lengths to user units while the capture runs.
 */

/** Splits `text` at commas that are not inside parentheses. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/** Colour functions dom-to-svg's gradient parser reads. */
const PARSED_COLOR = /^(rgba?)$/i;
/** `in <space> [<hue method> hue]` in a gradient's first argument. */
const INTERPOLATION = /\s*\bin\s+[a-z-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?\s*/i;

/** Replaces every colour function the parser does not read with `toRgba(fn)`. */
function plainColors(argument: string, toRgba: (color: string) => string): string {
  let out = '';
  let i = 0;
  while (i < argument.length) {
    const match = /[a-z-]+\(/i.exec(argument.slice(i));
    if (!match) {
      out += argument.slice(i);
      break;
    }
    const at = i + match.index;
    const name = match[0].slice(0, -1);
    let depth = 0;
    let end = at + name.length;
    for (; end < argument.length; end++) {
      if (argument[end] === '(') depth++;
      else if (argument[end] === ')' && --depth === 0) break;
    }
    const call = argument.slice(at, end + 1);
    out += argument.slice(i, at) + (PARSED_COLOR.test(name) ? call : toRgba(call));
    i = end + 1;
  }
  return out;
}

/** Rewrites one `linear-gradient(...)` so dom-to-svg can parse it. */
function safeLinearGradient(layer: string, toRgba: (color: string) => string): string {
  const open = layer.indexOf('(');
  const name = layer.slice(0, open);
  const args = splitTopLevel(layer.slice(open + 1, layer.lastIndexOf(')')));
  const first = args[0] ?? '';
  // The first argument is a direction or angle (with or without an interpolation space), or an interpolation space alone.
  if (/^(to\b|-?[\d.]+(deg|rad|grad|turn)\b|in\b)/i.test(first)) {
    const direction = first.replace(INTERPOLATION, ' ').trim();
    if (direction) args[0] = direction;
    else args.shift();
  }
  return `${name}(${args.map((arg) => plainColors(arg, toRgba)).join(', ')})`;
}

/**
 * A computed `background-image` with each `linear-gradient()` rewritten to
 * the syntax dom-to-svg parses: no interpolation space, `rgba()` stops.
 * Other layers are left as they are. `toRgba` turns any CSS colour into
 * `rgba(r, g, b, a)`.
 */
export function safeBackgroundImage(value: string, toRgba: (color: string) => string): string {
  if (!/linear-gradient\(/i.test(value)) return value;
  return splitTopLevel(value)
    .map((layer) => (/^(-webkit-)?(repeating-)?linear-gradient\(/i.test(layer) ? safeLinearGradient(layer, toRgba) : layer))
    .join(', ');
}

/** Turns any CSS colour into `rgba(r, g, b, a)` by drawing it, in `view`'s document. */
function colorConverter(view: Window): (color: string) => string {
  const canvas = view.document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, string>();
  return (color) => {
    let rgba = cache.get(color);
    if (rgba) return rgba;
    rgba = 'rgba(0, 0, 0, 0)';
    if (context) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = 'rgba(0, 0, 0, 0)';
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      rgba = `rgba(${r}, ${g}, ${b}, ${Math.round((a! / 255) * 1000) / 1000})`;
    }
    cache.set(color, rgba);
    return rgba;
  };
}

/** Geometry attributes of SVG elements that may be percentages of the viewport. */
const LENGTH_ATTRIBUTES = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2'];

/** Pins percentage lengths of shapes inside inline `<svg>`s under `root` to user units; returns the undo. */
function pinSvgPercentages(root: Element): () => void {
  const saved: [Element, string, string][] = [];
  const shapes = root.ownerDocument.querySelectorAll('svg *');
  for (const shape of shapes) {
    if (!root.contains(shape)) continue;
    for (const name of LENGTH_ATTRIBUTES) {
      const value = shape.getAttribute(name);
      if (!value?.includes('%')) continue;
      const length = (shape as unknown as Record<string, unknown>)[name] as SVGAnimatedLength | undefined;
      if (!length?.baseVal) continue;
      let resolved: number;
      try {
        resolved = length.baseVal.value;
      } catch {
        continue;
      }
      saved.push([shape, name, value]);
      shape.setAttribute(name, String(resolved));
    }
  }
  return () => {
    for (const [shape, name, value] of saved) shape.setAttribute(name, value);
  };
}

/**
 * Runs `run` (a synchronous dom-to-svg pass over `root`) with the page made
 * readable by it: `getComputedStyle` hands out capture-safe background
 * images, and percentage lengths in inline SVG are pinned to user units.
 * Everything is put back before returning.
 */
export function withCaptureSafeDom<T>(root: Element, run: () => T): T {
  const view = root.ownerDocument.defaultView;
  if (!view) return run();
  const toRgba = colorConverter(view);
  const original = view.getComputedStyle;
  const patched = function (this: Window, element: Element, pseudo?: string | null) {
    const styles = original.call(view, element, pseudo);
    const backgroundImage = styles.backgroundImage;
    if (!backgroundImage || !backgroundImage.includes('linear-gradient(')) return styles;
    const safe = safeBackgroundImage(backgroundImage, toRgba);
    if (safe === backgroundImage) return styles;
    return new Proxy(styles, {
      get(target, property) {
        if (property === 'backgroundImage') return safe;
        if (property === 'getPropertyValue') return (name: string) => (name === 'background-image' ? safe : target.getPropertyValue(name));
        const value = (target as unknown as Record<string | symbol, unknown>)[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  const unpin = pinSvgPercentages(root);
  view.getComputedStyle = patched as typeof view.getComputedStyle;
  try {
    return run();
  } finally {
    view.getComputedStyle = original;
    unpin();
  }
}
