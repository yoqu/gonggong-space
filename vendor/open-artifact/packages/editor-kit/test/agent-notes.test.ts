import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentResultMessage } from '../src/agent.ts';
import { queuedNote, sentNotice } from '../src/collab/comments.ts';

test('a thread waiting for an agent that is not woken while it idles says to message it', () => {
  assert.equal(queuedNote({ name: 'Codex' }), 'Waiting for the agent');
  assert.equal(queuedNote({ name: 'Codex', wakesIdle: true }), 'Waiting for the agent');
  assert.equal(queuedNote({ name: 'Cursor', wakesIdle: false }), 'Cursor gets this on its next turn: send it a message to start one');
});

test('the toast after sending says the same, only for an agent that is not woken', () => {
  assert.deepEqual(sentNotice('Codex', undefined), { title: 'Sent to Codex' });
  const cursor = sentNotice('Cursor', false);
  assert.equal(cursor.title, 'Sent to Cursor');
  assert.match(String(cursor.description), /next turn.*send it a message/);
});

test('a queued request says when the agent gets it, by whether it is woken while it idles', () => {
  const plain = agentResultMessage({ status: 'queued' }, 'this board', { name: 'Codex' });
  assert.equal(plain.title, 'Queued for the agent');
  assert.match(String(plain.description), /next time it checks this board/);
  assert.deepEqual(agentResultMessage({ status: 'queued' }, 'this board'), plain);
  const copilot = agentResultMessage({ status: 'queued' }, 'this deck', { name: 'Copilot', wakesIdle: false });
  assert.equal(copilot.title, 'Queued for Copilot');
  assert.match(String(copilot.description), /^Copilot gets it on its next turn.*send it a message/);
  assert.deepEqual(agentResultMessage({ status: 'delivered' }, 'this deck', { name: 'Copilot', wakesIdle: false }), { title: 'Sent to the agent' });
});
