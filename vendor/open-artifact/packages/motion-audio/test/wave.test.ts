import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PcmSource } from '../src/loudness.ts';
import { encodePcmWave, interleave, parsePcmWave } from '../src/wave.ts';

function pcm(channels: Float32Array<ArrayBuffer>[], sampleRate: number): PcmSource {
  return {
    sampleRate,
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(0),
  };
}

describe('waves', () => {
  it('writes a 16-bit PCM wave, clamping to full scale', () => {
    const bytes = encodePcmWave(pcm([new Float32Array([0, 1, -1, 2]), new Float32Array([0.5, -0.5, 0, -2])], 24000));
    const view = new DataView(bytes.buffer);
    assert.equal(bytes.byteLength, 44 + 4 * 2 * 2);
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
    assert.equal(view.getUint32(24, true), 24000);
    assert.equal(view.getUint16(22, true), 2);
    assert.deepEqual(
      Array.from({ length: 8 }, (_unused, index) => view.getInt16(44 + index * 2, true)),
      [0, 16383, 32767, -16384, -32768, 0, 32767, -32768],
    );
  });

  it('reads back a plain wave’s length and bare samples', () => {
    const bytes = encodePcmWave(pcm([new Float32Array(24000)], 24000));
    const wave = parsePcmWave(bytes.buffer);
    assert.ok(wave !== null);
    assert.equal(wave.seconds, 1);
    assert.deepEqual(new Uint8Array(wave.bare()), bytes);
  });

  it('skips chunks it does not know, and refuses anything but plain 16-bit PCM', () => {
    const plain = encodePcmWave(pcm([new Float32Array([0.25, 0.5])], 8000));
    const extra = new Uint8Array(plain.byteLength + 10);
    extra.set(plain.slice(0, 36));
    extra.set([0x4c, 0x49, 0x53, 0x54, 2, 0, 0, 0, 0, 0], 36);
    extra.set(plain.slice(36), 46);
    new DataView(extra.buffer).setUint32(4, extra.byteLength - 8, true);
    const wave = parsePcmWave(extra.buffer);
    assert.ok(wave !== null);
    assert.deepEqual(new Uint8Array(wave.bare()), plain);

    const eightBit = plain.slice();
    new DataView(eightBit.buffer).setUint16(34, 8, true);
    assert.equal(parsePcmWave(eightBit.buffer), null);
    assert.equal(parsePcmWave(new TextEncoder().encode('ID3 not a wave').buffer), null);
    assert.equal(parsePcmWave(plain.slice(0, 40).buffer), null);
  });

  it('interleaves channels frame by frame', () => {
    const out = interleave(pcm([new Float32Array([1, 2, 3]), new Float32Array([-1, -2, -3])], 48000));
    assert.deepEqual(Array.from(out), [1, -1, 2, -2, 3, -3]);
  });
});
