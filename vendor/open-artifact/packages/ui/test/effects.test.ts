import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  colorAtPosition,
  formatBoxShadow,
  formatFilter,
  formatGradient,
  newFilter,
  parseBoxShadow,
  parseFilter,
  parseGradient,
  splitTopLevel,
  type FilterFunction,
  type Gradient,
  type ShadowLayer,
} from '../src/effects.ts';

describe('splitTopLevel', () => {
  it('splits outside parentheses only', () => {
    assert.deepEqual(splitTopLevel('a, rgb(1, 2, 3), b', ','), ['a', 'rgb(1, 2, 3)', 'b']);
    assert.deepEqual(splitTopLevel('  1px  rgb(0 0 0 / .5)  inset ', 'space'), ['1px', 'rgb(0 0 0 / .5)', 'inset']);
    assert.deepEqual(splitTopLevel('a,,b', ','), ['a', '', 'b']);
  });
});

describe('box-shadow', () => {
  it('parses layers in any token order', () => {
    assert.deepEqual(parseBoxShadow('0 1px 2px rgba(0, 0, 0, 0.2)'), [{ x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(0, 0, 0, 0.2)', inset: false }]);
    assert.deepEqual(parseBoxShadow('inset red 1px -2px'), [{ x: 1, y: -2, blur: 0, spread: 0, color: 'red', inset: true }]);
    assert.deepEqual(parseBoxShadow('1px 2px 3px 4px inset'), [{ x: 1, y: 2, blur: 3, spread: 4, color: 'currentcolor', inset: true }]);
    assert.deepEqual(parseBoxShadow('0 0 0 1px var(--ring), 0 8px 24px -6px rgb(0 0 0 / 0.18)')?.map((layer) => layer.color), ['var(--ring)', 'rgb(0 0 0 / 0.18)']);
    assert.deepEqual(parseBoxShadow('none'), []);
    assert.deepEqual(parseBoxShadow(''), []);
  });

  it('rejects what it cannot represent', () => {
    for (const text of ['1em 2em red', '1px', '1px 2px 3px 4px 5px', '1px red 2px', '1px 2px -3px', '1px 2px, ', 'inset inset 1px 2px', 'var(--shadow)', '1px 2px red blue']) {
      assert.equal(parseBoxShadow(text), null, text);
    }
  });

  it('round-trips', () => {
    const layers: ShadowLayer[] = [
      { x: 0, y: 4, blur: 12, spread: -2, color: 'rgb(0 0 0 / 0.15)', inset: false },
      { x: 1.5, y: 0, blur: 0, spread: 1, color: '#2563eb', inset: true },
    ];
    const css = formatBoxShadow(layers);
    assert.equal(css, '0px 4px 12px -2px rgb(0 0 0 / 0.15), inset 1.5px 0px 0px 1px #2563eb');
    assert.deepEqual(parseBoxShadow(css), layers);
    assert.equal(formatBoxShadow([]), 'none');
    // Text → layers → text is stable after one pass.
    const once = formatBoxShadow(parseBoxShadow('inset 0 0 0 1px red, 0 2px 4px #0003')!);
    assert.equal(formatBoxShadow(parseBoxShadow(once)!), once);
  });
});

describe('filter', () => {
  it('parses each function and normalizes amounts', () => {
    assert.deepEqual(parseFilter('blur(4px) brightness(1.2) contrast(80%) grayscale(1) saturate(2) hue-rotate(0.25turn)'), [
      { kind: 'blur', value: 4 },
      { kind: 'brightness', value: 120 },
      { kind: 'contrast', value: 80 },
      { kind: 'grayscale', value: 100 },
      { kind: 'saturate', value: 200 },
      { kind: 'hue-rotate', value: 90 },
    ]);
    assert.deepEqual(parseFilter('drop-shadow(0 2px 4px rgb(0 0 0 / 0.3))'), [{ kind: 'drop-shadow', shadow: { x: 0, y: 2, blur: 4, color: 'rgb(0 0 0 / 0.3)' } }]);
    assert.deepEqual(parseFilter('grayscale(250%) invert() opacity(.5)'), [
      { kind: 'grayscale', value: 100 },
      { kind: 'invert', value: 100 },
      { kind: 'opacity', value: 50 },
    ]);
    assert.deepEqual(parseFilter('none'), []);
  });

  it('rejects what it cannot represent', () => {
    for (const text of ['url(#f)', 'blur(1em)', 'blur(-1px)', 'brightness(-1)', 'hue-rotate(90)', 'drop-shadow(1px 2px 3px 4px red)', 'drop-shadow(inset 1px 2px)', 'wobble(2)', 'blur(2px', 'var(--f)']) {
      assert.equal(parseFilter(text), null, text);
    }
  });

  it('round-trips', () => {
    const chain: FilterFunction[] = [
      { kind: 'blur', value: 2.5 },
      { kind: 'hue-rotate', value: -45 },
      { kind: 'sepia', value: 30 },
      { kind: 'drop-shadow', shadow: { x: 1, y: 2, blur: 3, color: '#000000' } },
      newFilter('saturate'),
    ];
    const css = formatFilter(chain);
    assert.equal(css, 'blur(2.5px) hue-rotate(-45deg) sepia(30%) drop-shadow(1px 2px 3px #000000) saturate(150%)');
    assert.deepEqual(parseFilter(css), chain);
    assert.equal(formatFilter([]), 'none');
  });
});

describe('gradients', () => {
  it('parses linear gradients with angles and sides', () => {
    const g = parseGradient('linear-gradient(45deg, red, blue)');
    assert.deepEqual(g, { type: 'linear', repeating: false, angle: 45, shape: 'ellipse', stops: [{ color: 'red', position: 0 }, { color: 'blue', position: 100 }] });
    assert.equal(parseGradient('linear-gradient(to right, red, blue)')?.angle, 90);
    assert.equal(parseGradient('linear-gradient(to top left, red, blue)')?.angle, 315);
    assert.equal(parseGradient('linear-gradient(0.5turn, red, blue)')?.angle, 180);
    assert.equal(parseGradient('linear-gradient(-90deg, red, blue)')?.angle, 270);
    // No direction: CSS default, top to bottom.
    assert.equal(parseGradient('linear-gradient(red, blue)')?.angle, 180);
  });

  it('fills in stop positions the way CSS does', () => {
    const g = parseGradient('linear-gradient(90deg, red, yellow, lime 80%, aqua, blue)');
    assert.deepEqual(g?.stops.map((stop) => stop.position), [0, 40, 80, 90, 100]);
    const backwards = parseGradient('linear-gradient(red 50%, blue 20%)');
    assert.deepEqual(backwards?.stops.map((stop) => stop.position), [50, 50]);
    const twin = parseGradient('linear-gradient(red 0% 30%, rgb(0 0 255 / 0.5) 70%)');
    assert.deepEqual(twin?.stops, [
      { color: 'red', position: 0 },
      { color: 'red', position: 30 },
      { color: 'rgb(0 0 255 / 0.5)', position: 70 },
    ]);
  });

  it('parses radial gradients', () => {
    assert.deepEqual(parseGradient('radial-gradient(circle at top left, #fff 10%, var(--x))'), {
      type: 'radial',
      repeating: false,
      angle: 180,
      shape: 'circle',
      position: 'top left',
      stops: [{ color: '#fff', position: 10 }, { color: 'var(--x)', position: 100 }],
    });
    assert.deepEqual(parseGradient('radial-gradient(red, blue)')?.shape, 'ellipse');
    assert.equal(parseGradient('radial-gradient(closest-side, red, blue)')?.size, 'closest-side');
    assert.equal(parseGradient('repeating-radial-gradient(ellipse at center, red, blue 20%)')?.repeating, true);
  });

  it('rejects what it cannot represent', () => {
    for (const text of [
      'conic-gradient(red, blue)',
      'linear-gradient(red)',
      'linear-gradient(red 10px, blue)',
      'linear-gradient(red, 30%, blue)',
      'linear-gradient(to nowhere, red, blue)',
      'linear-gradient(red, blue), linear-gradient(green, white)',
      'url(a.png)',
      'radial-gradient(wobbly, red, blue)',
    ]) {
      assert.equal(parseGradient(text), null, text);
    }
  });

  it('round-trips', () => {
    const samples: Gradient[] = [
      { type: 'linear', repeating: false, angle: 135, shape: 'ellipse', stops: [{ color: '#ff0000', position: 0 }, { color: 'rgb(0 0 255 / 0.5)', position: 62.5 }, { color: 'white', position: 100 }] },
      { type: 'radial', repeating: true, angle: 180, shape: 'circle', size: 'closest-side', position: '30% 40%', stops: [{ color: 'red', position: 0 }, { color: 'blue', position: 20 }] },
      { type: 'radial', repeating: false, angle: 180, shape: 'ellipse', stops: [{ color: 'red', position: 0 }, { color: 'blue', position: 100 }] },
    ];
    for (const sample of samples) assert.deepEqual(parseGradient(formatGradient(sample)), sample);
    assert.equal(formatGradient(samples[0]!), 'linear-gradient(135deg, #ff0000 0%, rgb(0 0 255 / 0.5) 62.5%, white 100%)');
    assert.equal(formatGradient(samples[1]!), 'repeating-radial-gradient(circle closest-side at 30% 40%, red 0%, blue 20%)');
    assert.equal(formatGradient(samples[2]!), 'radial-gradient(red 0%, blue 100%)');
  });

  it('interpolates a color between stops', () => {
    const stops = [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 100 }];
    assert.equal(colorAtPosition(stops, 50), '#808080');
    assert.equal(colorAtPosition(stops, -5), '#000000');
    assert.equal(colorAtPosition(stops, 150), '#ffffff');
    // Premultiplied: fading to transparent keeps the hue.
    assert.equal(colorAtPosition([{ color: 'rgb(255 0 0)', position: 0 }, { color: 'rgb(0 0 255 / 0)', position: 100 }], 50), 'rgb(255 0 0 / 0.5)');
    assert.equal(colorAtPosition([{ color: 'var(--a)', position: 0 }, { color: '#fff', position: 100 }], 20), 'var(--a)');
  });
});
