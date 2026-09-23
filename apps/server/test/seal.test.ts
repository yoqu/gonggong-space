import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { describe, expect, it } from 'vitest'
import { FILE_OVERHEAD, open, openFile, seal, sealStream } from '../src/lib/seal.js'

const dir = mkdtempSync(join(tmpdir(), 'aiws-seal-'))
const drain = async (s: Readable) => Buffer.concat(await s.toArray())

async function sealFile(name: string, data: Buffer) {
  const path = join(dir, name)
  await pipeline(
    Readable.from([data.subarray(0, 7), data.subarray(7)]),
    sealStream(),
    createWriteStream(path),
  )
  return path
}

describe('seal (strings)', () => {
  it('round-trips through a versioned AES-GCM envelope with a fresh IV each time', () => {
    const text = 'diff --git a/.env b/.env\n+退款 ✓'
    const a = seal(text)
    expect(a).toMatch(/^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/=]{24}:[A-Za-z0-9+/=]+$/)
    expect(a).not.toContain('diff')
    expect(seal(text)).not.toBe(a)
    expect(open(a)).toBe(text)
    expect(open(seal(''))).toBe('')
  })

  it('refuses tampered ciphertext', () => {
    const [v, iv, tag, ct] = seal('hello world').split(':') as [string, string, string, string]
    const flipped = Buffer.from(ct, 'base64')
    flipped[0]! ^= 1
    expect(() => open([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
    expect(() => open([v, iv, Buffer.alloc(16).toString('base64'), ct].join(':'))).toThrow()
  })

  it('passes rows written before encryption through unchanged', () => {
    expect(open('plain legacy patch')).toBe('plain legacy patch')
  })
})

describe('seal (files)', () => {
  it('encrypts a stream on disk and decrypts it back', async () => {
    const data = randomBytes(100_000)
    const path = await sealFile('a.bin', data)
    const disk = readFileSync(path)
    expect(disk.length).toBe(data.length + FILE_OVERHEAD)
    expect(disk.includes(data.subarray(0, 32))).toBe(false)
    expect(await drain(await openFile(path))).toEqual(data)
  })

  it('handles empty files', async () => {
    const path = await sealFile('empty.bin', Buffer.alloc(0))
    expect(await drain(await openFile(path))).toEqual(Buffer.alloc(0))
  })

  it('fails the stream when the file was tampered with', async () => {
    const path = await sealFile('t.bin', Buffer.from('attachment body'))
    const disk = readFileSync(path)
    disk[disk.length - 17]! ^= 1
    writeFileSync(path, disk)
    await expect(drain(await openFile(path))).rejects.toThrow()
  })

  it('serves files stored before encryption as they are', async () => {
    const path = join(dir, 'legacy.png')
    writeFileSync(path, 'legacy bytes')
    expect((await drain(await openFile(path))).toString()).toBe('legacy bytes')
  })
})
