import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RETYPED_MODULE } from '@open-artifact/motion-core';
import type { StageFilm } from '@open-artifact/motion-stage';
import { escapeHtmlComment, standaloneFile, standaloneFilm, standaloneHtml } from '../src/standalone/html.ts';
import type { StandaloneInput } from '../src/standalone/html.ts';

const film: StageFilm = {
  script: 'cut("</script><script>alert(1)</script>"); // <!-- not a comment',
  modules: [
    { name: 'scene-a.js', kind: 'js', text: 'scene()' },
    { name: RETYPED_MODULE, kind: 'json', text: '{}' },
  ],
  assets: [{ name: 'logo.png', mime: 'image/png', w: 1, h: 1, bytes: new Uint8Array([1, 2, 3]).buffer }],
  faces: null,
  narration: null,
  clippedTextWaitMs: 512,
  mode: 'rough',
};

const input = (more: Partial<StandaloneInput> = {}): StandaloneInput => ({
  title: 'A <b>bold</b> "film"',
  film,
  runtimeScript: 'var r = "</SCRIPT>";',
  playerScript: 'var p = "<!--";',
  audioScript: 'var a = "</script >";',
  ...more,
});

/** The text of every script element, as the HTML parser would end it. */
const scriptBodies = (html: string): string[] => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script/gi)].map((match) => match[1] ?? '');

test('no script in the page can end its element early or open a comment', () => {
  const html = standaloneHtml(input());
  const bodies = scriptBodies(html);
  assert.equal(bodies.length, 4);
  for (const body of bodies) assert.ok(!/<!--/.test(body), body);
  assert.ok(html.includes('var r = "<\\/SCRIPT>";'));
  assert.ok(html.includes('var p = "<\\x21--";'));
  assert.ok(html.includes('var a = "<\\/script >";'));
});

test('the title is escaped, and the page keeps to itself', () => {
  const html = standaloneHtml(input());
  assert.ok(html.includes('<title>A &lt;b&gt;bold&lt;/b&gt; &quot;film&quot;</title>'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.indexOf('id="film-data"') < html.indexOf('id="stage-runtime"'));
});

test('a silent page has no audio script', () => {
  assert.equal(scriptBodies(standaloneHtml(input({ audioScript: null }))).length, 3);
});

test('the page’s own records are left out, the takes added, and every scene drawn as written', () => {
  const take = { name: 'line-1.mp3', mime: 'audio/mpeg', w: 0, h: 0, bytes: new Uint8Array([9]).buffer };
  const carried = standaloneFilm(film, [take, { ...take, name: 'logo.png' }]);
  assert.deepEqual(
    carried.modules.map((module) => module.name),
    ['scene-a.js'],
  );
  assert.deepEqual(
    carried.assets.map((asset) => asset.name),
    ['logo.png', 'line-1.mp3'],
  );
  assert.equal(carried.mode, 'final');
});

test('licence texts sit in a comment they cannot end', () => {
  const html = standaloneHtml(input({ licences: [{ family: 'Inter', licence: 'OFL-1.1', text: 'Copyright --> <!-- sneaky --!>' }] }));
  const comment = html.slice(html.lastIndexOf('<!--\nThe typefaces'));
  assert.equal(comment.match(/-->/g)?.length, 1);
  assert.ok(comment.endsWith('-->\n'));
  assert.equal(escapeHtmlComment('a-->b--!>c<!-d'), 'a- >b- !>c< !-d');
});

test('the page is a file named from the title, refused past its limit', () => {
  const file = standaloneFile(input());
  assert.equal(file.filename, 'A b bold b film.html');
  assert.equal(file.mime, 'text/html');
  assert.throws(() => standaloneFile(input({ maxBytes: 100 })), /bigger than/);
});
