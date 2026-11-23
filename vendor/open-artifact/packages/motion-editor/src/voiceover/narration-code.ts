/**
 * Reading and moving the start (`at`) of narration lines in the film's own code, where the narration is written as
 * `kit.narration((T) => ({ lines: [...] }))` in `modules/narration.js`, or as `window.CUT.narration = { lines: [...] }`
 * in the script. Only plain, unambiguous code is read: one narration, every line an object literal with a quoted
 * `text`, a quoted `audio` name and a numeric `dur`. Anything else is left to the agent.
 */

import { FILM_SCRIPT_PATH, MODULES_COLLECTION, NARRATION_MODULE, scanStringLiterals, splitModule, storeBytes, MAX_DOC_BYTES } from '@open-artifact/motion-core';
import type { FilmModule } from '@open-artifact/motion-core';

export interface NarrationFilm {
  script: string;
  modules: readonly FilmModule[];
}

interface CodeSpan {
  start: number;
  end: number;
}

interface NarrationCodeLine {
  audio: string;
  text: CodeSpan;
  at: CodeSpan | undefined;
}

interface NarrationCode {
  source: string;
  inScript: boolean;
  lines: NarrationCodeLine[];
}

const NUMBER_PATTERN = /^\d+(\.\d+)?$/;
const AUDIO_PATTERN = /^(['"])[A-Za-z0-9_.-]{1,64}\1$/;
const SCENES_ONLY_SCRIPT = /^\s*window\.CUT\s*=\s*kit\.scenes\(\)\s*;?\s*$/;
const KIT_LINES_PATTERN = /kit\.narration\(\s*(?:\(?\s*\w+\s*\)?\s*=>\s*\(\{|function\s*\(\s*\w+\s*\)\s*\{\s*return\s*\{)\s*lines\s*:\s*\[/g;
const CUT_LINES_PATTERN = /window\.CUT\.narration\s*=\s*\{\s*lines\s*:\s*\[/g;
/** `T.name` or `T["name"]`, plus or minus a number. */
const SCENE_AT_PATTERN = /^(T(?:\.[A-Za-z_$][\w$]*|\[(?:'[^'\\\n]*'|"[^"\\\n]*")\]))(?:\s*([+-])\s*(\d+(?:\.\d+)?))?$/;
const QUOTES = '\'"`';

const skipSpaces = (source: string, index: number): number => {
  let at = index;
  while (/\s/.test(source[at] ?? '')) at += 1;
  return at;
};

const roundSeconds = (value: number): number => Number(value.toFixed(2));

/** The index just past the quoted string starting at `index`, or -1 (unterminated, or a template with substitutions). */
function skipQuoted(source: string, index: number): number {
  const quote = source[index];
  for (let at = index + 1; at < source.length; at += 1) {
    const character = source[at];
    if (character === '\\') at += 1;
    else if (character === quote) return at + 1;
    else if (character === '\n' && quote !== '`') return -1;
    else if (quote === '`' && source.startsWith('${', at)) return -1;
  }
  return -1;
}

/** Where the property value starting at `index` ends (at its `,` or `}`); -1 when it holds a comment or a regex, or is unbalanced. */
function propertyEnd(source: string, index: number): number {
  let depth = 0;
  let at = index;
  while (at < source.length) {
    const character = source[at]!;
    if (QUOTES.includes(character)) {
      at = skipQuoted(source, at);
      if (at < 0) return -1;
      continue;
    }
    if (character === '/') return -1;
    if (depth === 0 && (character === ',' || character === '}')) return at;
    if ('([{'.includes(character)) depth += 1;
    if (')]}'.includes(character)) {
      depth -= 1;
      if (depth < 0) return -1;
    }
    at += 1;
  }
  return -1;
}

/** The lines of the `lines: [` array whose items start at `index`; null when any item is not a plain line. */
function scanLines(source: string, index: number): NarrationCodeLine[] | null {
  const lines: NarrationCodeLine[] = [];
  let at = index;
  for (;;) {
    at = skipSpaces(source, at);
    if (source[at] === ']') return lines;
    if (source[at] === ',') {
      at += 1;
      continue;
    }
    if (source[at] !== '{') return null;
    const properties = new Map<string, CodeSpan>();
    at = skipSpaces(source, at + 1);
    while (source[at] !== '}') {
      const key = /^[A-Za-z_$][\w$]*/.exec(source.slice(at, at + 64))?.[0];
      if (key === undefined) return null;
      at = skipSpaces(source, at + key.length);
      if (source[at] !== ':') return null;
      const start = skipSpaces(source, at + 1);
      const end = propertyEnd(source, start);
      if (end < 0) return null;
      properties.set(key, { start, end: start + source.slice(start, end).trimEnd().length });
      at = skipSpaces(source, source[end] === ',' ? end + 1 : end);
    }
    at += 1;
    const text = properties.get('text');
    const audio = properties.get('audio');
    const dur = properties.get('dur');
    if (text === undefined || audio === undefined || dur === undefined) return null;
    if (!QUOTES.includes(source[text.start] ?? ' ') || skipQuoted(source, text.start) !== text.end) return null;
    const audioCode = source.slice(audio.start, audio.end);
    if (!AUDIO_PATTERN.test(audioCode) || !NUMBER_PATTERN.test(source.slice(dur.start, dur.end))) return null;
    lines.push({ audio: audioCode.slice(1, -1), text, at: properties.get('at') });
  }
}

/** The narration module as the film runs it. */
const narrationModule = (film: NarrationFilm): FilmModule | undefined => film.modules.find((module) => module.name === NARRATION_MODULE);

/** The film's narration code: in the script when the script does more than `window.CUT = kit.scenes()`, else in the narration module. */
export function findNarrationCode(film: NarrationFilm): NarrationCode | null {
  const inScript = !SCENES_ONLY_SCRIPT.test(film.script);
  const source = inScript ? film.script : narrationModule(film)?.text;
  if (source === undefined) return null;
  const found = [...source.matchAll(inScript ? CUT_LINES_PATTERN : KIT_LINES_PATTERN)];
  if (found.length !== 1 || source.split(inScript ? 'CUT.narration' : 'kit.narration').length !== 2) return null;
  const match = found[0]!;
  const lines = scanLines(source, match.index + match[0].length);
  const strings = scanStringLiterals(source);
  if (lines === null || strings === null) return null;
  // Every line's words must be a string the code really has, not text inside a comment.
  const starts = new Set(strings.literals.flat().map((span) => span.start));
  return lines.every((line) => starts.has(line.text.start + 1)) ? { source, inScript, lines } : null;
}

/** The film has narration code at all (whether or not the page can read it). */
export function hasNarrationCode(film: NarrationFilm): boolean {
  return /\bCUT\.narration\b/.test(film.script) || narrationModule(film) !== undefined;
}

/** `code` (a number, or `T.name` / `T["name"]` plus or minus a number) moved by `seconds`; null when it is none of those or would go below 0. */
export function shiftNarrationAt(code: string, seconds: number): string | null {
  if (NUMBER_PATTERN.test(code)) return Number(code) + seconds < 0 ? null : String(roundSeconds(Number(code) + seconds));
  const match = SCENE_AT_PATTERN.exec(code);
  if (match === null) return null;
  const offset = roundSeconds((match[2] === '-' ? -1 : 1) * Number(match[3] ?? 0) + seconds);
  const scene = match[1]!;
  return offset === 0 ? scene : `${scene}${offset > 0 ? ' + ' : ' - '}${Math.abs(offset)}`;
}

function lineAtCode(code: NarrationCode, audio: string): string | null {
  const lines = code.lines.filter((line) => line.audio === audio);
  const at = lines[0]?.at;
  if (lines.length !== 1 || at === undefined) return null;
  const value = code.source.slice(at.start, at.end);
  return shiftNarrationAt(value, 0) === null ? null : value;
}

/** The `at` code of the narration line with this take, when it is one the page can move. */
export function narrationAtFor(film: NarrationFilm, audio: string): string | null {
  const code = findNarrationCode(film);
  return code === null ? null : lineAtCode(code, audio);
}

/** The takes whose lines the page can move: none unless the code has exactly as many lines as are played. */
export function movableTakes(film: NarrationFilm, lines: readonly { audio: string }[]): Set<string> {
  const code = findNarrationCode(film);
  if (code === null || code.lines.length !== lines.length) return new Set();
  return new Set(lines.filter((line) => lineAtCode(code, line.audio) !== null).map((line) => line.audio));
}

/** The narration code with the `at` code `was` of the line with this take put to `now`; null when it no longer reads `was`. */
export function withNarrationAt(film: NarrationFilm, audio: string, was: string, now: string): { source: string; inScript: boolean } | null {
  const code = findNarrationCode(film);
  const lines = code?.lines.filter((line) => line.audio === audio) ?? [];
  const at = lines[0]?.at;
  if (code === null || lines.length !== 1 || at === undefined || code.source.slice(at.start, at.end) !== was) return null;
  return { source: code.source.slice(0, at.start) + now + code.source.slice(at.end), inScript: code.inScript };
}

/** One document to write. */
export interface NarrationWrite {
  path: string;
  data: { code: string } | { kind: 'js'; text: string };
}

/**
 * The document that carries the moved line: `film/script`, or `modules/narration.js` kept whole. Null when the code
 * no longer reads `was`, or the module is stored in parts or would no longer fit one document (the page then leaves
 * it to the agent).
 */
export function narrationAtWrite(film: NarrationFilm, audio: string, was: string, now: string): NarrationWrite | null {
  const moved = withNarrationAt(film, audio, was, now);
  if (moved === null) return null;
  if (moved.inScript) {
    const data = { code: moved.source };
    return storeBytes(data) <= MAX_DOC_BYTES ? { path: FILM_SCRIPT_PATH, data } : null;
  }
  const module = narrationModule(film);
  if (module === undefined || (module.parts ?? 0) > 0 || module.kind !== 'js') return null;
  const parts = splitModule(NARRATION_MODULE, 'js', moved.source);
  if (parts === null || parts.length !== 1) return null;
  return { path: `${MODULES_COLLECTION}/${NARRATION_MODULE}`, data: { kind: 'js', text: moved.source } };
}

/** The film with every narration line's `at` code left out: what a change of a line's time does not change. */
export function withoutNarrationAts<Film extends NarrationFilm>(film: Film): Film {
  const code = findNarrationCode(film);
  if (code === null) return film;
  const source = code.lines.reduceRight((text, line) => (line.at === undefined ? text : text.slice(0, line.at.start) + text.slice(line.at.end)), code.source);
  if (code.inScript) return { ...film, script: source };
  return { ...film, modules: film.modules.map((module) => (module.name === NARRATION_MODULE ? { ...module, text: source } : module)) };
}
