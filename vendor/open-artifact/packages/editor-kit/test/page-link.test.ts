import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashForPage, pageFromHash, pageLink } from '../src/page-link.ts';

describe('page links', () => {
  it('reads and writes the page in the hash, keeping other parameters', () => {
    assert.equal(pageFromHash('#page=p2'), 'p2');
    assert.equal(pageFromHash('#x=1&page=p3'), 'p3');
    assert.equal(pageFromHash(''), null);
    assert.equal(hashForPage('#x=1', 'p2'), '#x=1&page=p2');
    assert.equal(hashForPage('#page=p2', null), '');
  });

  it('drops the query from a shared link', () => {
    assert.equal(pageLink('https://host.test/a/edit?token=secret#page=p1', 'p4'), 'https://host.test/a/edit#page=p4');
  });
});
