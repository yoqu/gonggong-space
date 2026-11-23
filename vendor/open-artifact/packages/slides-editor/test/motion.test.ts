import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Slide } from '@open-artifact/slides-core';
import {
  animationText,
  countText,
  countUpOf,
  guardAnimations,
  guardSmil,
  parseAnimations,
  parseTime,
  readMotionRules,
  smilPlays,
  startingEntrance,
} from '../src/services/motion.ts';
import { buildSteps, hiddenFragments } from '../src/services/present.ts';

const RULES = [
  "@property --n { syntax: '<integer>'; inherits: false; initial-value: 0 }",
  '@keyframes count { from { --n: 0 } }',
  '@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }',
  '@keyframes rise { from { opacity: 0 } to { opacity: 1 } }',
];

describe('motion values', () => {
  it('reads times, calc() of times included', () => {
    assert.equal(parseTime('1.2s'), 1200);
    assert.equal(parseTime('200ms'), 200);
    assert.equal(parseTime('calc(2 * 80ms)'), 160);
    assert.equal(parseTime('calc((1 + 2) * 0.1s)'), 300);
    assert.equal(parseTime('calc(2 * 3)'), undefined);
    assert.equal(parseTime('fast'), undefined);
  });

  it('reads the animation shorthand and longhands', () => {
    const [a] = parseAnimations({ animation: 'count 1.2s ease-out 0.3s both' });
    assert.deepEqual(a, { name: 'count', duration: 1200, delay: 300, iterations: 1, timing: 'ease-out', direction: 'normal', fill: 'both' });
    const list = parseAnimations({ 'animation-name': 'rise, blink', 'animation-duration': '1s', 'animation-iteration-count': 'infinite' });
    assert.deepEqual(list.map((x) => [x.name, x.duration, x.iterations]), [['rise', 1000, Infinity], ['blink', 1000, Infinity]]);
    assert.equal(animationText(a!), 'count 1200ms ease-out 300ms 1 normal both');
  });
});

describe('flash guard', () => {
  const { keyframes } = readMotionRules(RULES);
  it('stops fast loops, slows fast finite runs and stretches short one-shots', () => {
    const guarded = guardAnimations(
      [
        ...parseAnimations({ animation: 'blink 400ms infinite' }), // 2 changes per 400ms: too fast
        ...parseAnimations({ animation: 'blink 300ms 4' }), // finite, too fast: slowed
        ...parseAnimations({ animation: 'rise 200ms' }), // one-shot: 334ms
        ...parseAnimations({ animation: 'rise 50ms' }), // a cut: kept
        ...parseAnimations({ animation: 'blink 2s infinite' }), // slow: kept
        ...parseAnimations({ animation: 'missing 1s' }), // not defined: dropped
      ],
      keyframes,
    );
    assert.deepEqual(guarded.map((x) => [x.name, x.duration]), [['blink', 667], ['rise', 334], ['rise', 50], ['blink', 2000]]);
  });

  it('keeps SMIL only where it may play', () => {
    const svg = '<svg><circle r="4"><animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite"/></circle><rect><set attributeName="fill" to="red" begin="1s"/></rect></svg>';
    assert.equal(guardSmil(svg, true), svg);
    assert.equal(guardSmil(svg, false), '<svg><circle r="4"></circle><rect></rect></svg>');
    assert.equal(smilPlays('animate', ' attributeName="opacity" values="0;1" dur="100ms" repeatCount="indefinite"'), false);
    assert.equal(smilPlays('animate', ' attributeName="opacity" values="0;1" dur="100ms"'), true);
    assert.equal(smilPlays('animate', ' attributeName="x" dur="1s" begin="0s;2s"'), false);
    assert.equal(smilPlays('animate', ' attributeName="x" dur="later"'), false);
    assert.equal(smilPlays('animateTransform', ' type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"'), true);
  });
});

describe('count-up and entrances', () => {
  const { keyframes, properties } = readMotionRules(RULES);
  it('counts a registered numeric property up to the number in the text', () => {
    const count = countUpOf(parseAnimations({ animation: 'count 1.2s ease-out both' }), keyframes, properties);
    assert.deepEqual(count, { from: 0, duration: 1200, delay: 0 });
    assert.equal(countUpOf(parseAnimations({ animation: 'rise 1s' }), keyframes, properties), null);
    assert.equal(countText('93%', 41.6), '42%');
    assert.equal(countText('$1,250,000 raised', 980000), '$980,000 raised');
    assert.equal(countText('4.75x', 2), '2.00x');
  });

  it('turns @starting-style into an entrance with the transition timing', () => {
    const entrance = startingEntrance('s-2', { opacity: '0', transform: 'translateY(32px)', color: 'red' }, { transition: 'opacity 400ms ease-out, transform 600ms', 'transition-delay': 'calc(2 * 80ms)' });
    assert.ok(entrance);
    assert.equal(entrance.animations.length, 2);
    assert.deepEqual(entrance.animations.map((a) => [a.name, a.duration, a.delay, a.fill]), [['s-2-0', 400, 160, 'backwards'], ['s-2-1', 600, 160, 'backwards']]);
    assert.match(entrance.keyframes, /@keyframes s-2-0 \{ from \{ opacity: 0 \} \}/);
    assert.ok(!entrance.keyframes.includes('color'));
    assert.equal(startingEntrance('x', { opacity: '0' }, {}), null);
  });
});

describe('fragments in flow', () => {
  const pinned = (origin: number, order?: number): Slide['children'][number] => ({
    kind: 'text', tag: 'p', runs: [], origin,
    style: { position: 'absolute' },
    buildIn: order === undefined ? { effect: 'fade' } : { effect: 'fade', order },
  }) as Slide['children'][number];
  const slide = {
    id: 's', hidden: false, style: {}, notes: '',
    children: [pinned(1, 2), pinned(3)],
    motion: { elements: {}, starting: {}, fragments: [{ origin: 2, index: 0 }, { origin: 4 }, { origin: 5, index: 1 }] },
  } as unknown as Slide;

  it('steps with pinned builds by number, then in document order', () => {
    const steps = buildSteps(slide);
    assert.deepEqual(steps.map((s) => [s.enter, s.reveal ?? []]), [[[], [2]], [[0], [5]], [[1], []], [[], [4]]]);
    assert.equal(buildSteps(slide, { flow: false }).length, 2);
  });

  it('keeps fragments hidden until their step', () => {
    const steps = buildSteps(slide);
    assert.deepEqual([...hiddenFragments(slide, steps, 0)], [2, 4, 5]);
    assert.deepEqual([...hiddenFragments(slide, steps, 2)], [4]);
    assert.deepEqual([...hiddenFragments(slide, steps, steps.length)], []);
  });
});
