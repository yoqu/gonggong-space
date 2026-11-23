import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINK_API_PREFIX, LINK_ROUTES, artifactIdOfLabel, contentHostLabel } from '../src/link.ts';
import * as protocol from '../src/index.ts';

test('a content host label is the artifact id with its underscore made a hyphen', () => {
  assert.equal(contentHostLabel('art_0abcdefghi1234'), 'art-0abcdefghi1234');
  assert.throws(() => contentHostLabel('not_an_id'), TypeError);
  assert.throws(() => contentHostLabel('art_short'), TypeError);
});

test('a content host label reads back as its artifact id', () => {
  const id = 'art_0abcdefghi1234';
  assert.equal(artifactIdOfLabel(contentHostLabel(id)), id);
  assert.equal(artifactIdOfLabel('ART-0ABCDEFGHI1234'), id);
  assert.equal(artifactIdOfLabel('art_0abcdefghi1234'), null);
  assert.equal(artifactIdOfLabel('art-short'), null);
  assert.equal(artifactIdOfLabel('art-0abcdefghi-1234'), null);
  assert.equal(artifactIdOfLabel('www'), null);
  assert.equal(artifactIdOfLabel(''), null);
});

test('Link routes are named after the prefix and exported from the package', () => {
  assert.equal(LINK_API_PREFIX, '/api/open-artifact.link.');
  assert.deepEqual(Object.values(LINK_ROUTES).sort(), ['ack', 'artifacts', 'call', 'device', 'events', 'export', 'files', 'hello', 'import', 'manifest', 'token', 'unpublish']);
  assert.equal(protocol.LINK_ROUTES, LINK_ROUTES);
  assert.equal(protocol.contentHostLabel, contentHostLabel);
});
