import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmSeconds, makePointCommentAnchor, type SceneBuildSummary } from '@open-artifact/motion-core';
import {
  anchorShowsAt,
  anchorSpan,
  anchorWorldBox,
  boxAnchorAt,
  pinWorldPoint,
  pointAnchorAt,
  revealTime,
  stageCamera,
  timelineMark,
  FILM_ANCHOR,
} from '../src/comments/anchor-place.ts';
import { filmView, seemsStopped, workingBarView } from '../src/player/waiting.ts';

const film = { width: 1920, height: 1080 };

test('a point anchor sits on the frame and shows near its moment', () => {
  const anchor = pointAnchorAt({ x: 960, y: 270 }, film, filmSeconds(12.4));
  assert.deepEqual(anchor, { kind: 'point', t: 12.4, x: 0.5, y: 0.25 });
  assert.deepEqual(pinWorldPoint(anchor, film), { x: 960, y: 270 });
  assert.equal(anchorShowsAt(anchor, 12.0, null), true);
  assert.equal(anchorShowsAt(anchor, 13.0, null), false);
  assert.equal(revealTime(anchor, null), 12.4);
});

test('a dragged box keeps its size; a tiny one is a point', () => {
  const box = boxAnchorAt({ x: 960, y: 540 }, { x: 480, y: 270 }, film, filmSeconds(1));
  assert.deepEqual(box, { kind: 'point', t: 1, x: 0.25, y: 0.25, box: { w: 0.25, h: 0.25 } });
  assert.deepEqual(anchorWorldBox(box, film), { x: 480, y: 270, w: 480, h: 270 });
  const tiny = boxAnchorAt({ x: 100, y: 100 }, { x: 102, y: 101 }, film, filmSeconds(1));
  assert.equal(tiny.kind === 'point' && tiny.box === undefined, true);
});

test('a range anchor shows through its stretch and marks the timeline', () => {
  const range = { kind: 'range' as const, from: filmSeconds(2), to: filmSeconds(5) };
  assert.deepEqual(anchorSpan(range, null), { from: 2, to: 5 });
  assert.equal(anchorShowsAt(range, 3, null), true);
  assert.equal(anchorShowsAt(range, 5.5, null), false);
  assert.deepEqual(timelineMark('a', range, null, 10), { id: 'a', from: 0.2, to: 0.5 });
  assert.deepEqual(pinWorldPoint(range, film), { x: 960, y: 1080 * 0.06 });
});

test('anchors follow a clock that retimes the film', () => {
  const clock = { toPlay: (t: number) => t * 2, toFilm: (t: number) => t / 2 } as unknown as Parameters<typeof anchorSpan>[1];
  const anchor = makePointCommentAnchor(filmSeconds(3));
  assert.deepEqual(anchorSpan(anchor, clock), { from: 6, to: 6 });
  assert.equal(revealTime(anchor, clock), 6);
});

test('the whole-film anchor has no pin, no span and no mark', () => {
  assert.equal(pinWorldPoint(FILM_ANCHOR, film), null);
  assert.equal(anchorSpan(FILM_ANCHOR, null), null);
  assert.equal(timelineMark('x', FILM_ANCHOR, null, 10), null);
  assert.equal(revealTime(FILM_ANCHOR, null), 0);
});

test('the camera maps film pixels onto the letterboxed picture', () => {
  assert.deepEqual(stageCamera({ left: 10, top: 20, width: 960, height: 540 }, film), { x: 10, y: 20, zoom: 0.5 });
});

test('what covers the picture', () => {
  const base = { sync: 'live' as const, hasScript: true, stage: 'ready' as const, problem: null, activity: 'idle' as const };
  assert.equal(filmView(base).kind, 'playing');
  assert.equal(filmView({ ...base, sync: 'connecting' }).kind, 'connecting');
  assert.equal(filmView({ ...base, hasScript: false }).kind, 'empty');
  assert.equal(filmView({ ...base, hasScript: false, activity: 'working' }).kind, 'starting');
  assert.equal(filmView({ ...base, stage: 'loading' }).kind, 'loading');
  assert.equal(filmView({ ...base, problem: { phase: 'render', message: 'x', stack: '', at: null } }).kind, 'error');
});

test('the agent seems stopped after 90 quiet seconds, unless it is idle', () => {
  const base = { missing: 2, activity: 'working' as const, lastWriteAt: 0, now: 91_000, readOnly: false };
  assert.equal(seemsStopped(base), true);
  assert.equal(seemsStopped({ ...base, now: 30_000 }), false);
  assert.equal(seemsStopped({ ...base, activity: 'idle' }), false);
  assert.equal(seemsStopped({ ...base, missing: 0 }), false);
  assert.equal(seemsStopped({ ...base, readOnly: true }), false);
});

test('the working bar counts scenes and offers the next step', () => {
  const summary: SceneBuildSummary = { rough: true, count: { what: 'making', n: 2, of: 5 }, button: null, left: [3, 4, 5], closing: false, pips: [] };
  assert.deepEqual(workingBarView({ summary, asked: null, waitsOnYou: false }), { rough: true, says: '2 of 5 scenes', pips: [], button: null });
  const left = { ...summary, count: null, button: 'continue' as const };
  assert.equal(workingBarView({ summary: left, asked: null, waitsOnYou: false })?.says, '3 scenes missing');
  assert.equal(workingBarView({ summary: left, asked: null, waitsOnYou: true })?.says, 'Waiting for you');
  const done = { rough: false, count: null, button: null, left: [], closing: false, pips: [] };
  assert.equal(workingBarView({ summary: done, asked: null, waitsOnYou: false }), null);
});
