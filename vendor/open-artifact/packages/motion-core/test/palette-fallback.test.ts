import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filmTries, paletteCardStates, paletteFallReply, paletteFallback, type PaletteChoice } from '../src/palettes/index.ts';

const NONE = { lines: false, colors: false };
const LINES = { lines: true, colors: false };
const COLORS = { lines: false, colors: true };
const BOTH = { lines: true, colors: true };

describe('the tries of a film with a person’s records', () => {
  it('tries everything, then the lines alone, then the film as written', () => {
    assert.deepEqual(filmTries(BOTH), [BOTH, LINES, NONE]);
    assert.deepEqual(filmTries(LINES), [LINES, NONE]);
    assert.deepEqual(filmTries(COLORS), [COLORS, NONE]);
    assert.deepEqual(filmTries(NONE), [NONE]);
  });
});

describe('how the film came up, for the Palette section', () => {
  const held = (records: typeof NONE, unreadLines = false) => ({ ...records, unreadLines });

  it('fell: the colors did not play, the lines did or there were none', () => {
    assert.deepEqual(paletteFallback(held(COLORS), NONE), { original: false, fell: true });
    assert.deepEqual(paletteFallback(held(BOTH), LINES), { original: false, fell: true });
  });

  it('original: the text did not play, so neither do the colors', () => {
    assert.deepEqual(paletteFallback(held(BOTH), NONE), { original: true, fell: false });
    assert.deepEqual(paletteFallback(held(LINES), NONE), { original: true, fell: false });
  });

  it('neither when everything played, or when unreadable lines put the film as written', () => {
    assert.deepEqual(paletteFallback(held(BOTH), BOTH), { original: false, fell: false });
    assert.deepEqual(paletteFallback(held(COLORS), COLORS), { original: false, fell: false });
    assert.deepEqual(paletteFallback(held(COLORS, true), NONE), { original: false, fell: false });
  });

  it('marks the film’s own palette while it shows the original, and no card while it fell', () => {
    const cards: PaletteChoice[] = [
      { pairs: [], bars: ['#fff', '#000'] },
      { pairs: [{ was: '#fff', v: '#000' }], bars: ['#000', '#fff'] },
    ];
    const colors = cards[1]!.pairs;
    const on = (state: { fell: boolean; original: boolean }) => paletteCardStates(cards, colors, state).map((card) => card.on);
    assert.deepEqual(on({ fell: false, original: false }), [false, true]);
    assert.deepEqual(on({ fell: true, original: false }), [false, false]);
    assert.deepEqual(on({ fell: false, original: true }), [true, false]);
  });

  it('takes back a pick that fell, and tells once of a palette that fell otherwise', () => {
    assert.equal(paletteFallReply({ fell: true, wasFell: false, pickFailed: true }), 'undo');
    assert.equal(paletteFallReply({ fell: true, wasFell: true, pickFailed: true }), 'undo');
    assert.equal(paletteFallReply({ fell: true, wasFell: false, pickFailed: false }), 'tell');
    assert.equal(paletteFallReply({ fell: true, wasFell: true, pickFailed: false }), 'none');
    assert.equal(paletteFallReply({ fell: false, wasFell: true, pickFailed: true }), 'none');
  });
});
