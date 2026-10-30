import { crc32 } from 'node:zlib'

type Size = { width: number; height: number }

/** PNG: every chunk whole with a matching CRC, IHDR first with a size, at least one IDAT, IEND last. */
function png(b: Buffer): Size | null {
  let at = 8
  let size: Size | null = null
  let idat = false
  while (at + 12 <= b.length) {
    const len = b.readUInt32BE(at)
    const type = b.toString('latin1', at + 4, at + 8)
    const end = at + 12 + len
    if (end > b.length) return null
    if (crc32(b.subarray(at + 4, at + 8 + len)) !== b.readUInt32BE(at + 8 + len)) return null
    if (at === 8) {
      if (type !== 'IHDR' || len !== 13) return null
      size = { width: b.readUInt32BE(at + 8), height: b.readUInt32BE(at + 12) }
    }
    if (type === 'IDAT') idat = true
    if (type === 'IEND') return idat && end === b.length ? size : null
    at = end
  }
  return null
}

/** JPEG: well-formed segments up to the scan, a frame header (SOFn) with a size before it, EOI after it. */
function jpeg(b: Buffer): Size | null {
  let at = 2
  let size: Size | null = null
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1] as number
    if (marker === 0xff) {
      at++
      continue
    }
    const len = b.readUInt16BE(at + 2)
    if (len < 2 || at + 2 + len > b.length) return null
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (sof) {
      if (len < 7) return null
      size = { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) }
    }
    if (marker === 0xda) return size && b.lastIndexOf(Buffer.from([0xff, 0xd9])) > at ? size : null
    at += 2 + len
  }
  return null
}

/** GIF: a logical screen size, at least one image descriptor's worth of data, the trailer last. */
function gif(b: Buffer): Size | null {
  if (b.length < 14 || b[b.length - 1] !== 0x3b) return null
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
}

/** WebP: the RIFF size within the file and the size of its first chunk (lossy, lossless or extended). */
function webp(b: Buffer): Size | null {
  if (b.length < 30 || b.readUInt32LE(4) + 8 > b.length) return null
  const chunk = b.toString('latin1', 12, 16)
  if (b.readUInt32LE(16) + 20 > b.length) return null
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
  return null
}

const READERS: Record<string, (b: Buffer) => Size | null> = { png, jpg: jpeg, gif, webp }

/**
 * Whether an upload whose magic bytes passed is a whole image: its structure reads through and its size is not zero
 * (a truncated or garbled file would show as an empty box on the screen).
 */
export function readableImage(ext: string, b: Buffer) {
  const read = READERS[ext]
  if (!read) return true
  try {
    const size = read(b)
    return !!size && size.width > 0 && size.height > 0
  } catch {
    return false
  }
}
