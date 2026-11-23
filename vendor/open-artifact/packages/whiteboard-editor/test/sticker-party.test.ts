/**
 * Tests of the sticker party's WebP handling: an animated WebP is set to
 * play once and its length is the sum of its frame durations; anything else
 * is left alone.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playOnceWebp } from '../src/lib/sticker-party.ts';

/** A RIFF chunk: fourcc, little-endian size, payload (padded to even). */
function chunk(kind: string, payload: number[]): number[] {
  const size = payload.length;
  return [...kind].map((char) => char.charCodeAt(0)).concat([size & 255, (size >> 8) & 255, (size >> 16) & 255, size >>> 24], payload, size % 2 ? [0] : []);
}

/** An ANMF frame payload lasting `ms` (no image data needed for the walk). */
function frame(ms: number): number[] {
  return [0, 0, 0, 0, 0, 0, 9, 0, 0, 9, 0, 0, ms & 255, (ms >> 8) & 255, (ms >> 16) & 255, 0];
}

function webp(chunks: number[][]): Uint8Array {
  const body = [...'WEBP'].map((char) => char.charCodeAt(0)).concat(...chunks);
  return new Uint8Array(chunk('RIFF', body));
}

describe('sticker party webp', () => {
  it('plays an animated webp once and sums its frames', () => {
    const bytes = webp([chunk('VP8X', new Array(10).fill(0)), chunk('ANIM', [0, 0, 0, 0, 0, 0]), chunk('ANMF', frame(40)), chunk('ANMF', frame(1000)), chunk('ANMF', frame(70000))]);
    assert.equal(playOnceWebp(bytes), 71040);
    const anim = 12 + 18 + 8;
    assert.deepEqual([bytes[anim + 4], bytes[anim + 5]], [1, 0]);
  });

  it('leaves a still webp or other bytes alone', () => {
    assert.equal(playOnceWebp(webp([chunk('VP8 ', [1, 2, 3])])), undefined);
    assert.equal(playOnceWebp(new TextEncoder().encode('<svg></svg>')), undefined);
  });
});
