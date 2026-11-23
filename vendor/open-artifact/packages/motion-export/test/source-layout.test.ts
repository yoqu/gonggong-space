import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECOLORED_MODULE, playSeconds } from '@open-artifact/motion-core';
import { sourceFolder } from '../src/source/layout.ts';
import type { SourceFolderInput } from '../src/source/layout.ts';
import { FolderNames, fontFolder, licenceFileName, sourceRootFolder } from '../src/source/names.ts';

const bytes = new Uint8Array([1, 2, 3]);

const input = (more: Partial<SourceFolderInput> = {}): SourceFolderInput => ({
  title: 'Launch Day',
  date: new Date(2026, 10, 18, 12),
  script: 'cut()',
  modules: [
    { name: 'scene-a.js', kind: 'js', text: 'a' },
    { name: 'Scene-A.js', kind: 'js', text: 'twin' },
    { name: 'index.html', kind: 'html', text: '<p>' },
    { name: 'notes.css', kind: 'js', text: 'mislabelled' },
    { name: RECOLORED_MODULE, kind: 'json', text: '{}' },
  ],
  assets: [
    { name: 'logo.png', mime: 'image/png', bytes },
    { name: 'con.png', mime: 'image/png', bytes },
    { name: 'clip.png', mime: 'video/mp4', bytes },
  ],
  fonts: [
    { family: 'Inter Display', licence: 'OFL-1.1', licenceText: 'OFL text', files: [{ name: 'inter.woff2', bytes }, { name: 'INTER.woff2', bytes }] },
    { family: 'Secret Sans', licence: 'Apache-2.0', licenceText: null, files: [{ name: 'secret.woff2', bytes }] },
  ],
  standalone: '<!doctype html>',
  ...more,
});

const names = (folder: ReturnType<typeof sourceFolder>): string[] => folder.entries.map((entry) => entry.name);

test('the folder holds the readme, page, code, modules, assets and fonts under the title’s stem', () => {
  const folder = sourceFolder(input());
  assert.deepEqual(names(folder), [
    'launch-day/README.txt',
    'launch-day/index.html',
    'launch-day/cut.js',
    'launch-day/film.json',
    'launch-day/modules/scene-a.js',
    'launch-day/assets/logo.png',
    'launch-day/fonts/Inter-Display/inter.woff2',
    'launch-day/fonts/Inter-Display/2-INTER.woff2',
    'launch-day/fonts/Inter-Display/OFL.txt',
  ]);
});

test('files that cannot be files of their own are named, and the page’s records are not', () => {
  const folder = sourceFolder(input());
  assert.deepEqual(folder.filesLeftOut, ['modules/Scene-A.js', 'modules/index.html', 'modules/notes.css', 'assets/con.png', 'assets/clip.png']);
  assert.deepEqual(folder.fontsLeftOut, ['Secret Sans']);
  const readme = folder.entries.find((entry) => entry.name.endsWith('README.txt'))?.data;
  assert.equal(typeof readme, 'string');
  assert.ok(String(readme).includes('Made on 2026-11-18.'));
  assert.ok(String(readme).includes('Secret Sans: no licence text'));
  assert.ok(String(readme).includes('modules/Scene-A.js'));
});

test('film.json says which files make up which font family', () => {
  const folder = sourceFolder(input({ facts: { width: 1920, height: 1080, fps: 30, duration: playSeconds(10) } }));
  const data = folder.entries.find((entry) => entry.name.endsWith('film.json'))?.data;
  const film: unknown = JSON.parse(String(data));
  assert.deepEqual(film, {
    version: 1,
    title: 'Launch Day',
    created: new Date(2026, 10, 18, 12).toISOString(),
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 10,
    fonts: [{ family: 'Inter Display', licence: 'OFL-1.1', files: ['fonts/Inter-Display/inter.woff2', 'fonts/Inter-Display/2-INTER.woff2'] }],
    fontsLeftOut: ['Secret Sans'],
    filesLeftOut: ['modules/Scene-A.js', 'modules/index.html', 'modules/notes.css', 'assets/con.png', 'assets/clip.png'],
  });
});

test('without a page there is no index.html and the readme does not mention one', () => {
  const folder = sourceFolder(input({ standalone: null, fonts: [], assets: [] }));
  assert.ok(!names(folder).some((name) => name.endsWith('index.html')));
  const readme = String(folder.entries[0]?.data);
  assert.ok(!readme.includes('index.html\n'));
  assert.ok(!readme.includes('fonts/'));
});

test('the score goes in as score.mid beside film.json, and the readme says what it is', () => {
  const midi = new Uint8Array([0x4d, 0x54, 0x68, 0x64]);
  const folder = sourceFolder(input({ midi }));
  const at = names(folder).indexOf('launch-day/score.mid');
  assert.equal(names(folder)[at - 1], 'launch-day/film.json');
  assert.equal(folder.entries[at]?.data, midi);
  assert.ok(String(folder.entries[0]?.data).includes('score.mid\n'));
  const without = sourceFolder(input({ midi: null }));
  assert.ok(!names(without).some((name) => name.endsWith('.mid')));
  assert.ok(!String(without.entries[0]?.data).includes('score.mid'));
});

test('names are compared without case, and reserved names are refused', () => {
  const taken = new FolderNames();
  assert.equal(taken.module('a.js', 'js'), true);
  assert.equal(taken.module('A.JS', 'js'), false);
  assert.equal(taken.asset('readme.png', 'image/png'), false);
  assert.equal(taken.asset('lpt1.png', 'image/png'), false);
  assert.equal(taken.asset('photo.jpeg', 'image/jpeg'), true);
  assert.equal(sourceRootFolder('con'), '_con/');
  assert.equal(sourceRootFolder('film'), 'film/');
  assert.equal(fontFolder('  !!  '), 'fonts/font/');
});

test('each licence has its own file name', () => {
  assert.equal(licenceFileName('OFL-1.1'), 'OFL.txt');
  assert.equal(licenceFileName('OFL-1.0'), 'OFL.txt');
  assert.equal(licenceFileName('Apache-2.0'), 'LICENSE.txt');
  assert.equal(licenceFileName('UFL-1.0'), 'UFL.txt');
});
