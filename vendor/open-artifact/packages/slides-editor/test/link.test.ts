import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { typedLink } from '../src/lib/link.ts';

describe('an address typed into the link card', () => {
  it('becomes a web address, with https when it has no scheme', () => {
    assert.equal(typedLink('  example.com/docs '), 'https://example.com/docs');
    assert.equal(typedLink('http://example.com'), 'http://example.com');
    assert.equal(typedLink('HTTPS://Example.com/A'), 'HTTPS://Example.com/A');
  });

  it('is refused when a slide could not keep it as a link', () => {
    assert.equal(typedLink('   '), null);
    assert.equal(typedLink('javascript:alert(1)'), null);
    assert.equal(typedLink('mailto:a@example.com'), null);
    assert.equal(typedLink('exa mple.com'), null);
    assert.equal(typedLink('localhost:3000/x'), null);
  });
});
