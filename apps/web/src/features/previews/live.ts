import {
  CAST_INPUT_TOPIC,
  CAST_KEYS,
  type CastInput,
  LIVE_WATCH_SECONDS,
  type LiveTokenDto,
} from '@gonggong/protocol'
import { type RemoteTrack, Room, RoomEvent, Track } from 'livekit-client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { errorText } from '../auth/AuthCard'

/** Renews the watch lease well within its lifetime. */
const RENEW_MS = (LIVE_WATCH_SECONDS * 1000) / 3

/** The server's own LiveKit, proxied at `/livekit` on this origin. */
const serverLiveKit = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/livekit`

/**
 * Watches a live preview (plan B4): keeps the machine publishing while mounted, joins the preview's room and hands
 * back its video track; `send` delivers input to the machine (LiveKit drops it unless this member has control).
 */
export function useLiveRoom(previewId: string) {
  const [track, setTrack] = useState<RemoteTrack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const room = useRef<Room | null>(null)

  useEffect(() => {
    let left = false
    const r = new Room({ adaptiveStream: false })
    room.current = r
    r.on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => {
      if (t.kind === Track.Kind.Video) setTrack(t)
    })
    r.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => setTrack((cur) => (cur === t ? null : cur)))
    const watch = () => api.post(`/previews/${previewId}/watch`).catch(() => {})
    void watch()
    const timer = setInterval(watch, RENEW_MS)
    api
      .post<LiveTokenDto>(`/previews/${previewId}/live`)
      .then(({ url, token }) => (left ? undefined : r.connect(url ?? serverLiveKit(), token)))
      .catch((e) => {
        if (!left) setError(errorText(e))
      })
    return () => {
      left = true
      clearInterval(timer)
      setTrack(null)
      void r.disconnect()
    }
  }, [previewId])

  const send = useCallback((input: CastInput) => {
    void room.current?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(input)), {
      reliable: true,
      destinationIdentities: ['cast'],
      topic: CAST_INPUT_TOPIC,
    })
  }, [])

  return { track, error, send }
}

/**
 * Where a pointer is on the picture, as fractions of the frame; null over the letterbox bars (object-fit: contain),
 * or with `clamp` the nearest edge (a drag released outside must still release on the machine).
 */
export function framePoint(video: HTMLVideoElement, clientX: number, clientY: number, clamp = false) {
  const { videoWidth: vw, videoHeight: vh } = video
  if (!vw || !vh) return null
  const r = video.getBoundingClientRect()
  const scale = Math.min(r.width / vw, r.height / vh)
  const [w, h] = [vw * scale, vh * scale]
  const x = (clientX - r.left - (r.width - w) / 2) / w
  const y = (clientY - r.top - (r.height - h) / 2) / h
  const inside = (v: number) => v >= 0 && v <= 1
  if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  return inside(x) && inside(y) ? { x, y } : null
}

type Mods = Extract<CastInput, { t: 'key' }>['mods']

/** A key press as input: named keys and shortcuts; null for characters, which arrive as typed text. */
export function keyInput(e: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): CastInput | null {
  const mods: Mods = []
  if (e.metaKey) mods.push('meta')
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  if ((CAST_KEYS as readonly string[]).includes(e.key))
    return { t: 'key', key: e.key as (typeof CAST_KEYS)[number], mods }
  const shortcut = (e.metaKey || e.ctrlKey) && /^[a-z0-9]$/i.test(e.key)
  return shortcut ? { t: 'key', key: e.key.toLowerCase(), mods } : null
}
