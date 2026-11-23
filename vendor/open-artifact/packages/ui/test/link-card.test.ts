import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canOpenLink, placeLinkCard, shownLink } from '../src/link-card.ts';

describe('link card', () => {
  it('shows the site first and opens only web and mail addresses', () => {
    assert.deepEqual(shownLink('https://www.example.com/docs?q=1'), { site: 'example.com', rest: '/docs?q=1' });
    assert.deepEqual(shownLink('https://example.com/'), { site: 'example.com', rest: '' });
    assert.deepEqual(shownLink('mailto:a%40b@example.com'), { site: 'a@b@example.com', rest: '' });
    assert.deepEqual(shownLink('components/Button/README.md'), { site: 'components/Button/README.md', rest: '' });
    assert.deepEqual(shownLink('mailto:%E0%A4%A'), { site: '%E0%A4%A', rest: '' });
    assert.ok(canOpenLink('http://127.0.0.1:4000/project/README.md'));
    assert.ok(canOpenLink('mailto:a@example.com'));
    assert.ok(!canOpenLink('javascript:alert(1)'));
    assert.ok(!canOpenLink('README.md'));
  });

  it('places the card below the link, or above when the window ends', () => {
    const card = { width: 200, height: 40 };
    assert.deepEqual(placeLinkCard({ top: 100, bottom: 120, left: 50 }, card, { width: 800, height: 600 }), { top: 126, left: 50 });
    assert.deepEqual(placeLinkCard({ top: 560, bottom: 580, left: 700 }, card, { width: 800, height: 600 }), { top: 514, left: 594 });
    assert.deepEqual(placeLinkCard({ top: 10, bottom: 30, left: 0 }, card, { width: 800, height: 60 }), { top: 36, left: 6 });
  });
});
