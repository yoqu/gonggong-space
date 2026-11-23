import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FLASH_SAMPLE_FPS,
  analyzeFlashes,
  buildGifPalette,
  createFlashAnalyzer,
  createGifEncoder,
  flashSafeScale,
  gifBackend,
  openGifSession,
  planFlashSampling,
} from '../src/index.ts';

/** RGBA pixels of a `width` × `height` picture. */
function picture(width: number, height: number, color: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set([...color(x, y), 255], (y * width + x) * 4);
  }
  return pixels;
}

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

/** Offsets of the image descriptors, walking the GIF's blocks. */
function imageDescriptors(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packed = bytes[10]!;
  let at = 13 + (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);
  const skipSubBlocks = (): void => {
    while (bytes[at] !== 0) at += bytes[at]! + 1;
    at++;
  };
  const found: number[] = [];
  for (;;) {
    const introducer = bytes[at];
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      at += 2;
      skipSubBlocks();
    } else if (introducer === 0x2c) {
      found.push(at);
      const local = bytes[at + 9]!;
      at += 10 + (local & 0x80 ? 3 << ((local & 7) + 1) : 0);
      at++; // LZW minimum code size
      skipSubBlocks();
    } else assert.fail(`unexpected block 0x${introducer?.toString(16)} at ${at}`);
    assert.ok(at < view.byteLength, 'blocks stay inside the file');
  }
  assert.equal(at, bytes.length - 1, 'the trailer ends the file');
  return found;
}

describe('GIF', () => {
  const first = picture(6, 4, (x) => (x < 3 ? [255, 0, 0] : [0, 0, 255]));
  const second = picture(6, 4, (x, y) => (x === 4 && y === 1 ? [0, 255, 0] : x < 3 ? [255, 0, 0] : [0, 0, 255]));

  it('picks the exact colors of a simple picture', () => {
    assert.deepEqual([...buildGifPalette([first, second])], [255, 0, 0, 0, 0, 255, 0, 255, 0]);
  });

  it('encodes two frames, the second as just the changed pixel', () => {
    const encoder = createGifEncoder({ width: 6, height: 4, palette: buildGifPalette([first, second]) });
    assert.ok(encoder.add(first, 8) > 0);
    assert.ok(encoder.add(second, 8) > 0);
    assert.equal(encoder.add(second, 8), 0, 'an unchanged frame adds nothing');
    const bytes = encoder.finish();
    assert.equal(latin1(bytes.subarray(0, 6)), 'GIF89a');
    assert.deepEqual([...bytes.subarray(6, 10)], [6, 0, 4, 0]);
    assert.ok(latin1(bytes).includes('NETSCAPE2.0'));
    assert.equal(bytes.at(-1), 0x3b);
    const [full, changed] = imageDescriptors(bytes);
    assert.deepEqual([...bytes.subarray(full! + 1, full! + 9)], [0, 0, 0, 0, 6, 0, 4, 0]);
    assert.deepEqual([...bytes.subarray(changed! + 1, changed! + 9)], [4, 0, 1, 0, 1, 0, 1, 0]);
    // The second frame's control block: transparency on, shown 8 + 8 cs.
    const control = changed! - 8;
    assert.deepEqual([...bytes.subarray(control, control + 6)], [0x21, 0xf9, 4, 5, 16, 0]);
    assert.throws(() => encoder.finish(), /finished/);
  });

  it('a session gives the same file, in-thread here', async () => {
    assert.equal(gifBackend(), 'inline');
    const direct = createGifEncoder({ width: 6, height: 4, palette: buildGifPalette([first, second]) });
    direct.add(first, 10);
    direct.add(second, 10);
    const wanted = direct.finish();
    const session = openGifSession({ width: 6, height: 4 });
    await session.sample(first.slice());
    await session.sample(second.slice());
    assert.ok((await session.add(first.slice(), 10)) > 0);
    await session.add(second.slice(), 10);
    assert.deepEqual(await session.finish(), wanted);
    await assert.rejects(session.add(first.slice(), 10), /closed/);
  });

  it('a session without samples takes its palette from the first frame', async () => {
    const session = openGifSession({ width: 6, height: 4, repeat: 3 });
    await session.add(first.slice(), 4);
    const bytes = await session.finish();
    assert.equal(imageDescriptors(bytes).length, 1);
    const loop = latin1(bytes).indexOf('NETSCAPE2.0') + 13;
    assert.deepEqual([...bytes.subarray(loop, loop + 2)], [3, 0]);
  });

  it('refuses frames of the wrong size', () => {
    const encoder = createGifEncoder({ width: 6, height: 4, palette: new Uint8Array([0, 0, 0]) });
    assert.throws(() => encoder.add(new Uint8Array(8), 4), /RGBA/);
    encoder.dispose();
  });
});

describe('flash analysis', () => {
  const [width, height] = [64, 36];
  const level = (value: number): Uint8ClampedArray => picture(width, height, () => [value, value, value]);
  const black = level(0);
  const white = level(255);

  it('a full-screen strobe cannot be shortened', () => {
    // Black and white swapping every 2 frames for 3 seconds.
    const frames = Array.from({ length: 90 }, (_, index) => (Math.floor(index / 2) % 2 === 0 ? black : white));
    const report = analyzeFlashes(frames, { width, fromFrame: 0, toFrame: 90 });
    assert.equal(report.frames, 90);
    assert.deepEqual(report.fastest, { first: 2, last: 14 });
    assert.equal(report.span, 12 / FLASH_SAMPLE_FPS);
    assert.equal(report.safeScale, 1);
  });

  it('slow flashes allow some shortening', () => {
    const analyzer = createFlashAnalyzer({ fromFrame: 0, toFrame: 200 });
    for (let index = 0; index < 200; index++) analyzer.add(Math.floor(index / 15) % 2 === 0 ? black : white, width);
    const report = analyzer.report();
    analyzer.dispose();
    assert.equal(report.span, 3);
    assert.equal(report.safeScale, flashSafeScale(3));
    assert.ok(report.safeScale > 0.34 && report.safeScale < 0.35);
  });

  it('a steady picture never flashes', () => {
    const report = analyzeFlashes(Array.from({ length: 60 }, () => level(128)), { width, fromFrame: 0, toFrame: 60 });
    assert.deepEqual(report, { frames: 60, fastest: null, span: Infinity, safeScale: 0 });
  });

  it('frames must keep their size', () => {
    const analyzer = createFlashAnalyzer({ fromFrame: 0, toFrame: 10 });
    analyzer.add(black, width);
    assert.throws(() => analyzer.add(picture(8, 8, () => [0, 0, 0]), 8), /among pictures of 64x36/);
    analyzer.dispose();
  });

  it('samples a second of film each side of a scene', () => {
    const sampling = planFlashSampling(5, 2, 60);
    assert.ok(sampling);
    assert.equal(sampling.times.length, 4 * FLASH_SAMPLE_FPS + 1);
    assert.equal(sampling.times[0], 4);
    assert.deepEqual([sampling.fromFrame, sampling.toFrame], [30, 90]);
    const opening = planFlashSampling(0.5, 1, 1.5);
    assert.ok(opening);
    assert.deepEqual([opening.fromFrame, opening.toFrame, opening.times.length], [15, 45, 46]);
    assert.equal(planFlashSampling(0, 31, 60), null);
  });
});
