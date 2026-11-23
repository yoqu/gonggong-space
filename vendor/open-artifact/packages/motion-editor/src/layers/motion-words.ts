/** What Animate says of a pick: the changes, each as the request says it, and the sentence that sums them up. Pure. */

import type { LayerMotionChoice, LayerKind as RequestKind } from '@open-artifact/motion-core';
import { makeEach, makeThis } from './words.ts';

function joined(verbs: string[]): string {
  if (verbs.length < 2) return verbs.join('');
  return `${verbs.slice(0, -1).join(', ')} and ${verbs[verbs.length - 1]}`;
}

/** The changes picked, each as the request says it. `inScene`: the film is made of scenes. */
export function motionChoicePhrases(choice: LayerMotionChoice, inScene: boolean): string[] {
  const enter = { fade: 'fade in', slide: `slide in from the ${choice.enterFrom}`, pop: 'pop in', type: 'type on letter by letter' } as const;
  const leave = {
    fade: 'fade out',
    slide: `slide out to the ${choice.leaveTo}`,
    shrink: 'shrink away as it leaves',
    stay: inScene ? 'stay until the scene ends' : 'stay until the end',
  } as const;
  return [
    ...(choice.enter !== null ? [enter[choice.enter]] : []),
    ...(choice.leave !== null ? [leave[choice.leave]] : []),
    ...(choice.when !== null ? [`come in a little ${choice.when}`] : []),
    ...(choice.pace !== null ? [`move ${choice.pace}`] : []),
  ];
}

const NOUNS: Readonly<Record<RequestKind, string>> = { text: 'text', image: 'image', shape: 'shape', group: 'group', ground: 'background' };

/** The sentence over the Ask button: "Make this text fade in and move faster." */
export function describeMotionChoice(kind: RequestKind, many: number, choice: LayerMotionChoice, inScene: boolean): string | null {
  const phrases = motionChoicePhrases(choice, inScene);
  if (phrases.length === 0) return null;
  const changes = joined(phrases);
  const count = Number.isFinite(many) && many >= 2 ? Math.min(999, Math.round(many)) : null;
  return count !== null ? makeEach(count, changes) : makeThis(NOUNS[kind], changes);
}
