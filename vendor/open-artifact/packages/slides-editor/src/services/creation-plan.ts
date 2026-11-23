/**
 * The pure half of creation progress (services/creation.ts): which planned
 * slides are not written yet, the timing of the rotating tips, and what is
 * announced when the agent finishes. No DOM or stores here, so it is
 * unit-tested directly.
 */

/** Tip timing, ms. */
export interface TipTiming {
  tipInitialDelay: number;
  tipRotation: number;
}

/** Timing of the creation view, ms. */
export const CREATION_TIMING = {
  /** The first tip shows this long after writing starts (until then: "<agent> is writing…"). */
  tipInitialDelay: 3000,
  /** Each tip shows this long. */
  tipRotation: 5000,
  /** Delay between skeleton cells appearing, one after another. */
  cellStagger: 25,
  /** A slide that arrives is drawn with the arrival animation for this long. */
  slideArrival: 375,
  /** After the agent stops, wait this long for its last files before announcing. */
  completionSettle: 2000,
  /** Planned slides with no agent status and nothing arriving for this long: no longer "writing". */
  staleTimeout: 90_000,
} as const;

/** Tips shown while the agent writes (`{agent}` is the agent's name). */
export const CREATION_TIPS: readonly string[] = [
  'Double-click any text to edit it.',
  'Comment on any slide, and {agent} can revise it.',
  'Use @ in a comment to mention someone.',
  'Drag an image from your computer onto a slide.',
  'Every edit saves automatically.',
  'People you share with see your changes live.',
  'Drag a slide thumbnail to change the order.',
  'Select anything on a slide to comment on it.',
];

/** Ids listed in the index order with no file yet (planned, not written), each once. */
export function plannedIds(order: readonly string[], files: ReadonlySet<string> | Record<string, unknown>): string[] {
  const has = files instanceof Set ? (id: string) => files.has(id) : (id: string) => Object.prototype.hasOwnProperty.call(files, id);
  const seen = new Set<string>();
  return order.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return !has(id);
  });
}

/** The tip shown `elapsed` ms after writing started: -1 for the "writing…" line, else an index into the tips. */
export function tipIndexAt(elapsed: number, timing: TipTiming = CREATION_TIMING): number {
  if (elapsed < timing.tipInitialDelay) return -1;
  return Math.floor((elapsed - timing.tipInitialDelay) / timing.tipRotation);
}

/** How long until the tip after the one shown at `elapsed` ms. */
export function nextTipDelay(elapsed: number, timing: TipTiming = CREATION_TIMING): number {
  if (elapsed < timing.tipInitialDelay) return timing.tipInitialDelay - elapsed;
  return timing.tipRotation - ((elapsed - timing.tipInitialDelay) % timing.tipRotation);
}

/** The text of tip `index` (-1: the "writing" line). */
export function tipText(index: number, agent: string): string {
  if (index < 0 || CREATION_TIPS.length === 0) return `${agent} is writing…`;
  return CREATION_TIPS[index % CREATION_TIPS.length]!.replace('{agent}', agent);
}

/** What one agent turn did to the deck, as seen by this tab. */
export interface TurnSummary {
  /** The turn started on an empty deck, or on an outline with slides still to write. */
  creating: boolean;
  /** Slides written or changed by others during the turn. */
  touched: number;
  /** Slides in the deck before and after. */
  before: number;
  after: number;
}

/**
 * What is announced when the agent finishes: "Presentation ready, N slides"
 * after writing a new deck, "N slides updated" after changing some,
 * "Presentation updated, N slides in all" when only the outline changed
 * (slides removed or reordered). Null: nothing changed.
 */
export function turnAnnouncement(summary: TurnSummary): string | null {
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  if (summary.creating && summary.after > 0 && (summary.touched > 0 || summary.after !== summary.before)) {
    return `Presentation ready, ${plural(summary.after, 'slide', 'slides')}`;
  }
  if (summary.touched > 0) return `${plural(summary.touched, 'slide', 'slides')} updated`;
  if (summary.after !== summary.before) {
    return summary.after === 0 ? 'Presentation updated, no slides left' : `Presentation updated, ${plural(summary.after, 'slide', 'slides')} in all`;
  }
  return null;
}
