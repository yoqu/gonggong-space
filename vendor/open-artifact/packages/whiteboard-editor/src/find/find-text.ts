/**
 * The pure half of find in page (⌘F): how text and queries are folded
 * before they are compared, how a run of page text collapses its spaces the
 * way the browser draws them, the keys that open the bar and step through
 * matches, and what the bar's counter says.
 *
 * Matching ignores case, treats the no-break spaces as spaces, final sigma
 * as sigma and curly quotes as straight ones. A run whose white space
 * collapses (normal CSS text) is searched with the query's own space runs
 * collapsed to one space too.
 */

/** Most matches counted; the counter shows "+" past it. */
export const MAX_FIND_MATCHES = 1000;
/** Longest query the field takes. */
export const MAX_FIND_QUERY_CHARS = 200;
/** How long typing settles before a search, ms. */
export const FIND_DEBOUNCE_MS = 120;

/** Name of the bar, its field and placeholder. */
export const FIND_IN_PAGE_LABEL = 'Find in page';
/** The step buttons. */
export const PREVIOUS_MATCH_LABEL = 'Previous match';
export const NEXT_MATCH_LABEL = 'Next match';
/** The close button. */
export const CLOSE_FIND_BAR_LABEL = 'Close find bar';
/** Why the step buttons do nothing yet. */
export const TYPE_TO_SEARCH_LABEL = 'Type to search';
/** Said when nothing matches. */
export const NO_MATCHES_LABEL = 'No matches';

/** Characters folded to another before comparing. */
const FIND_FOLD_MAP: ReadonlyMap<string, string> = new Map([
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  ['ς', 'σ'],
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
]);
const FIND_FOLD_PATTERN = new RegExp(`[${[...FIND_FOLD_MAP.keys()].join('')}]`, 'g');
/** Text whose lower case may change its length (capital sigma, astral characters). */
const NEEDS_SLOW_FOLD = /[Σ\ud800-\udfff]/;
/** A run of spaces that collapses in normal text. */
const FIND_SPACE_RUN = /[ \t\n\r\f   ]+/g;

/**
 * Text folded for comparing, one UTF-16 unit per unit of the input (so
 * offsets into the folded text are offsets into the original).
 */
export function foldForFind(text: string): string {
  const fold = (value: string): string => value.replace(FIND_FOLD_PATTERN, (char) => FIND_FOLD_MAP.get(char) ?? char);
  const lower = text.toLowerCase();
  if (lower.length === text.length && !NEEDS_SLOW_FOLD.test(text)) return fold(lower);
  let folded = '';
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!.toLowerCase();
    folded += char.length === 1 ? char : text[at];
  }
  return fold(folded);
}

/** Where `needle` starts in `haystack` (folded, not overlapping). */
export function findOffsets(haystack: string, needle: string): number[] {
  if (needle === '') return [];
  const text = foldForFind(haystack);
  const query = foldForFind(needle);
  const offsets: number[] = [];
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) offsets.push(at);
  return offsets;
}

/** A query with its space runs collapsed, for runs whose spaces collapse. */
export function collapseFindSpaces(text: string): string {
  return text.replace(FIND_SPACE_RUN, ' ');
}

/** How a run treats white space: all collapses, newlines kept, or none. */
export type FindSpaceMode = 'all' | 'keep-newlines' | 'none';

/** The space mode of an element's computed `white-space` (`''` when unknown). */
export function whiteSpaceMode(whiteSpace: string, inPre: boolean): FindSpaceMode {
  if (whiteSpace === 'pre-line') return 'keep-newlines';
  if (whiteSpace === 'normal' || whiteSpace === 'nowrap') return 'all';
  if (whiteSpace === '') return inPre ? 'none' : 'all';
  return 'none';
}

/** A run of text as drawn, with where each of its characters came from. */
export interface FindTextRun<N> {
  /** The text, spaces collapsed as drawn. */
  text: string;
  /** The text nodes the run spans. */
  nodes: N[];
  /** For each character of `text`, its node (index into `nodes`). */
  nodeAt: number[];
  /** For each character of `text`, its offset in that node. */
  offsetAt: number[];
  /** Some of its spaces collapse (search it with a collapsed query). */
  collapses: boolean;
}

/** Characters that collapse to one space. */
function isCollapsibleSpace(char: string, mode: FindSpaceMode): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\f' || char === ' ' || char === ' ' || char === ' ' || (char === '\n' && mode === 'all');
}

/**
 * Builds runs of text from text nodes the way the browser draws them:
 * collapsible spaces fold into one, none at the start or end of a run. A
 * block boundary ends a run (`end`). `onRun` returns `false` to stop.
 */
export function createFindRunBuilder<N>(onRun: (run: FindTextRun<N>) => boolean, maxChars = 2_000_000) {
  let chars: string[] = [];
  let run: FindTextRun<N> = { text: '', nodes: [], nodeAt: [], offsetAt: [], collapses: false };
  let lastChar = '';
  let left = maxChars;
  let going = true;
  return {
    /** False once a run asked to stop (or the text budget ran out). */
    get going(): boolean {
      return going && left > 0;
    },
    /** Adds a text node's text, in its element's space mode. */
    add(node: N, data: string, mode: FindSpaceMode): void {
      const index = run.nodes.push(node) - 1;
      if (mode !== 'none') run.collapses = true;
      for (let offset = 0; offset < data.length && left > 0; offset++, left--) {
        let char = data[offset]!;
        if (mode !== 'none' && isCollapsibleSpace(char, mode)) {
          if (lastChar === '' || lastChar === ' ' || lastChar === '\n') continue;
          char = ' ';
        }
        chars.push(char);
        run.nodeAt.push(index);
        run.offsetAt.push(offset);
        lastChar = char;
      }
    },
    /** Ends the run (a block boundary or the end of the text). */
    end(): void {
      if (run.collapses && lastChar === ' ') {
        chars.pop();
        run.nodeAt.pop();
        run.offsetAt.pop();
      }
      if (chars.length > 0 && going) {
        run.text = chars.join('');
        going = onRun(run);
      }
      chars = [];
      run = { text: '', nodes: [], nodeAt: [], offsetAt: [], collapses: false };
      lastChar = '';
    },
  };
}

/** Where one match sits in a run: start and end node and offset. */
export interface FindRunMatch<N> {
  start: { node: N; offset: number };
  end: { node: N; offset: number };
}

/** The matches of a query in a run (`limit` most). */
export function matchesInRun<N>(run: FindTextRun<N>, query: string, limit = Number.POSITIVE_INFINITY): FindRunMatch<N>[] {
  const needle = run.collapses ? collapseFindSpaces(query) : query;
  const out: FindRunMatch<N>[] = [];
  for (const at of findOffsets(run.text, needle)) {
    if (out.length >= limit) break;
    const last = at + needle.length - 1;
    out.push({
      start: { node: run.nodes[run.nodeAt[at]!]!, offset: run.offsetAt[at]! },
      end: { node: run.nodes[run.nodeAt[last]!]!, offset: run.offsetAt[last]! + 1 },
    });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Keys                                                                     */
/* ------------------------------------------------------------------------ */

/** The key fields the find shortcuts read. */
export interface FindKeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** A letter key, by its letter or (on other layouts) its place. */
function keyMatchesLetter(event: Pick<FindKeyPress, 'key' | 'code'>, letter: string): boolean {
  return event.key.toLowerCase() === letter || event.code === `Key${letter.toUpperCase()}`;
}

/** ⌘ alone on Apple platforms, Ctrl alone elsewhere, never with ⌥. */
function hasPrimaryModifier(event: FindKeyPress, apple: boolean): boolean {
  return !event.altKey && (apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

/** ⌘F (Ctrl+F elsewhere) opens the bar. */
export function isFindShortcut(event: FindKeyPress, apple: boolean): boolean {
  return hasPrimaryModifier(event, apple) && !event.shiftKey && keyMatchesLetter(event, 'f');
}

/** ⌘G / ⇧⌘G (Ctrl elsewhere) and F3 / ⇧F3 step forward or back. */
export function findStepDirection(event: FindKeyPress, apple: boolean): 1 | -1 | undefined {
  const step = event.key === 'F3' ? !event.altKey && !event.metaKey && !event.ctrlKey : hasPrimaryModifier(event, apple) && keyMatchesLetter(event, 'g');
  if (!step) return undefined;
  return event.shiftKey ? -1 : 1;
}

/**
 * Whether ⌘G / F3 steps through matches rather than doing its board job:
 * F3 always does; ⌘G does unless it would group a selection (items
 * selected on an editable board, the keyboard not in a text field).
 */
export function ownsFindStepChord(event: FindKeyPress, state: { selected: number; editable: boolean; typing: boolean }): boolean {
  if (event.key === 'F3') return true;
  return state.selected === 0 || !state.editable || state.typing;
}

/* ------------------------------------------------------------------------ */
/* Status                                                                   */
/* ------------------------------------------------------------------------ */

/** What the bar shows. */
export interface FindStatus {
  query: string;
  total: number;
  /** 1-based index of the current match (0 when none). */
  current: number;
  /** More matches than {@link MAX_FIND_MATCHES}. */
  capped: boolean;
  /** A search is waiting or running. */
  searching: boolean;
}

/** Nothing searched. */
export const EMPTY_FIND_STATUS: FindStatus = { query: '', total: 0, current: 0, capped: false, searching: false };

/** The counter: `3/12`, `3/1000+`, or nothing while empty or searching. */
export function findCountText(status: FindStatus): string {
  if (status.query === '' || status.searching) return '';
  return `${status.current}/${status.total}${status.capped ? '+' : ''}`;
}

/** The counter as read out: "3 of 12", "3 of 1000 or more", "No matches". */
export function findCountMessage(current: number, total: number, capped: boolean): string {
  if (total === 0) return NO_MATCHES_LABEL;
  return capped ? `${current} of ${total} or more` : `${current} of ${total}`;
}

/** Why the step buttons are off: nothing typed, or nothing found (none while searching). */
export function findStepDisabledTip(status: FindStatus): string | undefined {
  if (status.query === '') return TYPE_TO_SEARCH_LABEL;
  return status.searching ? undefined : NO_MATCHES_LABEL;
}

/**
 * Keeps the last settled status while a new search runs, so the counter
 * does not flicker empty between keystrokes.
 */
export function steadyFindStatus(read: () => FindStatus): () => FindStatus {
  let settled: FindStatus | null = null;
  return () => {
    const status = read();
    if (status.query === '') settled = null;
    else if (!status.searching) settled = status;
    return status.searching && settled !== null ? settled : status;
  };
}
