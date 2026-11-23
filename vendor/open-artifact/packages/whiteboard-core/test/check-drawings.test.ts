import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBoardDocuments, drawingFindings, ideaDocumentProblem, MAX_DRAWING_GROUP_DEPTH, MAX_DRAWING_OPACITY } from '../src/check.ts';
import { savedIdeaPath, VERSION_OPTION_LIMITS } from '../src/ideas.ts';

const base64 = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const errors = (src: string): string[] => drawingFindings(src).filter(([level]) => level === 'error').map(([, message]) => message);

describe('drawing check', () => {
  it('passes a plain drawing', () => {
    assert.deepEqual(errors(base64(svg('<rect x="1" y="1" width="20" height="20" fill="#F6BD78"/>'))), []);
    assert.deepEqual(errors(`data:image/svg+xml;utf8,${svg('<rect width="20" height="20" fill="%23F6BD78"/>')}`), []);
  });

  it('reports a raw # in a text data URI', () => {
    assert.ok(errors(`data:image/svg+xml;utf8,${svg('<rect width="20" height="20" fill="#F6BD78"/>')}`)[0]!.includes('%23'));
  });

  it('reports a URI that does not decode or holds no <svg>', () => {
    assert.ok(errors('data:image/svg+xml;utf8,%E0%A4%A').some((m) => m.includes('does not decode')));
    assert.ok(errors(base64('<html></html>')).some((m) => m.includes('no <svg>')));
  });

  it('reports groups nested too deep (the page shows a grey box)', () => {
    const nest = (depth: number, inner = '') => `${'<g>'.repeat(depth)}${inner}${'</g>'.repeat(depth)}`;
    assert.deepEqual(errors(base64(svg(nest(MAX_DRAWING_GROUP_DEPTH)))), []);
    assert.ok(errors(base64(svg(nest(MAX_DRAWING_GROUP_DEPTH + 1)))).some((m) => m.includes('nest 6 deep')));
    // Shapes count as a level too: the page draws at most 6 levels, <svg> included.
    const rect = '<rect width="1" height="1"/>';
    assert.deepEqual(errors(base64(svg(nest(MAX_DRAWING_GROUP_DEPTH - 1, rect)))), []);
    assert.ok(errors(base64(svg(nest(MAX_DRAWING_GROUP_DEPTH, rect)))).some((m) => m.includes('grey box')));
  });

  it(`reports more than ${MAX_DRAWING_OPACITY} opacity attributes`, () => {
    const dots = (n: number) => Array.from({ length: n }, (_, i) => `<circle cx="${i}" cy="1" r="1" opacity="0.5"/>`).join('');
    assert.deepEqual(errors(base64(svg(dots(MAX_DRAWING_OPACITY)))), []);
    assert.ok(errors(base64(svg(dots(MAX_DRAWING_OPACITY + 1)))).some((m) => m.includes('opacity')));
  });

  it('reports parts the page does not draw', () => {
    assert.ok(errors(base64(svg('<foreignObject width="10" height="10"></foreignObject>'))).some((m) => m.includes('grey box')));
  });

  it('is reported on image elements, with missing uploads', () => {
    const image = (src: string) => ({ type: 'image', x: 0, y: 0, w: 100, h: 100, src });
    const findings = checkBoardDocuments(
      new Map<string, Record<string, unknown>>([
        ['board/meta', { v: 1, title: 'B', order: ['d1', 'u1'] }],
        ['elements/d1', image(base64(svg(`${'<g>'.repeat(6)}${'</g>'.repeat(6)}`)))],
        ['elements/u1', image('/_blob/0123456789abcdef0123456789abcdef')],
      ]),
      { blobExists: () => false },
    );
    assert.ok(findings.some((f) => f.path === 'elements/d1' && f.level === 'error' && f.message.includes('grey box')));
    assert.ok(findings.some((f) => f.path === 'elements/u1' && f.level === 'error' && f.message.includes('not an upload')));
  });
});

describe('idea check', () => {
  const path = savedIdeaPath('u1');
  const option = (label: string, edits = 1) => ({ label, edits: Array.from({ length: edits }, (_, i) => ({ id: `n${i}`, x: i })) });
  const idea = (options: unknown[]) => ({ says: 'Group the notes by theme.', about: ['n0'], options });

  it('accepts 2 to 4 options', () => {
    assert.equal(ideaDocumentProblem(idea([option('A'), option('B')]), path), undefined);
    assert.equal(ideaDocumentProblem(idea([option('A'), option('B'), option('C'), option('D')]), path), undefined);
  });

  it('refuses with a code', () => {
    assert.equal(ideaDocumentProblem(idea([option('A')]), path)?.code, 'IDEA_OPTIONS');
    assert.equal(ideaDocumentProblem(idea(['A', 'B', 'C', 'D', 'E'].map((l) => option(l))), path)?.code, 'IDEA_OPTIONS');
    assert.equal(ideaDocumentProblem(idea([option('A'), option('B', VERSION_OPTION_LIMITS.edits + 1)]), path)?.code, 'IDEA_EDITS');
    assert.equal(ideaDocumentProblem(idea([option('A'), option('A')]), path)?.code, 'INVALID_IDEA');
    assert.equal(ideaDocumentProblem(idea([option('x'.repeat(61)), option('B')]), path)?.code, 'INVALID_IDEA');
    assert.equal(ideaDocumentProblem({ ...idea([option('A'), option('B')]), extra: 1 }, path)?.code, 'INVALID_IDEA');
    const heavy = { label: 'Big', edits: [{ id: 'n1', text: 'x'.repeat(VERSION_OPTION_LIMITS.bytes) }] };
    assert.equal(ideaDocumentProblem(idea([option('A'), heavy]), path)?.code, 'IDEA_EDITS_TOO_LARGE');
  });

  it('reports a stored idea the page drops', () => {
    const findings = checkBoardDocuments(new Map<string, Record<string, unknown>>([['board/meta', { v: 1, title: 'B', order: [] }], [path, idea([option('A')])]]));
    assert.ok(findings.some((f) => f.path === path && f.level === 'error' && f.message.includes('drops the idea')));
  });
});
