import { crc32, deflateSync } from 'node:zlib'

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

/** A real `w`×`h` grey PNG. */
export function png(w = 2, h = 2) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 0, 0, 0, 0], 8)
  const rows = Buffer.alloc((w + 1) * h, 0x80)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A JPEG's structure: SOI, a baseline frame header of `w`×`h`, a scan, EOI. */
export function jpeg(w = 2, h = 2) {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])
  const sos = Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0])
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    sof,
    sos,
    Buffer.from([1, 2, 3]),
    Buffer.from([0xff, 0xd9]),
  ])
}

export function gif(w = 1, h = 1) {
  const head = Buffer.from('GIF89a', 'latin1')
  const screen = Buffer.alloc(7)
  screen.writeUInt16LE(w, 0)
  screen.writeUInt16LE(h, 2)
  const image = Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0])
  return Buffer.concat([head, screen, image, Buffer.from([0x3b])])
}

/** A lossless WebP of `w`×`h` (header only: what the server reads). */
export function webp(w = 1, h = 1) {
  const data = Buffer.alloc(10)
  data[0] = 0x2f
  data.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1)
  const vp8l = Buffer.concat([Buffer.from('VP8L', 'latin1'), Buffer.alloc(4), data])
  vp8l.writeUInt32LE(data.length, 4)
  const riff = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'latin1'),
    vp8l,
  ])
  riff.writeUInt32LE(riff.length - 8, 4)
  return riff
}
