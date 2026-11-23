import type { ModuleKind } from '../names.ts';
import { FETCHED_FONTS_MODULE, RECOLORED_MODULE, RECUT_MODULE, REFACED_MODULE, RETOUCHED_MODULE, RETYPED_MODULE, SCENES_MODULE, isJsonModuleName } from '../names.ts';
import { scanStringLiterals } from '../retype/js-strings.ts';
import type { FilmSource } from '../retype/sources.ts';
import { collectSourceColors, colorSourceSpans, isColorLiteralContext } from '../recolor/scan.ts';

/** A black shadow (`rgba(0,0,0,.3)`): no palette changes it, so it never makes a film unsafe. */
export const BLACK_SHADOW_PATTERN = /rgba?\(\s*0(?:\s*,\s*|\s+)0(?:\s*,\s*|\s+)0\s*[,/]\s*(?:0?\.\d+|\d{1,2}%)\s*\)/gi;

const BLACK_WHITE_OPERAND = /(?:black|white|#000(?:000)?|#fff(?:fff)?)(?![\w-])(?:\s+([\d.]+)%)?/.source;
const PALETTE_VAR_OPERAND = /var\(--(?:ground|main|second|accent)\)(?:\s+([\d.]+)%)?/.source;
const BLACK_OPERAND = /(?:black|#000(?:000)?)(?![\w-])(?:\s+([\d.]+)%)?/.source;
const TRANSPARENT_OPERAND = /transparent(?:\s+([\d.]+)%)?/.source;
/** The most black or white a palette color may be mixed with and still follow the palette. */
export const COLOR_MIX_MAX_SHARE = 0.3;

/** `color-mix()` of two operands in either order; the groups are the percentages of `first, second`, then of `second, first`. */
const colorMixPattern = (first: string, second: string): RegExp =>
  new RegExp(String.raw`color-mix\(\s*in\s+[\w-]+(?:\s+[\w-]+\s+hue)?\s*,\s*(?:` + first + String.raw`\s*,\s*` + second + '|' + second + String.raw`\s*,\s*` + first + String.raw`)\s*\)`, 'gi');

const PALETTE_VAR_BLACK_WHITE_MIX_PATTERN = colorMixPattern(PALETTE_VAR_OPERAND, BLACK_WHITE_OPERAND);
const BLACK_TRANSPARENT_MIX_PATTERN = colorMixPattern(BLACK_OPERAND, TRANSPARENT_OPERAND);

/** The share of a `color-mix()`'s second operand, from the two percentages as written (either may be left out). */
export function colorMixSecondShare(first: string | undefined, second: string | undefined): number {
  const [a, b] =
    first === undefined && second === undefined
      ? [50, 50]
      : first === undefined
        ? [100 - Number(second), Number(second)]
        : second === undefined
          ? [Number(first), 100 - Number(first)]
          : [Number(first), Number(second)];
  return a + b > 0 ? b / (a + b) : 1;
}

/** The text without the color mixes a palette leaves alone: black faded to transparent, a palette color a little darker or lighter. */
export function stripNeutralColorMixes(text: string): string {
  const share = (_match: string, ...groups: unknown[]): number => {
    const [first, second, secondReversed, firstReversed] = groups.slice(0, 4).map((group) => (typeof group === 'string' ? group : undefined));
    return colorMixSecondShare(first ?? firstReversed, second ?? secondReversed);
  };
  return text
    .replace(BLACK_TRANSPARENT_MIX_PATTERN, (match: string, ...groups: unknown[]) => (share(match, ...groups) > 0 ? '' : match))
    .replace(PALETTE_VAR_BLACK_WHITE_MIX_PATTERN, (match: string, ...groups: unknown[]) => (share(match, ...groups) <= COLOR_MIX_MAX_SHARE ? '' : match));
}

/** A color function no palette pair can rewrite: `hsl()`, `oklch()`, `color()`…, or `rgb()` with percentages. */
export const UNSUPPORTED_COLOR_FUNCTION_PATTERN = /\b(?:hsla?|hwb|lab|lch|oklab|oklch|color)\(|\brgba?\([^)%]{0,80}%/i;
/** A color literal no palette pair can rewrite: a short hex color, or a common color name. */
export const UNSUPPORTED_COLOR_LITERAL_PATTERN =
  /#[0-9a-f]{3,4}(?![\w-])|(?<![\w-])(?:white|black|red|green|blue|yellow|orange|purple|pink|brown|gr[ae]y|silver|gold|navy|teal|ivory|beige|crimson|tomato|coral|salmon)(?![\w-])/gi;
/** A script string that comes right after one of these is a value given to a color. */
export const COLOR_ASSIGNMENT_BEFORE_PATTERN =
  /(?:[\w$\]]\s*=|[\w$]\s*:|[{,]\s*['"][\w-]+['"]\s*:|\|\||\?\?|=>|\breturn|(?:\bsetAttribute\(|\bsetAttributeNS\([^,()]*,|\.(?:attr|style)\()\s*['"](?:fill|stroke|background|[\w-]*color)['"]\s*,|\bsetProperty\(\s*['"][\w-]+['"]\s*,|\baddColorStop\([^,()]*,|\b(?:fill|stroke|background)\()\s*$/;
/** What may come before a word in a css value where a color name still reads as a color. */
export const NON_COLOR_BEFORE_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s;{"'`(])--[\w-]+:$/,
  /(?:^|[\s:,(])(?:transparent|currentcolor|underline|overline|line-through|wavy|no-repeat|repeat|center|medium|thin|thick)$/i,
  /\)$/,
  /\b(?:to|from|by|values)\s*=\s*["'](?:[^"']*;)?$/i,
];
/** Any color written in a module that is not code, which the palette would leave behind. */
export const PALETTE_FOREIGN_SOURCE_PATTERN = /#[0-9a-f]{3,8}(?![\w-])|\brgba?\(/i;
/** A color a script works out as a number (`0xff8800`). */
export const PALETTE_DYNAMIC_COLOR_PATTERN = /\b0x[0-9a-f]{6}\b/i;
/** The modules no palette is read in. */
export const PALETTE_EXCLUDED_MODULES: ReadonlySet<string> = new Set([
  SCENES_MODULE,
  RECOLORED_MODULE,
  RETYPED_MODULE,
  REFACED_MODULE,
  RECUT_MODULE,
  RETOUCHED_MODULE,
  FETCHED_FONTS_MODULE,
  'plan.json',
  'edits.json',
  'art.json',
]);

export const isColorSourceKind = (kind: ModuleKind): boolean => kind === 'js' || kind === 'css' || kind === 'html';

/** Whether the word at `from`–`to` stands where a css value takes a color. */
export const isCssColorValueContext = (text: string, from: number, to: number): boolean =>
  NON_COLOR_BEFORE_PATTERNS.some((pattern) => pattern.test(text.slice(Math.max(0, from - 200), from).trimEnd())) && !/^\s*\{/.test(text.slice(to, to + 40));

/**
 * A reader of whether a stretch of css stands in a declaration's value (not a selector, comment, string, or a `url()`
 * other than a data one). Asked about stretches in order.
 */
export function createCssDeclarationValueScanner(text: string): (start: number, end: number) => boolean {
  let index = 0;
  let inDeclaration = false;
  let quote = '';
  let inComment = false;
  let urlEnd = '';
  let urlIsPlain = false;
  return (start, end) => {
    for (; index < start; index++) {
      const character = text[index]!;
      if (inComment) {
        if (character === '*' && text[index + 1] === '/') {
          inComment = false;
          index++;
        }
      } else if (urlEnd !== '' || quote !== '') {
        if (character === '\\') index++;
        else if (character === urlEnd) urlEnd = '';
        else if (urlEnd === '' && (character === quote || character === '\n')) quote = '';
      } else if (character === '/' && text[index + 1] === '*') {
        inComment = true;
        index++;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '{' || character === '}' || character === ';') inDeclaration = false;
      else if (character === ':') inDeclaration = true;
      else if (character === '(' && /url$/i.test(text.slice(Math.max(0, index - 3), index))) {
        const opening = /^\s*(['"]?)\s*(data:)?/i.exec(text.slice(index + 1, index + 20))!;
        urlEnd = opening[1] || ')';
        urlIsPlain = opening[2] === undefined;
        index += opening[0].length;
      }
    }
    return inDeclaration && quote === '' && !inComment && (urlEnd === '' ? !/^[^;{}]*\{/.test(text.slice(end, end + 200)) : !urlIsPlain);
  };
}

/** Whether the source writes, where a color goes, a short hex color or a color name. */
export function hasUnsupportedColorLiteral(source: FilmSource): boolean {
  for (const { start, end, opens } of colorSourceSpans(source)) {
    const slice = source.kind === 'js' ? source.text.slice(start, end).replace(/\\(["'])/g, ' $1') : source.text.slice(start, end);
    const indent = slice.length - slice.trimStart().length;
    const scanner = source.kind === 'css' ? createCssDeclarationValueScanner(slice) : null;
    for (const match of slice.matchAll(UNSUPPORTED_COLOR_LITERAL_PATTERN)) {
      const from = match.index;
      const to = from + match[0].length;
      if (scanner !== null ? !scanner(from, to) : !isColorLiteralContext(slice, from, to, opens, false) && !isCssColorValueContext(slice, from, to)) continue;
      if (
        match[0][0] !== '#' &&
        from === indent &&
        opens &&
        !(slice.slice(to).trim() === '' && COLOR_ASSIGNMENT_BEFORE_PATTERN.test(source.text.slice(Math.max(0, start - 60), Math.max(0, start - 1))))
      )
        continue;
      return true;
    }
  }
  return false;
}

/**
 * Whether the film writes colors a palette could miss, so that a palette turning a light film dark (or a dark one
 * light) might leave something unreadable: a color the code writes that is not one of `palette`, a color in a
 * module that is not code, a color a script works out as a number, an `hsl()`-like function, a short hex color or a
 * color name.
 */
export function hasUnsafePaletteSources(sources: readonly FilmSource[], palette: readonly string[]): boolean {
  const read = sources
    .filter((source) => !PALETTE_EXCLUDED_MODULES.has(source.name))
    .map((source): FilmSource => {
      const kind: ModuleKind = isJsonModuleName(source.name) ? 'json' : source.kind;
      const text = source.text.replace(BLACK_SHADOW_PATTERN, '');
      return { ...source, kind, text: isColorSourceKind(kind) ? stripNeutralColorMixes(text) : text };
    });
  const code = read.filter((source) => isColorSourceKind(source.kind));
  const unreadable = (source: FilmSource): boolean => source.kind === 'js' && scanStringLiterals(source.text) === null;
  const colorText = (source: FilmSource): string =>
    source.kind !== 'js' || unreadable(source) ? source.text : colorSourceSpans(source).map((span) => source.text.slice(span.start, span.end)).join('\n');
  const hasUnsupported = (source: FilmSource): boolean =>
    code.includes(source) && !unreadable(source) ? hasUnsupportedColorLiteral(source) : new RegExp(UNSUPPORTED_COLOR_LITERAL_PATTERN.source, 'i').test(colorText(source));
  return (
    [...collectSourceColors(code)].some((hex) => !palette.includes(hex)) ||
    read.some(
      (source) =>
        (!code.includes(source) && PALETTE_FOREIGN_SOURCE_PATTERN.test(source.text)) ||
        (source.kind === 'js' && PALETTE_DYNAMIC_COLOR_PATTERN.test(source.text)) ||
        UNSUPPORTED_COLOR_FUNCTION_PATTERN.test(colorText(source)) ||
        hasUnsupported(source),
    )
  );
}
