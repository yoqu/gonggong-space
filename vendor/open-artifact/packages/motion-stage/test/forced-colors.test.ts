import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stageDocument } from '../src/host.ts';
import { PLAIN_INK, svgForRaster } from '../src/runtime/snapshot/serialize.ts';

test('the stage document opts out of forced colors and names the film-reset layer first', () => {
  for (const html of [stageDocument('void 0'), stageDocument('void 0', 'same')]) {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.match(style, /html,body\{[^}]*forced-color-adjust:none[^}]*\}/);
    assert.ok(style.includes('@media (forced-colors:active){@layer film-reset{html{color:light-dark(#000,#fff)}}}'));
    // Before the runtime, which adds the film's own film-reset rules: this style's mention sets the layer's place.
    assert.ok(html.indexOf('@layer film-reset') < html.indexOf('<script>'));
    assert.equal(html.match(/<style>/g)?.length, 1);
  }
});

test('a snapshot’s foreignObject always opts out of forced colors', () => {
  const { svg, pw, ph } = svgForRaster('<div xmlns="http://www.w3.org/1999/xhtml"></div>', 1920, 1080, 0.5);
  assert.equal(pw, 960);
  assert.equal(ph, 540);
  assert.ok(svg.includes('<foreignObject x="0" y="0" width="1920" height="1080" style="forced-color-adjust:none">'));
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" data-raster-size="960x540">'));
  assert.doesNotMatch(svg, / color=/);
  assert.ok(svg.endsWith('</foreignObject></svg>'));
});

test('a snapshot given ink sets it as its root color', () => {
  const frame = svgForRaster('<div/>', 100, 50, 2, 'rgb(12, 34, 56)').svg;
  assert.ok(frame.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" data-raster-size="200x100" color="rgb(12, 34, 56)">'));
  assert.ok(frame.includes('style="forced-color-adjust:none"'));
  assert.equal(frame.match(/ color=/g)?.length, 1);
  const plate = svgForRaster('<div/>', 100, 50, 1, PLAIN_INK).svg;
  assert.ok(plate.includes(' data-raster-size="100x50" color="#000">'));
});
