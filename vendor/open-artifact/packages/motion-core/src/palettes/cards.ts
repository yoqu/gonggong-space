import type { RecoloredColor, RecoloredRecord } from '../records/recolored.ts';
import type { HueScheme } from './hue-groups.ts';
import type { PaletteChoice, ScenePalettes } from './scene-palettes.ts';

/** The most palette cards listed. */
export const MAX_PALETTE_CARDS = 9;

/** A palette card as the panel shows it. */
export interface PaletteCard {
  bars: string[];
  /** The film shows this palette now. */
  on: boolean;
  role?: { theirs: boolean };
}

/** Whether two sets of pairs are the same, in any order. */
export const equalColorPairs = (left: readonly RecoloredColor[], right: readonly RecoloredColor[]): boolean =>
  left.length === right.length && left.every((pair) => right.some((other) => other.was === pair.was && other.v === pair.v));

/** The record's colors the code still writes (`written`, from `collectSourceColors`). */
export const shownRecoloredColors = (record: RecoloredRecord, written: ReadonlySet<string>): RecoloredColor[] =>
  record.colors.filter((color) => written.has(color.was));

/** The record a palette card writes. */
export const recordForChoice = (choice: Pick<PaletteChoice, 'pairs'>): RecoloredRecord => ({ colors: choice.pairs.map(({ was, v }) => ({ was, v })) });

/**
 * The set of hues whose turns the record's colors come from (an index into `schemes`), or -1: none when no color is
 * changed or the colors are a palette `scenes.json` offers.
 */
export function schemeForColors(schemes: readonly HueScheme[], scenes: ScenePalettes | null, colors: readonly RecoloredColor[]): number {
  if (colors.length === 0 || (scenes !== null && scenes.options.some((option) => equalColorPairs(option.pairs, colors)))) return -1;
  return schemes.findIndex((scheme) => scheme.probe.some((pair) => colors.some((color) => color.was === pair.was)));
}

export interface PaletteCardsInput {
  schemes: readonly HueScheme[];
  /** The set of hues to offer turns of (an index into `schemes`), -1 for none. */
  scheme: number;
  scenes: ScenePalettes | null;
  /** The film's length is known. */
  timed: boolean;
  /** The record's colors the code still writes. */
  colors: readonly RecoloredColor[];
  /**
   * Colors a person set that no card offers, kept as a card of their own while the film's code stays the same (the
   * editor keeps it from the last call, and forgets it when the code changes).
   */
  kept: readonly RecoloredColor[] | null;
}

export interface PaletteCards {
  /** `null` when there is nothing to offer. */
  cards: PaletteChoice[] | null;
  /** What to pass as `kept` next time. */
  kept: readonly RecoloredColor[] | null;
}

/**
 * The palette cards: the film's own palette and those `scenes.json` offers (once the film's length is known), or the
 * film's own colors alone, then the turns of a set of hues; at most nine. Colors a person set that no card offers
 * get a card of their own after the offered palettes (or last). With nothing to offer but changed colors, a card of
 * the code's colors and one of the person's.
 */
export function paletteCards(input: PaletteCardsInput): PaletteCards {
  const { colors } = input;
  const scheme = input.schemes[input.scheme];
  const offered =
    input.scenes === null || !input.timed || (input.scenes.options.length === 0 && scheme === undefined) ? null : [input.scenes.own, ...input.scenes.options];
  if (scheme === undefined && offered === null)
    return {
      cards:
        colors.length > 0
          ? [
              { pairs: [], bars: colors.slice(0, 4).map((color) => color.was) },
              { pairs: [...colors], bars: colors.slice(0, 4).map((color) => color.v) },
            ]
          : null,
      kept: input.kept,
    };
  const lead = offered ?? [scheme!.own];
  const shifts = scheme?.shifts ?? [];
  const all = [...lead, ...shifts];
  const kept = colors.length > 0 && !all.slice(0, MAX_PALETTE_CARDS).some((card) => equalColorPairs(card.pairs, colors)) ? [...colors] : input.kept;
  if (kept === null) return { cards: all.slice(0, MAX_PALETTE_CARDS), kept };
  const first = lead[0]!;
  const own: PaletteChoice = {
    pairs: [...kept],
    bars: first.bars.map((bar) => kept.find((pair) => pair.was === bar)?.v ?? bar),
    ...(first.role === undefined ? {} : { role: { theirs: false } }),
  };
  return {
    cards: offered === null ? [...all.slice(0, MAX_PALETTE_CARDS - 1), own] : [...lead, own, ...shifts].slice(0, MAX_PALETTE_CARDS),
    kept,
  };
}

/**
 * The cards as the panel shows them, the one the film shows marked: the first while the film shows the original
 * text, none when the film could not play in its palette.
 */
export function paletteCardStates(
  cards: readonly PaletteChoice[],
  colors: readonly RecoloredColor[],
  state: { fell: boolean; original: boolean },
): PaletteCard[] {
  return cards.map((card, index) => ({
    bars: card.bars,
    on: state.original ? index === 0 : !state.fell && equalColorPairs(card.pairs, colors),
    ...(card.role === undefined ? {} : { role: card.role }),
  }));
}
