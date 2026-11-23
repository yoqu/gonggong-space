import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contoursToFillPaths, layerSvgForContrast, strokeToCapsulePaths } from '../src/drawn-svg/contrast.ts';
import { brushStrokeOutline, brushSvgStrokes, hatchFillLines, hatchSvgFills, splitPolylineAtRepeats } from '../src/drawn-svg/restyle.ts';
import { flattenSvgPath, flattenSvgShape, IDENTITY_MATRIX, invertMatrix, parseSvgTransform, splitSvgPathArcs, svgShapePathData } from '../src/drawn-svg/svg-geometry.ts';
import { drawingSvgOrPlaceholder, ensureSvgNamespace, findUnknownSvgParts, svgShapeLength, UNKNOWN_SVG_PART, UNREADABLE_DRAWING_SVG, WHOLE_SVG_PART } from '../src/drawn-svg/vetting.ts';
import { createSvgElement, parseSvgTree, parseXml, serializeXml, XmlElement, XmlParseError } from '../src/drawn-svg/xml.ts';
import { seededRandomFromString } from '../src/shape-paths.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgTree(svg: string): XmlElement {
  const root = parseSvgTree(svg);
  assert.ok(root instanceof XmlElement, `unreadable: ${String(root)}`);
  return root;
}

describe('xml', () => {
  it('parses elements, namespaces, entities and CDATA', () => {
    const root = parseXml('<?xml version="1.0"?><a xmlns="urn:a" xmlns:b="urn:b" b:x="1 &amp; 2"><!-- note --><b:c>&lt;&#65;&#x42;<![CDATA[<raw>]]></b:c><d/></a>');
    assert.equal(root.namespaceURI, 'urn:a');
    const [c, d] = root.children;
    assert.equal(c?.namespaceURI, 'urn:b');
    assert.equal(c?.localName, 'c');
    assert.equal(c?.textContent, '<AB<raw>');
    assert.equal(d?.namespaceURI, 'urn:a');
    assert.equal(root.attributes.find((attribute) => attribute.localName === 'x')?.value, '1 & 2');
  });

  it('refuses what is not well-formed', () => {
    for (const bad of ['<a>', '<a></b>', '<a x="1" x="2"/>', '<p:a/>', '<!DOCTYPE a><a/>', '<a><!-- a -- b --></a>', '<a>&nbsp;</a>', '<a/><b/>'])
      assert.throws(() => parseXml(bad), XmlParseError, bad);
  });

  it('serializes and edits a tree', () => {
    const root = parseXml('<svg xmlns="http://www.w3.org/2000/svg"><g fill="a&quot;b"><rect width="1"/></g></svg>');
    const g = root.children[0]!;
    const path = createSvgElement('path');
    path.setAttribute('d', 'M0 0<1');
    g.children[0]!.replaceWith(path);
    g.after(createSvgElement('circle'));
    assert.equal(serializeXml(root), '<svg xmlns="http://www.w3.org/2000/svg"><g fill="a&quot;b"><path d="M0 0&lt;1"/></g><circle/></svg>');
    path.remove();
    assert.equal(g.childElementCount, 0);
  });

  it('reads drawings, telling unread from broken', () => {
    assert.equal(svgTree(`<svg xmlns="${SVG_NS}"><rect/></svg>`).localName, 'svg');
    assert.equal(parseSvgTree(`<svg xmlns="${SVG_NS}"><!DOCTYPE x></svg>`), 'unread');
    assert.equal(parseSvgTree('<svg xmlns="urn:other"/>'), 'unread');
    assert.equal(parseSvgTree(`<svg xmlns="${SVG_NS}"><rect></svg>`), 'broken');
    assert.equal(parseSvgTree(`<g xmlns="${SVG_NS}"/>`), 'broken');
  });
});

describe('svg geometry', () => {
  it('parses transform lists into matrices', () => {
    assert.equal(parseSvgTransform(IDENTITY_MATRIX, ''), IDENTITY_MATRIX);
    assert.deepEqual(parseSvgTransform(IDENTITY_MATRIX, 'translate(10 20) scale(2)'), [2, 0, 0, 2, 10, 20]);
    assert.equal(parseSvgTransform(IDENTITY_MATRIX, 'skewX(10)'), undefined);
    const matrix = parseSvgTransform(IDENTITY_MATRIX, 'matrix(2 0 0 4 6 8)')!;
    assert.deepEqual(
      invertMatrix(matrix).map((value) => value + 0),
      [0.5, 0, 0, 0.25, -3, -2],
    );
  });

  it('flattens paths and shapes into polylines', () => {
    // Sharp corners are repeated so later smoothing keeps them sharp.
    assert.deepEqual(flattenSvgPath('M0 0 L10 0 l0 10 H0 Z'), [[0, 0, 10, 0, 10, 0, 10, 10, 10, 10, 0, 10, 0, 10, 0, 0]]);
    const curve = flattenSvgPath('M0 0 C 0 50 100 50 100 0');
    assert.ok(curve && curve[0]!.length > 8);
    assert.equal(flattenSvgPath('M0 0 L 5000 0'), undefined);
    assert.equal(flattenSvgPath('not a path'), undefined);
    const rect = createSvgElement('rect');
    for (const [name, value] of [
      ['x', '1'],
      ['y', '2'],
      ['width', '3'],
      ['height', '4'],
    ])
      rect.setAttribute(name, value);
    assert.equal(svgShapePathData(rect), 'M1 2h3v4h-3v-4Z');
    assert.deepEqual(flattenSvgShape(rect, [2, 0, 0, 2, 0, 0]), [[2, 4, 8, 4, 8, 4, 8, 12, 8, 12, 2, 12, 2, 12, 2, 4]]);
  });
});

describe('vetting drawings', () => {
  it('passes plain drawings', () => {
    const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><title>A sun</title><defs><linearGradient id="g"><stop offset="0" stop-color="#fc0"/></linearGradient></defs><circle cx="50" cy="50" r="20" fill="url(#g)" stroke="currentColor" stroke-dasharray="4 4"/></svg>`;
    assert.deepEqual(findUnknownSvgParts(svg), []);
    assert.equal(drawingSvgOrPlaceholder(svg), svg);
    assert.equal(drawingSvgOrPlaceholder(svg, true), UNREADABLE_DRAWING_SVG);
  });

  it('names what a drawing may not use', () => {
    assert.deepEqual(findUnknownSvgParts(`<svg xmlns="${SVG_NS}"><script>alert(1)</script><rect onclick="x" width="1"/><foo/></svg>`).sort(), ['<script>', UNKNOWN_SVG_PART].sort());
    assert.deepEqual(findUnknownSvgParts(`<svg xmlns="${SVG_NS}"><rect fill="url(https://example.com/x)"/></svg>`), ['fill']);
    assert.deepEqual(findUnknownSvgParts(`<svg xmlns="${SVG_NS}"><rect filter="blur(2)"/></svg>`), ['filter']);
    assert.deepEqual(findUnknownSvgParts(`<svg xmlns="${SVG_NS}"><g><g><g><g><g><g><rect/></g></g></g></g></g></g></svg>`), ['<g>']);
    assert.deepEqual(findUnknownSvgParts('<svg><rect/></svg>'), [WHOLE_SVG_PART]);
    assert.deepEqual(findUnknownSvgParts(`<svg xmlns="${SVG_NS}"><rect>`), [WHOLE_SVG_PART]);
  });

  it('allows a dashed arc, counting it as the full circle of its larger radius', () => {
    const path = (d: string): XmlElement => {
      const element = createSvgElement('path');
      element.setAttribute('d', d);
      return element;
    };
    assert.deepEqual(splitSvgPathArcs('M10 50 A40 30 0 0 1 90 50 a5 5 0 1 0 10 0 L 0 0'), { radii: [40, 5], lines: 'M 10 50 L 90 50 l 10 0 L 0 0' });
    assert.equal(svgShapeLength(path('M10 50 A40 40 0 0 1 90 50')), 2 * Math.PI * 40 + 80);
    assert.equal(svgShapeLength(path('M0 0 a0.5 2 0 0 1 1 0')), 2 * Math.PI * 2 + 1, 'the larger radius counts');
    assert.equal(svgShapeLength(path('M0 0 a0.5 0.5 0 0 1 1 0')), Infinity, 'an arc under radius 1');
    const dashed = (d: string, dashes: string) => `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><path d="${d}" fill="none" stroke="currentColor" stroke-dasharray="${dashes}"/></svg>`;
    assert.deepEqual(findUnknownSvgParts(dashed('M10 50 A40 40 0 0 1 90 50', '6 4')), []);
    assert.deepEqual(findUnknownSvgParts(dashed('M10 50 A0.5 0.5 0 0 1 11 50', '6 4')), ['stroke-dasharray']);
    assert.deepEqual(findUnknownSvgParts(dashed('M10 50 A400 400 0 0 1 90 50', '0.1 0.1')), ['stroke-dasharray'], 'too many dashes');
  });

  it('adds a missing namespace', () => {
    assert.equal(ensureSvgNamespace('<svg viewBox="0 0 1 1"/>'), `<svg xmlns="${SVG_NS}" viewBox="0 0 1 1"/>`);
    assert.equal(ensureSvgNamespace(`<svg xmlns="${SVG_NS}"/>`), `<svg xmlns="${SVG_NS}"/>`);
  });
});

describe('hand-drawn restyling', () => {
  it('hatches a filled outline with zigzag passes', () => {
    const square = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0];
    const hatch = hatchFillLines(square, 20, [100, 100], false, { looks: 1e6, passes: 1e3 }, seededRandomFromString('h'));
    assert.ok(hatch !== undefined && hatch !== 'too many');
    assert.ok(hatch.width > 0);
    assert.ok(hatch.lines.length >= 1 && hatch.lines.every((line) => line.length >= 4));
    assert.equal(hatchFillLines(square, 20, [100, 100], false, { looks: 1, passes: 1 }, seededRandomFromString('h')), 'too many');
    assert.equal(hatchFillLines([0, 0, 4, 0, 4, 4, 0, 4], 20, [100, 100], false, { looks: 1e6, passes: 1e3 }, seededRandomFromString('h')), undefined);
  });

  it('turns fills into hatching and thin strokes into brush outlines', () => {
    const root = svgTree(
      `<svg xmlns="${SVG_NS}" viewBox="0 0 400 300"><rect x="40" y="40" width="200" height="120" fill="#E8A33D"/><path d="M20 250 C 100 200, 200 300, 380 240" stroke="currentColor" stroke-width="2" fill="none"/></svg>`,
    );
    assert.equal(hatchSvgFills(root), true);
    assert.equal(root.children[0]?.localName, 'path');
    assert.equal(root.children[0]?.getAttribute('fill'), 'none');
    assert.equal(root.children[0]?.getAttribute('stroke'), '#E8A33D');
    assert.equal(brushSvgStrokes(root), true);
    const brushed = root.children[1]!;
    assert.equal(brushed.getAttribute('stroke'), 'none');
    assert.equal(brushed.getAttribute('fill'), 'currentColor');
    assert.equal(serializeXml(root), serializeXml(root));
  });

  it('splits polylines where they double back on a point and outlines brush strokes', () => {
    assert.deepEqual(splitPolylineAtRepeats([0, 0, 10, 0, 10, 0, 20, 0]), [
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 0],
        [20, 0],
      ],
    ]);
    const outline = brushStrokeOutline(
      [
        [0, 0],
        [50, 10],
        [100, 0],
      ],
      2,
      1,
      [true, true],
      seededRandomFromString('b'),
      IDENTITY_MATRIX,
      (value) => String(Math.round(value)),
    );
    assert.match(outline ?? '', /^M/);
  });
});

describe('contrast layering', () => {
  it('builds fill paths from contours and capsules from strokes', () => {
    // Every contour is wound the same way, so the nonzero rule fills each.
    assert.deepEqual(contoursToFillPaths([[0, 0, 10, 0, 10, 10, 0, 0]]), ['M0 0L10 10L10 0L0 0Z']);
    assert.deepEqual(contoursToFillPaths([[0, 0, 10, 10, 10, 0, 0, 0]]), ['M0 0L10 10L10 0L0 0Z']);
    assert.equal(contoursToFillPaths([[0, 0, 0, 10, 10, 10, 10, 0, 0, 0], [2, 2, 8, 2, 8, 8, 2, 8, 2, 2]]), undefined);
    assert.equal(strokeToCapsulePaths([[0, 0, 10, 0]], 2).length, 1);
  });

  it('redraws dark ink in the readable color over its own fills', () => {
    const root = svgTree(
      `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><rect width="100" height="100" fill="#222222"/><path d="M10 50 L90 50" stroke="currentColor" stroke-width="10"/></svg>`,
    );
    assert.equal(layerSvgForContrast(root, '#191919', '#EFEFEF'), true);
    const names = root.children.map((child) => child.localName);
    assert.deepEqual(names, ['clipPath', 'g', 'use']);
    assert.equal(root.children[2]?.getAttribute('color'), '#EFEFEF');
  });
});
