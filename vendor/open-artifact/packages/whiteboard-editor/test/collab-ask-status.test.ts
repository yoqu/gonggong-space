/**
 * Tests of how requests to the agent move through their statuses, and of
 * the words shown while the agent works (activity labels, working words,
 * the stagger of new elements).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASK_STATUSES,
  ASK_STATUS_LABELS,
  askStatusLabel,
  askStatusAfterClaims,
  askStatusAfterIdle,
  askStatusAfterSend,
  isAskPending,
  isAskSettled,
} from '../src/collab/ask-status.ts';
import {
  activityAnnouncement,
  APPEAR_MAX_ITEMS,
  APPEAR_MAX_STEP_MS,
  APPEAR_SPAN_MS,
  appearDelays,
  askActivity,
  elementActivity,
  nextWorkingWord,
  WORKING_WORDS,
} from '../src/collab/activity-labels.ts';

describe('ask statuses', () => {
  it('labels every status', () => {
    for (const status of ASK_STATUSES) assert.ok(ASK_STATUS_LABELS[status].length > 0, status);
  });

  it('says a queued request waits for the next turn when the agent is not woken while it idles', () => {
    assert.equal(askStatusLabel('queued'), 'Queued');
    assert.equal(askStatusLabel('queued', true), 'Queued');
    assert.equal(askStatusLabel('queued', false), 'Queued for its next turn');
    assert.equal(askStatusLabel('working', false), ASK_STATUS_LABELS.working);
  });

  it('settles on done, stopped and failed only', () => {
    assert.deepEqual(
      ASK_STATUSES.filter((status) => isAskSettled(status)),
      ['done', 'stopped', 'failed'],
    );
    assert.equal(isAskPending('working'), true);
    assert.equal(isAskPending('done'), false);
  });

  it('maps the host answer to a status', () => {
    assert.equal(askStatusAfterSend({ status: 'delivered' }), 'delivered');
    assert.equal(askStatusAfterSend({ status: 'queued' }), 'queued');
    assert.equal(askStatusAfterSend({ status: 'staged' }), 'queued');
    assert.equal(askStatusAfterSend({ status: 'failed' }), 'failed');
  });

  it('works while claimed, then is done or stopped when the claim goes', () => {
    assert.equal(askStatusAfterClaims('delivered', true), 'working');
    assert.equal(askStatusAfterClaims('working', false), 'done');
    assert.equal(askStatusAfterClaims('working', false, true), 'stopped');
    assert.equal(askStatusAfterClaims('queued', false), 'queued');
    assert.equal(askStatusAfterClaims('done', true), 'done');
  });

  it('is done when the agent goes idle without claiming ground', () => {
    assert.equal(askStatusAfterIdle('delivered', false), 'done');
    assert.equal(askStatusAfterIdle('working', false), 'done');
    assert.equal(askStatusAfterIdle('working', true), 'working');
    assert.equal(askStatusAfterIdle('queued', false), 'queued');
    assert.equal(askStatusAfterIdle('failed', false), 'failed');
  });
});

describe('askActivity', () => {
  it('reads the leading verb past polite openers', () => {
    assert.equal(askActivity('please add three risks'), 'Adding');
    assert.equal(askActivity('Hey agent, could you summarize this?'), 'Summarizing');
    assert.equal(askActivity("@board I'd like you to organize the notes"), 'Organizing');
  });

  it('knows nothing for requests without a known verb', () => {
    assert.equal(askActivity('what is this?'), undefined);
    assert.equal(askActivity('   '), undefined);
  });
});

describe('element activity', () => {
  it('names what writing an element looks like', () => {
    assert.equal(elementActivity('note'), 'Writing');
    assert.equal(elementActivity('arrow'), 'Connecting');
    assert.equal(elementActivity('sticker'), undefined);
  });

  it('announces in a sentence', () => {
    assert.equal(activityAnnouncement('Adding'), 'The agent is adding on the board.');
  });
});

describe('nextWorkingWord', () => {
  it('never repeats the previous word', () => {
    for (const previous of WORKING_WORDS) {
      for (const r of [0, 0.5, 0.999]) assert.notEqual(nextWorkingWord(previous, () => r), previous);
    }
  });

  it('picks from the list', () => {
    assert.ok(WORKING_WORDS.includes(nextWorkingWord(undefined, () => 0.3)));
  });
});

describe('appearDelays', () => {
  it('starts the first at once and spreads the rest', () => {
    assert.deepEqual(appearDelays(0), []);
    assert.deepEqual(appearDelays(1), [0]);
    const three = appearDelays(3);
    assert.equal(three[0], 0);
    assert.equal(three[1], APPEAR_MAX_STEP_MS);
    assert.equal(three[2], 2 * APPEAR_MAX_STEP_MS);
  });

  it('fits a large batch in the span and stops animating past the cap', () => {
    const delays = appearDelays(APPEAR_MAX_ITEMS + 5);
    assert.equal(delays.length, APPEAR_MAX_ITEMS + 5);
    assert.equal(delays[APPEAR_MAX_ITEMS - 1], APPEAR_SPAN_MS);
    assert.equal(delays[APPEAR_MAX_ITEMS], undefined);
  });
});
