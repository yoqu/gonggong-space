import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FilmModule } from '../src/documents.ts';
import {
  applyRecolored,
  contrastRatio,
  cssColorToHex,
  filmPalette,
  formatCssColor,
  hexToOklch,
  hueDistance,
  normalizeHexColor,
  parseCssColor,
  readableInk,
  recolorScenesBackground,
  rgbLuminance,
  hexToRgb,
  rotateHueAtLuminance,
  scanFilmColors,
} from '../src/recolor/index.ts';

const css = (name: string, text: string): FilmModule => ({ name, kind: 'css', text });

describe('color parsing', () => {
  it('reads hex colors of every length', () => {
    assert.equal(normalizeHexColor('#ABC'), '#aabbcc');
    assert.equal(normalizeHexColor('#ff880080'), '#ff8800');
    assert.equal(normalizeHexColor('#12345'), null);
    assert.deepEqual(parseCssColor('#f80c'), { rgb: [255, 136, 0], alpha: 0.8 });
  });

  it('reads rgb(), hsl(), names and transparent', () => {
    assert.deepEqual(parseCssColor('rgb(255, 136, 0)'), { rgb: [255, 136, 0], alpha: 1 });
    assert.deepEqual(parseCssColor('rgba(255 136 0 / 50%)'), { rgb: [255, 136, 0], alpha: 0.5 });
    assert.deepEqual(parseCssColor('rgb(100%, 0%, 0%)'), { rgb: [255, 0, 0], alpha: 1 });
    assert.deepEqual(parseCssColor('hsl(120, 100%, 25%)'), { rgb: [0, 128, 0], alpha: 1 });
    assert.deepEqual(parseCssColor('hsla(0.5turn 100% 50% / 0.25)'), { rgb: [0, 255, 255], alpha: 0.25 });
    assert.equal(cssColorToHex('RebeccaPurple'), '#663399');
    assert.deepEqual(parseCssColor('transparent'), { rgb: [0, 0, 0], alpha: 0 });
    assert.equal(parseCssColor('not-a-color'), null);
  });

  it('formats colors as hex', () => {
    assert.equal(formatCssColor({ rgb: [255, 136, 0], alpha: 1 }), '#ff8800');
    assert.equal(formatCssColor({ rgb: [255, 136, 0], alpha: 0.5 }), '#ff880080');
  });
});

describe('contrast and OKLCH', () => {
  it('measures contrast as WCAG does', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
    assert.equal(contrastRatio('#777777', '#777777'), 1);
    assert.equal(readableInk('#111111'), '#ffffff');
    assert.equal(readableInk('#fafafa'), '#000000');
  });

  it('reads OKLCH', () => {
    const white = hexToOklch('#ffffff');
    assert.ok(Math.abs(white.L - 1) < 0.001 && white.C < 0.001);
    const red = hexToOklch('#ff0000');
    assert.ok(Math.abs(red.h - 29.2) < 1);
    assert.equal(hueDistance(350, 10), 20);
  });

  it('turns a hue keeping the luminance', () => {
    const turned = rotateHueAtLuminance('#2563eb', 120);
    assert.notEqual(turned, '#2563eb');
    assert.ok(hueDistance(hexToOklch(turned).h, hexToOklch('#2563eb').h + 120) < 8);
    assert.ok(Math.abs(rgbLuminance(hexToRgb(turned)) - rgbLuminance(hexToRgb('#2563eb'))) < 0.01);
    assert.equal(rotateHueAtLuminance('#2563eb', 0), '#2563eb');
  });
});

const BASE = ':root { --ground: #101010; --main: #FF8800; --second: #eeeeee; --accent: #2563eb; }';
const SCRIPT = [
  "ctx.fillStyle = '#ff8800';",
  "el.style.color = 'rgb(255, 136, 0)';",
  "document.querySelector('#123abc');",
  "const id = 'abc#2563eb';",
  "const wide = 'rgb(300, 1, 1)';",
].join('\n');

const film = {
  script: SCRIPT,
  modules: [
    css('base.css', BASE),
    css('look.css', '#abcdef { color: #FF8800CC; border: 1px solid #2563eb; }'),
    { name: 'scenes.json', kind: 'json' as const, text: '{"background":"#101010","palettes":[["#000000","#ff0000","#00ff00","#0000ff"]]}' },
  ],
};

describe('scanFilmColors', () => {
  it('counts the colors the code writes, with roles and background', () => {
    const colors = scanFilmColors(film);
    assert.deepEqual(
      colors.map((color) => [color.hex, color.count]),
      [
        ['#ff8800', 4],
        ['#2563eb', 2],
        ['#101010', 1],
        ['#eeeeee', 1],
      ],
    );
    const orange = colors[0]!;
    assert.deepEqual(orange.roles, ['main']);
    assert.deepEqual(orange.sources, ['', 'base.css', 'look.css']);
    assert.equal(colors.find((color) => color.hex === '#101010')?.background, true);
  });

  it("reads the film's palette from base.css", () => {
    assert.deepEqual(filmPalette(film), ['#101010', '#ff8800', '#eeeeee', '#2563eb']);
    assert.equal(filmPalette({ script: '', modules: [css('base.css', ':root{--ground:#101010;--ground:#000000}')] }), null);
  });
});

describe('applyRecolored', () => {
  it('rewrites colors keeping case, alpha and rgb() separators', () => {
    const result = applyRecolored(film, {
      colors: [
        { was: '#ff8800', v: '#112233' },
        { was: '#101010', v: '#fafafa' },
        { was: '#999999', v: '#000000' },
      ],
    });
    assert.equal(result.met, 2);
    assert.deepEqual(
      result.unmatched.map((color) => color.was),
      ['#999999'],
    );
    assert.match(result.script, /fillStyle = '#112233'/);
    assert.match(result.script, /rgb\(17, 34, 51\)/);
    assert.match(result.script, /rgb\(300, 1, 1\)/);
    assert.equal(result.modules[1]!.text, '#abcdef { color: #112233CC; border: 1px solid #2563eb; }');
    assert.match(result.modules[0]!.text, /--main: #112233;/);
    assert.equal(JSON.parse(result.modules[2]!.text).background, '#fafafa');
  });

  it('round-trips', () => {
    const there = applyRecolored(film, { colors: [{ was: '#2563eb', v: '#e11d48' }] });
    const back = applyRecolored(there, { colors: [{ was: '#e11d48', v: '#2563eb' }] });
    assert.equal(back.script, film.script);
    assert.deepEqual(
      back.modules.map((module) => module.text),
      film.modules.map((module) => module.text),
    );
  });

  it('leaves the scenes background alone unless the code writes its color', () => {
    assert.equal(recolorScenesBackground('{"background":"#101010"}', []), '{"background":"#101010"}');
    assert.equal(recolorScenesBackground('{"background":"#101010"}', [{ was: '#101010', v: '#202020' }]), '{"background":"#202020"}');
  });
});
