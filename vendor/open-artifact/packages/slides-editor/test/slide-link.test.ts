import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCopySlideLinkKey, linkedSlide, onlySuffix, readSlideLink } from '../src/lib/slide-link.ts';

describe('slide links', () => {
  const order = ['intro', '7', 'end'];

  it('reads an id link, an older page number and a link to one slide on its own', () => {
    assert.deepEqual(readSlideLink('#slide-~7'), { target: { id: '7' }, only: false });
    assert.deepEqual(readSlideLink('#slide-2'), { target: { page: 2 }, only: false });
    assert.deepEqual(readSlideLink('#slide-~end.only'), { target: { id: 'end' }, only: true });
    assert.deepEqual(readSlideLink('#slide-~end.only.3.3'), { target: { id: 'end' }, only: true });
  });

  it('turns down what is not a slide link', () => {
    for (const hash of ['', '#view-inline', '#slide-~a.b', '#slide-2.only', '#slide-~a.only.3', '#slide-~a.only.x.y', '#slide-~a.only.1.2.3']) {
      assert.equal(readSlideLink(hash), null, hash);
    }
  });

  it('finds the linked slide in the deck, or nothing when it is gone', () => {
    assert.equal(linkedSlide(readSlideLink('#slide-~end.only')!, order), 'end');
    assert.equal(linkedSlide(readSlideLink('#slide-1')!, order), 'intro');
    assert.equal(linkedSlide(readSlideLink('#slide-~gone.only')!, order), null);
    assert.equal(linkedSlide(readSlideLink('#slide-9')!, order), null);
  });

  it('writes the place of a slide shown on its own', () => {
    assert.equal(onlySuffix(), '.only');
    assert.equal(onlySuffix({ position: 2, count: 5 }), '.only.2.5');
    assert.deepEqual(readSlideLink('#slide-~7' + onlySuffix({ position: 2, count: 5 })), { target: { id: '7' }, only: true });
  });

  it('matches the copy-slide-link chord while ignoring Ctrl+Cmd+Alt+L', () => {
    assert.equal(isCopySlideLinkKey({ altKey: true, metaKey: true, ctrlKey: false, code: 'KeyL', key: '¬' }), true);
    assert.equal(isCopySlideLinkKey({ altKey: true, metaKey: false, ctrlKey: true, code: 'KeyL', key: 'l' }), true);
    assert.equal(isCopySlideLinkKey({ altKey: true, metaKey: true, ctrlKey: true, code: 'KeyL', key: 'l' }), false);
    assert.equal(isCopySlideLinkKey({ altKey: false, metaKey: true, ctrlKey: false, code: 'KeyL', key: 'l' }), false);
  });
});
