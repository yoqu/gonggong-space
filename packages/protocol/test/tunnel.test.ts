import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeFrame, encodeFrame, type TunnelFrameType } from '../src/index.js'

type Case = { streamId: number; type: TunnelFrameType; payloadHex: string; frameHex: string }
const cases: Case[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '../cases/tunnel-frames.json'), 'utf8'),
)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

describe('tunnel frames (shared with the Rust daemon)', () => {
  it.each(cases)('stream $streamId type $type', (c) => {
    const frame = encodeFrame(c.streamId, c.type, Buffer.from(c.payloadHex, 'hex'))
    expect(hex(frame)).toBe(c.frameHex)
    const back = decodeFrame(Buffer.from(c.frameHex, 'hex'))
    expect({ ...back, payload: hex(back.payload) }).toEqual({
      streamId: c.streamId,
      type: c.type,
      payload: c.payloadHex,
    })
  })

  it('rejects truncated or unknown frames', () => {
    expect(() => decodeFrame(new Uint8Array([0, 0, 0, 1]))).toThrow()
    expect(() => decodeFrame(new Uint8Array([0, 0, 0, 1, 9]))).toThrow()
  })
})
