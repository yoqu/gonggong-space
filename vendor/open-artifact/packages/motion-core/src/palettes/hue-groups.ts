import { MAX_RECOLORED_COLORS, type RecoloredColor } from '../records/recolored.ts';
import { hexToOklch, hueDistance, maxOklchChroma, rotateHueAtLuminance, type Oklch } from '../recolor/color.ts';
import { collectSourceColors } from '../recolor/scan.ts';
import { scanStringLiterals } from '../retype/js-strings.ts';
import type { FilmSource, TextSpan } from '../retype/sources.ts';
import type { PaletteChoice } from './scene-palettes.ts';

/** Less chroma than this is no hue at all. */
export const MIN_COLOR_CHROMA = 0.004;
/** Less chroma than this reads as gray. */
export const GRAY_COLOR_CHROMA = 0.04;
/** A vivid color: this much chroma, and this share of the most its lightness and hue allow. */
export const VIVID_COLOR_CRITERIA = { C: 0.07, share: 0.6 } as const;
/** How near in hue a color joins a group: a vivid one, and a faint one. */
export const HUE_GROUP_DISTANCE = { vivid: 10, faint: 25 } as const;
/** Hue groups this near each other are turned together. */
export const MAX_HUE_GROUP_SPREAD = 50;
/** A set of groups spread wider than this is not turned. */
export const MIN_HUE_GROUP_SPACING = 90;
/** The steps, in degrees, a set of hues is turned by. */
export const WARM_HUE_DISTANCE = 30;
/** A turn that loses more than this share of the strongest color's chroma is not offered. */
export const FAINT_CHROMA_SCALE = 0.7;
/** A turned vivid color must stay this far in hue from the film's other vivid colors. */
export const MIN_ACCENT_HUE_DISTANCE = 20;
/** The most turns offered for a set of hues. */
export const MAX_HUE_GROUPS = 5;
/** The most bars a turned palette's card shows. */
export const MAX_PALETTE_VARIANTS = 4;

/** Skin, wood and paper tones: warm hues of little chroma, never turned. */
export const isWarmLowChromaColor = (color: Oklch): boolean => color.h >= 8 && color.h <= 95 && color.C < 0.16;
/** A warm tone with enough chroma to be an accent: the hues near it are not turned. */
export const isWarmAccentColor = (color: Oklch): boolean => isWarmLowChromaColor(color) && color.C >= 0.06 && color.L < 0.93;
/** A muddy yellow a turn should not make. */
export const isDarkYellowColor = (color: Oklch): boolean => color.h >= 55 && color.h <= 130 && color.L < 0.75;

/** A set of the film's hues turned around the wheel: the film's own colors, the turns offered, and a turn to compare pictures by. */
export interface HueScheme {
  own: PaletteChoice;
  shifts: PaletteChoice[];
  /** The colors turned halfway round, to find whether the hues show on the picture. */
  probe: RecoloredColor[];
  /** The hues of the set's vivid colors. */
  hues: number[];
}

const HEX_COLOR_WITH_LETTER_PATTERN = /#(?=\d*[a-f])[0-9a-f]{6}(?:[0-9a-f]{2})?(?![\w-])/i;
const NUMERIC_HEX_COLOR_PATTERN = /#(\d{6})(?:\d{2})?(?![\w-])/g;

/** Markup with its tags, and the style sheets before the last `</style>`, reduced to `<>`. */
export function stripMarkupKeepingStyle(text: string): string {
  let lastStyleEnd = 0;
  for (const match of text.matchAll(/<\/style>/gi)) lastStyleEnd = match.index + match[0].length;
  return text.slice(0, lastStyleEnd).replace(/<style[\s\S]*?<\/style>|<[^<>]*>/gi, '<>') + text.slice(lastStyleEnd).replace(/<[^<>]*>/g, '<>');
}

/**
 * The all-digit hex tokens (`#123456`) the film writes as words, not colors: in the text of its markup, and in
 * strings that are no color (a string that is nothing but such a token counts as a color only beside a string that is
 * a hex color with letters).
 */
export function collectNonColorHexTokens(sources: readonly FilmSource[]): Set<string> {
  const tokens = new Set<string>();
  const addFrom = (text: string): void => {
    for (const match of text.matchAll(NUMERIC_HEX_COLOR_PATTERN)) tokens.add('#' + match[1]);
  };
  for (const { kind, text } of sources) {
    if (kind === 'html') addFrom(stripMarkupKeepingStyle(text));
    const literals = kind === 'js' ? (scanStringLiterals(text)?.literals ?? []) : [];
    const plain: TextSpan[] = literals
      .filter((literal) => literal.length === 1)
      .map(([span]) => span!)
      .sort((a, b) => a.start - b.start);
    const besideColor = (at: number, from: number, to: number): boolean => {
      const span = plain[at];
      const between = text.slice((plain[from]?.end ?? 0) + 1, Math.max(0, (plain[to]?.start ?? 0) - 1));
      return (
        span !== undefined &&
        new RegExp('^' + HEX_COLOR_WITH_LETTER_PATTERN.source + '$', 'i').test(text.slice(span.start, span.end)) &&
        between.length < 60 &&
        !/[)\]}]/.test(between)
      );
    };
    for (const literal of literals) {
      const slice = text.slice(literal[0]!.start, literal.at(-1)!.end);
      const at = /^#\d{6}$/.test(slice) ? plain.indexOf(literal[0]!) : -1;
      if (/<\/?[a-z]/i.test(slice)) addFrom(stripMarkupKeepingStyle(slice));
      else if (!HEX_COLOR_WITH_LETTER_PATTERN.test(slice) && !(at >= 0 && (besideColor(at - 1, at - 1, at) || besideColor(at + 1, at, at + 1)))) addFrom(slice);
    }
  }
  return tokens;
}

interface ReadColor extends Oklch {
  hex: string;
  vivid: boolean;
}

interface HueGroup {
  h: number;
  members: ReadColor[];
}

/**
 * The film's colors grouped by hue, each set of near groups offered turned round the wheel in steps of 30 degrees:
 * vivid colors start the groups, fainter ones join the nearest; warm low-chroma tones stay as they are, and a set
 * near a warm accent, spread too wide, or with too many colors is left out. Turns that fade the strongest color, make
 * a vivid one a dark yellow, or bring it near another vivid color are not offered; at most five are, spread evenly.
 */
export function deriveHueGroups(sources: readonly FilmSource[]): HueScheme[] {
  const words = collectNonColorHexTokens(sources);
  const colors: ReadColor[] = [...collectSourceColors(sources)]
    .filter((hex) => !words.has(hex))
    .sort()
    .map((hex) => {
      const color = hexToOklch(hex);
      const vivid =
        color.C >= VIVID_COLOR_CRITERIA.C && color.C / Math.max(0.000001, maxOklchChroma(color.L, color.h)) >= VIVID_COLOR_CRITERIA.share && !isWarmLowChromaColor(color);
      return { hex, ...color, vivid };
    });
  const groups: HueGroup[] = [];
  for (const color of colors.filter((item) => item.vivid).sort((a, b) => b.C - a.C)) {
    const group = groups.find((item) => hueDistance(item.h, color.h) <= HUE_GROUP_DISTANCE.vivid);
    if (group !== undefined) group.members.push(color);
    else groups.push({ h: color.h, members: [color] });
  }
  for (const color of colors.filter((item) => !item.vivid && item.C >= MIN_COLOR_CHROMA && !isWarmLowChromaColor(item))) {
    const nearest = [...groups].sort((a, b) => hueDistance(a.h, color.h) - hueDistance(b.h, color.h))[0];
    if (nearest !== undefined && hueDistance(nearest.h, color.h) <= (color.C < GRAY_COLOR_CHROMA ? HUE_GROUP_DISTANCE.faint : HUE_GROUP_DISTANCE.vivid))
      nearest.members.push(color);
  }
  const sets: HueGroup[][] = [];
  for (const group of [...groups].sort((a, b) => a.h - b.h)) {
    const last = sets.at(-1);
    if (last !== undefined && group.h - last.at(-1)!.h <= MAX_HUE_GROUP_SPREAD) last.push(group);
    else sets.push([group]);
  }
  if (sets.length > 1 && sets[0]![0]!.h + 360 - sets.at(-1)!.at(-1)!.h <= MAX_HUE_GROUP_SPREAD) sets[0] = [...sets.pop()!, ...sets[0]!];
  return sets.flatMap((set): HueScheme[] => {
    const members = set.flatMap((group) => group.members).sort((a, b) => b.C - a.C);
    if (
      (set.at(-1)!.h - set[0]!.h + 360) % 360 > MIN_HUE_GROUP_SPACING ||
      members.length > MAX_RECOLORED_COLORS ||
      colors.some((color) => isWarmAccentColor(color) && set.some((group) => hueDistance(group.h, color.h) <= HUE_GROUP_DISTANCE.vivid))
    )
      return [];
    const strongest = members[0]!;
    const otherVivid = colors.filter((color) => color.vivid && !members.includes(color));
    const shown = members.reduce<ReadColor[]>(
      (bars, color) => (bars.length < MAX_PALETTE_VARIANTS && bars.every((bar) => Math.abs(bar.L - color.L) >= 0.12) ? [...bars, color] : bars),
      [],
    );
    const turned = (degrees: number): PaletteChoice => ({
      pairs:
        degrees === 0
          ? []
          : members.map((color) => ({ was: color.hex, v: rotateHueAtLuminance(color.hex, degrees) })).filter((pair) => pair.was !== pair.v),
      bars: shown.map((color) => (degrees === 0 ? color.hex : rotateHueAtLuminance(color.hex, degrees))),
    });
    const turns = Array.from({ length: 360 / WARM_HUE_DISTANCE - 1 }, (_unused, index) => (index + 1) * WARM_HUE_DISTANCE).filter(
      (degrees) =>
        hexToOklch(rotateHueAtLuminance(strongest.hex, degrees)).C >= FAINT_CHROMA_SCALE * strongest.C &&
        !members.some(
          (color) =>
            color.vivid &&
            (isDarkYellowColor(hexToOklch(rotateHueAtLuminance(color.hex, degrees))) ||
              otherVivid.some((other) => hueDistance(other.h, color.h + degrees) < MIN_ACCENT_HUE_DISTANCE)),
        ),
    );
    const offered =
      turns.length <= MAX_HUE_GROUPS
        ? turns
        : Array.from({ length: MAX_HUE_GROUPS }, (_unused, index) => turns[Math.round((index * (turns.length - 1)) / (MAX_HUE_GROUPS - 1))]!);
    return offered.length === 0
      ? []
      : [{ own: turned(0), shifts: offered.map(turned), probe: turned(180).pairs, hues: members.filter((color) => color.vivid).map((color) => color.h) }];
  });
}
