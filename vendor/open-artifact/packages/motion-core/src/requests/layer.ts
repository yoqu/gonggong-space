import { describeAnimationAnchor, makePointCommentAnchor, toFilmAnchorTime, type AnchorClock } from '../anchors.ts';
import { playSeconds, type PlaySeconds } from '../units.ts';
import { joinWithAnd, type VideoAgentRequest } from './common.ts';

export type LayerSide = 'left' | 'right' | 'top' | 'bottom';
export type LayerEnter = 'fade' | 'slide' | 'pop' | 'type';
export type LayerLeave = 'fade' | 'slide' | 'shrink' | 'stay';
export type LayerKind = 'text' | 'image' | 'shape' | 'group' | 'ground';

/** How a person wants one thing to come and go, as picked under Animate. */
export interface LayerMotionChoice {
  enter: LayerEnter | null;
  enterFrom: LayerSide;
  leave: LayerLeave | null;
  leaveTo: LayerSide;
  when: 'earlier' | 'later' | null;
  pace: 'slower' | 'faster' | null;
}

export const EMPTY_LAYER_MOTION_CHOICE: LayerMotionChoice = { enter: null, enterFrom: 'left', leave: null, leaveTo: 'left', when: null, pace: null };

export const hasLayerMotionChoice = (choice: LayerMotionChoice): boolean =>
  choice.enter !== null || choice.leave !== null || choice.when !== null || choice.pace !== null;

/** The thing picked on the picture. */
export interface PickedLayer {
  kind: LayerKind;
  /** Where it was seen, as played. */
  t: PlaySeconds;
  /** Its box, as fractions of the frame. */
  box: { x: number; y: number; w: number; h: number };
  /** Scene `n` (from 1) of `of`, or `null` in a film without scenes. */
  scene: { n: number; of: number } | null;
  /** How many like things move together with it (a group of 2 or more). */
  many?: number;
}

const LAYER_NOUNS: Readonly<Record<LayerKind, string>> = { text: 'text', image: 'image', shape: 'shape', group: 'group', ground: 'background' };

/** A count as said in a request: a whole number from 1 to 999. */
export const formatLayerCount = (count: number): string => String(Number.isFinite(count) ? Math.max(1, Math.min(999, Math.round(count))) : 1);

const unit = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

function motionPhrases(choice: LayerMotionChoice, inScene: boolean): string[] {
  const enter: Readonly<Record<LayerEnter, string>> = {
    fade: 'fade in',
    slide: `slide in from the ${choice.enterFrom}`,
    pop: 'pop in',
    type: 'type on letter by letter',
  };
  const leave: Readonly<Record<LayerLeave, string>> = {
    fade: 'fade out',
    slide: `slide out to the ${choice.leaveTo}`,
    shrink: 'shrink away as it leaves',
    stay: inScene ? 'stay until the scene ends' : 'stay until the end',
  };
  return [
    ...(choice.enter !== null ? [enter[choice.enter]] : []),
    ...(choice.leave !== null ? [leave[choice.leave]] : []),
    ...(choice.when !== null ? [`come in a little ${choice.when}`] : []),
    ...(choice.pace !== null ? [`move ${choice.pace}`] : []),
  ];
}

/** Change how one thing (or a group of like things) comes and goes; `null` when nothing is picked. */
export function animateLayerRequest(layer: PickedLayer, choice: LayerMotionChoice, clock: AnchorClock = null): VideoAgentRequest | null {
  if (!hasLayerMotionChoice(choice)) return null;
  const played = playSeconds(Number.isFinite(layer.t) ? Math.max(0, Math.min(35999, Math.round(layer.t * 100) / 100)) : 0);
  const anchor = makePointCommentAnchor(toFilmAnchorTime(clock, played), {
    x: unit(layer.box.x),
    y: unit(layer.box.y),
    w: unit(layer.box.w),
    h: unit(layer.box.h),
  });
  const detail = describeAnimationAnchor(anchor, clock).detail;
  const changes = joinWithAnd(motionPhrases(choice, layer.scene !== null));
  const many = layer.many !== undefined && layer.many >= 2 ? formatLayerCount(layer.many) : null;
  const scene = layer.scene;
  const text =
    `Change how one thing ${scene !== null ? `in scene ${formatLayerCount(scene.n)} of ${formatLayerCount(scene.of)}` : 'in the animation'} animates: ` +
    `the ${many !== null ? `group of ${many} similar things` : LAYER_NOUNS[layer.kind]} here. Anchor detail: ${detail}. ` +
    (many !== null
      ? `Make each of them ${changes}, keeping the delays between them as they are. Keep their look, their words`
      : `Make it ${changes}. Keep its look, its words`) +
    ` and everything else ${scene !== null ? 'in the scene ' : ''}as they are. If nothing sits in or very near that box at that moment, ` +
    (scene !== null
      ? `if you cannot tell which thing this is, or the animation no longer has ${formatLayerCount(scene.of)} scenes`
      : 'or you cannot tell which thing this is') +
    ', change nothing and ask me.';
  return { title: 'Animate a layer', text };
}
