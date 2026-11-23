/**
 * Tests of the icon sticker components. (What each role is offered and the
 * version-history wiring: `@open-artifact/editor-kit`.)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ICON_STICKERS } from '@open-artifact/whiteboard-core';
import { stickerIconComponent } from '../src/lib/sticker-icons.ts';

describe('icon stickers', () => {
  it('have a lucide component each', () => {
    const missing = ICON_STICKERS.filter((sticker) => stickerIconComponent(sticker.icon) === undefined).map((sticker) => sticker.icon);
    assert.deepEqual(missing, []);
  });
});
