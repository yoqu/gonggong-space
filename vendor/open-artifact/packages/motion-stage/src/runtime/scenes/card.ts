/*
 * A scene that is not written yet, or failed, shows a card with its name on the film's ground. The ink is white or
 * black, whichever stands out more (WCAG contrast) from the ground as the card shows it, greyed or not; at these
 * strengths it is at least 3 to 1 on every ground the canvas can read.
 */
export const LIGHT_INK = 'rgba(255,255,255,.72)';
export const DARK_INK = 'rgba(0,0,0,.64)';
export type CardInk = typeof LIGHT_INK | typeof DARK_INK;

type Rgb = [number, number, number];

/** How the canvas spells a colour: most CSS colours become #rrggbb or rgba(). What it cannot read leaves `failing`. */
function spelled(context: CanvasRenderingContext2D, ground: string, failing: string): string {
  const before = context.fillStyle;
  context.fillStyle = failing;
  context.fillStyle = ground;
  const spelling = String(context.fillStyle);
  context.fillStyle = before;
  return spelling;
}

/** The ground's red, green and blue, if it is an opaque colour the canvas reads (not a gradient, not var()). */
export function groundRgb(context: CanvasRenderingContext2D, ground: string): Rgb | null {
  const spelling = spelled(context, ground, '#ffffff');
  if (spelling !== spelled(context, ground, '#000000')) return null;
  const found = /^#(..)(..)(..)$/.exec(spelling);
  if (!found) return null;
  return [parseInt(found[1] ?? '0', 16), parseInt(found[2] ?? '0', 16), parseInt(found[3] ?? '0', 16)];
}

export const greyOf = (rgb: Rgb): number => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

function luminance(rgb: Rgb): number {
  const weights = [0.2126, 0.7152, 0.0722];
  return rgb.reduce((sum, channel, i) => {
    const x = channel / 255;
    return sum + (weights[i] ?? 0) * (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  }, 0.05);
}

/** The ink for a card on `rgb`, which is the card's ground as shown (greyed already where it is). */
export function cardInk(rgb: Rgb): CardInk {
  const apart = (shade: number, alpha: number): number => {
    const mixed: Rgb = [rgb[0] * (1 - alpha) + shade * alpha, rgb[1] * (1 - alpha) + shade * alpha, rgb[2] * (1 - alpha) + shade * alpha];
    const ratio = luminance(mixed) / luminance(rgb);
    return ratio > 1 ? ratio : 1 / ratio;
  };
  return apart(255, 0.72) >= apart(0, 0.64) ? LIGHT_INK : DARK_INK;
}

/** The card ink on whatever the canvas makes of the ground: an unreadable ground counts as its fallback. */
export function inkOn(context: CanvasRenderingContext2D, ground: string, greyed: boolean): CardInk {
  let rgb: Rgb | null = groundRgb(context, ground);
  if (!rgb) {
    const parts = (spelled(context, ground, '#ffffff').match(/[\d.]+/g) ?? ['255', '255', '255']).map(Number);
    rgb = [parts[0] ?? 255, parts[1] ?? 255, parts[2] ?? 255];
  }
  if (greyed) {
    const grey = greyOf(rgb);
    rgb = [grey, grey, grey];
  }
  return cardInk(rgb);
}
