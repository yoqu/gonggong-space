import {
  CAST_INPUT_TOPIC,
  CAST_KEYS,
  type CastInput,
  LIVE_WATCH_SECONDS,
  type LiveFps,
  type LiveTokenDto,
} from '@gonggong/protocol'
import {
  ConnectionQuality,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText } from '../../lib/api'
import {
  autoFps,
  type FpsPick,
  fpsPicks,
  type Grade,
  grade,
  type LiveStats,
  measure,
  type QualityPick,
  qualityPicks,
  type Settled,
  sample,
  settle,
} from './stats'

/** Renews the watch lease well within its lifetime. */
const RENEW_MS = (LIVE_WATCH_SECONDS * 1000) / 3

/** The server's own LiveKit, proxied at `/livekit` on this origin. */
const serverLiveKit = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/livekit`

/**
 * Joins a live preview's room (plan B4) and hands back its video track; `send` delivers input to the machine (LiveKit
 * drops it unless this member has control). The machine publishes only while someone holds `useWatch`.
 */
export function useLiveRoom(previewId: string) {
  const [track, setTrack] = useState<RemoteTrack | null>(null)
  const [publication, setPublication] = useState<RemoteTrackPublication | null>(null)
  const [weak, setWeak] = useState<Weak>({ machine: false, me: false })
  const [error, setError] = useState<string | null>(null)
  const room = useRef<Room | null>(null)

  useEffect(() => {
    let left = false
    // No adaptive stream: it would pick the quality layer by the box's size, and a small box blurs the text.
    const r = new Room({ adaptiveStream: false })
    room.current = r
    r.on(RoomEvent.TrackSubscribed, (t: RemoteTrack, pub: RemoteTrackPublication) => {
      if (t.kind !== Track.Kind.Video) return
      setTrack(t)
      setPublication(pub)
    })
    r.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => setTrack((cur) => (cur === t ? null : cur)))
    r.on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, who: Participant) => {
      const bad = q === ConnectionQuality.Poor || q === ConnectionQuality.Lost
      if (who.identity === CAST) setWeak((w) => ({ ...w, machine: bad }))
      else if (who.identity === r.localParticipant.identity) setWeak((w) => ({ ...w, me: bad }))
    })
    api
      .post<LiveTokenDto>(`/previews/${previewId}/live`)
      .then(({ url, token }) => (left ? undefined : r.connect(url ?? serverLiveKit(), token)))
      .catch((e) => {
        if (!left) setError(errorText(e))
      })
    return () => {
      left = true
      setTrack(null)
      setPublication(null)
      void r.disconnect()
    }
  }, [previewId])

  const send = useCallback((input: CastInput) => {
    void room.current?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(input)), {
      reliable: true,
      destinationIdentities: [CAST],
      topic: CAST_INPUT_TOPIC,
    })
  }, [])

  return { track, publication, weak, error, send }
}

/** Keeps the machine publishing while mounted, at `fps` or above (another viewer may ask for more). */
export function useWatch(previewId: string, fps: LiveFps) {
  useEffect(() => {
    const watch = () => api.post(`/previews/${previewId}/watch`, { fps }).catch(() => {})
    void watch()
    const timer = setInterval(watch, RENEW_MS)
    return () => clearInterval(timer)
  }, [previewId, fps])
}

/** gg-cast's identity in the room. */
const CAST = 'cast'

/** Whose connection LiveKit rates poor: the machine's upload, or this viewer's own. */
export type Weak = { machine: boolean; me: boolean }

const STATS_MS = 1000

/** The picture's figures, once a second, with a grade that only changes once it holds (see `settle`). */
export function useLiveStats(track: RemoteTrack | null) {
  const [state, setState] = useState<{ stats: LiveStats; grade: Grade } | null>(null)

  useEffect(() => {
    if (!track) return
    let prev: ReturnType<typeof sample> | undefined
    let settled: Settled | undefined
    const timer = setInterval(async () => {
      const report = await track.getRTCStatsReport()
      if (!report) return
      const cur = sample(report, Date.now())
      if (prev) {
        const stats = measure(cur, prev)
        settled = settle(settled, grade(stats))
        setState({ stats, grade: settled.grade })
      }
      prev = cur
    }, STATS_MS)
    return () => {
      clearInterval(timer)
      setState(null)
    }
  }, [track])

  return state
}

function saved<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return valid.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

/** A pick remembered in this browser. */
export function useSaved<T extends string>(key: string, valid: readonly T[], fallback: T) {
  const [value, setValue] = useState(() => saved(key, valid, fallback))
  const choose = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, v)
      } catch {}
    },
    [key],
  )
  return [value, choose] as const
}

/**
 * This viewer's quality layer: automatic by default (LiveKit lowers it to fit their bandwidth), or a layer they pick.
 * Picks are caps; LiveKit still steps down when the network cannot carry them. `width`: the frame arriving now.
 */
export function useQuality(publication: RemoteTrackPublication | null, fps: LiveFps, width: number | null) {
  const [pick, choose] = useSaved<QualityPick>(
    'gonggong.live.quality',
    ['auto', 'high', 'medium', 'low'],
    'auto',
  )
  const info = publication?.trackInfo
  const picks = useMemo(
    () => qualityPicks(info?.codecs[0]?.layers ?? info?.layers ?? [], fps, width),
    [info, fps, width],
  )
  const chosen = picks.find((p) => p.value === pick) ?? picks[0]
  const quality = chosen?.quality

  useEffect(() => {
    if (publication && quality !== undefined) publication.setVideoQuality(quality)
  }, [publication, quality])

  return { picks, pick: chosen?.value ?? 'auto', choose }
}

/** The frame rate this viewer asks the machine for: automatic by the network's grade, or picked. */
export function useFrameRate(g: Grade | undefined) {
  const [pick, choose] = useSaved<FpsPick>('gonggong.live.fps', ['auto', '30', '60', '90'], 'auto')
  const auto = autoFps(g ?? 'good')
  const fps = pick === 'auto' ? auto : (Number(pick) as LiveFps)
  return { picks: fpsPicks(auto), pick, choose, fps }
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
