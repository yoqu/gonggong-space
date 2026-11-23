import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildVideoViewContext,
  checkFilm,
  mergeFilmPatch,
  playSeconds,
  replaceInField,
  scaffoldFilmFiles,
  validateVideoViewContext,
  videoWritesProblem,
} from '../src/index.ts';

const none = (): unknown => undefined;
const scenes = (list: unknown[], stage = 'rough'): string => JSON.stringify({ kind: 'json', text: JSON.stringify({ v: 1, stage, scenes: list }) });

describe('video writes', () => {
  it('passes what the player reads', () => {
    assert.equal(
      videoWritesProblem(
        [
          { op: 'set', path: 'film/meta', data: { v: 1, title: 'Fox', updatedAt: '2026-11-18T00:00:00Z' } },
          { op: 'set', collection: 'modules', doc_id: 'scene-yard.js', data: { kind: 'js', text: "kit.scene('yard', {})" } },
          { op: 'str_replace', path: 'modules/shared.js', field: 'text', old: 'a', new: 'b' },
          { op: 'delete', path: 'modules/old.js' },
          { op: 'set', path: 'film/script', data: { code: 'window.CUT = kit.scenes();' } },
        ],
        (path) => (path === 'modules/shared.js' ? { kind: 'js', text: 'a' } : undefined),
      ),
      null,
    );
  });

  it('refuses what only the page writes', () => {
    assert.deepEqual(videoWritesProblem([{ op: 'set', path: 'film/meta', data: { title: 'x' } }, { op: 'delete', path: 'modules/recut.json' }], none)?.code, 'READ_ONLY_PATH');
    assert.match(videoWritesProblem([{ op: 'set', path: 'data/users/owner/x', data: {} }], none)?.message ?? '', /written by the open page/);
    assert.equal(videoWritesProblem([{ op: 'delete', path: 'film/meta' }], none)?.code, 'REFUSED');
  });

  it('refuses documents the player would drop, after merging an update', () => {
    assert.match(videoWritesProblem([{ op: 'set', path: 'modules/-bad', data: { text: '' } }], none)?.message ?? '', /^writes\[0\]: modules\/-bad/);
    assert.match(videoWritesProblem([{ op: 'update', path: 'modules/a.js', data: { text: { __delete__: true } } }], () => ({ kind: 'js', text: 'x' }))?.message ?? '', /needs/);
    assert.match(
      videoWritesProblem([{ op: 'set', path: 'assets/logo', data: { ref: 'https://example.com/a.png', mime: 'image/png' } }], none)?.message ?? '',
      /never an external URL/,
    );
    const big = videoWritesProblem([{ op: 'set', path: 'modules/big.js', data: { kind: 'js', text: 'x'.repeat(210 * 1024) } }], none);
    assert.equal(big?.code, 'TOO_LARGE');
    assert.match(videoWritesProblem([{ op: 'set', path: 'modules/a.js', data: { kind: 'js', text: '' } }, { op: 'set', path: 'modules/a.js', data: { kind: 'js', text: '' } }], none)?.message ?? '', /twice/);
  });

  it('merges and replaces as the store does', () => {
    assert.deepEqual(mergeFilmPatch({ a: 1, b: { c: 2, d: 3 } }, { a: null, b: { c: { __delete__: true } } }), { a: null, b: { d: 3 } });
    assert.deepEqual(replaceInField({ text: 'one two' }, 'text', 'two', '$&2'), { text: 'one $&2' });
    assert.equal(replaceInField({ text: 'a a' }, 'text', 'a', 'b'), undefined);
  });
});

describe('check', () => {
  const syntaxError = (code: string): { message: string } | null => (code.includes('((') ? { message: 'Unexpected token' } : null);

  it('passes a sound film', () => {
    const files = new Map([
      ['film/meta', JSON.stringify({ v: 1, title: 'Fox', updatedAt: '' })],
      ['film/script', JSON.stringify({ code: 'window.CUT = kit.scenes();' })],
      ['modules/scenes.json', scenes([{ id: 'yard', name: 'Yard', dur: 3 }])],
      ['modules/scene-yard.js', JSON.stringify({ kind: 'js', text: "kit.scene('yard', {})" })],
      ['data/users/owner/x', '{}'],
    ]);
    assert.deepEqual(checkFilm(files, { syntaxError }), []);
  });

  it('reports what stops the film or what it drops', () => {
    const files = new Map([
      ['film/script', JSON.stringify({ code: 'window.CUT = kit.scenes(((' })],
      ['modules/scenes.json', scenes([{ id: 'Yard', name: 'Yard', dur: 0 }, { id: 'gate', name: 'Gate', dur: 40_000 }], 'final')],
      ['modules/layer-x.js', JSON.stringify({ kind: 'js', text: '' })],
      ['modules/data.json', JSON.stringify({ kind: 'json', text: '{' })],
      ['other/x', '{}'],
      ['assets/song', JSON.stringify({ ref: '/_blob/0123456789abcdef0123456789abcdef', mime: 'audio/mpeg' })],
    ]);
    const findings = checkFilm(files, { syntaxError, blobContentType: () => 'audio/wav' });
    const said = findings.map((finding) => `${finding.level} ${finding.file}: ${finding.message}`);
    const has = (pattern: RegExp): void => assert.ok(said.some((line) => pattern.test(line)), `${pattern} in\n${said.join('\n')}`);
    has(/^error db\/film\/meta\.json: missing/);
    has(/^error db\/film\/script\.json: does not parse: Unexpected token/);
    has(/scenes\[0\] id "Yard"/);
    has(/scenes\[0\] dur: seconds, above 0/);
    has(/add up to 40000 s/);
    has(/stage is "final" but scene modules are missing: 1 \(Yard\), 2 \(gate\)/);
    has(/^warning db\/modules\/layer-x\.js\.json: names that begin layer-/);
    has(/^error db\/modules\/data\.json\.json: is not JSON/);
    has(/^warning db\/other\/x\.json: is in a collection the player does not read/);
    has(/^error db\/assets\/song\.json: mime is audio\/mpeg, but the upload is audio\/wav/);
  });

  it('scaffolds the marker', () => {
    const files = scaffoldFilmFiles('', new Date('2026-11-18T00:00:00Z'));
    assert.deepEqual(Object.keys(files), ['film/meta.json']);
    assert.equal(JSON.parse(files['film/meta.json']!).title, 'Untitled motion');
  });
});

describe('view context', () => {
  it('builds and validates what the page publishes', () => {
    const context = buildVideoViewContext({
      mode: 'player',
      dirty: false,
      selected: ['yard:3/h1', 'bad id!'],
      handEditRecords: ['modules/recut.json', 'modules/scenes.json'],
      at: playSeconds(3.456),
    });
    assert.deepEqual(context, { mode: 'player', dirty: false, selected: ['yard:3/h1'], handEditRecords: ['modules/recut.json'], at: 3.46 });
    assert.deepEqual(validateVideoViewContext({ ...context, edits: 2, junk: { deep: { x: 1 } }, box: { x: 1, y: 2, w: 3, h: 4 } }), {
      ...context,
      edits: 2,
      box: { x: 1, y: 2, w: 3, h: 4 },
    });
    assert.equal(validateVideoViewContext([]), null);
    assert.equal(validateVideoViewContext({ big: 'x'.repeat(40_000) }), null);
  });
});
