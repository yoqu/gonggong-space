/**
 * What the empty board says: one tip about asking the agent, picked at
 * random, and the hints that rotate while the agent fills the board.
 *
 * A tip with a scene (`tip-scenes.ts`) shows for the scene's length plus
 * {@link EMPTY_TIP_AFTER_SCENE_MS}; one without a scene, or with motion
 * reduced, for {@link EMPTY_TIP_SHOWN_MS}. The person's first click or key
 * hides it, except keys that only move focus or are modifiers
 * ({@link dismissesTip}).
 *
 * On a touch screen the keyboard tips give way to "Tap Ask …", and while
 * the agent works only the sharing hint rotates (the others are about a
 * mouse and keyboard).
 *
 * Pure: unit-tested. `EmptyBoard.tsx` draws it.
 */

/** How long a tip stays after its scene ends, ms. */
export const EMPTY_TIP_AFTER_SCENE_MS = 2000;
/** How long a tip without a scene (or with motion reduced) shows, ms. */
export const EMPTY_TIP_SHOWN_MS = 6000;

/** Delay before the first hint while the agent works, ms. */
export const WORKING_HINT_FIRST_DELAY_MS = 3000;
/** Time between hints while the agent works, ms. */
export const WORKING_HINT_INTERVAL_MS = 5000;
/** How long a hint takes to fade out, ms. */
export const WORKING_HINT_OUT_MS = 80;
/** How long a hint takes to fade in, ms. */
export const WORKING_HINT_IN_MS = 120;

/** Hints about using the board with a mouse and keyboard. */
export const WORKING_HINTS_BOARD_BASICS: readonly string[] = [
  'Double-click the board to add text.',
  'Double-click text to edit it.',
  'Drag across the board to select several things.',
  'Hold Space and drag to move around the board.',
  'Drag in a picture from your computer.',
];
/** Hints about sharing (true on every device). */
export const WORKING_HINTS_SHARING: readonly string[] = ['People you share with see your changes live.'];

/** Keys that leave the tip up: focus moves and modifiers. */
export const NON_DISMISSING_KEY_PATTERN =
  /^(Tab|F6|Shift|Control|Alt|AltGraph|Meta|OS|Hyper|Super|Fn|FnLock|Symbol|SymbolLock|CapsLock|NumLock|ScrollLock|Dead|Process|Unidentified)$/;

/** True when pressing `key` (a `KeyboardEvent.key`) hides the tip. */
export function dismissesTip(key: string): boolean {
  return !NON_DISMISSING_KEY_PATTERN.test(key);
}

/** The animated scenes, one per tip that has one. */
export type TipSceneKey = 'cmdk' | 'drag' | 'slash' | 'prototype' | 'sketch' | 'flowchart' | 'brainstorm' | 'explain' | 'timeline' | 'retro';

/** How long each scene plays, ms. */
export const TIP_SCENE_MS: Readonly<Record<TipSceneKey, number>> = {
  cmdk: 3000,
  drag: 3000,
  slash: 2300,
  prototype: 2800,
  sketch: 2900,
  flowchart: 2800,
  brainstorm: 2700,
  explain: 2900,
  timeline: 2700,
  retro: 3000,
};

/** A tip: `{}` in its words marks where its keys go. */
export interface EmptyTip {
  words: string;
  /** Key caps shown at `{}` (e.g. `['⌘', 'K']`). */
  keys?: readonly string[];
  scene?: TipSceneKey;
}

/** What decides the tips. */
export interface EmptyTipOptions {
  /** A touch screen: tap tips, no keyboard ones. */
  touch: boolean;
  /** The agent's display name. */
  name: string;
  /** An Apple platform (⌘ rather than Ctrl). */
  mac: boolean;
  /** `/` opens cursor chat here (single-letter keys on, and a room). */
  slash: boolean;
  /** The agent can make embeds (clickable prototypes). */
  embeds: boolean;
}

/** How tips name the agent: its name, or "the agent" for the generic one. */
export function agentWho(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' || /^agent$/i.test(trimmed) ? 'the agent' : trimmed;
}

/** The name of the tool bar's Ask button. */
export function askButtonName(name: string): string {
  return `Ask ${name.trim() || 'Agent'}`;
}

/** The ⌘K (Ctrl+K) key caps. */
export function askKeys(mac: boolean): readonly string[] {
  return mac ? ['⌘', 'K'] : ['Ctrl', 'K'];
}

/** The tips that apply now, in a fixed order. */
export function emptyBoardTips(options: EmptyTipOptions): EmptyTip[] {
  const who = agentWho(options.name);
  return [
    ...(options.touch
      ? [{ words: `Tap ${askButtonName(options.name)}` }]
      : [
          { words: `Press {} to ask ${who}`, keys: askKeys(options.mac), scene: 'cmdk' as const },
          { words: `Drag across an empty spot to ask ${who}`, scene: 'drag' as const },
          ...(options.slash ? [{ words: `Press {} to type at your cursor, and @${options.name.trim() || 'Agent'}`, keys: ['/'], scene: 'slash' as const }] : []),
        ]),
    ...(options.embeds ? [{ words: `Ask ${who} for a clickable prototype`, scene: 'prototype' as const }] : []),
    { words: `Ask ${who} for a sketch`, scene: 'sketch' },
    { words: `Ask ${who} to map out a system`, scene: 'flowchart' },
    { words: `Ask ${who} to brainstorm ideas`, scene: 'brainstorm' },
    { words: `Ask ${who} to explain a topic`, scene: 'explain' },
    { words: `Ask ${who} for a project timeline`, scene: 'timeline' },
    { words: `Ask ${who} to set up a retro`, scene: 'retro' },
  ];
}

/** The tip `chance` (0 ≤ chance < 1) picks. */
export function pickTip(tips: readonly EmptyTip[], chance: number): EmptyTip | undefined {
  return tips[Math.min(tips.length - 1, Math.max(0, Math.floor(chance * tips.length)))];
}

/** How long `tip` shows, ms (0 for none: it is over at once). */
export function tipShownMs(tip: EmptyTip | undefined, reducedMotion: boolean): number {
  if (tip === undefined) return 0;
  return tip.scene === undefined || reducedMotion ? EMPTY_TIP_SHOWN_MS : TIP_SCENE_MS[tip.scene] + EMPTY_TIP_AFTER_SCENE_MS;
}

/** The line screen readers hear about getting started. */
export function startedLine(options: Pick<EmptyTipOptions, 'touch' | 'name' | 'mac'>): string {
  return options.touch ? `To get started: tap ${askButtonName(options.name)}.` : `To get started: press ${options.mac ? '⌘K' : 'Ctrl+K'} to ask ${agentWho(options.name)}.`;
}

/** The hints that rotate while the agent works. */
export function workingHintLines(touch: boolean): readonly string[] {
  return touch ? WORKING_HINTS_SHARING : [...WORKING_HINTS_BOARD_BASICS, ...WORKING_HINTS_SHARING];
}

/** The working line: "The agent is working…" (or the agent's name). */
export function workingLabel(name: string): string {
  const who = agentWho(name);
  return `${who.charAt(0).toUpperCase()}${who.slice(1)} is working…`;
}
