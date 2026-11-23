import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_DOC_BYTES,
  decodeFilm,
  documentSegments,
  filmModule,
  isModuleName,
  isPageOnlyPath,
  joinSplitModules,
  modulePartOf,
  parseScenesFile,
  sceneIdOfModule,
  sceneModuleName,
  scenesTotal,
  splitModule,
  storeBytes,
} from '../src/index.ts';

const scenesJson = JSON.stringify({
  v: 1,
  stage: 'rough',
  scenes: [
    { id: 'yard', name: 'The yard', dur: 4 },
    { id: 'gate', name: 'Gate', dur: 2.5 },
  ],
});

describe('names', () => {
  it('knows module names, parts and scene modules', () => {
    assert.equal(isModuleName('scene-yard.js'), true);
    assert.equal(isModuleName('scene-yard.js~3'), true);
    assert.equal(isModuleName('__proto__'), false);
    assert.equal(isModuleName('-x'), false);
    assert.deepEqual(modulePartOf('big.js~12'), { base: 'big.js', n: 12 });
    assert.equal(modulePartOf('big.js'), null);
    assert.equal(sceneModuleName('yard'), 'scene-yard.js');
    assert.equal(sceneIdOfModule('scene-yard.js'), 'yard');
    assert.equal(isPageOnlyPath('modules/recut.json'), true);
    assert.equal(isPageOnlyPath('modules/scenes.json'), false);
  });

  it('splits document paths into collection and id pairs', () => {
    assert.deepEqual(documentSegments('film/meta'), ['film', 'meta']);
    assert.deepEqual(documentSegments('/modules/scene-yard.js/'), ['modules', 'scene-yard.js']);
    assert.equal(documentSegments('film'), null);
    assert.equal(documentSegments('modules/../x'), null);
  });
});

describe('split and join', () => {
  it('keeps a small module whole', () => {
    assert.deepEqual(splitModule('a.js', 'js', 'x()'), [{ name: 'a.js', document: { kind: 'js', text: 'x()' } }]);
  });

  it('splits a big module into parts under the store limit, preferring line ends, and joins them back', () => {
    const text = Array.from({ length: 12000 }, (_, index) => `const line${index} = ${index}; // <&>`).join('\n');
    const parts = splitModule('big.js', 'js', text);
    assert.ok(parts !== null && parts.length > 1);
    for (const part of parts) assert.ok(storeBytes(part.document) <= MAX_DOC_BYTES);
    assert.ok(parts.slice(0, -1).every((part) => part.document.text.endsWith('\n')));
    const joined = joinSplitModules(parts.map((part) => ({ name: part.name, ...part.document })));
    assert.equal(joined.length, 1);
    assert.equal(joined[0]?.name, 'big.js');
    assert.equal(joined[0]?.text, text);
  });

  it('never splits a record the page keeps whole', () => {
    assert.equal(splitModule('recut.json', 'json', 'x'.repeat(MAX_DOC_BYTES)), null);
  });
});

describe('decodeFilm', () => {
  it('reads meta, script, joined modules, assets and scenes.json', () => {
    const film = decodeFilm([
      ['film/meta', { v: 1, title: ' Fox ', updatedAt: '2026-11-18T00:00:00.000Z' }],
      ['film/script', { code: 'window.CUT = kit.scenes();' }],
      ['modules/scenes.json', { kind: 'json', text: scenesJson }],
      ['modules/shared.js~2', { kind: 'js', text: 'b' }],
      ['modules/shared.js~1', { kind: 'js', text: 'a' }],
      ['modules/yard.js', { kind: 'js', text: "kit.scene('yard', {})" }],
      ['assets/logo', { ref: '/_blob/0123456789abcdef0123456789abcdef', mime: 'image/png', w: 10, h: 10 }],
      ['modules/bad name', { kind: 'js', text: '' }],
    ]);
    assert.equal(film.meta?.title, 'Fox');
    assert.equal(film.script, 'window.CUT = kit.scenes();');
    assert.equal(filmModule(film, 'shared.js')?.text, 'ab');
    assert.equal(filmModule(film, 'scene-yard.js')?.storedAs, 'yard.js');
    assert.equal(film.assets.length, 1);
    assert.equal(film.scenes?.ok, true);
    assert.equal(film.problems.length, 1);
    assert.equal(film.problems[0]?.path, 'modules/bad name');
  });

  it('reports a scenes.json the stage refuses', () => {
    const film = decodeFilm(new Map([['modules/scenes.json', { kind: 'json', text: '{"v":1,"stage":"rough","scenes":[]}' }]]));
    assert.equal(film.scenes?.ok, false);
    assert.match(film.problems[0]?.message ?? '', /1 to 24 scenes/);
  });
});

describe('scenes.json', () => {
  it('reads the scenes and their total', () => {
    const result = parseScenesFile(scenesJson);
    assert.ok(result.ok);
    assert.equal(result.file.scenes.length, 2);
    assert.equal(scenesTotal(result.file), 6.5);
    assert.equal(result.file.width, 1920);
  });
});
