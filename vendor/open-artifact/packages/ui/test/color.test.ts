import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  colorName,
  colorRevertMessage,
  contrastLevel,
  contrastRatio,
  contrastTarget,
  convertColor,
  formatColor,
  formatHex,
  formatLike,
  hslaToRgba,
  hsvaToRgba,
  hueName,
  oklchInGamut,
  oklchToRgba,
  parseColor,
  readableShade,
  rgbaToHsla,
  rgbaToHsva,
  rgbaToOklch,
  sameColor,
  toRgba,
  withHexHash,
  type Rgba,
} from '../src/color.ts';

const near = (actual: number, expected: number, tolerance = 0.5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const nearRgba = (actual: Rgba | null, expected: Rgba, tolerance = 0.5) => {
  assert.ok(actual, 'expected a color');
  near(actual.r, expected.r, tolerance);
  near(actual.g, expected.g, tolerance);
  near(actual.b, expected.b, tolerance);
  near(actual.a, expected.a, 0.002);
};

describe('parseColor', () => {
  it('reads hex in every length', () => {
    assert.deepEqual(toRgba('#f80'), { r: 255, g: 136, b: 0, a: 1 });
    assert.deepEqual(toRgba('#ff8800'), { r: 255, g: 136, b: 0, a: 1 });
    nearRgba(toRgba('#f808'), { r: 255, g: 136, b: 0, a: 0x88 / 255 });
    nearRgba(toRgba('#FF880080'), { r: 255, g: 136, b: 0, a: 128 / 255 });
    assert.equal(parseColor('#ff88')?.notation.short, true);
    assert.equal(parseColor('#FF8800')?.notation.upper, true);
    assert.equal(toRgba('#ff88000'), null);
    assert.equal(toRgba('#ggg'), null);
  });

  it('reads rgb() and rgba() in comma and space syntax', () => {
    assert.deepEqual(toRgba('rgb(255, 0, 128)'), { r: 255, g: 0, b: 128, a: 1 });
    assert.deepEqual(toRgba('rgba(255, 0, 128, 0.5)'), { r: 255, g: 0, b: 128, a: 0.5 });
    assert.deepEqual(toRgba('rgb(255 0 128 / 50%)'), { r: 255, g: 0, b: 128, a: 0.5 });
    assert.deepEqual(toRgba('rgb(100% 0% 50%)'), { r: 255, g: 0, b: 127.5, a: 1 });
    assert.deepEqual(toRgba('RGB(300 -5 0)'), { r: 255, g: 0, b: 0, a: 1 });
    assert.equal(parseColor('rgba(1, 2, 3, 0.5)')?.notation.legacy, true);
    assert.equal(parseColor('rgba(1, 2, 3, 0.5)')?.notation.alphaName, true);
    // Commas and spaces cannot mix; legacy syntax cannot mix numbers and percentages.
    assert.equal(toRgba('rgb(1, 2 3)'), null);
    assert.equal(toRgba('rgb(1, 2%, 3)'), null);
    assert.equal(toRgba('rgb(1 2)'), null);
  });

  it('reads hsl() with angle units', () => {
    nearRgba(toRgba('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0, a: 1 });
    nearRgba(toRgba('hsl(120deg 100% 25%)'), { r: 0, g: 127.5, b: 0, a: 1 });
    nearRgba(toRgba('hsl(0.5turn 100% 50% / 0.25)'), { r: 0, g: 255, b: 255, a: 0.25 });
    nearRgba(toRgba('hsla(240, 100%, 50%, 1)'), { r: 0, g: 0, b: 255, a: 1 });
    assert.equal(toRgba('hsl(0, 100, 50)'), null);
  });

  it('reads oklch() and keeps the exact channels', () => {
    const parsed = parseColor('oklch(62.8% 0.2577 29.23)');
    assert.ok(parsed);
    nearRgba(parsed.rgba, { r: 255, g: 0, b: 0, a: 1 }, 1);
    assert.deepEqual(parsed.oklch, { l: 0.628, c: 0.2577, h: 29.23, a: 1 });
    nearRgba(toRgba('oklch(1 0 0)'), { r: 255, g: 255, b: 255, a: 1 }, 0.5);
    nearRgba(toRgba('oklch(0% 0 none / 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
    assert.equal(toRgba('oklch(50%, 0.1, 20)'), null);
  });

  it('reads named colors and transparent', () => {
    assert.deepEqual(toRgba('RebeccaPurple'), { r: 102, g: 51, b: 153, a: 1 });
    assert.deepEqual(toRgba('transparent'), { r: 0, g: 0, b: 0, a: 0 });
    assert.equal(parseColor('red')?.notation.format, 'named');
    assert.equal(colorName({ r: 255, g: 0, b: 0, a: 1 }), 'red');
    assert.equal(colorName({ r: 255, g: 0, b: 1, a: 1 }), null);
  });

  it('leaves non-literal colors alone', () => {
    for (const text of ['var(--primary)', 'currentcolor', 'color-mix(in srgb, red, blue)', '', 'nope']) assert.equal(parseColor(text), null, text);
  });
});

describe('formatColor', () => {
  const orange = { r: 255, g: 136, b: 0, a: 1 };
  it('writes every format', () => {
    assert.equal(formatColor(orange, 'hex'), '#ff8800');
    assert.equal(formatColor({ ...orange, a: 0.5 }, 'hex'), '#ff880080');
    assert.equal(formatColor(orange, 'rgb'), 'rgb(255 136 0)');
    assert.equal(formatColor({ ...orange, a: 0.5 }, 'rgb'), 'rgb(255 136 0 / 0.5)');
    assert.equal(formatColor(orange, 'hsl'), 'hsl(32 100% 50%)');
    assert.match(formatColor(orange, 'oklch'), /^oklch\(\d+(\.\d+)?% 0\.\d+ \d+(\.\d+)?\)$/);
    assert.equal(formatColor({ r: 255, g: 255, b: 255, a: 1 }, 'oklch'), 'oklch(100% 0 0)');
  });

  it('keeps the notation details of the original', () => {
    assert.equal(formatLike('rgba(0, 0, 0, 0.5)', { r: 10, g: 20, b: 30, a: 1 }), 'rgba(10, 20, 30, 1)');
    assert.equal(formatLike('rgb(0, 0, 0)', { r: 10, g: 20, b: 30, a: 0.25 }), 'rgba(10, 20, 30, 0.25)');
    assert.equal(formatLike('hsl(0deg 0% 0%)', { r: 255, g: 0, b: 0, a: 1 }), 'hsl(0 100% 50%)');
    assert.equal(formatLike('#ABCDEF', { r: 255, g: 0, b: 0, a: 1 }), '#FF0000');
    assert.equal(formatLike('#abc', { r: 0x11, g: 0x22, b: 0x33, a: 1 }), '#123');
    assert.equal(formatLike('#abc', { r: 0x11, g: 0x22, b: 0x34, a: 1 }), '#112234');
    assert.equal(formatLike('red', { r: 0, g: 0, b: 255, a: 1 }), 'blue');
    assert.equal(formatLike('red', { r: 0, g: 0, b: 254, a: 1 }), '#0000fe');
    assert.equal(formatLike('var(--x)', { r: 0, g: 0, b: 0, a: 1 }), '#000000');
  });

  it('round-trips through every format', () => {
    const samples = ['#000000', '#ffffff', '#ff8800', '#2563eb', '#12345680', '#7f7f7f'];
    for (const sample of samples) {
      const rgba = toRgba(sample)!;
      for (const format of ['hex', 'rgb', 'hsl', 'oklch'] as const) {
        const back = toRgba(formatColor(rgba, format));
        nearRgba(back, rgba, 0.6);
        assert.equal(formatHex(back!), sample, `${sample} via ${format}`);
      }
    }
  });

  it('converts text between formats', () => {
    assert.equal(convertColor('red', 'rgb'), 'rgb(255 0 0)');
    assert.equal(convertColor('oklch(70% 0.1 200 / 0.5)', 'oklch'), 'oklch(70% 0.1 200 / 0.5)');
    assert.equal(convertColor('hsl(210 50% 40%)', 'hex'), '#336699');
    assert.equal(convertColor('var(--x)', 'hex'), null);
  });
});

describe('conversions', () => {
  it('HSV round-trips and keeps the hue of grays', () => {
    const rgba = { r: 37, g: 99, b: 235, a: 0.8 };
    nearRgba(hsvaToRgba(rgbaToHsva(rgba)), rgba, 1e-6);
    assert.equal(rgbaToHsva({ r: 128, g: 128, b: 128, a: 1 }, 200).h, 200);
    assert.deepEqual(rgbaToHsva({ r: 255, g: 0, b: 0, a: 1 }), { h: 0, s: 1, v: 1, a: 1 });
  });

  it('HSL round-trips', () => {
    const rgba = { r: 200, g: 30, b: 90, a: 1 };
    nearRgba(hslaToRgba(rgbaToHsla(rgba)), rgba, 1e-6);
    const hsl = rgbaToHsla({ r: 255, g: 255, b: 255, a: 1 });
    assert.equal(hsl.l, 1);
    assert.equal(hsl.s, 0);
  });

  it('OKLCH matches reference values and round-trips', () => {
    const red = rgbaToOklch({ r: 255, g: 0, b: 0, a: 1 });
    near(red.l, 0.628, 0.001);
    near(red.c, 0.2577, 0.001);
    near(red.h, 29.23, 0.05);
    const rgba = { r: 37, g: 99, b: 235, a: 1 };
    nearRgba(oklchToRgba(rgbaToOklch(rgba)), rgba, 1e-3);
    assert.equal(rgbaToOklch({ r: 50, g: 50, b: 50, a: 1 }, 123).h, 123);
  });

  it('maps out-of-gamut OKLCH into sRGB by lowering chroma', () => {
    const wild = { l: 0.7, c: 0.4, h: 150, a: 1 };
    assert.equal(oklchInGamut(wild), false);
    const mapped = oklchToRgba(wild);
    for (const channel of [mapped.r, mapped.g, mapped.b]) assert.ok(channel >= 0 && channel <= 255);
    near(rgbaToOklch(mapped).l, 0.7, 0.01);
    near(rgbaToOklch(mapped).h, 150, 1);
  });

  it('compares colors across notations', () => {
    assert.ok(sameColor('#ff0000', 'red'));
    assert.ok(sameColor('rgb(255 0 0 / 0)', 'transparent'));
    assert.ok(!sameColor('#ff0000', '#fe0000'));
    assert.ok(sameColor('var(--a)', 'VAR(--a)'));
    assert.ok(sameColor(null, null));
    assert.ok(!sameColor('#000', null));
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    near(contrastRatio('#000', '#fff')!, 21, 1e-9);
    near(contrastRatio('#fff', '#fff')!, 1, 1e-9);
    near(contrastRatio('#767676', '#ffffff')!, 4.54, 0.01);
    near(contrastRatio('#ffffff', '#767676')!, 4.54, 0.01);
    assert.equal(contrastRatio('var(--x)', '#fff'), null);
  });

  it('composites translucent colors', () => {
    // 50% black on white is a mid gray.
    near(contrastRatio('rgb(0 0 0 / 0.5)', '#fff')!, contrastRatio('#808080', '#fff')!, 0.05);
    // A transparent foreground has no contrast at all.
    near(contrastRatio('transparent', '#123456')!, 1, 1e-9);
  });

  it('grades ratios', () => {
    assert.equal(contrastLevel(7.1), 'AAA');
    assert.equal(contrastLevel(4.6), 'AA');
    assert.equal(contrastLevel(3.2), 'AA Large');
    assert.equal(contrastLevel(2.1), 'Fail');
    assert.equal(contrastLevel(4.6, true), 'AAA');
    assert.equal(contrastLevel(3.1, true), 'AA');
    assert.equal(contrastTarget('AA'), 4.5);
    assert.equal(contrastTarget('AAA', true), 4.5);
  });

  it('finds a readable shade in the original notation', () => {
    const fix = readableShade('#999999', '#ffffff');
    assert.ok(fix && /^#[0-9a-f]{6}$/.test(fix));
    assert.ok(contrastRatio(fix, '#ffffff')! >= 4.5);
    const okl = readableShade('oklch(80% 0.1 250)', '#ffffff');
    assert.ok(okl?.startsWith('oklch('));
    assert.ok(contrastRatio(okl!, '#ffffff')! >= 4.5);
    assert.equal(readableShade('#000', '#fff'), null);
  });
});

describe('typed color text', () => {
  it('adds the # to bare hex of a color length', () => {
    assert.equal(withHexHash('abc'), '#abc');
    assert.equal(withHexHash(' abcd '), '#abcd');
    assert.equal(withHexHash('AABBCC'), '#AABBCC');
    assert.equal(withHexHash('aabbcc80'), '#aabbcc80');
    assert.equal(toRgba(withHexHash('f80'))?.g, 136);
  });

  it('leaves other text alone', () => {
    assert.equal(withHexHash('#abc'), '#abc');
    assert.equal(withHexHash('abcde'), 'abcde');
    assert.equal(withHexHash('aabbccd'), 'aabbccd');
    assert.equal(withHexHash('red'), 'red');
    assert.equal(withHexHash('ggg'), 'ggg');
  });

  it('says where a refused value went back to', () => {
    assert.equal(colorRevertMessage('#FF8800'), 'Not a color, so it went back to #FF8800.');
    assert.equal(colorRevertMessage(' '), 'Not a color, so the field stayed empty.');
  });
});

describe('hue names', () => {
  it('names the nearest of twelve hues', () => {
    assert.equal(hueName(0), 'red');
    assert.equal(hueName(14), 'red');
    assert.equal(hueName(16), 'orange');
    assert.equal(hueName(120), 'green');
    assert.equal(hueName(240), 'blue');
    assert.equal(hueName(350), 'red');
    assert.equal(hueName(-30), 'pink');
    assert.equal(hueName(720), 'red');
  });
});
