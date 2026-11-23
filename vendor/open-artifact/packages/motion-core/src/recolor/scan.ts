import type { Film } from '../film/decode.ts';
import { parseJsonRecord } from '../json.ts';
import { SCENES_MODULE, isJsonModuleName } from '../names.ts';
import { scanStringLiterals } from '../retype/js-strings.ts';
import { filmSources, type FilmSource, type TextSpan } from '../retype/sources.ts';
import { hexToRgb, rgbToHex } from './color.ts';
import { PALETTE_ROLES, readBaseCssPalette, type PaletteRole } from './film-palette.ts';

/** A stretch of a source colors are read in; `opens` when it is the first part of a string, which may hold a color alone. */
export interface ColorSpan extends TextSpan {
  opens: boolean;
}

/**
 * A color the code writes: `#rrggbb` (an alpha after it kept), or the numbers of `rgb()`/`rgba()`. Groups: the hex
 * digits; or the opening, red, separator, green, separator, blue.
 */
export const SOURCE_COLOR_PATTERN =
  /#([0-9a-f]{6})(?:[0-9a-f]{2})?(?![\w-])|(?<![\w-])(rgba?\(\s*)(\d{1,3})(\s*,\s*|\s+)(\d{1,3})(\s*,\s*|\s+)(\d{1,3})(?=\s*[,/)])/gi;

/** What may come right before a hex color (trailing blanks dropped) for it to be read as a color. */
export const COLOR_CONTEXT_PATTERNS: readonly RegExp[] = [
  /[,=[{]$/,
  /(?<![\w-])(?!(?:not|is|where|has|url)\()[\w-]+\($/,
  /(?:^|[\s;{"'`(])[a-z-]+:$/,
  /\b(?:fill|stroke|color|stop-color|flood-color|lighting-color|bgcolor|background)\s*=\s*["']$/i,
  /#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i,
  /(?:^|[\s:,(])(?:solid|dashed|dotted|double|groove|ridge|inset|outset|0|[\d.]+(?:px|r?em|v[hw]|%|deg|fr|m?s))$/i,
];

/** A string that starts after one of these is a selector, link or id, never a color on its own. */
export const NO_COLOR_SCAN_TEMPLATE_PATTERN =
  /(?:\b(?:querySelector(?:All)?|closest|matches|getElementById)\(|\.(?:href|hash)\s*=|['"](?:xlink:)?href['"]\s*,|url\(['"]\s*\+)\s*$/;

/** Where a source's colors are read: all of a css or html module, the strings of a script, nothing of a json module. */
export function colorSourceSpans(source: FilmSource): ColorSpan[] {
  if (isJsonModuleName(source.name)) return [];
  switch (source.kind) {
    case 'css':
    case 'html':
      return [{ start: 0, end: source.text.length, opens: false }];
    case 'js':
      return (scanStringLiterals(source.text)?.literals ?? [])
        .flatMap((literal) =>
          literal.map((span, index) => ({
            ...span,
            opens: index === 0 && !NO_COLOR_SCAN_TEMPLATE_PATTERN.test(source.text.slice(Math.max(0, span.start - 41), span.start - 1)),
          })),
        )
        .sort((a, b) => a.start - b.start);
    case 'json':
    case 'text':
      return [];
  }
}

/**
 * Whether the hex color at `from`–`to` of a text is a color: not a selector (`#id {`), in css within a declaration,
 * and after something a color follows; at the very start of a string only when the string `opens` near its start.
 */
export function isColorLiteralContext(text: string, from: number, to: number, opens: boolean, css: boolean): boolean {
  const before = text.slice(Math.max(0, from - 200), from).trimEnd();
  if (/^\s*\{/.test(text.slice(to, to + 40))) return false;
  if (css && !text.slice(Math.max(text.lastIndexOf('{', from), text.lastIndexOf('}', from), text.lastIndexOf(';', from)) + 1, from).includes(':')) return false;
  return before === '' ? opens && from <= 200 : COLOR_CONTEXT_PATTERNS.some((pattern) => pattern.test(before));
}

/**
 * The source's text with each color it writes passed through `replace` (as `#rrggbb` lower case). A hex color keeps
 * its alpha and, when written all in capitals, stays in capitals; `rgb()` keeps its separators.
 */
export function replaceSourceColors(source: FilmSource, replace: (hex: string) => string): string {
  let result = '';
  let copiedUntil = 0;
  for (const { start, end, opens } of colorSourceSpans(source)) {
    const slice = source.text.slice(start, end);
    result +=
      source.text.slice(copiedUntil, start) +
      slice.replace(
        SOURCE_COLOR_PATTERN,
        (
          match: string,
          hex: string | undefined,
          opening: string | undefined,
          red: string | undefined,
          firstSeparator: string | undefined,
          green: string | undefined,
          secondSeparator: string | undefined,
          blue: string | undefined,
          offset: number,
        ): string => {
          if (
            hex === undefined
              ? Number(red) > 255 || Number(green) > 255 || Number(blue) > 255
              : !isColorLiteralContext(slice, offset, offset + match.length, opens, source.kind === 'css')
          )
            return match;
          const was = hex === undefined ? rgbToHex([Number(red), Number(green), Number(blue)]) : '#' + hex.toLowerCase();
          const v = replace(was);
          if (v === was) return match;
          if (hex !== undefined) return '#' + (/[A-F]/.test(hex) && !/[a-f]/.test(hex) ? v.slice(1).toUpperCase() : v.slice(1)) + match.slice(7);
          const [newRed, newGreen, newBlue] = hexToRgb(v);
          return `${opening ?? ''}${newRed}${firstSeparator ?? ''}${newGreen}${secondSeparator ?? ''}${newBlue}`;
        },
      );
    copiedUntil = end;
  }
  return result + source.text.slice(copiedUntil);
}

/** Every color the sources write, as `#rrggbb` lower case. */
export function collectSourceColors(sources: readonly FilmSource[]): Set<string> {
  const colors = new Set<string>();
  for (const source of sources)
    replaceSourceColors(source, (hex) => {
      colors.add(hex);
      return hex;
    });
  return colors;
}

/** A color the film's code writes, as a person can change it. */
export interface FilmColor {
  /** `#rrggbb`, lower case. */
  hex: string;
  /** How many times the code writes it. */
  count: number;
  /** The sources that write it, by name (`''` for the cut). */
  sources: string[];
  /** The palette roles `base.css` gives it. */
  roles: PaletteRole[];
  /** It is the background `scenes.json` names. */
  background: boolean;
}

/** The background color `scenes.json` names, as `#rrggbb` lower case, or `null`. */
export function scenesBackground(sources: readonly FilmSource[]): string | null {
  const background = parseJsonRecord(sources.find((source) => source.name === SCENES_MODULE)?.text)?.background;
  return typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) ? background.toLowerCase() : null;
}

/** Every color the film's code writes (the colors a person may change), most used first. */
export function scanFilmColors(film: Pick<Film, 'script' | 'modules'>): FilmColor[] {
  const sources = filmSources(film);
  const found = new Map<string, FilmColor>();
  for (const source of sources)
    replaceSourceColors(source, (hex) => {
      const color = found.get(hex) ?? { hex, count: 0, sources: [], roles: [], background: false };
      color.count++;
      if (!color.sources.includes(source.name)) color.sources.push(source.name);
      found.set(hex, color);
      return hex;
    });
  const palette = readBaseCssPalette(sources);
  palette?.forEach((hex, index) => found.get(hex)?.roles.push(PALETTE_ROLES[index]!));
  const background = scenesBackground(sources);
  const backgroundColor = background === null ? undefined : found.get(background);
  if (backgroundColor !== undefined) backgroundColor.background = true;
  return [...found.values()].sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
}
