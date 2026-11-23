/**
 * Words for what the agent is doing on the board: the label on a claimed
 * area ("Adding…"), the line a screen reader hears ("The agent is adding on
 * the board"), the whimsical word shown while nothing more specific is
 * known, and the stagger with which new elements from the agent appear.
 *
 * Pure: unit-tested without a DOM.
 */

import type { ElementType } from '@open-artifact/whiteboard-core';

/** The gerund of the leading verb of a request, by verb. */
export const ASK_VERB_GERUNDS: Readonly<Record<string, string>> = {
  add: 'Adding',
  align: 'Aligning',
  arrange: 'Arranging',
  brainstorm: 'Brainstorming',
  build: 'Building',
  change: 'Changing',
  chart: 'Charting',
  check: 'Checking',
  clean: 'Cleaning up',
  cluster: 'Clustering',
  color: 'Coloring',
  colour: 'Colouring',
  connect: 'Connecting',
  convert: 'Converting',
  create: 'Creating',
  delete: 'Deleting',
  design: 'Designing',
  diagram: 'Diagramming',
  draft: 'Drafting',
  draw: 'Drawing',
  expand: 'Expanding',
  explain: 'Explaining',
  fill: 'Filling in',
  fix: 'Fixing',
  format: 'Formatting',
  group: 'Grouping',
  improve: 'Improving',
  label: 'Labeling',
  link: 'Linking',
  list: 'Listing',
  make: 'Making',
  map: 'Mapping',
  merge: 'Merging',
  move: 'Moving',
  number: 'Numbering',
  organize: 'Organizing',
  organise: 'Organising',
  outline: 'Outlining',
  plan: 'Planning',
  polish: 'Polishing',
  put: 'Placing',
  rearrange: 'Rearranging',
  redo: 'Redoing',
  remove: 'Removing',
  rename: 'Renaming',
  reorder: 'Reordering',
  reorganize: 'Reorganizing',
  resize: 'Resizing',
  restyle: 'Restyling',
  rewrite: 'Rewriting',
  shorten: 'Shortening',
  simplify: 'Simplifying',
  sketch: 'Sketching',
  sort: 'Sorting',
  split: 'Splitting',
  structure: 'Structuring',
  style: 'Styling',
  summarize: 'Summarizing',
  summarise: 'Summarising',
  tidy: 'Tidying',
  translate: 'Translating',
  turn: 'Turning',
  update: 'Updating',
  write: 'Writing',
};

/** Greetings and polite openers dropped before looking for the verb. */
const ASK_PREFIXES: readonly RegExp[] = [
  /^(hi|hey|hello|yo|ok|okay|so|um|uh|alright|great|thanks|thank you)\b[\s,.!:;-]*/i,
  /^(agent|assistant)\b[\s,.!:;-]*/i,
  /^@\S+[\s,.!:;-]*/,
  /^(please|pls|plz|kindly)\b[\s,.!:;-]*/i,
  /^(can|could|would|will) (you|u)\b[\s,.!:;-]*/i,
  /^(i'?d like (you )?to|i want (you )?to|i need (you )?to|help me|let'?s|go ahead and|try to|just)\b[\s,.!:;-]*/i,
];

/**
 * The activity a request names, from its leading verb: "please add three
 * risks" gives "Adding". `undefined` when the request does not start with
 * a verb this page knows.
 */
export function askActivity(text: string): string | undefined {
  let rest = text.trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const before = rest;
    for (const prefix of ASK_PREFIXES) rest = rest.replace(prefix, '').trimStart();
    if (rest === before) break;
  }
  const verb = /^[A-Za-z]+/.exec(rest)?.[0]?.toLowerCase();
  return verb === undefined ? undefined : ASK_VERB_GERUNDS[verb];
}

/** What the agent is doing when it writes an element of a type. */
export function elementActivity(type: ElementType): string | undefined {
  switch (type) {
    case 'text':
    case 'note':
    case 'shape':
      return 'Writing';
    case 'stroke':
    case 'image':
      return 'Sketching';
    case 'arrow':
      return 'Connecting';
    case 'container':
      return 'Grouping';
    case 'table':
      return 'Charting';
    case 'html':
      return 'Building';
    default:
      return undefined;
  }
}

/** The line a screen reader hears for an activity: "The agent is adding on the board." */
export function activityAnnouncement(activity: string): string {
  return `The agent is ${activity.toLowerCase()} on the board.`;
}

/** Words shown on a claim while nothing more specific is known. */
export const WORKING_WORDS: readonly string[] = [
  'Thinking',
  'Pondering',
  'Mulling',
  'Tinkering',
  'Puzzling',
  'Doodling',
  'Noodling',
  'Brewing',
  'Scheming',
  'Musing',
  'Conjuring',
  'Percolating',
  'Whittling',
  'Untangling',
];

/** Least time a working word stays before a more specific label replaces it (ms). */
export const WORKING_WORD_MIN_HOLD_MS = 1300;

/** How often the working word changes (ms). */
export const WORKING_WORD_TURN_MS = 8000;

/** A working word other than `previous`, picked with `random` (0 ≤ r < 1). */
export function nextWorkingWord(previous: string | undefined, random: () => number = Math.random): string {
  const choices = WORKING_WORDS.filter((word) => word !== previous);
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] ?? WORKING_WORDS[0]!;
}

/** Longest delay between two elements appearing (ms). */
export const APPEAR_MAX_STEP_MS = 280;

/** Total time over which a batch of new elements appears (ms). */
export const APPEAR_SPAN_MS = 700;

/** How long one element takes to appear (ms). */
export const APPEAR_DURATION_MS = 500;

/** Most elements of one batch that animate (the rest appear at once). */
export const APPEAR_MAX_ITEMS = 85;

/**
 * Start delays of a batch of `count` new elements, in the order they were
 * written: evenly spread over {@link APPEAR_SPAN_MS}, never more than
 * {@link APPEAR_MAX_STEP_MS} apart. Elements past {@link APPEAR_MAX_ITEMS}
 * get `undefined` (no animation).
 */
export function appearDelays(count: number): Array<number | undefined> {
  const animated = Math.min(count, APPEAR_MAX_ITEMS);
  const step = animated <= 1 ? 0 : Math.min(APPEAR_MAX_STEP_MS, APPEAR_SPAN_MS / (animated - 1));
  return Array.from({ length: Math.max(0, count) }, (_, index) => (index < animated ? Math.round(index * step) : undefined));
}
