import { hexToOklch } from '../recolor/color.ts';
import { GRAY_COLOR_CHROMA } from './hue-groups.ts';
import { isDarkPaletteColor, paletteAccentColor, type PaletteChoice } from './scene-palettes.ts';
import { PALETTE_WORDS, type HueName, type PaletteNameForm } from './words.ts';

/** The hue names by OKLCH hue: each up to (not including) its degree. */
export const HUE_COLOR_NAMES: ReadonlyArray<readonly [number, HueName]> = [
  [10, 'Pink'],
  [35, 'Red'],
  [62, 'Orange'],
  [80, 'Amber'],
  [118, 'Yellow'],
  [138, 'Lime'],
  [170, 'Green'],
  [205, 'Teal'],
  [248, 'Sky'],
  [282, 'Blue'],
  [322, 'Violet'],
  [336, 'Magenta'],
  [360, 'Pink'],
];

/** The name of a `#rrggbb` color's hue: gray with little chroma, brown for a dark orange, olive for a dark yellow. */
export function colorName(hex: string): HueName {
  const { L, C, h } = hexToOklch(hex);
  if (C < GRAY_COLOR_CHROMA) return 'Gray';
  const name = HUE_COLOR_NAMES.find(([limit]) => h < limit)?.[1] ?? 'Pink';
  if ((name === 'Orange' || name === 'Amber') && L < 0.56) return 'Brown';
  if ((name === 'Yellow' || name === 'Lime') && L < 0.72) return name === 'Yellow' ? 'Olive' : 'Green';
  return name;
}

export interface PaletteHue {
  hue: HueName;
  as: PaletteNameForm;
}

/** What each palette is named after: a turned palette its first bar's hue, an offered one its accent's hue on its ground. */
export const paletteOptionHues = (choices: ReadonlyArray<Pick<PaletteChoice, 'bars' | 'role'>>): PaletteHue[] =>
  choices.map((choice) =>
    choice.role === undefined
      ? { hue: colorName(choice.bars[0]!), as: 'palette' }
      : { hue: colorName(paletteAccentColor(choice.bars)), as: isDarkPaletteColor(choice.bars[0]!) ? 'dark' : 'light' },
  );

/** The palettes' names, a number added to each name after its first. */
export function paletteOptionNames(hues: readonly PaletteHue[]): string[] {
  const names = hues.map((hue) => PALETTE_WORDS.named(hue.hue, hue.as));
  return names.map((name, index) => {
    const count = names.slice(0, index).filter((other) => other === name).length + 1;
    return count === 1 ? name : PALETTE_WORDS.numbered(name, count);
  });
}

/**
 * The names of the cards as listed: the film's own palette first (marked as the person's when they asked for it),
 * then the person's palettes as Yours, Yours 2…, and the others by hue.
 */
export function paletteCardNames(cards: ReadonlyArray<Pick<PaletteChoice, 'bars' | 'role'>>): string[] {
  const rest = cards.slice(1);
  const byHue = paletteOptionNames(paletteOptionHues(rest.filter((card) => card.role?.theirs !== true)));
  let yours = 0;
  let others = 0;
  return [
    cards[0]?.role?.theirs === true ? PALETTE_WORDS.ownYours : PALETTE_WORDS.own,
    ...rest.map((card) => (card.role?.theirs === true ? (++yours > 1 ? PALETTE_WORDS.yoursNumbered(yours) : PALETTE_WORDS.yours) : byHue[others++]!)),
  ];
}
