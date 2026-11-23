/**
 * Creation progress: while the agent writes a deck, `deck.json` lists the
 * planned slide order before every slide file exists. This service tells
 * how far that has come, which slides arrived a moment ago (drawn with the
 * arrival animation), and what to announce when the agent stops ("Presentation
 * ready, 8 slides", "3 slides updated").
 *
 * A writing session runs while the agent reports itself busy. Without an
 * agent status (an agent that writes files directly), planned slides that
 * keep arriving count as writing until nothing has arrived for a while.
 */

import { toast } from '@open-artifact/ui';
import { create } from 'zustand';
import type { Slide } from '@open-artifact/slides-core';
import { useDeck } from '../state/deck.ts';
import { followAgentWrites, useAgent } from './agent.ts';
import { CREATION_TIMING, plannedIds, turnAnnouncement } from './creation-plan.ts';

export { plannedIds } from './creation-plan.ts';

/** How far the agent's writing has come: slides written of the slides planned. */
export interface WritingProgress {
  written: number;
  planned: number;
}

interface CreationState {
  /** The agent is writing (busy, or planned slides still arriving). */
  writing: boolean;
  /** This writing session started on an empty deck or an outline with slides to write. */
  creating: boolean;
  /** When the session started (ms since epoch). */
  startedAt: number;
  /** Slides that arrived a moment ago. */
  fresh: ReadonlySet<string>;
  /** The last announcement, for the live region (with a counter so a repeat is read again). */
  announcement: { text: string; n: number } | null;
}

/** Creation progress. */
export const useCreation = create<CreationState>()(() => ({ writing: false, creating: false, startedAt: 0, fresh: new Set(), announcement: null }));

/** Slides planned in the outline that have no file yet. */
export function usePlanned(): string[] {
  const order = useDeck((s) => s.index.order);
  const slides = useDeck((s) => s.slides);
  const writing = useCreation((s) => s.writing);
  // Planned cells only show while someone is writing them: an outline left half-written stays quiet.
  return writing ? plannedIds(order, slides) : [];
}

/**
 * Non-null while the agent is still writing a deck whose outline lists
 * slides that are not written yet: what an export would leave out.
 */
export function writingShortfall(): WritingProgress | null {
  const deck = useDeck.getState();
  if (deck.status !== 'ready') return null;
  if (!useAgent.getState().status.busy && !useCreation.getState().writing) return null;
  const missing = plannedIds(deck.index.order, deck.slides).length;
  if (missing === 0) return null;
  const written = Object.keys(deck.slides).length;
  return { written, planned: written + missing };
}

/* -------------------------------------------------------------------------- */
/* Session tracking                                                            */
/* -------------------------------------------------------------------------- */

/** Slides changed by someone else during the current session. */
const touched = new Set<string>();
/** The deck as the session started. */
let baseline: { count: number; slides: Record<string, Slide> } = { count: 0, slides: {} };

/** The sync service applied someone else's version of these slides. */
export function noteRemoteSlides(ids: readonly string[]): void {
  for (const id of ids) touched.add(id);
  followAgentWrites(ids);
  const state = useCreation.getState();
  if (!state.writing && !useAgent.getState().status.busy) maybeStartUnreported();
}

/** Announces a sentence to screen readers and as a toast. */
function announce(text: string): void {
  const previous = useCreation.getState().announcement;
  useCreation.setState({ announcement: { text, n: (previous?.n ?? 0) + 1 } });
  toast.add({ title: text });
}

let staleTimer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function begin(): void {
  clearTimeout(settleTimer);
  if (useCreation.getState().writing) return;
  const deck = useDeck.getState();
  const count = Object.keys(deck.slides).length;
  touched.clear();
  baseline = { count, slides: Object.fromEntries(Object.entries(deck.slides).map(([id, entry]) => [id, entry.slide])) };
  const creating = count === 0 || plannedIds(deck.index.order, deck.slides).length > 0;
  useCreation.setState({ writing: true, creating, startedAt: Date.now() });
}

function finish(): void {
  clearTimeout(staleTimer);
  clearTimeout(settleTimer);
  // The last files land a moment after the agent says it is done.
  settleTimer = setTimeout(() => {
    if (useAgent.getState().status.busy) return;
    const { creating } = useCreation.getState();
    useCreation.setState({ writing: false });
    const deck = useDeck.getState();
    const after = Object.keys(deck.slides).length;
    const changed = [...touched].filter((id) => deck.slides[id]?.slide !== baseline.slides[id]).length;
    touched.clear();
    const text = turnAnnouncement({ creating, touched: changed, before: baseline.count, after });
    if (text) announce(text);
  }, CREATION_TIMING.completionSettle);
}

/** Planned slides arriving with no agent status: writing until they stop arriving. */
function maybeStartUnreported(): void {
  const deck = useDeck.getState();
  if (plannedIds(deck.index.order, deck.slides).length === 0 && !useCreation.getState().writing) return;
  begin();
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    if (!useAgent.getState().status.busy) finish();
  }, CREATION_TIMING.staleTimeout);
}

let started = false;

/** Follows the agent's status and the slides arriving. Call once the deck is loaded. */
export function startCreation(): void {
  if (started) return;
  started = true;
  if (useAgent.getState().status.busy) begin();
  useAgent.subscribe((state, previous) => {
    if (state.status.busy === previous.status.busy) return;
    if (state.status.busy) begin();
    else if (useCreation.getState().writing) finish();
  });
  useDeck.subscribe((state, previous) => {
    if (state.slides === previous.slides) return;
    const arrived = Object.keys(state.slides).filter((id) => !previous.slides[id]);
    if (arrived.length === 0) return;
    if (!useCreation.getState().writing) return;
    const fresh = new Set(useCreation.getState().fresh);
    for (const id of arrived) fresh.add(id);
    useCreation.setState({ fresh });
    setTimeout(() => {
      const next = new Set(useCreation.getState().fresh);
      for (const id of arrived) next.delete(id);
      useCreation.setState({ fresh: next });
    }, CREATION_TIMING.slideArrival + 200);
  });
}
