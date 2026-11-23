import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGE_CONNECT, STAGE_PROTOCOL_VERSION, isHostToStage, isStageConnect, isStageToHost } from '../src/protocol.ts';
import type { StageFilm, StageMeta } from '../src/protocol.ts';

const film: StageFilm = {
  script: 'window.CUT = { duration: 1, render() {} };',
  modules: [{ name: 'scenes.json', kind: 'json', text: '{}' }],
  assets: [
    { name: 'logo.png', mime: 'image/png', w: 4, h: 4, bytes: new ArrayBuffer(8) },
    { name: 'clip.mp4', mime: 'video/mp4', w: 640, h: 360, url: 'blob:clip' },
  ],
  faces: { fonts: [{ family: 'Inter', url: 'data:font/woff2;base64,AA==', weight: '400', style: 'normal' }], slots: { sans: 'Inter' } },
  narration: { maxLines: 40, maxLineSeconds: 30 },
  clippedTextWaitMs: 512,
  mode: 'rough',
};

const meta = {
  width: 1920,
  height: 1080,
  fps: 60,
  duration: 4,
  filmDuration: 4,
  chapters: [{ t: 0, label: 'Intro' }],
  scenes: null,
  background: ['rgb(255, 255, 255)', 'none'],
  parts: [{ key: null, label: 'Intro', own: 'Intro', a0: 0, nat: 4, p0: 0, dur: 4 }],
} as StageMeta;

test('the connect message carries the version', () => {
  assert.ok(isStageConnect({ type: STAGE_CONNECT, version: STAGE_PROTOCOL_VERSION }));
  assert.ok(!isStageConnect({ type: 'connect', version: 1 }));
  assert.ok(!isStageConnect({ type: STAGE_CONNECT }));
});

const entry = { id: 'film:0.1/div', cls: 'card', kin: '0/1', at: 1.5, fill: { was: '#ffffff', v: '#ff0000' } };
const look = {
  cls: 'card',
  kin: '0/1',
  at: 1,
  fill: '#ffffff',
  ink: null,
  radius: 8,
  most: 40,
  size: 1,
  hidden: null,
  svgfill: null,
  svgstroke: null,
  entry: null,
  loose: false,
  home: false,
  lapsed: [],
};
const motion = { how: ['fade'], from: 0, to: 0.4 };
const row = {
  id: 'film:0.1/div',
  kind: 'shape',
  round: false,
  name: 'Card',
  hidden: false,
  under: null,
  own: false,
  many: 0,
  texts: ['Hello'],
  spans: [[0, 4]],
  at: 0.5,
  enter: motion,
  leave: { how: null, from: 3.5, to: 4 },
  box: [10, 20, 300, 200],
  wordsBox: null,
  look,
  kids: [{ id: 'film:0.1.0/p', kind: 'text', round: false, name: '', hidden: 'held', under: 'film:0.1/div', own: false, many: 0, texts: ['Hello'], spans: [[0, 4]], at: 0.5, enter: motion, leave: motion, box: null, wordsBox: [12, 22, 50, 20], look: null, kids: [], sole: null, whole: false, drawn: '', full: false }],
  sole: null,
  whole: false,
  drawn: '',
  full: false,
};
const asked = {
  cls: 'title',
  kin: '0/1/a1b2',
  at: 1,
  fill: null,
  ink: '#222222',
  radius: null,
  most: 0,
  size: 1,
  hidden: null,
  entry: null,
  home: false,
  lapsed: [],
  family: 'Inter',
  weight: 700,
  italic: 0,
  px: 64,
  leading: 'normal',
  tracking: 0,
  align: 'left',
};

test('every host message is accepted in its own shape', () => {
  const good: unknown[] = [
    { type: 'load', film },
    { type: 'render', seq: 1, t: 0.5, playing: false },
    { type: 'mode', mode: 'final' },
    { type: 'frame', seq: 2, t: 1, scale: 0.5, smallMedia: true, readFx: false, smooth: true },
    { type: 'watch', on: true, places: false },
    { type: 'scan' },
    { type: 'layers', seq: 3, from: 0, to: 4, at: 1, scene: null, stop: false },
    { type: 'layers', seq: 3, from: 0, to: 4, at: 1, scene: 'intro', stop: true },
    { type: 'retouch', record: null },
    { type: 'retouch', record: { layers: [entry] } },
    { type: 'look', seq: 4, id: 'title', t: null },
  ];
  for (const message of good) assert.ok(isHostToStage(message), JSON.stringify(message));
});

test('a host message with a wrong field, or of no known type, is refused', () => {
  const bad: unknown[] = [
    null,
    'render',
    { type: 'render', seq: 1, t: '0.5', playing: false },
    { type: 'render', seq: 1, t: Number.NaN, playing: false },
    { type: 'mode', mode: 'draft' },
    { type: 'load', film: { ...film, assets: [{ name: 'x.png', mime: 'image/png', w: 1, h: 1 }] } },
    { type: 'load', film: { ...film, modules: [{ name: 'a.js', kind: 'python', text: '' }] } },
    { type: 'watch', on: true },
    { type: 'layers', seq: 3, from: 0, to: 4, scene: null, stop: false },
    { type: 'retouch', text: null },
    { type: 'retouch', record: { layers: [{ ...entry, id: 'Intro:0/div' }] } },
    { type: 'retouch', record: { layers: [{ ...entry, fill: { was: 'red', v: '#ff0000' } }] } },
    { type: 'navigate', href: 'https://example.com' },
  ];
  for (const message of bad) assert.ok(!isHostToStage(message), JSON.stringify(message));
});

test('every stage message is accepted in its own shape', () => {
  const good: unknown[] = [
    { type: 'hello', version: STAGE_PROTOCOL_VERSION },
    { type: 'ready', meta, score: null, narration: null, loadMs: 12 },
    {
      type: 'ready',
      meta,
      score: { events: [{ t: 0, dur: 0.3, kind: 'note', patch: 'piano', midi: 60, vel: 64 }], master: { gain: -6, fadeOut: 1, loudness: -16 } },
      narration: { lines: [{ at: 1, dur: 2, text: 'Hello', audio: 'line-1.mp3' }], duck: null },
      loadMs: 40,
    },
    { type: 'presented', seq: 1, t: 0.5, ok: true, ms: 3.2 },
    { type: 'frame', seq: 2, t: 1, svg: '<svg/>', pw: 960, ph: 540, ms: 20 },
    { type: 'frame-error', seq: 2, hold: true, env: false, message: 'render(1.000) threw: x' },
    { type: 'console', level: 'warn', text: 'careful' },
    { type: 'error', phase: 'load', message: 'boom', stack: '' },
    { type: 'navigating' },
    { type: 'texts', nodes: [{ text: 'Hi', x: 1, y: 2, w: 3, h: 4, line: 4, seen: true }, { text: 'hidden' }] },
    { type: 'layers', report: { seq: 3, from: 0, to: 4, at: 1, lost: [], underHide: [], rows: null } },
    { type: 'layers', report: { seq: 3, from: 0, to: 4, at: 1, lost: ['film:0.1/div'], underHide: [], rows: [row] } },
    { type: 'looked', seq: 4, id: 'title', look: null, lost: [] },
    { type: 'looked', seq: 4, id: 'film:0.1/h1', look: asked, lost: [] },
    { type: 'link', href: 'https://example.com' },
  ];
  for (const message of good) assert.ok(isStageToHost(message), JSON.stringify(message));
});

test('a stage message with a wrong field is refused', () => {
  const bad: unknown[] = [
    { type: 'hello' },
    { type: 'ready', meta: { ...meta, fps: 25 }, score: null, narration: null, loadMs: 1 },
    { type: 'console', level: 'debug', text: 'x' },
    { type: 'error', phase: 'init', message: 'x', stack: '' },
    { type: 'texts', nodes: [{ x: 1 }] },
    { type: 'link', href: 7 },
    { type: 'layers', report: { seq: 3, from: 0, to: 4, rows: null } },
    { type: 'layers', report: { seq: 3, from: 0, to: 4, at: 1, lost: [], underHide: [], rows: [{ ...row, kind: 'blob' }] } },
    { type: 'looked', seq: 4, id: 'x', look: { ...asked, italic: 2 }, lost: [] },
    { type: 'load', film },
  ];
  for (const message of bad) assert.ok(!isStageToHost(message), JSON.stringify(message));
});
