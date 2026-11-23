/** What a session answer after a dropped stream means for the page's access. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accessChangeOf } from '../src/local-provider.ts';

describe('accessChangeOf', () => {
  const was = { id: 'guest-1', role: 'editor' };
  it('reads a refusal as access removed', () => {
    assert.equal(accessChangeOf(was, 403), 'removed');
    assert.equal(accessChangeOf(was, 401), 'removed');
  });
  it('reads another viewer or role as a change', () => {
    assert.equal(accessChangeOf(was, 200, { id: 'guest-1', role: 'viewer' }), 'changed');
    assert.equal(accessChangeOf(was, 200, { id: 'guest-2', role: 'editor' }), 'changed');
  });
  it('keeps reconnecting when nothing changed or the server is unwell', () => {
    assert.equal(accessChangeOf(was, 200, { id: 'guest-1', role: 'editor' }), null);
    assert.equal(accessChangeOf(was, 502), null);
    assert.equal(accessChangeOf(was, 200, null), null);
  });
});
