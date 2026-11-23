import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contrastRatio, toRgba } from '@open-artifact/slides-core';
import { colorLabel, formatPicked, hsvaToRgba, oklchToRgba, readableShade, rgbaToHsva, rgbaToOklch, sameColor } from '../src/lib/colorspace.ts';

describe('HSV', () => {
  it('round-trips primaries and grays', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#d97757', '#3d3d3a', '#ffffff', '#000000']) {
      const rgba = toRgba(hex)!;
      assert.deepEqual(hsvaToRgba(rgbaToHsva(rgba)), rgba, hex);
    }
  });

  it('keeps the given hue for grays', () => {
    assert.equal(rgbaToHsva({ r: 128, g: 128, b: 128, a: 1 }, 200).h, 200);
  });

  it('reads hue, saturation and value', () => {
    const { h, s, v } = rgbaToHsva({ r: 255, g: 128, b: 0, a: 1 });
    assert.ok(Math.abs(h - 30.1) < 0.2);
    assert.equal(s, 1);
    assert.equal(v, 1);
  });
});

describe('labels', () => {
  it('upper-cases hex and resolves other spellings', () => {
    assert.equal(colorLabel('#73726c'), '#73726C');
    assert.equal(colorLabel('rgb(255, 0, 0)'), '#FF0000');
    assert.equal(colorLabel('var(--accent)'), 'var(--accent)');
  });

  it('writes opaque colors as hex and translucent ones as rgba()', () => {
    assert.equal(formatPicked({ r: 255, g: 0, b: 0, a: 1 }), '#ff0000');
    assert.equal(formatPicked({ r: 255, g: 0, b: 0, a: 0.5 }), 'rgba(255, 0, 0, 0.5)');
  });

  it('compares colors across spellings', () => {
    assert.ok(sameColor('#FFF', 'rgb(255, 255, 255)'));
    assert.ok(!sameColor('#fff', 'rgba(255, 255, 255, 0.5)'));
    assert.ok(!sameColor(null, '#fff'));
  });
});

describe('OKLCH', () => {
  it('round-trips sRGB colors', () => {
    for (const hex of ['#d97757', '#2563eb', '#141413', '#faf9f5']) {
      const rgba = toRgba(hex)!;
      const back = oklchToRgba(rgbaToOklch(rgba));
      assert.ok(Math.abs(back.r - rgba.r) <= 1 && Math.abs(back.g - rgba.g) <= 1 && Math.abs(back.b - rgba.b) <= 1, hex);
    }
  });

  it('finds the nearest readable shade', () => {
    const background = toRgba('#ffffff')!;
    const text = toRgba('#d97757')!;
    const shade = readableShade(text, background, 4.5)!;
    const ratio = contrastRatio(toRgba(shade)!, background);
    assert.ok(ratio >= 4.5 && ratio < 5, `${shade} at ${ratio}`);
    // Darker, same family.
    assert.ok(rgbaToOklch(toRgba(shade)!).l < rgbaToOklch(text).l);
  });

  it('gives up when nothing reaches the target', () => {
    assert.equal(readableShade(toRgba('#777777')!, toRgba('#777777')!, 22), null);
  });
});
