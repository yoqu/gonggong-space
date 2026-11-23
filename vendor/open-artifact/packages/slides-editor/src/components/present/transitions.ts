/**
 * Slide transitions while presenting, with the Web Animations API.
 *
 * A slide's transition says how it *leaves*: going forward plays the
 * outgoing slide's transition, going back plays the transition of the
 * slide returned to, reversed.
 *
 * - fade (320 ms): the incoming slide fades in over the outgoing one.
 * - push (420 ms): the incoming slide pushes the outgoing one off the side.
 * - magic move (480 ms): top-level elements with the same id on both
 *   slides move and resize from their old place to their new one (FLIP);
 *   everything else cross-fades, background included.
 */

import { SLIDE_WIDTH, TRANSITIONS, type Slide, type Transition } from '@open-artifact/slides-core';
import { TRANSITION_MS } from '../../services/present.ts';

/** Easing of slide moves. */
const EASE = 'cubic-bezier(0.33, 0.01, 0.2, 1)';

/** True when the person asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The transition to play between two slides of the show (none: a cut). */
export function transitionBetween(from: Slide, to: Slide, direction: 1 | -1): Transition | null {
  const kind = direction > 0 ? from.transition : to.transition;
  return kind && (TRANSITIONS as readonly string[]).includes(kind) ? kind : null;
}

/** One layer of the show: the slide's root element (at 1920×1080, CSS-scaled). */
export interface TransitionLayer {
  slide: Slide;
  root: HTMLElement;
}

/** Top-level elements of a slide that carry an id, by id. */
function framesById(layer: TransitionLayer): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  layer.slide.children.forEach((child, i) => {
    if (!child.id) return;
    const el = layer.root.querySelector<HTMLElement>(`[data-open-artifact-path="${i}"]`);
    if (el) out.set(child.id, el);
  });
  return out;
}

const center = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Runs a transition from `from` to `to` (both mounted, `to` above). `scale`
 * is the on-screen scale of the slides. Resolves when it is over; the
 * returned `finish` jumps to the end.
 */
export function runTransition(kind: Transition, from: TransitionLayer, to: TransitionLayer, direction: 1 | -1, scale: number): { done: Promise<void>; finish: () => void } {
  const ms = TRANSITION_MS[kind];
  const animations: Animation[] = [];
  if (kind === 'push') {
    animations.push(
      from.root.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * SLIDE_WIDTH}px)` }], { duration: ms, easing: EASE, fill: 'forwards' }),
      to.root.animate([{ transform: `translateX(${direction * SLIDE_WIDTH}px)` }, { transform: 'translateX(0)' }], { duration: ms, easing: EASE }),
    );
  } else if (kind === 'magic') {
    const olds = framesById(from);
    for (const [id, el] of framesById(to)) {
      const old = olds.get(id);
      if (!old) continue;
      const a = old.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (!a.width || !a.height || !b.width || !b.height) continue;
      const ca = center(a);
      const cb = center(b);
      // Screen deltas back into slide pixels (the slides are CSS-scaled).
      const dx = (ca.x - cb.x) / scale;
      const dy = (ca.y - cb.y) / scale;
      const sx = a.width / b.width;
      const sy = a.height / b.height;
      animations.push(
        el.animate([{ translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}` }, { translate: '0px 0px', scale: '1 1' }], { duration: ms, easing: EASE }),
        // The old element travels along underneath, so the move reads as one object.
        old.animate([{ translate: '0px 0px', scale: '1 1' }, { translate: `${-dx}px ${-dy}px`, scale: `${1 / sx} ${1 / sy}` }], { duration: ms, easing: EASE, fill: 'forwards' }),
      );
    }
    animations.push(to.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease' }));
  } else {
    animations.push(to.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease' }));
  }

  const finish = (): void => {
    for (const animation of animations) {
      try {
        animation.finish();
      } catch {
        // An animation with fill:forwards and no end time cannot finish; it is cancelled below.
      }
    }
  };
  const done = Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => {
    // Leave no transforms behind on elements that stay mounted.
    for (const animation of animations) animation.cancel();
  });
  return { done, finish };
}
