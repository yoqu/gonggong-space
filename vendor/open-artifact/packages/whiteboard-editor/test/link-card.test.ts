import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LINK_CARD_GAP_PX,
  LINK_CARD_SHOW_MS,
  MAX_SHOWN_ADDRESS_CHARS,
  hasLinkCredentials,
  linkAddressParts,
  linkBlock,
  linkBoxMoved,
  linkCardPlace,
  linkCardShowDelay,
  linkClickAction,
  pressIsClick,
  severalLinksMessage,
  type ClickModifiers,
} from '../src/lib/link-card.ts';

function click(options: Partial<ClickModifiers> = {}): ClickModifiers {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...options };
}

describe('clicks on board links', () => {
  it('opens a plain click after the delay and a Mod-click at once', () => {
    assert.equal(linkClickAction(click(), true), 'later');
    assert.equal(linkClickAction(click({ metaKey: true }), true), 'now');
    assert.equal(linkClickAction(click({ ctrlKey: true }), false), 'now');
  });

  it('leaves Shift, Alt and a Mac Ctrl-click alone', () => {
    assert.equal(linkClickAction(click({ metaKey: true, shiftKey: true }), true), 'none');
    assert.equal(linkClickAction(click({ ctrlKey: true, altKey: true }), false), 'none');
    assert.equal(linkClickAction(click({ shiftKey: true }), true), 'none');
    assert.equal(linkClickAction(click({ ctrlKey: true }), true), 'none');
    assert.equal(linkClickAction(click({ metaKey: true }), false), 'none');
  });

  it('counts short still taps and mouse presses that never became drags', () => {
    assert.equal(pressIsClick({ pointerType: 'touch', ms: 400, moved: 10 }), true);
    assert.equal(pressIsClick({ pointerType: 'touch', ms: 401, moved: 0 }), false);
    assert.equal(pressIsClick({ pointerType: 'touch', ms: 100, moved: 11 }), false);
    assert.equal(pressIsClick({ pointerType: 'mouse', ms: 2000, moved: 4 }), true);
    assert.equal(pressIsClick({ pointerType: 'mouse', ms: 50, moved: 5 }), false);
  });
});

describe('links the board does not open', () => {
  it('spots a user name or password in the address', () => {
    assert.equal(hasLinkCredentials('https://user:secret@example.org/a'), true);
    assert.equal(hasLinkCredentials('https://user@example.org'), true);
    assert.equal(hasLinkCredentials('https://example.org/a@b'), false);
    assert.equal(hasLinkCredentials('https://example.org/?mail=a@b.org'), false);
  });

  it('says why a link does not open', () => {
    assert.equal(linkBlock('https://example.org', 'https://example.org'), undefined);
    assert.equal(linkBlock('https://u:p@example.org', undefined), 'credentials');
    assert.equal(linkBlock('ftp://example.org', undefined), 'unsupported');
  });
});

describe('the card address', () => {
  it('shows the site and the path apart', () => {
    assert.deepEqual(linkAddressParts('https://example.org/docs/page?x=1#top'), {
      host: 'example.org',
      path: '/docs/page?x=1#top',
      full: 'https://example.org/docs/page?x=1#top',
    });
    assert.deepEqual(linkAddressParts('https://example.org/'), { host: 'example.org', path: '', full: 'https://example.org' });
  });

  it('keeps credentials out and shows other addresses whole', () => {
    assert.equal(linkAddressParts('https://user:secret@example.org/a').full, 'https://example.org/a');
    assert.deepEqual(linkAddressParts('open-artifact://artifact/art_1'), { host: 'open-artifact://artifact/art_1', path: '', full: 'open-artifact://artifact/art_1' });
  });

  it('cuts long addresses and shows control characters', () => {
    const long = linkAddressParts(`https://example.org/${'a'.repeat(400)}`);
    assert.equal([...long.full].length, MAX_SHOWN_ADDRESS_CHARS);
    assert.ok(long.full.endsWith('…'));
    assert.equal([...long.path].length, MAX_SHOWN_ADDRESS_CHARS);
    assert.equal(linkAddressParts('not a url\u0007').full, 'not a url�');
  });
});

describe('where the card sits', () => {
  const viewport = { w: 1000, h: 800 };
  const card = { w: 300, h: 40 };

  it('sits above the link when it fits', () => {
    assert.deepEqual(linkCardPlace({ x: 100, y: 200, w: 80, h: 20 }, card, viewport), { x: 100, y: 200 - LINK_CARD_GAP_PX - 40, side: 'above' });
  });

  it('goes below near the top of the viewport', () => {
    assert.deepEqual(linkCardPlace({ x: 100, y: 20, w: 80, h: 20 }, card, viewport), { x: 100, y: 40 + LINK_CARD_GAP_PX, side: 'below' });
  });

  it('keeps clear of the selection bar', () => {
    const bar = { x: 50, y: 140, w: 400, h: 44 };
    const place = linkCardPlace({ x: 100, y: 200, w: 80, h: 20 }, card, viewport, bar);
    assert.equal(place.side, 'below');
    assert.equal(place.y, 220 + LINK_CARD_GAP_PX);
    const under = linkCardPlace({ x: 100, y: 20, w: 80, h: 20 }, card, viewport, { x: 50, y: 50, w: 400, h: 44 });
    assert.equal(under.y, 94 + LINK_CARD_GAP_PX);
  });

  it('stays inside the viewport sideways', () => {
    assert.equal(linkCardPlace({ x: 900, y: 300, w: 60, h: 20 }, card, viewport).x, 1000 - 300 - 8);
    assert.equal(linkCardPlace({ x: -40, y: 300, w: 60, h: 20 }, card, viewport).x, 8);
  });

  it('notices a link that moved', () => {
    const box = { x: 10, y: 10, w: 50, h: 20 };
    assert.equal(linkBoxMoved(box, { ...box, x: 10.4 }), false);
    assert.equal(linkBoxMoved(box, { ...box, y: 12 }), true);
  });
});

describe('card timing and hints', () => {
  it('waits out the pause after a link opened', () => {
    assert.equal(linkCardShowDelay(1000, null), LINK_CARD_SHOW_MS);
    assert.equal(linkCardShowDelay(1000, 900), 600);
    assert.equal(linkCardShowDelay(5000, 900), LINK_CARD_SHOW_MS);
  });

  it('names a click or a tap for an item with several links', () => {
    assert.equal(severalLinksMessage(false), 'Several links: open one with a click');
    assert.equal(severalLinksMessage(true), 'Several links: open one with a tap');
  });
});
