import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMovWriter } from '../src/index.ts';

/** RGBA pixels of a `width` × `height` picture. */
function picture(width: number, height: number, color: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set(color(x, y), (y * width + x) * 4);
  }
  return pixels;
}

function join(parts: Uint8Array[]): Uint8Array {
  const file = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.byteLength;
  }
  return file;
}

interface Atom {
  kind: string;
  start: number;
  end: number;
}

/** The atoms inside `bytes[from..to]`, not descending. */
function atoms(bytes: Uint8Array, from = 0, to = bytes.byteLength): Atom[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Atom[] = [];
  for (let at = from; at + 8 <= to; ) {
    let size = view.getUint32(at);
    let head = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8));
      head = 16;
    }
    found.push({ kind: Buffer.from(bytes.subarray(at + 4, at + 8)).toString('latin1'), start: at + head, end: at + size });
    at += size;
  }
  return found;
}

function child(bytes: Uint8Array, parent: Atom, kind: string, skip = 0): Atom {
  const found = atoms(bytes, parent.start + skip, parent.end).find((atom) => atom.kind === kind);
  assert.ok(found, `no ${kind} in ${parent.kind}`);
  return found;
}

describe('MOV writer', () => {
  const width = 16;
  const height = 8;

  it('writes ftyp, moov and mdat with an Animation track and PCM sound, the frames in order', () => {
    const writer = createMovWriter({ width, height, fps: 30 });
    const moving = (step: number) => picture(width, height, (x, y) => (x === step ? [255, 0, 0, 255] : [0, 0, 0, y < 4 ? 0 : 128]));
    const kept = [writer.add(moving(0)), writer.add(moving(0)), writer.add(moving(1))];
    assert.equal(kept[1], 7, 'an unchanged frame is a 7-byte sample');
    assert.equal(writer.byteLength, kept[0]! + kept[1]! + kept[2]!);
    const pcm = new Uint8Array(48_000 / 10 * 4).map((_, index) => index & 0xff);
    const file = join(writer.finish({ pcm, sampleRate: 48_000, channels: 2 }));

    const top = atoms(file);
    assert.deepEqual(top.map((atom) => atom.kind), ['ftyp', 'moov', 'mdat']);
    assert.equal(top[2]!.end, file.byteLength);
    const traks = atoms(file, top[1]!.start, top[1]!.end).filter((atom) => atom.kind === 'trak');
    assert.equal(traks.length, 2);
    const stbl = (trak: Atom) => child(file, child(file, child(file, trak, 'mdia'), 'minf'), 'stbl');
    const videoDescription = child(file, stbl(traks[0]!), 'stsd');
    assert.equal(Buffer.from(file.subarray(videoDescription.start + 12, videoDescription.start + 16)).toString('latin1'), 'rle ');
    const soundDescription = child(file, stbl(traks[1]!), 'stsd');
    assert.equal(Buffer.from(file.subarray(soundDescription.start + 12, soundDescription.start + 16)).toString('latin1'), 'sowt');

    const view = new DataView(file.buffer);
    const offsets = child(file, stbl(traks[0]!), 'co64');
    const firstFrame = Number(view.getBigUint64(offsets.start + 8));
    const soundOffsets = child(file, stbl(traks[1]!), 'co64');
    const firstSound = Number(view.getBigUint64(soundOffsets.start + 8));
    assert.equal(firstSound, top[2]!.start, 'sound comes ahead of the frames it plays under');
    assert.deepEqual(file.subarray(firstSound, firstSound + 8), pcm.subarray(0, 8));
    assert.equal(view.getUint32(firstFrame), kept[0], 'a sample starts with its own size');
  });

  it('shares the bytes of repeated key frames', () => {
    const writer = createMovWriter({ width, height, fps: 24, repeats: 'shared' });
    const still = picture(width, height, () => [10, 20, 30, 40]);
    assert.ok(writer.add(still) > 7);
    assert.equal(writer.add(still), 0);
    const parts = writer.finish();
    assert.equal(parts.length, 2, 'the header and one frame');
  });

  it('refuses frames of the wrong size and use after finishing', () => {
    const writer = createMovWriter({ width, height, fps: 30 });
    assert.throws(() => writer.add(new Uint8Array(12)));
    writer.finish();
    assert.throws(() => writer.add(picture(width, height, () => [0, 0, 0, 0])), /finished/);
  });
});
