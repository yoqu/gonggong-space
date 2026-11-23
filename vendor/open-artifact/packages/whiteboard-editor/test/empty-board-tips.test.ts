/**
 * Tests of the empty board's tips: which tips apply (keyboard or touch,
 * cursor chat, prototypes), how long one shows (its scene plus a moment,
 * or a fixed time with no scene or with motion reduced), which keys leave
 * it up, and the hints that rotate while the agent works.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_TIP_AFTER_SCENE_MS,
  EMPTY_TIP_SHOWN_MS,
  TIP_SCENE_MS,
  WORKING_HINTS_BOARD_BASICS,
  WORKING_HINTS_SHARING,
  agentWho,
  dismissesTip,
  emptyBoardTips,
  pickTip,
  startedLine,
  tipShownMs,
  workingHintLines,
  workingLabel,
  type EmptyTipOptions,
} from '../src/collab/empty-tips.ts';
import { playTipScene, tipSceneDurationMs } from '../src/collab/tip-scenes.ts';

const desk: EmptyTipOptions = { touch: false, name: 'Agent', mac: true, slash: true, embeds: true };

describe('the tips', () => {
  it('offers ⌘K, a drag, cursor chat and things to ask for on a desktop', () => {
    const tips = emptyBoardTips(desk);
    assert.deepEqual(
      tips.map((tip) => tip.scene),
      ['cmdk', 'drag', 'slash', 'prototype', 'sketch', 'flowchart', 'brainstorm', 'explain', 'timeline', 'retro'],
    );
    assert.equal(tips[0]?.words, 'Press {} to ask the agent');
    assert.deepEqual(tips[0]?.keys, ['⌘', 'K']);
    assert.equal(tips[2]?.words, 'Press {} to type at your cursor, and @Agent');
    assert.deepEqual(tips[2]?.keys, ['/']);
  });

  it('uses Ctrl elsewhere, the agent’s own name, and leaves out what does not apply', () => {
    const tips = emptyBoardTips({ ...desk, mac: false, name: 'Pal', slash: false, embeds: false });
    assert.deepEqual(tips[0]?.keys, ['Ctrl', 'K']);
    assert.equal(tips[1]?.words, 'Drag across an empty spot to ask Pal');
    assert.ok(!tips.some((tip) => tip.scene === 'slash' || tip.scene === 'prototype'));
  });

  it('says to tap the Ask button on a touch screen, with no keyboard tips', () => {
    const tips = emptyBoardTips({ ...desk, touch: true });
    assert.deepEqual(tips[0], { words: 'Tap Ask Agent' });
    assert.ok(!tips.some((tip) => tip.keys !== undefined || tip.scene === 'cmdk' || tip.scene === 'drag'));
    assert.equal(startedLine({ touch: true, name: 'Agent', mac: false }), 'To get started: tap Ask Agent.');
    assert.equal(startedLine({ touch: false, name: 'Agent', mac: false }), 'To get started: press Ctrl+K to ask the agent.');
  });

  it('picks a tip by chance, within the list', () => {
    const tips = emptyBoardTips(desk);
    assert.equal(pickTip(tips, 0), tips[0]);
    assert.equal(pickTip(tips, 0.999), tips.at(-1));
    assert.equal(pickTip([], 0.5), undefined);
  });

  it('names the generic agent "the agent"', () => {
    assert.equal(agentWho('Agent'), 'the agent');
    assert.equal(agentWho(' '), 'the agent');
    assert.equal(agentWho('Pal'), 'Pal');
  });
});

describe('how long a tip shows', () => {
  it('lasts its scene and a moment, or a fixed time without a scene or with motion reduced', () => {
    assert.equal(tipShownMs({ words: 'x', scene: 'slash' }, false), TIP_SCENE_MS.slash + EMPTY_TIP_AFTER_SCENE_MS);
    assert.equal(tipShownMs({ words: 'x', scene: 'slash' }, true), EMPTY_TIP_SHOWN_MS);
    assert.equal(tipShownMs({ words: 'Tap Ask Agent' }, false), EMPTY_TIP_SHOWN_MS);
    assert.equal(tipShownMs(undefined, false), 0);
  });

  it('times every scene as drawn', () => {
    for (const [scene, ms] of Object.entries(TIP_SCENE_MS)) assert.equal(tipSceneDurationMs(scene as keyof typeof TIP_SCENE_MS), ms);
    assert.equal(TIP_SCENE_MS.cmdk, 3000);
    assert.equal(TIP_SCENE_MS.slash, 2300);
  });

  it('plays nothing where elements cannot animate', () => {
    const stop = playTipScene({} as HTMLElement, 'cmdk', { rest: false, mac: true, name: 'Agent' });
    assert.doesNotThrow(stop);
  });
});

describe('what hides a tip', () => {
  it('ignores Tab, F6 and modifier keys', () => {
    for (const key of ['Tab', 'F6', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Process', 'Unidentified']) assert.equal(dismissesTip(key), false, key);
  });

  it('is any other key', () => {
    for (const key of ['a', 'Enter', 'Escape', ' ', '/', 'ArrowLeft', 'k']) assert.equal(dismissesTip(key), true, key);
  });
});

describe('while the agent works', () => {
  it('rotates board basics then sharing, and only sharing on touch', () => {
    assert.deepEqual(workingHintLines(false), [...WORKING_HINTS_BOARD_BASICS, ...WORKING_HINTS_SHARING]);
    assert.deepEqual(workingHintLines(true), WORKING_HINTS_SHARING);
  });

  it('says who is working', () => {
    assert.equal(workingLabel('Agent'), 'The agent is working…');
    assert.equal(workingLabel('Pal'), 'Pal is working…');
  });
});
