import { z } from 'zod'

/**
 * Preview tunnel (`/ws/daemon/tunnel`, machine token as Bearer): the server multiplexes HTTP requests and upgraded
 * connections (WebSocket, HMR) to the daemon's loopback ports over one binary WebSocket. Frame =
 * `[streamId u32 BE][type u8][payload]`; streams are opened by the server only. `open` / `head` / `reset` carry JSON,
 * `data` body bytes (after a 101: the raw connection bytes), `end` nothing (that direction is done).
 */
export const TUNNEL_FRAME = { open: 1, head: 2, data: 3, end: 4, reset: 5 } as const
export type TunnelFrameType = (typeof TUNNEL_FRAME)[keyof typeof TUNNEL_FRAME]
/** Concurrent streams per machine; the server resets new ones beyond it. */
export const TUNNEL_MAX_STREAMS = 64

const HEADER = 5
const TYPES = new Set<number>(Object.values(TUNNEL_FRAME))

export function encodeFrame(streamId: number, type: TunnelFrameType, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HEADER + payload.length)
  new DataView(frame.buffer).setUint32(0, streamId)
  frame[4] = type
  frame.set(payload, HEADER)
  return frame
}

export function decodeFrame(frame: Uint8Array) {
  if (frame.length < HEADER) throw new Error('tunnel frame too short')
  const type = frame[4] as number
  if (!TYPES.has(type)) throw new Error(`unknown tunnel frame type ${type}`)
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  return { streamId: view.getUint32(0), type: type as TunnelFrameType, payload: frame.subarray(HEADER) }
}

/** Ordered name/value pairs: repeated headers such as set-cookie must survive. */
export const TunnelHeaders = z.array(z.tuple([z.string(), z.string()]))

export const TunnelOpen = z.object({
  previewId: z.string(),
  port: z.number().int().min(1).max(65535),
  method: z.string(),
  /** Path and query as the browser sent them. */
  path: z.string(),
  headers: TunnelHeaders,
  /** Upgrade request: after `head` 101 the stream carries the raw connection both ways. */
  upgrade: z.boolean(),
})
export type TunnelOpen = z.infer<typeof TunnelOpen>

export const TunnelHead = z.object({ status: z.number().int(), headers: TunnelHeaders })
export type TunnelHead = z.infer<typeof TunnelHead>

export const TunnelReset = z.object({ reason: z.string() })
export type TunnelReset = z.infer<typeof TunnelReset>
