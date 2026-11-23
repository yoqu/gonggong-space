/**
 * Plays a source slide's motion while presenting (services/motion.ts has
 * the rules): the deck's `@keyframes` and `@property` go into the page, each
 * element's animations (flash-guarded) and `@starting-style` entrance are
 * set on its drawn element as the slide appears, count-ups count, and
 * in-flow fragments wait hidden for their step. Nothing plays with reduced
 * motion (fragments still step, without fading).
 */

import { useLayoutEffect, useMemo, type RefObject } from 'react';
import type { Slide, SlideNode } from '@open-artifact/slides-core';
import { currentSourceDeck } from '../../state/deck.ts';
import { BUILD_MS } from '../../render/css.ts';
import { elementMotion, readMotionRules } from '../../services/motion.ts';
import { countUp } from '../../services/count-player.ts';
import { prefersReducedMotion } from './transitions.ts';

const DECK_STYLE_ID = 'open-artifact-deck-motion';

let readRules: { rules: readonly string[]; read: ReturnType<typeof readMotionRules> } | undefined;

/** The deck's motion rules, read once per sheet, and put into the page. */
function deckMotion(): ReturnType<typeof readMotionRules> {
  const rules = currentSourceDeck()?.sheet.motion ?? [];
  if (readRules?.rules !== rules) {
    readRules = { rules, read: readMotionRules(rules) };
    let style = document.getElementById(DECK_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = DECK_STYLE_ID;
      document.head.append(style);
    }
    style.textContent = rules.join('\n');
  }
  return readRules.read;
}

/** The drawn elements of a slide's nodes by origin (0: the slide itself). */
function elementsByOrigin(box: HTMLElement, slide: Slide): Map<number, { element: HTMLElement; node?: SlideNode }> {
  const out = new Map<number, { element: HTMLElement; node?: SlideNode }>();
  const root = box.querySelector<HTMLElement>('[data-open-artifact-slide]');
  if (root) out.set(0, { element: root });
  const walk = (nodes: readonly SlideNode[], path: number[]): void => {
    nodes.forEach((node, i) => {
      const here = [...path, i];
      if (node.origin !== undefined) {
        const element = box.querySelector<HTMLElement>(`[data-open-artifact-path="${here.join('.')}"]`);
        if (element) out.set(node.origin, { element, node });
      }
      const children = (node as { children?: unknown }).children;
      if (Array.isArray(children)) walk(children as SlideNode[], here);
    });
  };
  walk(slide.children, []);
  return out;
}

/**
 * Plays `slide`'s motion inside `box` (the shown slide) while `play`, and
 * keeps its in-flow fragments not yet stepped to hidden.
 */
export function useSlideMotion(box: RefObject<HTMLElement | null>, slide: Slide, hidden: ReadonlySet<number>, play: boolean): void {
  const motion = slide.motion;

  // Animations, entrances and count-ups, once as the slide appears.
  useLayoutEffect(() => {
    const container = box.current;
    if (!play || !motion || !container || prefersReducedMotion()) return;
    const rules = deckMotion();
    const elements = elementsByOrigin(container, slide);
    const stops: Array<() => void> = [];
    let entranceCss = '';
    const prefix = `open-artifact-start-${Math.random().toString(36).slice(2, 8)}`;
    const origins = new Set([...Object.keys(motion.elements), ...Object.keys(motion.starting)].map(Number));
    for (const origin of origins) {
      const found = elements.get(origin);
      if (!found) continue;
      // Builds draw their own animation.
      if (found.node?.buildIn || found.node?.buildOut) continue;
      const declarations = motion.elements[origin] ?? {};
      const { animation, keyframes, count } = elementMotion(declarations, motion.starting[origin], rules, `${prefix}-${origin}`);
      if (!animation) continue;
      entranceCss += keyframes;
      const element = found.element;
      element.style.animation = animation;
      const stopCount = count ? countUp(element, count) : undefined;
      stops.push(() => {
        element.style.animation = '';
        stopCount?.();
      });
    }
    let style: HTMLStyleElement | undefined;
    if (entranceCss) {
      style = document.createElement('style');
      style.textContent = entranceCss;
      document.head.append(style);
    }
    return () => {
      for (const stop of stops) stop();
      style?.remove();
    };
  }, [box, slide, motion, play]);

  // In-flow fragments: hidden until their step.
  const hiddenKey = useMemo(() => [...hidden].sort((a, b) => a - b).join(','), [hidden]);
  useLayoutEffect(() => {
    const container = box.current;
    if (!container || !motion?.fragments.length) return;
    const elements = elementsByOrigin(container, slide);
    const fade = prefersReducedMotion() ? '' : `opacity ${BUILD_MS}ms ease`;
    for (const fragment of motion.fragments) {
      const element = elements.get(fragment.origin)?.element;
      if (!element) continue;
      element.style.transition = fade;
      element.style.opacity = hidden.has(fragment.origin) ? '0' : '';
    }
    // `hidden` is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, slide, motion, hiddenKey]);
}
