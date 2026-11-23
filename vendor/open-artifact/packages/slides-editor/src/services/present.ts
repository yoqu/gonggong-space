/**
 * The presentation model: which slides play, the build steps of a slide,
 * and the phase of every build-animated element at a step.
 *
 * Builds belong to pinned children of the section. Numbered builds (1–50)
 * run in number order, builds sharing a number run together, and builds
 * without a number follow in source order. An `auto` build runs right after
 * the step before it (or as the slide appears, when it is the first).
 *
 * A source slide's in-flow fragments (`class="fragment"`, see
 * `Slide.motion`) are steps too: `data-fragment-index` N steps with build
 * N + 1, as a pinned fragment does; the rest follow in document order.
 */

import { isPinned, type BuildSpec, type Slide, type Transition } from '@open-artifact/slides-core';
import type { BuildPhase } from '../render/SlideView.tsx';
import { deckOrder, useDeck } from '../state/deck.ts';

/** One click (or automatic step) of a slide's builds. */
export interface BuildStep {
  /** Pinned child indexes that enter. */
  enter: number[];
  /** Pinned child indexes that leave. */
  exit: number[];
  /** Runs without waiting for a click. */
  auto: boolean;
  /** In-flow fragments revealed (element origins, see `Slide.motion`). */
  reveal?: number[];
}

/** Transition durations, ms. */
export const TRANSITION_MS: Record<Transition, number> = { fade: 320, push: 420, magic: 480 };

/** The slides that play, in order: not skipped, not held, not in conflict. */
export function playableSlides(): string[] {
  const state = useDeck.getState();
  return deckOrder(state).filter((id) => {
    const entry = state.slides[id];
    return entry && !entry.slide.hidden;
  });
}

/**
 * The build steps of a slide. `flow: false` leaves in-flow fragments out
 * for callers that need only the pinned build timeline.
 */
export function buildSteps(slide: Slide, options: { flow?: boolean } = {}): BuildStep[] {
  interface Event {
    /** Pinned child index, or -1 for an in-flow fragment. */
    child: number;
    /** Where it is in the document (orders unnumbered events). */
    place: number;
    kind: 'in' | 'out' | 'reveal';
    order?: number;
    auto: boolean;
    origin?: number;
  }
  const events: Event[] = [];
  const add = (event: Event, spec: BuildSpec): void => {
    events.push(spec.order !== undefined ? { ...event, order: spec.order } : event);
  };
  slide.children.forEach((child, i) => {
    if (!isPinned(child)) return;
    const place = child.origin ?? i;
    if (child.buildIn) add({ child: i, place, kind: 'in', auto: Boolean(child.buildIn.auto) }, child.buildIn);
    if (child.buildOut) add({ child: i, place, kind: 'out', auto: Boolean(child.buildOut.auto) }, child.buildOut);
  });
  if (options.flow !== false) {
    // Only source slides have fragments, and their pinned children all carry an origin.
    for (const fragment of slide.motion?.fragments ?? []) {
      const event: Event = { child: -1, place: fragment.origin, kind: 'reveal', auto: false, origin: fragment.origin };
      if (fragment.index !== undefined) event.order = Math.min(50, fragment.index + 1);
      events.push(event);
    }
  }
  if (events.length === 0) return [];
  // Numbered first (by number), then the rest in source order (ins before outs of one element).
  const numbered = events.filter((e) => e.order !== undefined).sort((a, b) => a.order! - b.order! || a.place - b.place);
  const rest = events.filter((e) => e.order === undefined).sort((a, b) => a.place - b.place);
  const steps: BuildStep[] = [];
  const put = (step: BuildStep, event: Event): void => {
    if (event.kind === 'reveal') (step.reveal ??= []).push(event.origin!);
    else (event.kind === 'in' ? step.enter : step.exit).push(event.child);
  };
  let lastOrder: number | undefined;
  for (const event of numbered) {
    if (event.order !== lastOrder || steps.length === 0) {
      steps.push({ enter: [], exit: [], auto: event.auto });
      lastOrder = event.order;
    }
    const step = steps[steps.length - 1]!;
    put(step, event);
    if (event.auto) step.auto = true;
  }
  for (const event of rest) {
    const step: BuildStep = { enter: [], exit: [], auto: event.auto };
    put(step, event);
    steps.push(step);
  }
  return steps;
}

/** In-flow fragments still hidden after `done` steps (element origins). */
export function hiddenFragments(slide: Slide, steps: readonly BuildStep[], done: number): Set<number> {
  const hidden = new Set((slide.motion?.fragments ?? []).map((f) => f.origin));
  for (const step of steps.slice(0, done)) for (const origin of step.reveal ?? []) hidden.delete(origin);
  return hidden;
}

/**
 * The phase of every build-animated child after `done` steps. The step just
 * played (`animate`) shows as entering / exiting.
 */
export function buildPhases(slide: Slide, steps: readonly BuildStep[], done: number, animate: boolean): Map<number, BuildPhase> {
  const phases = new Map<number, BuildPhase>();
  slide.children.forEach((child, i) => {
    if (!isPinned(child)) return;
    if (child.buildIn) phases.set(i, 'before');
    else if (child.buildOut) phases.set(i, 'shown');
  });
  steps.slice(0, done).forEach((step, k) => {
    const latest = animate && k === done - 1;
    for (const i of step.enter) phases.set(i, latest ? 'entering' : 'shown');
    for (const i of step.exit) phases.set(i, latest ? 'exiting' : 'gone');
  });
  return phases;
}

/** The number of steps an `auto` chain runs from `from` (inclusive). */
export function autoRun(steps: readonly BuildStep[], from: number): number {
  let n = 0;
  while (from + n < steps.length && steps[from + n]!.auto) n++;
  return n;
}
