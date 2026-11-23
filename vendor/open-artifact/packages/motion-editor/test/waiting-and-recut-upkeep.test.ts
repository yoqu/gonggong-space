import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentCapability, AgentStatus } from '@open-artifact/runtime';
import { buildClock, filmSeconds, parseRecutRecord, type SceneBuildSummary } from '@open-artifact/motion-core';
import { watchAgentActivity } from '../src/host/agent-activity.ts';
import { seemsStopped, workingBarView } from '../src/player/waiting.ts';
import { advanceEstimate, pauseEstimate } from '../src/player/work-estimate.ts';
import { handLengths, lapsedHandLengths } from '../src/recut/lapsed.ts';
import { useWorking } from '../src/stores/working.ts';

function fakeAgent(first: AgentStatus): { agent: AgentCapability; say(status: AgentStatus): void } {
  const listeners = new Set<(status: AgentStatus) => void>();
  return {
    agent: {
      send: async () => ({ status: 'delivered' }),
      status: async () => first,
      onStatus: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    say: (status) => listeners.forEach((listener) => listener(status)),
  };
}

test('an agent that waits on the person is working, and waits on them', async () => {
  const { agent, say } = fakeAgent({ available: true, busy: false, name: 'Codex' });
  const stop = watchAgentActivity(agent);
  await Promise.resolve();
  say({ available: true, busy: false, name: 'Codex', waitingForPerson: true });
  assert.equal(useWorking.getState().activity, 'working');
  assert.equal(useWorking.getState().waitsOnYou, true);
  say({ available: true, busy: true, name: 'Codex' });
  assert.equal(useWorking.getState().waitsOnYou, false);
  assert.equal(useWorking.getState().activity, 'working');
  say({ available: false, busy: false, name: 'Codex', waitingForPerson: true });
  assert.equal(useWorking.getState().waitsOnYou, false, 'no agent, nothing to wait for');
  stop();
});

test('waiting on the person: the bar says so, the agent has not stopped, and the estimate’s clock holds', () => {
  const summary: SceneBuildSummary = { rough: true, count: { what: 'making', n: 1, of: 4 }, button: null, left: [2, 3, 4], closing: false, pips: [] };
  assert.equal(workingBarView({ summary, asked: null, waitsOnYou: true })?.says, 'Waiting for you');
  const quiet = { missing: 3, activity: 'working' as const, lastWriteAt: 0, now: 200_000, readOnly: false };
  assert.equal(seemsStopped(quiet), true);
  assert.equal(seemsStopped({ ...quiet, waitsOnYou: true }), false);
  const estimate = advanceEstimate(null, { what: 'making', toCome: 3, of: 4 }, 1_000);
  assert.deepEqual(pauseEstimate(estimate, 60_000), { ...estimate!, began: 61_000, mark: 61_000 });
  assert.equal(pauseEstimate(estimate, 0), estimate);
  assert.equal(pauseEstimate(null, 5_000), null);
});

test('the toast’s trigger: a length set by hand lapses when the agent changes the scene’s own length', () => {
  const record = parseRecutRecord({ v: 1, scenes: [{ id: 'pour', dur: { was: 4.5, v: 6 } }, { id: 'bell', dur: { was: 3, v: 2 } }] });
  const film = (pour: number, bell = 3, names: [string, string] = ['The pour', 'Bell']) =>
    buildClock(
      [
        { key: 'pour', name: names[0], dur: filmSeconds(pour) },
        { key: 'bell', name: names[1], dur: filmSeconds(bell) },
      ],
      record,
    ).parts;
  const before = handLengths(record, film(4.5));
  assert.deepEqual([...before.keys()], ['pour', 'bell']);
  const changed = film(5);
  assert.deepEqual(lapsedHandLengths(before, handLengths(record, changed), record, changed), ['The pour']);
  const same = film(6);
  assert.deepEqual(lapsedHandLengths(before, handLengths(record, same), record, same), [], 'the agent gave it the length set by hand');
  const gone = buildClock([{ key: 'bell', name: 'Bell', dur: filmSeconds(3) }], record).parts;
  assert.deepEqual(lapsedHandLengths(before, handLengths(record, gone), record, gone), [], 'a scene taken out says nothing');
  const takenBack = parseRecutRecord({ v: 1, scenes: [{ id: 'bell', dur: { was: 3, v: 2 } }] });
  assert.deepEqual(lapsedHandLengths(before, handLengths(takenBack, film(4.5)), takenBack, film(4.5)), [], 'the person took it back');
});
