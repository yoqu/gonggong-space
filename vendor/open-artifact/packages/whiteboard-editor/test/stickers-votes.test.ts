/**
 * Stickers and videos: where votes land on an item, the recent stickers
 * limit, the peel's motion model, and how a press on a video plays it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement, NoteElement, Point } from '@open-artifact/whiteboard-core';
import { FACE_STICKER_INSET, FACE_STICKER_SIZE, FACE_STICKER_SPACING, createVote, isVote, voteNudge, voteSeed, voteSpotOn } from '../src/lib/votes.ts';
import { RECENT_STICKERS_LIMIT } from '../src/state/recent-stickers.ts';
import { StickerPeelMotion, easePeelLayDown, peelDropShadowFilter, peelFoldGeometry, peelFoldReach } from '../src/lib/peel-motion.ts';
import {
  VIDEO_CLICK_GUARD_MS,
  pauseVideo,
  playVideo,
  runVideoPress,
  stopVideo,
  takeToldStop,
  toggleVideo,
  useVideoPlayback,
  videoClickedRecently,
  videoPlayButtonSize,
  videoPressAction,
} from '../src/elements/video-playback.ts';
import { contiguousReach, formatPlaybackTime } from '../src/elements/video-playback.ts';

const note = (over: Partial<NoteElement> = {}): NoteElement =>
  ({ type: 'note', id: 'host', x: 0, y: 0, w: 200, h: 200, color: 'yellow', text: '', tilt: 0, ...over }) as NoteElement;

describe('votes', () => {
  it('seeds the nudge from the author id, the same every time', () => {
    assert.equal(voteSeed(''), 7);
    assert.equal(voteSeed('a'), (7 * 31 + 97) >>> 0);
    assert.equal(voteSeed('ab'), voteSeed('ab'));
    for (const id of ['', 'a', 'someone', 'user_123', '😀x']) {
      const nudge = voteNudge(id);
      assert.ok(nudge.x >= -4 && nudge.x <= 4 && nudge.y >= -4 && nudge.y <= 4, id);
    }
  });

  it('puts the first vote in the bottom-right corner, overhanging it a little', () => {
    const host = note();
    const nudge = voteNudge('me');
    const spot = voteSpotOn(host, 'me', [host]);
    assert.equal(spot.x, 200 - FACE_STICKER_SIZE + FACE_STICKER_INSET + nudge.x);
    assert.equal(spot.y, 200 - FACE_STICKER_SIZE + FACE_STICKER_INSET + nudge.y);
  });

  it('fills leftward along the row, then the row above', () => {
    const host = note();
    const elements: BoardElement[] = [host];
    const placed: Point[] = [];
    for (let index = 0; index < 9; index += 1) {
      const spot = voteSpotOn(host, 'me', elements);
      placed.push(spot);
      elements.push(createVote('me', spot, `v${index}`));
    }
    const columns = Math.floor((200 - 2 * FACE_STICKER_INSET) / FACE_STICKER_SPACING) + 1;
    assert.ok(Math.abs(placed[0]!.x - placed[1]!.x - FACE_STICKER_SPACING) < 1e-9);
    assert.equal(placed[1]!.y, placed[0]!.y);
    // Spots past the item's left edge would take the vote off it: the row stops there.
    const rowLength = placed.findIndex((spot) => spot.y !== placed[0]!.y);
    assert.ok(rowLength > 0 && rowLength <= columns);
    assert.ok(Math.abs(placed[0]!.y - placed[rowLength]!.y - FACE_STICKER_SPACING) < 1e-9);
    assert.equal(placed[rowLength]!.x, placed[0]!.x);
  });

  it('keeps clear of anyone’s votes', () => {
    const host = note();
    const first = voteSpotOn(host, 'me', [host]);
    const theirs = createVote('them', first, 'theirs');
    const next = voteSpotOn(host, 'me', [host, theirs]);
    assert.ok(Math.hypot(next.x - first.x, next.y - first.y) >= FACE_STICKER_SPACING / 2);
  });

  it('uses the offset grid, then stacks, when the item is full', () => {
    const host = note({ w: 40, h: 40 });
    const elements: BoardElement[] = [host];
    const spots: Point[] = [];
    for (let index = 0; index < 4; index += 1) {
      const spot = voteSpotOn(host, 'me', elements);
      spots.push(spot);
      elements.push(createVote('me', spot, `v${index}`));
    }
    // A small item has one spot per grid: the corner, then half a step up and left.
    assert.ok(Math.abs(spots[0]!.x - spots[1]!.x - FACE_STICKER_SPACING / 2) < 1e-9);
    assert.ok(Math.abs(spots[0]!.y - spots[1]!.y - FACE_STICKER_SPACING / 2) < 1e-9);
    // Then each stacks a little up and left of the first spot.
    assert.deepEqual(spots[2], { x: spots[0]!.x - 3, y: spots[0]!.y - 2 });
    assert.deepEqual(spots[3], { x: spots[0]!.x - 6, y: spots[0]!.y - 4 });
  });

  it('makes a vote: a face sticker naming its author', () => {
    const vote = createVote('x'.repeat(300), { x: 1, y: 2 }, 'id');
    assert.ok(isVote(vote));
    assert.equal(vote.authorId.length, 128);
    assert.deepEqual([vote.x, vote.y, vote.w, vote.h], [1, 2, FACE_STICKER_SIZE, FACE_STICKER_SIZE]);
  });
});

describe('recent stickers', () => {
  it('keeps the seven most recent', () => {
    assert.equal(RECENT_STICKERS_LIMIT, 7);
  });
});

describe('video playback', () => {
  it('sizes the play button from the video’s size on screen', () => {
    assert.equal(videoPlayButtonSize(400, false), 'xl');
    assert.equal(videoPlayButtonSize(256, true), 'xl');
    assert.equal(videoPlayButtonSize(200, false), 'lg');
    assert.equal(videoPlayButtonSize(100, false), 'md');
    assert.equal(videoPlayButtonSize(50, false), 'sm');
    assert.equal(videoPlayButtonSize(32, false), 'xs');
    assert.equal(videoPlayButtonSize(31, false), undefined);
    // On a touch screen: one size, or none on a small video.
    assert.equal(videoPlayButtonSize(100, true), 'lg');
    assert.equal(videoPlayButtonSize(47, true), undefined);
  });

  it('plays from the button, or anywhere for a viewer; pauses only a video selected alone', () => {
    const press = { onPlayButton: false, viewer: false, started: false, alone: false };
    assert.equal(videoPressAction({ ...press, onPlayButton: true }), 'play');
    assert.equal(videoPressAction(press), undefined);
    assert.equal(videoPressAction({ ...press, viewer: true }), 'play');
    assert.equal(videoPressAction({ ...press, started: true }), undefined);
    assert.equal(videoPressAction({ ...press, started: true, alone: true }), 'toggle');
    assert.equal(videoPressAction({ ...press, started: true, viewer: true }), 'toggle');
    assert.equal(videoPressAction({ ...press, started: true, alone: true, onPlayButton: true }), 'play');
  });

  it('plays one video at a time; pausing and resuming keep it', () => {
    playVideo('a');
    assert.deepEqual(useVideoPlayback.getState(), { playing: 'a', paused: false, muted: false });
    playVideo('b');
    assert.equal(useVideoPlayback.getState().playing, 'b');
    assert.equal(pauseVideo('a'), false);
    assert.equal(pauseVideo('b'), true);
    assert.equal(useVideoPlayback.getState().paused, true);
    toggleVideo('b');
    assert.deepEqual(useVideoPlayback.getState(), { playing: 'b', paused: false, muted: false });
    stopVideo('a');
    assert.equal(useVideoPlayback.getState().playing, 'b');
    stopVideo('b', true);
    assert.equal(useVideoPlayback.getState().playing, null);
    assert.equal(takeToldStop(), true);
    assert.equal(takeToldStop(), false);
  });

  it('does not pause on the second click of a double click that started it', () => {
    runVideoPress('c', 'play', 1000);
    assert.equal(useVideoPlayback.getState().playing, 'c');
    runVideoPress('c', 'toggle', 1000 + VIDEO_CLICK_GUARD_MS - 1);
    assert.equal(useVideoPlayback.getState().paused, false);
    assert.equal(videoClickedRecently(1000 + VIDEO_CLICK_GUARD_MS), true);
    runVideoPress('c', 'toggle', 1000 + VIDEO_CLICK_GUARD_MS + 1);
    assert.equal(useVideoPlayback.getState().paused, true);
    assert.equal(videoClickedRecently(1000 + 3 * VIDEO_CLICK_GUARD_MS), false);
    stopVideo('c');
  });
});

describe('sticker peel', () => {
  const STEP = 1000 / 60;

  it('steps at 60 Hz, sharing out the motion', () => {
    const motion = new StickerPeelMotion(0, 0.5);
    assert.equal(motion.step(STEP - 1, 1, 0, 1, 0), false);
    assert.equal(motion.depth, 0);
    assert.equal(motion.step(STEP + 0.5, 0, 0, 0, 0), true);
    // Long gaps run at most 100 ms of steps.
    const fresh = new StickerPeelMotion(0, 0.5);
    assert.equal(fresh.step(10_000, 0, 0, 0, 0), true);
  });

  it('peels from the trailing corner once the sticker has moved 2 px', () => {
    const motion = new StickerPeelMotion(0, 0.5);
    let time = 0;
    motion.step((time += STEP), 0.5, 0, 0.5, 0);
    assert.equal(motion.depth, 0);
    for (let index = 0; index < 30; index += 1) motion.step((time += STEP), 6, 0, 6, 0);
    assert.ok(motion.depth > 0.1, String(motion.depth));
    // Moving right: it peels from the left (away from the motion).
    assert.ok(Math.abs(Math.abs(motion.dir) - Math.PI) < 0.3, String(motion.dir));
    assert.ok(motion.raised > 0.5);
  });

  it('keeps scale and lean in bounds, and grows from the cell toward full size', () => {
    const motion = new StickerPeelMotion(0, 0.5);
    let time = 0;
    for (let index = 0; index < 200; index += 1) {
      motion.step((time += STEP), 40, -40, 40, -40);
      assert.ok(Math.abs(motion.lean) <= 21.6 + 1e-9);
      assert.ok(motion.scale > 0.4 && motion.scale < 1.4, String(motion.scale));
    }
    assert.ok(motion.scale > 0.9);
    assert.ok(motion.depth <= 0.35 + 1e-9);
  });

  it('eases the lay-down from 0 to 1, always forward', () => {
    assert.ok(Math.abs(easePeelLayDown(0)) < 1e-6);
    assert.ok(Math.abs(easePeelLayDown(1) - 1) < 1e-6);
    let last = 0;
    for (let index = 1; index <= 20; index += 1) {
      const value = easePeelLayDown(index / 20);
      assert.ok(value >= last - 1e-9, `${index}: ${value} < ${last}`);
      last = value;
    }
  });

  it('casts no shadow at rest, a deeper one lifted, with a glow on a dark board', () => {
    assert.equal(peelDropShadowFilter(0, false), '');
    assert.match(peelDropShadowFilter(1, false), /^drop-shadow\(/);
    assert.match(peelDropShadowFilter(1, true), /rgba\(255,232,214/);
  });

  it('folds by reflecting across the fold line', () => {
    const side = 40;
    const reach = peelFoldReach(side);
    assert.ok(Math.abs(reach - (side / 2) * Math.SQRT2 - side / 2) < 1e-9);
    const fold = peelFoldGeometry(0.3, side, reach);
    const [a, b, c, d, e, f] = fold.matrix;
    assert.ok(Math.abs(a * d - b * c + 1) < 1e-9, 'a reflection');
    // The fold line stays put; its tip folds back onto the art.
    const { x1, y1, x2, y2 } = fold.shade;
    assert.ok(Math.abs(a * x1 + c * y1 + e - x1) < 1e-9 && Math.abs(b * x1 + d * y1 + f - y1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(x2 - x1, y2 - y1) - (0.3 * side) / 2) < 1e-9);
    const tip = { x: a * x2 + c * y2 + e, y: b * x2 + d * y2 + f };
    assert.ok(Math.hypot(tip.x - side / 2, tip.y - side / 2) < Math.hypot(x2 - side / 2, y2 - side / 2));
    assert.equal(fold.cut.length, 4);
    assert.equal(fold.keep.length, 4);
  });
});

describe('video controls', () => {
  it('formats playback times', () => {
    assert.equal(formatPlaybackTime(0), '0:00');
    assert.equal(formatPlaybackTime(65.9), '1:05');
    assert.equal(formatPlaybackTime(3725), '1:02:05');
    assert.equal(formatPlaybackTime(Number.NaN), '0:00');
  });

  it('measures how far a video loaded without a gap', () => {
    assert.equal(contiguousReach([]), 0);
    assert.equal(contiguousReach([[0, 4]]), 4);
    assert.equal(contiguousReach([[0.2, 4], [4.3, 9]]), 9);
    assert.equal(contiguousReach([[0, 4], [6, 9]]), 4);
    assert.equal(contiguousReach([[3, 9]]), 0);
  });
});
