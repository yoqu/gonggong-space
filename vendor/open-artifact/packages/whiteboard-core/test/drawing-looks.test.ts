/**
 * Tests of drawing looks: which look a style names and how it is made, the
 * SVG rewrites of the vector looks, the paint plan of the textured ones,
 * and text over a drawing reading against its paper.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ImageElement, TextElement } from '../src/schema.ts';
import { textBackdropColors } from '../src/backdrop.ts';
import { svgToBase64DataUrl } from '../src/image-source.ts';
import { findUnknownSvgParts } from '../src/drawn-svg/vetting.ts';
import {
  BLUEPRINT_CUT_FILL,
  BLUEPRINT_KEPT_WASH,
  blueprintDrawnSvg,
  blueprintGridPaths,
  comicColor,
  COMIC_SHADOW_TONES,
  comicDrawnSvg,
  drawingCutParts,
  DRAWING_LOOK_TONES,
  drawingLookOf,
  drawingLookPaper,
  drawingLookRenderer,
  drawingPaintPlan,
  hexSaturation,
  imageDrawingLook,
  pencilHatchPath,
  seededLookRandom,
  sketchDrawnSvg,
  solidHex,
} from '../src/drawn-svg/looks.ts';
import { parseSvgTree, serializeXml, XmlElement } from '../src/drawn-svg/xml.ts';
import { DRAWING_STYLES } from '../src/schema.ts';

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="2">';
const drawing = `${SVG_OPEN}<rect x="20" y="20" width="80" height="50" fill="#3b82f6" stroke="none"/><path d="M110 20L180 80" stroke-dasharray="4 4"/><circle cx="150" cy="40" r="15" fill="#f59e0b"/></svg>`;

function tree(svg: string): XmlElement {
  const root = parseSvgTree(svg);
  assert.ok(root instanceof XmlElement, `unreadable: ${String(root)}`);
  return root;
}

describe('drawingLookOf', () => {
  it('names each known style and draws no style or an unknown word plain', () => {
    for (const style of DRAWING_STYLES) assert.equal(drawingLookOf(style), style);
    assert.equal(drawingLookOf('oil-paint'), 'plain');
    assert.equal(drawingLookOf(undefined), 'plain');
  });

  it('gives a look only to SVG drawings', () => {
    assert.equal(imageDrawingLook({ src: svgToBase64DataUrl(drawing), style: 'comic' }), 'comic');
    assert.equal(imageDrawingLook({ src: '/_blob/photo', style: 'comic' }), undefined);
  });
});

describe('drawingLookRenderer', () => {
  it('rewrites the vector looks and paints the textured ones', () => {
    const renderers = Object.fromEntries(DRAWING_STYLES.map((style) => [style, drawingLookRenderer(style)]));
    assert.deepEqual(renderers, { plain: 'svg', draft: 'svg', comic: 'svg', blueprint: 'svg', marker: 'raster', watercolor: 'raster', paper: 'raster' });
  });
});

describe('look tones', () => {
  it('has a light and a dark tone for every look', () => {
    for (const style of DRAWING_STYLES) {
      const { light, dark } = DRAWING_LOOK_TONES[style];
      assert.notEqual(light.ink, dark.ink, style);
    }
  });

  it('lays paper only under draft, blueprint and watercolor', () => {
    const papered = DRAWING_STYLES.filter((style) => drawingLookPaper(style, 'light') !== undefined);
    assert.deepEqual([...papered].sort(), ['blueprint', 'draft', 'watercolor']);
    assert.notEqual(drawingLookPaper('blueprint', 'light'), drawingLookPaper('blueprint', 'dark'));
  });
});

describe('look colors', () => {
  it('reads solid hex colors and their alpha', () => {
    assert.deepEqual(solidHex('#ABC'), { hex: '#aabbcc', alpha: 1 });
    assert.equal(solidHex('url(#g)'), undefined);
    assert.equal(solidHex('currentColor'), undefined);
  });

  it('makes comic colors at least as saturated', () => {
    for (const hex of ['#7f8fa6', '#3b82f6', '#c0a080']) assert.ok(hexSaturation(comicColor(hex)) >= hexSaturation(hex) - 1e-6, hex);
  });
});

describe('pencilHatchPath', () => {
  it('covers the box with crooked lines and gives up past its budget', () => {
    const hatch = pencilHatchPath([0, 0, 100, 50], 6, Math.PI / 4, 500, seededLookRandom('x'));
    assert.ok(hatch !== undefined && hatch.lines > 10);
    assert.match(hatch.d, /^M[\d.-]+ [\d.-]+Q/);
    assert.equal(pencilHatchPath([0, 0, 100, 50], 0.1, 0, 50, seededLookRandom('x')), undefined);
  });

  it('is the same for the same seed', () => {
    const a = pencilHatchPath([0, 0, 40, 40], 5, 1, 100, seededLookRandom('seed'));
    const b = pencilHatchPath([0, 0, 40, 40], 5, 1, 100, seededLookRandom('seed'));
    assert.deepEqual(a, b);
  });
});

describe('sketchDrawnSvg', () => {
  it('lays paper behind, inks in graphite and hatches the fills', () => {
    const root = tree(drawing);
    assert.equal(sketchDrawnSvg(root, 'light'), true);
    const out = serializeXml(root);
    assert.equal(root.getAttribute('color'), DRAWING_LOOK_TONES.draft.light.ink);
    assert.equal(root.children[0]?.getAttribute('fill'), DRAWING_LOOK_TONES.draft.light.paper);
    assert.match(out, /<clipPath\b/);
    assert.ok(Number(root.descendants().find((node) => node.localName === 'rect' && node.getAttribute('fill') === '#3b82f6')?.getAttribute('fill-opacity')) < 0.5);
  });

  it('needs a viewBox from the origin', () => {
    assert.equal(sketchDrawnSvg(tree('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L9 9" stroke="#000"/></svg>'), 'light'), false);
  });
});

describe('comicDrawnSvg', () => {
  it('outlines filled masses thickly and drops a hard shadow', () => {
    const root = tree(drawing);
    assert.equal(comicDrawnSvg(root, 'light'), true);
    const groups = root.children.filter((node) => node.localName === 'g');
    assert.equal(groups.length, 3);
    assert.match(groups[0]?.getAttribute('transform') ?? '', /^translate\(/);
    const rimWidths = groups[1]!.descendants().map((node) => Number(node.getAttribute('stroke-width') ?? 0));
    assert.ok(Math.max(...rimWidths) >= 3);
    assert.equal(groups[0]?.getAttribute('color'), COMIC_SHADOW_TONES.light.color);
    // The dashed line is not a filled mass: it gets no silhouette.
    assert.equal(groups[0]!.descendants().some((node) => node.localName === 'path'), false);
  });
});

describe('blueprintDrawnSvg', () => {
  it('lays blue paper and a grid, keeps dashes and turns fills to washes', () => {
    const root = tree(drawing);
    assert.equal(blueprintDrawnSvg(root, 'dark'), true);
    const tone = DRAWING_LOOK_TONES.blueprint.dark;
    assert.equal(root.children[0]?.getAttribute('fill'), tone.paper);
    assert.equal(root.children[1]?.localName, 'path');
    assert.equal(root.descendants().find((node) => node.localName === 'path' && node.hasAttribute('stroke-dasharray'))?.getAttribute('stroke-dasharray'), '4 4');
    const rect = root.descendants().find((node) => node.localName === 'rect' && node.getAttribute('x') === '20');
    assert.equal(Number(rect?.getAttribute('fill-opacity')), BLUEPRINT_KEPT_WASH.opacity);
    assert.equal(rect?.getAttribute('stroke'), 'currentColor');
  });

  it('keeps a standing-out color as a light, nearly opaque wash', () => {
    const root = tree(drawing);
    blueprintDrawnSvg(root, 'light');
    const circle = root.descendants().find((node) => node.localName === 'circle');
    assert.equal(Number(circle?.getAttribute('fill-opacity')), BLUEPRINT_KEPT_WASH.opacity);
    assert.ok(hexSaturation(circle?.getAttribute('fill') ?? '#000000') > 0.6, 'the amber stays amber');
  });

  it('fills section cuts solid mid-grey, outlined, on parts and in groups', () => {
    const cut = `${SVG_OPEN}<rect class="cut" x="10" y="10" width="20" height="80" fill="none"/><g class="wall cut"><rect x="40" y="10" width="20" height="80" fill="#3b82f6" stroke="none"/></g><rect x="70" y="10" width="20" height="80" fill="#ffffff"/></svg>`;
    for (const scheme of ['light', 'dark'] as const) {
      const root = tree(cut);
      assert.equal(blueprintDrawnSvg(root, scheme), true);
      const rects = root.descendants().filter((node) => node.localName === 'rect' && node.getAttribute('y') === '10');
      assert.deepEqual(rects.map((rect) => rect.getAttribute('fill')), [BLUEPRINT_CUT_FILL[scheme], BLUEPRINT_CUT_FILL[scheme], DRAWING_LOOK_TONES.blueprint[scheme].ink]);
      assert.deepEqual(rects.slice(0, 2).map((rect) => rect.getAttribute('fill-opacity')), ['1', '1']);
      assert.equal(rects[1]?.getAttribute('stroke'), 'currentColor');
    }
  });

  it('reads cut parts from class tokens, not substrings', () => {
    const root = tree(`${SVG_OPEN}<g class="cut"><rect x="1" y="1" width="2" height="2"/></g><rect class="cutout" x="5" y="5" width="2" height="2"/></svg>`);
    assert.deepEqual([...drawingCutParts(root)].map((node) => node.localName), ['g', 'rect']);
  });

  it('draws every fifth grid line stronger', () => {
    const grid = blueprintGridPaths(100, 100);
    assert.ok(grid.pitch > 0);
    assert.ok(grid.minor.length > grid.major.length && grid.major.length > 0);
  });
});

describe('the cut marker', () => {
  const marked = `${SVG_OPEN}<rect class="cut" x="20" y="20" width="80" height="50" fill="#3b82f6"/></svg>`;

  it('passes vetting as a plain marker', () => {
    assert.deepEqual(findUnknownSvgParts(marked), []);
  });

  it('is ignored by the other looks', () => {
    for (const rewrite of [sketchDrawnSvg, comicDrawnSvg]) {
      const root = tree(marked);
      rewrite(root, 'light');
      assert.equal(root.descendants().some((node) => Object.values(BLUEPRINT_CUT_FILL).includes(node.getAttribute('fill') ?? '')), false, rewrite.name);
    }
  });
});

describe('drawingPaintPlan', () => {
  it('flattens shapes with their resolved paint, back to front', () => {
    const plan = drawingPaintPlan(tree(drawing));
    assert.ok(plan !== undefined);
    assert.equal(plan.width, 200);
    assert.equal(plan.parts.length, 3);
    assert.deepEqual(plan.parts[0]?.fill, { color: '#3b82f6', alpha: 1 });
    assert.equal(plan.parts[0]?.stroke, undefined);
    assert.equal(plan.parts[1]?.stroke?.dashed, true);
    assert.equal(plan.parts[1]?.fill, undefined);
    assert.equal(plan.parts[2]?.stroke?.color, 'currentColor');
  });
});

describe('text over a drawing', () => {
  const image = (style: string | undefined): ImageElement => ({ id: 'img', type: 'image', x: 0, y: 0, w: 400, h: 200, src: svgToBase64DataUrl(drawing), ...(style !== undefined ? { style } : {}) });
  const text: TextElement = { id: 'txt', type: 'text', x: 50, y: 50, text: 'Label', size: 'body', color: 'ink' };
  const measures = new Map([['txt', { w: 100, h: 30 }]]);

  it('reads against the paper of its look', () => {
    assert.equal(textBackdropColors([image('blueprint'), text], measures, 'light').get('txt'), DRAWING_LOOK_TONES.blueprint.light.paper);
    assert.equal(textBackdropColors([image('blueprint'), text], measures, 'dark').get('txt'), DRAWING_LOOK_TONES.blueprint.dark.paper);
  });

  it('reads against the board when the look has no paper', () => {
    assert.equal(textBackdropColors([image('comic'), text], measures, 'light').has('txt'), false);
    assert.equal(textBackdropColors([image(undefined), text], measures, 'light').has('txt'), false);
  });
});
