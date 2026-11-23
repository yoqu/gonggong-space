import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeBackgroundImage, splitTopLevel } from '../src/capture-safe.ts';

const toRgba = (color: string) => `rgba(<${color}>)`;

describe('capture-safe background images', () => {
  it('splits at top-level commas only', () => {
    assert.deepEqual(splitTopLevel('a(1, 2), b, c(d(3, 4))'), ['a(1, 2)', 'b', 'c(d(3, 4))']);
  });

  it('leaves values without linear gradients alone', () => {
    const value = 'radial-gradient(circle at 100% 100% in oklab, rgb(255, 255, 255) 0%, rgb(255, 255, 255) 100%)';
    assert.equal(safeBackgroundImage(value, toRgba), value);
    assert.equal(safeBackgroundImage('none', toRgba), 'none');
  });

  it('drops an interpolation space given alone', () => {
    assert.equal(
      safeBackgroundImage('linear-gradient(in oklch, oklch(1 5.96046e-8 90 / 0.75) 0%, oklch(1 5.96046e-8 90 / 0.15) 100%)', toRgba),
      'linear-gradient(rgba(<oklch(1 5.96046e-8 90 / 0.75)>) 0%, rgba(<oklch(1 5.96046e-8 90 / 0.15)>) 100%)',
    );
  });

  it('keeps the direction and drops the space after it', () => {
    assert.equal(safeBackgroundImage('linear-gradient(to bottom in oklch longer hue, red, blue)', toRgba), 'linear-gradient(to bottom, red, blue)');
    assert.equal(safeBackgroundImage('linear-gradient(90deg in srgb, rgb(1, 2, 3) 0%, color(display-p3 1 0 0) 100%)', toRgba), 'linear-gradient(90deg, rgb(1, 2, 3) 0%, rgba(<color(display-p3 1 0 0)>) 100%)');
  });

  it('rewrites only the linear layers of a list', () => {
    assert.equal(
      safeBackgroundImage('url("a.png"), linear-gradient(lab(50 10 10), rgba(0, 0, 0, 0)), radial-gradient(in oklch, red, blue)', toRgba),
      'url("a.png"), linear-gradient(rgba(<lab(50 10 10)>), rgba(0, 0, 0, 0)), radial-gradient(in oklch, red, blue)',
    );
  });
});
