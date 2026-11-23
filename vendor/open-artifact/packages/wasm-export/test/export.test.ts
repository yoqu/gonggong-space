import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { buildPdf, exportBackend, optimizePng, packZip } from '../src/index.ts';

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

interface ReadEntry {
  name: string;
  method: number;
  data: Buffer;
  time: number;
  date: number;
}

/** Reads a zip through its central directory, inflating with Node's zlib and checking every CRC with it. */
function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  assert.equal(view.getUint16(end + 8, true), count);
  const size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  assert.equal(at + size, end);
  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    assert.equal(view.getUint16(at + 8, true) & 0x0800, 0x0800, 'UTF-8 names');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const raw = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint16(local + 8, true), method);
    assert.equal(view.getUint32(local + 14, true), crc);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + packed);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.ok(method === 0 || method === 8, `method ${method}`);
    assert.equal(data.length, raw, `size of ${name}`);
    assert.equal(zlib.crc32(data), crc, `CRC of ${name}`);
    out.push({ name, method, data, time: view.getUint16(at + 12, true), date: view.getUint16(at + 14, true) });
    at += 46 + nameLength;
  }
  return out;
}

/** A PNG as a browser writes one: 8-bit RGBA, no filters, light deflate. */
function browserPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]),
  );
}

/** A PNG's chunks, with every CRC checked by Node's zlib. */
function pngChunks(bytes: Uint8Array): { type: string; data: Buffer }[] {
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const out: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    assert.equal(buffer.readUInt32BE(at + 8 + length), zlib.crc32(buffer.subarray(at + 4, at + 8 + length)), `CRC of ${type}`);
    out.push({ type, data });
    at += 12 + length;
  }
  return out;
}

describe('the export client', () => {
  it('runs in-thread where there are no Workers', () => {
    assert.equal(exportBackend(), 'inline');
  });
});

describe('packZip', () => {
  it('deflates text, stores pictures, drops duplicate names and round-trips through zlib', async () => {
    const xml = `<?xml version="1.0"?>${'<a:p><a:r><a:t>Hello, world</a:t></a:r></a:p>'.repeat(500)}`;
    const picture = new Uint8Array(3000).map((_, i) => (i * 7919) % 251);
    const progress: number[] = [];
    const bytes = await packZip(
      [
        { name: '[Content_Types].xml', data: xml },
        { name: 'ppt/media/图 1.png', data: picture },
        { name: 'blob.txt', data: new Blob(['from a blob ', 'in two parts']) },
        { name: 'kept.bin', data: new Uint8Array([1, 2, 3]), store: true },
        { name: 'blob.txt', data: 'dropped' },
      ],
      { date: new Date(2026, 10, 16, 14, 30, 44), onProgress: (done) => progress.push(done) },
    );
    const entries = readZip(bytes);
    assert.deepEqual(
      entries.map((e) => [e.name, e.method]),
      [
        ['[Content_Types].xml', 8],
        ['ppt/media/图 1.png', 0],
        ['blob.txt', 0],
        ['kept.bin', 0],
      ],
    );
    assert.equal(entries[0]!.data.toString('utf8'), xml);
    assert.deepEqual(new Uint8Array(entries[1]!.data), picture);
    assert.equal(entries[2]!.data.toString('utf8'), 'from a blob in two parts');
    assert.ok(bytes.length < xml.length / 10 + picture.length + 400, `${bytes.length} bytes`);
    assert.equal(entries[0]!.time, (14 << 11) | (30 << 5) | 22);
    assert.equal(entries[0]!.date, ((2026 - 1980) << 9) | (11 << 5) | 16);
    assert.deepEqual(progress, [1, 2, 3, 4, 5]);
  });

  it('writes an empty archive', async () => {
    assert.equal((await packZip([])).length, 22);
  });

  it('re-compresses PNG entries when asked', async () => {
    const png = browserPng(200, 100, (x) => (x < 100 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const [entry] = readZip(await packZip([{ name: 'a.png', data: png }], { optimizePng: true }));
    assert.ok(entry!.data.length < png.length);
    assert.equal(pngChunks(entry!.data)[0]!.data[9], 3, 'a palette');
  });
});

describe('buildPdf', () => {
  it('writes pages, a text layer, links and an outline with an exact cross-reference table', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = await buildPdf(
      [
        {
          jpeg: new Blob([jpeg]),
          pixelWidth: 1920,
          pixelHeight: 1080,
          width: 1440,
          height: 810,
          text: [{ text: 'Hello 世界', x: 72, baseline: 100, size: 24, width: 140 }],
          links: [{ uri: 'https://example.com/a b', x: 10, y: 10, width: 100, height: 20 }],
          bookmark: '1. Intro',
        },
        { jpeg, pixelWidth: 200, pixelHeight: 100, width: 75, height: 37.5 },
      ],
      { title: 'Deck', date: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) },
    );
    const raw = latin1(bytes);
    assert.ok(raw.startsWith('%PDF-1.7\n'));
    assert.ok(raw.endsWith('%%EOF\n'));
    const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(raw)![1]);
    const [, count] = /^xref\n0 (\d+)\n/.exec(raw.slice(start))!.map(Number) as [number, number];
    const rows = raw.slice(start).split('\n').slice(3, 2 + count);
    assert.equal(rows.length, count - 1);
    const objects = new Map<number, string>();
    rows.forEach((row, i) => {
      assert.match(row, /^\d{10} 00000 n $/);
      const offset = Number(row.slice(0, 10));
      assert.ok(raw.startsWith(`${i + 1} 0 obj\n<<`, offset), `object ${i + 1} at ${offset}`);
      let body = raw.slice(offset, raw.indexOf('\nendobj\n', offset));
      const stream = /\/Length (\d+) >>\nstream\n/.exec(body);
      if (stream) {
        const at = stream.index + stream[0].length;
        const data = bytes.subarray(offset + at, offset + at + Number(stream[1]));
        assert.ok(body.slice(at + Number(stream[1])) === '\nendstream', `stream ${i + 1} length`);
        body = body.slice(0, at) + (body.includes('/FlateDecode') ? zlib.inflateSync(data).toString('latin1') : latin1(data));
      }
      objects.set(i + 1, body);
    });
    const all = [...objects.values()].join('\n');
    assert.match(all, /\/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R\] \/Count 2/);
    assert.match(all, /BT 3 Tr\n\/F1 24 Tf 116\.67 Tz 1 0 0 1 72 710 Tm <00010002000300030004000500060007> Tj\nET/);
    assert.match(all, /\/ToUnicode/);
    assert.match(all, /<0006> <4E16>/);
    assert.match(all, /\/URI \(https:\/\/example\.com\/a%20b\)/);
    assert.match(all, /\/Rect \[10 780 110 800\]/);
    assert.match(all, /\/Outlines/);
    assert.ok(all.includes('/Title <FEFF0031002E00200049006E00740072006F>'));
    assert.ok(all.includes('/CreationDate (D:20260102030405Z) /Title <FEFF004400650063006B>'));
    assert.match(all, /\/MediaBox \[0 0 75 37\.5\]/);
    assert.match(all, /q 75 0 0 37\.5 0 0 cm \/Im0 Do Q/);
    assert.equal((all.match(/\/Subtype \/Image/g) ?? []).length, 2);
  });
});

describe('optimizePng', () => {
  it('turns a flat picture into a small palette PNG', async () => {
    const png = browserPng(400, 300, (x, y) => ((x >> 5) + (y >> 5)) % 3 === 0 ? [240, 80, 40, 255] : (x + y) % 2 ? [255, 255, 255, 255] : [20, 20, 20, 255]);
    const out = await optimizePng(new Blob([png as Uint8Array<ArrayBuffer>]));
    const chunks = pngChunks(out);
    const ihdr = chunks[0]!.data;
    assert.equal(ihdr.readUInt32BE(0), 400);
    assert.equal(ihdr[9], 3, 'palette');
    assert.equal(ihdr[8], 2, 'three colors pack into 2 bits');
    assert.equal(chunks.find((c) => c.type === 'PLTE')!.data.length, 9);
    const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
    assert.equal(zlib.inflateSync(idat).length, (Math.ceil((400 * 2) / 8) + 1) * 300);
    assert.ok(out.length < png.length / 2, `${png.length} → ${out.length}`);
  });

  it('gives back what it cannot make smaller or read', async () => {
    const junk = new Uint8Array([1, 2, 3]);
    assert.deepEqual(await optimizePng(junk), junk);
  });
});
