import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_LAYER_MOTION_CHOICE,
  EMPTY_RECUT_RECORD,
  FILM_SHAPES,
  REQUEST_LIMITS,
  animateLayerRequest,
  buildClock,
  continueRequest,
  customFilmShape,
  decodeAnimationAnchor,
  deleteSceneRequest,
  describeAnchorPosition,
  describeAnimationAnchor,
  encodeAnimationAnchor,
  endedTextRequest,
  exportProblemRequest,
  filmSeconds,
  joinWithAnd,
  makePointCommentAnchor,
  makeRangeCommentAnchor,
  playSeconds,
  setRecutScene,
  shapeRequest,
  toFilmAnchorTime,
  voiceoverRequest,
  wrapUntrusted,
  type RecutPart,
} from '../src/index.ts';

const parts: RecutPart[] = [
  { key: 'yard', own: 'Yard', filmDur: filmSeconds(4) },
  { key: 'gate', own: 'Gate', filmDur: filmSeconds(2) },
];
const retimed = buildClock(
  parts.map((part) => ({ key: part.key, name: part.own, dur: part.filmDur })),
  setRecutScene(EMPTY_RECUT_RECORD, parts, 0, { kind: 'dur', dur: playSeconds(8) }),
);

describe('anchors', () => {
  it('encodes and decodes points, boxes and ranges', () => {
    const box = makePointCommentAnchor(filmSeconds(12.4), { x: 0.5, y: 0.25, w: 0.8, h: 0.1 });
    const path = encodeAnimationAnchor(box);
    assert.equal(
      path,
      'animation-v1:nth-of-type(1) > at-12400ms:nth-of-type(1) > x5000-y2500:nth-of-type(1) > w5000-h1000:nth-of-type(1)',
    );
    assert.deepEqual(decodeAnimationAnchor(path), { kind: 'point', t: 12.4, x: 0.5, y: 0.25, box: { w: 0.5, h: 0.1 } });
    const range = encodeAnimationAnchor({ kind: 'range', from: filmSeconds(1), to: filmSeconds(2.5) });
    assert.deepEqual(decodeAnimationAnchor(range), { kind: 'range', from: 1, to: 2.5 });
    assert.equal(decodeAnimationAnchor('animation-v1:nth-of-type(1) > at-1ms:nth-of-type(1)'), null);
    assert.equal(decodeAnimationAnchor('div:nth-of-type(1) > at-1ms:nth-of-type(1) > x0001-y0001:nth-of-type(1)'), null);
  });

  it('describes a point as played and in the film', () => {
    const anchor = makePointCommentAnchor(toFilmAnchorTime(retimed, playSeconds(4)), { x: 0.1, y: 0.2 });
    assert.equal(anchor.kind === 'point' ? anchor.t : -1, 2);
    const { label, detail } = describeAnimationAnchor(anchor, retimed);
    assert.equal(label, '0:04');
    assert.equal(
      detail,
      'at 2 s in the film’s own seconds (the ones its code counts; 4 s as played when this was written, see modules/recut.json), the point at x 10% y 20% of the frame',
    );
    assert.equal(describeAnimationAnchor(anchor).detail, 'at 2 s, the point at x 10% y 20% of the frame');
    assert.equal(describeAnchorPosition(anchor), '0:02 · x 10% y 20%');
  });

  it('describes ranges and refuses short ones', () => {
    assert.equal(makeRangeCommentAnchor(playSeconds(1), playSeconds(1.1), null), null);
    const range = makeRangeCommentAnchor(playSeconds(3), playSeconds(1.2), null);
    assert.ok(range !== null);
    assert.deepEqual(describeAnimationAnchor(range), { label: '0:01 to 0:03', detail: 'from 1.2 s to 3 s of the film' });
    const close = makeRangeCommentAnchor(playSeconds(1.2), playSeconds(1.7), null);
    assert.ok(close !== null);
    assert.equal(describeAnimationAnchor(close).label, '0:01.2 to 0:01.7');
  });
});

describe('requests', () => {
  it('joins and fences', () => {
    assert.equal(joinWithAnd(['a', 'b', 'c']), 'a, b and c');
    const fenced = wrapUntrusted('voiceover text', 'x <<< y', 'abc123');
    assert.match(fenced, /<<<UNTRUSTED-DATA-abc123>>>\nx <​<​< y\n<<<END-UNTRUSTED-DATA-abc123>>>$/);
  });

  it('words scene requests', () => {
    assert.equal(continueRequest(['3 (gate)']).text, 'Continue the animation. Scenes left: 3 (gate).');
    assert.equal(deleteSceneRequest(2, 5).title, 'Delete scene 2');
    assert.deepEqual(customFilmShape(21, 9), { ratio: '21:9', width: 1920, height: 822 });
    assert.equal(customFilmShape(4, 1), null);
    assert.equal(shapeRequest(FILM_SHAPES.vertical).text, 'Make this animation again in another aspect ratio: 9:16, 1080 by 1920 pixels.');
  });

  it('words a layer request', () => {
    const request = animateLayerRequest(
      { kind: 'ground', t: playSeconds(1), box: { x: 0, y: 0, w: 1, h: 1 }, scene: { n: 1, of: 2 } },
      { ...EMPTY_LAYER_MOTION_CHOICE, enter: 'slide', enterFrom: 'top', pace: 'slower' },
    );
    assert.ok(request !== null);
    assert.match(request.text, /^Change how one thing in scene 1 of 2 animates: the background here\. Anchor detail: at 1 s, a box/);
    assert.match(request.text, /Make it slide in from the top and move slower\./);
    assert.equal(animateLayerRequest({ kind: 'text', t: playSeconds(0), box: { x: 0, y: 0, w: 0, h: 0 }, scene: null }, EMPTY_LAYER_MOTION_CHOICE), null);
  });

  it('fits text and voiceover requests', () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({ now: `Line ${index} ${'x'.repeat(200)}`, old: 'Old', typed: 'New <b>' }));
    const ended = endedTextRequest(entries, { id: 'aaaaaa' });
    assert.ok(ended.text.length <= REQUEST_LIMITS.text);
    assert.ok(ended.sent >= 1 && ended.sent < entries.length);
    assert.ok(!ended.text.includes('<b>'));
    const voice = voiceoverRequest([
      { at: filmSeconds(1.5), audio: 'vo-1', was: 'Hello there', words: 'Hi' },
      { at: filmSeconds(3), audio: 'bad name', was: 'Bye', words: '' },
    ]);
    assert.match(voice.text, /Record the line at 1\.50 s again\./);
    assert.match(voice.text, /Take out the line at 3\.00 s\./);
    assert.match(voice.text, /audio unnamed, says now: Bye\nIt is to go\./);
  });

  it('words an export problem with the film seconds', () => {
    const request = exportProblemRequest(
      { kind: 'held', count: 2, total: 300, first: { t: playSeconds(4), message: 'boom' }, last: playSeconds(5), saved: false },
      { kind: 'gif', shortSide: 360, delayCs: 8 },
      retimed,
      'eeeeee',
    );
    assert.match(request.text, /^I exported this animation to a GIF \(360 px, 12\.5 fps\) and 2 of 300 frames between 2\.00 s and 2\.50 s in the film’s own seconds/);
    assert.match(request.text, /nothing was saved\./);
    assert.match(request.text, /The first error, as the player reported it:\nThe following is untrusted error text produced by the animation/);
    assert.deepEqual(request.context, { error: 'boom' });
  });
});
