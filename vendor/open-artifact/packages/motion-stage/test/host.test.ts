import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAME_ORIGIN_STAGE_POLICY, STAGE_SANDBOX, stageDocument, stageSandbox, stageTargetOrigin } from '../src/host.ts';

test('an opaque stage runs scripts only; a same-origin one keeps the page’s origin', () => {
  assert.equal(stageSandbox('opaque'), STAGE_SANDBOX);
  assert.equal(stageSandbox('opaque'), 'allow-scripts');
  assert.equal(stageSandbox('same'), 'allow-scripts allow-same-origin');
});

test('a same-origin stage document carries its policy and sends no referrer', () => {
  const opaque = stageDocument('void 0');
  const same = stageDocument('void 0', 'same');
  assert.doesNotMatch(opaque, /Content-Security-Policy/);
  assert.ok(same.includes(`content="${SAME_ORIGIN_STAGE_POLICY}"`));
  assert.match(same, /<meta name="referrer" content="no-referrer">/);
  assert.match(SAME_ORIGIN_STAGE_POLICY, /default-src 'none'/);
  assert.match(SAME_ORIGIN_STAGE_POLICY, /worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'/);
  assert.ok(same.indexOf('Content-Security-Policy') < same.indexOf('<script>'));
});

test('the port goes to the page’s own origin for a same-origin stage', () => {
  assert.equal(stageTargetOrigin('opaque', 'http://127.0.0.1:4000'), '*');
  assert.equal(stageTargetOrigin('same', 'http://127.0.0.1:4000'), 'http://127.0.0.1:4000');
  assert.equal(stageTargetOrigin('same', 'null'), '*');
});
